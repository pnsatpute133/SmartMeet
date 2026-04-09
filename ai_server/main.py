"""
SmartMeet AI Server — YOLOv11 Student Engagement Monitor
FastAPI + Ultralytics YOLO + MediaPipe (head pose)
"""

import io
import time
import base64
import logging
import math
from collections import defaultdict, deque

import cv2
import numpy as np
from typing import Optional, Tuple
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ── Optional: MediaPipe for head-pose estimation ──────────────────────────
try:
    import mediapipe as mp
    mp_face_mesh = mp.solutions.face_mesh
    face_mesh_solver = mp_face_mesh.FaceMesh(
        static_image_mode=True,
        max_num_faces=4,
        refine_landmarks=True,
        min_detection_confidence=0.5,
    )
    MEDIAPIPE_OK = True
except (ImportError, AttributeError, Exception) as _mp_err:
    MEDIAPIPE_OK = False
    face_mesh_solver = None
    logging.warning(f"[AI] MediaPipe unavailable ({_mp_err}) — head-pose disabled")

# ── YOLO ──────────────────────────────────────────────────────────────────
from ultralytics import YOLO

logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s.%(msecs)03d [%(levelname)-8s] [%(name)s] %(message)s',
    datefmt='%H:%M:%S',
)
logger = logging.getLogger("smartmeet-ai")
# Silence noisy third-party loggers
logging.getLogger("ultralytics").setLevel(logging.WARNING)
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
logging.getLogger("multipart").setLevel(logging.WARNING)

# Log MediaPipe status after logger is ready
if MEDIAPIPE_OK:
    logger.info("[AI] ✅ MediaPipe FaceMesh loaded successfully")
else:
    logger.warning("[AI] ⚠️ MediaPipe not available — head-pose features disabled")

app = FastAPI(title="SmartMeet AI Server", version="2.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Load YOLOv11 model once at startup ────────────────────────────────────
MODEL_PATH = "yolo11n.pt"   # auto-downloaded on first run
yolo_model: Optional[YOLO] = None

# ── Behaviour history per user (sliding 60-second window) ─────────────────
# Structure: { userId -> deque of (timestamp, status) }
HISTORY_WINDOW_SEC = 60
behaviour_history: dict[str, deque] = defaultdict(lambda: deque(maxlen=120))

# ── COCO class indices we care about ──────────────────────────────────────
PERSON_CLASS   = 0
LAPTOP_CLASS   = 63
PHONE_CLASS    = 67   # "cell phone" in COCO-80
TABLET_CLASS   = 73   # Often "book" or similar in YOLOv8/11 default coco if not specialized, but 67 is primary for handhelds. 
                      # COCO-80 specifically: 63:laptop, 67:cell phone. We'll stick to these.

# ── EAR & MAR Constants (MediaPipe) ─────────────────────────────────────────────
EYE_AR_THRESH = 0.22      
MOUTH_AR_THRESH = 0.08    # Above this, user is likely speaking or moving lips

# Landmark indices
LEFT_EYE_IDXS  = [362, 385, 387, 263, 373, 380]
RIGHT_EYE_IDXS = [33, 160, 158, 133, 153, 144]
MOUTH_IDXS = [13, 14, 78, 308] # Vertical (13,14), Horizontal (78,308)

# ══════════════════════════════════════════════════════════════════════════
# REQUEST / RESPONSE MODELS
# ══════════════════════════════════════════════════════════════════════════
class FrameRequest(BaseModel):
    userId:  str
    roomId:  str
    frame:   str          # base-64 encoded JPEG/PNG
    ts:      float = 0.0  # client timestamp (ms)
    isMuted: bool  = True # Whether the student is muted locally

class DetectionResult(BaseModel):
    userId:     str
    roomId:     str
    status:     str         # attentive | distracted | phone | multiple_people | no_face | drowsy | poor_posture | speaking
    confidence: float
    details:    dict
    alert:      Optional[str]
    insights:   dict        # agentic behaviour summary
    timeline:   list        # behavior history for reporting

# ══════════════════════════════════════════════════════════════════════════
# STARTUP / SHUTDOWN
# ══════════════════════════════════════════════════════════════════════════
@app.on_event("startup")
async def load_model():
    global yolo_model
    logger.info("[AI] 🚀 SmartMeet AI Server starting up...")
    logger.info(f"[AI] MediaPipe available: {MEDIAPIPE_OK}")
    logger.info(f"[AI] Loading YOLOv11 model from: {MODEL_PATH}")
    t0 = time.time()
    yolo_model = YOLO(MODEL_PATH)
    # warm-up pass
    dummy = np.zeros((480, 640, 3), dtype=np.uint8)
    yolo_model(dummy, verbose=False)
    elapsed = round(time.time() - t0, 2)
    logger.info(f"[AI] ✅ YOLOv11 model ready (loaded in {elapsed}s)")
    logger.info(f"[AI] 📊 History window: {HISTORY_WINDOW_SEC}s | Capture interval: set by client")


# ══════════════════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════════════════
def b64_to_cv2(b64_str: str) -> np.ndarray:
    """Decode base-64 image string → OpenCV BGR array."""
    b64_str = b64_str.split(",")[-1]  # strip data-URI prefix if present
    buf = base64.b64decode(b64_str)
    arr = np.frombuffer(buf, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        logger.error("[AI] ❌ b64_to_cv2: could not decode image (imdecode returned None)")
        raise ValueError("Could not decode image")
    logger.debug(f"[AI] 🖼️ Frame decoded: shape={img.shape} | b64_len={len(b64_str)}")
    return img


def aspect_ratio(landmarks, idxs, w, h):
    """Generic aspect ratio for eye (EAR) or mouth (MAR)."""
    pts = [np.array([landmarks[i].x * w, landmarks[i].y * h]) for i in idxs]
    if len(idxs) == 4: # MAR (Vertical pt13-14 / Horizontal pt78-308)
        v = np.linalg.norm(pts[0] - pts[1])
        horiz = np.linalg.norm(pts[2] - pts[3])
        return v / (horiz + 1e-6)
    else: # EAR
        v1 = np.linalg.norm(pts[1] - pts[5])
        v2 = np.linalg.norm(pts[2] - pts[4])
        horiz = np.linalg.norm(pts[0] - pts[3])
        return (v1 + v2) / (2.0 * horiz + 1e-6)


def estimate_advanced_features(img_rgb: np.ndarray) -> dict:
    """
    Use MediaPipe FaceMesh to estimate:
    - Head pose (Yaw, Pitch)
    - Drowsiness (EAR)
    - Lip movement (MAR)
    - Posture (Vertical deviation)
    """
    if not MEDIAPIPE_OK:
        logger.debug("[AI] MediaPipe unavailable, returning defaults")
        return {"yaw": 0.0, "pitch": 0.0, "facing_forward": True, "ear": 0.3, "mar": 0.0, "is_drowsy": False, "posture_score": 100}

    h, w = img_rgb.shape[:2]
    results = face_mesh_solver.process(img_rgb)
    
    if not results.multi_face_landmarks:
        logger.debug("[AI] No face landmarks found by MediaPipe")
        return {"yaw": 0.0, "pitch": 0.0, "facing_forward": False, "ear": 0.0, "mar": 0.0, "is_drowsy": False, "posture_score": 0}

    lm = results.multi_face_landmarks[0].landmark

    # 1. Head Pose Estimation
    def pt(idx):
        l = lm[idx]
        return np.array([l.x * w, l.y * h, l.z * w])

    nose    = pt(1)
    eye_mid = (pt(33) + pt(263)) / 2 
    
    # Yaw
    dx = nose[0] - eye_mid[0]
    eye_width = np.linalg.norm(pt(33) - pt(263)) + 1e-6
    yaw = math.degrees(math.atan2(dx, eye_width)) * 2.2
    
    # Pitch
    face_height = np.linalg.norm(pt(10) - pt(152)) + 1e-6
    dy = nose[1] - (pt(10)[1] + face_height * 0.35)
    pitch = math.degrees(math.atan2(dy, face_height)) * 1.8

    facing_forward = (abs(yaw) < 26) and (pitch > -21)

    # 2. Drowsiness (EAR)
    ear_l = aspect_ratio(lm, LEFT_EYE_IDXS, w, h)
    ear_r = aspect_ratio(lm, RIGHT_EYE_IDXS, w, h)
    avg_ear = (ear_l + ear_r) / 2.0
    is_drowsy = avg_ear < EYE_AR_THRESH

    # 3. Speaking Detection (MAR)
    mar = aspect_ratio(lm, MOUTH_IDXS, w, h)
    is_speaking = mar > MOUTH_AR_THRESH

    # 4. Posture Detection
    nose_y_norm = lm[1].y
    posture_score = 100
    if nose_y_norm > 0.65: # Head is too low
        posture_score = max(0, 100 - int((nose_y_norm - 0.65) * 400))

    features = {
        "yaw": round(yaw, 1),
        "pitch": round(pitch, 1),
        "facing_forward": facing_forward,
        "ear": round(avg_ear, 3),
        "mar": round(mar, 3),
        "is_drowsy": is_drowsy,
        "is_speaking": is_speaking,
        "posture_score": posture_score,
        "slumping": posture_score < 70
    }
    logger.debug(
        f"[AI] MediaPipe: yaw={features['yaw']}° pitch={features['pitch']}° "
        f"ear={features['ear']} mar={features['mar']} "
        f"facing={features['facing_forward']} drowsy={features['is_drowsy']} speaking={features['is_speaking']}"
    )
    return features


def classify_behaviour(
    person_count: int,
    phone_detected: bool,
    laptop_detected: bool,
    advanced: dict,
    is_muted: bool,
    yolo_conf: float,
) -> Tuple[str, Optional[str], float]:
    """
    Priority-based behavior classification.
    """
    if person_count == 0:
        logger.debug("[Classify] status=no_face")
        return "no_face", "⚠️ No face detected", 0.5

    if person_count > 1:
        logger.debug(f"[Classify] status=multiple_people | count={person_count}")
        return "multiple_people", "🚨 Unauthorized person", 0.98

    if phone_detected:
        logger.debug("[Classify] status=phone")
        return "phone", "Stop using phone", 0.95

    if advanced.get("is_drowsy"):
        logger.debug(f"[Classify] status=drowsy | EAR={advanced.get('ear')}")
        return "drowsy", "Stay alert", 0.90

    if advanced.get("slumping"):
        logger.debug(f"[Classify] status=poor_posture | score={advanced.get('posture_score')}")
        return "poor_posture", "Sit straight", 0.80

    if not advanced.get("facing_forward"):
        logger.debug(f"[Classify] status=distracted | yaw={advanced.get('yaw')} pitch={advanced.get('pitch')}")
        return "distracted", "Pay attention", 0.82

    if advanced.get("is_speaking") and is_muted:
        logger.debug("[Classify] status=speaking_muted")
        return "speaking_muted", "You are speaking while muted", 0.85
    
    if advanced.get("is_speaking"):
        logger.debug("[Classify] status=speaking")
        return "speaking", None, 0.90

    conf = min(0.70 + yolo_conf * 0.30, 0.99)
    logger.debug(f"[Classify] status=attentive | conf={conf:.3f}")
    return "attentive", None, conf


def get_agentic_insights(user_id: str) -> dict:
    """
    Analyse history and generate actionable summaries.
    """
    history = list(behaviour_history[user_id])
    now = time.time()
    window = [(ts, st) for ts, st in history if now - ts < HISTORY_WINDOW_SEC]

    if not window:
        logger.debug(f"[Insights] No history for userId={user_id}")
        return {"summary": "Initializing...", "engagement_score": 0, "suggestions": [], "timeline": []}

    counts = defaultdict(int)
    for _, st in window:
        counts[st] += 1
    total = len(window)

    # SECONDS ESTIMATION (approx 2s interval)
    att_sec    = round(counts["attentive"] * 2.0)
    dist_sec   = round((counts["distracted"] + counts["phone"]) * 2.0)
    drowsy_sec = round(counts["drowsy"] * 2.0)
    
    # Advanced Score logic
    score = (counts["attentive"] * 1.0 + counts["speaking"] * 1.0 + counts["poor_posture"] * 0.6 + counts["distracted"] * 0.4) / total * 100
    score = min(100, round(score))

    suggestions = []
    if score < 40: suggestions.append("Critical: Engagement is failing.")
    if drowsy_sec > 15: suggestions.append("Drowsiness pattern — suggest a 1-min break.")
    if counts["speaking_muted"] > 3: suggestions.append("Student keeps trying to talk while muted.")

    dominant = max(counts, key=counts.get) if counts else "unknown"
    logger.debug(
        f"[Insights] userId={user_id} | score={score} | dominant={dominant} "
        f"| attentive={att_sec}s dist={dist_sec}s drowsy={drowsy_sec}s | window={total} samples"
    )
    
    return {
        "summary": f"Engagement: {score}%. Tone: {dominant}.",
        "engagement_score": score,
        "attentive_pct": round(counts["attentive"] / total * 100) if total else 0,
        "suggestions": suggestions,
        "timeline": [st for _, st in window][-20:] 
    }


# ══════════════════════════════════════════════════════════════════════════
# MAIN DETECTION ENDPOINT
# ══════════════════════════════════════════════════════════════════════════
@app.post("/detect", response_model=DetectionResult)
async def detect(req: FrameRequest):
    t_start = time.time()
    logger.debug(f"[/detect] → userId={req.userId} | roomId={req.roomId} | isMuted={req.isMuted} | ts={req.ts}")

    if yolo_model is None:
        logger.error("[/detect] YOLO model not loaded yet!")
        raise HTTPException(503, "Model loading...")

    try:
        img_bgr = b64_to_cv2(req.frame)
    except Exception as e:
        logger.error(f"[/detect] Frame decode failed: {e}")
        raise HTTPException(400, f"Bad frame: {e}")

    # Process frame
    h, w = img_bgr.shape[:2]
    orig_size = (w, h)
    if w > 640:
        scale = 640 / w
        img_bgr = cv2.resize(img_bgr, (640, int(h * scale)))
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    logger.debug(f"[/detect] Frame: orig={orig_size} resized={img_bgr.shape[:2][::-1]}")

    # 1. YOLO Inference
    t_yolo = time.time()
    results = yolo_model(img_bgr, verbose=False, conf=0.30)[0]
    boxes   = results.boxes
    logger.debug(f"[/detect] YOLO done in {round((time.time()-t_yolo)*1000)}ms | detections={len(boxes)}")

    person_count    = 0
    phone_detected  = False
    laptop_detected = False
    max_yolo_conf   = 0.0

    for box in boxes:
        cls  = int(box.cls[0])
        conf = float(box.conf[0])
        label = results.names[cls]
        logger.debug(f"[YOLO] box: class={cls}({label}) conf={conf:.2f}")
        if cls == PERSON_CLASS:
            person_count += 1
            max_yolo_conf = max(max_yolo_conf, conf)
        elif cls == PHONE_CLASS:
            phone_detected = True
        elif cls == LAPTOP_CLASS:
            laptop_detected = True

    logger.debug(
        f"[/detect] YOLO summary: persons={person_count} "
        f"phone={phone_detected} laptop={laptop_detected} max_conf={max_yolo_conf:.2f}"
    )

    # 2. MediaPipe Features
    t_mp = time.time()
    advanced = estimate_advanced_features(img_rgb)
    logger.debug(f"[/detect] MediaPipe done in {round((time.time()-t_mp)*1000)}ms")

    # 3. Behavior Logic
    status, alert, confidence = classify_behaviour(
        person_count, phone_detected, laptop_detected, advanced, req.isMuted, max_yolo_conf
    )
    logger.info(
        f"[/detect] ✅ userId={req.userId} | status=\033[1m{status}\033[0m "
        f"conf={confidence:.2f} | alert={alert!r} | "
        f"total_ms={round((time.time()-t_start)*1000)}"
    )

    # 4. Agentic Logic
    behaviour_history[req.userId].append((time.time(), status))
    logger.debug(f"[/detect] History for {req.userId}: {len(behaviour_history[req.userId])} entries")
    insights = get_agentic_insights(req.userId)

    return DetectionResult(
        userId=req.userId,
        roomId=req.roomId,
        status=status,
        confidence=round(confidence, 3),
        details={
            "persons": person_count,
            "distractions": {"phone": phone_detected, "laptop": laptop_detected},
            "biometrics": advanced
        },
        alert=alert,
        insights=insights,
        timeline=insights.get("timeline", [])
    )


@app.get("/insights/{userId}")
async def insights(userId: str):
    logger.debug(f"[/insights] userId={userId} | history_len={len(behaviour_history.get(userId, []))}")
    return get_agentic_insights(userId)


@app.get("/health")
async def health():
    tracked_users = len(behaviour_history)
    model_status = "loaded" if yolo_model is not None else "not_loaded"
    mediapipe_status = "ok" if MEDIAPIPE_OK else "unavailable"
    logger.debug(f"[/health] model={model_status} | mediapipe={mediapipe_status} | tracked_users={tracked_users}")
    return {
        "status": "ok",
        "model": model_status,
        "mediapipe": mediapipe_status,
        "users": tracked_users,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)

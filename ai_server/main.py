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

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("smartmeet-ai")

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
    logger.info("[AI] Loading YOLOv11 model …")
    yolo_model = YOLO(MODEL_PATH)
    # warm-up pass
    dummy = np.zeros((480, 640, 3), dtype=np.uint8)
    yolo_model(dummy, verbose=False)
    logger.info("[AI] ✅ YOLOv11 model ready")


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
        raise ValueError("Could not decode image")
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
        return {"yaw": 0.0, "pitch": 0.0, "facing_forward": True, "ear": 0.3, "mar": 0.0, "is_drowsy": False, "posture_score": 100}

    h, w = img_rgb.shape[:2]
    results = face_mesh_solver.process(img_rgb)
    
    if not results.multi_face_landmarks:
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

    return {
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
        return "no_face", "⚠️ No face detected", 0.5

    if person_count > 1:
        return "multiple_people", "🚨 Unauthorized person", 0.98

    if phone_detected:
        return "phone", "Stop using phone", 0.95

    if advanced.get("is_drowsy"):
        return "drowsy", "Stay alert", 0.90

    if advanced.get("slumping"):
        return "poor_posture", "Sit straight", 0.80

    if not advanced.get("facing_forward"):
        return "distracted", "Pay attention", 0.82

    if advanced.get("is_speaking") and is_muted:
        return "speaking_muted", "You are speaking while muted", 0.85
    
    if advanced.get("is_speaking"):
        return "speaking", None, 0.90

    return "attentive", None, min(0.70 + yolo_conf * 0.30, 0.99)


def get_agentic_insights(user_id: str) -> dict:
    """
    Analyse history and generate actionable summaries.
    """
    history = list(behaviour_history[user_id])
    now = time.time()
    window = [(ts, st) for ts, st in history if now - ts < HISTORY_WINDOW_SEC]

    if not window:
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
    if yolo_model is None:
        raise HTTPException(503, "Model loading...")

    try:
        img_bgr = b64_to_cv2(req.frame)
    except Exception as e:
        raise HTTPException(400, f"Bad frame: {e}")

    # Process frame
    h, w = img_bgr.shape[:2]
    if w > 640:
        scale = 640 / w
        img_bgr = cv2.resize(img_bgr, (640, int(h * scale)))
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

    # 1. YOLO Inference
    results = yolo_model(img_bgr, verbose=False, conf=0.30)[0]
    boxes   = results.boxes

    person_count    = 0
    phone_detected  = False
    laptop_detected = False
    max_yolo_conf   = 0.0

    for box in boxes:
        cls  = int(box.cls[0])
        conf = float(box.conf[0])
        if cls == PERSON_CLASS:
            person_count += 1
            max_yolo_conf = max(max_yolo_conf, conf)
        elif cls == PHONE_CLASS:
            phone_detected = True
        elif cls == LAPTOP_CLASS:
            laptop_detected = True

    # 2. MediaPipe Features
    advanced = estimate_advanced_features(img_rgb)

    # 3. Behavior Logic
    status, alert, confidence = classify_behaviour(
        person_count, phone_detected, laptop_detected, advanced, req.isMuted, max_yolo_conf
    )

    # 4. Agentic Logic
    behaviour_history[req.userId].append((time.time(), status))
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
    return get_agentic_insights(userId)


@app.get("/health")
async def health():
    return {"status": "ok", "users": len(behaviour_history)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)

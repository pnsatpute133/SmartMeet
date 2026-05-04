/**
 * useEngagementMonitor — v2
 * ─────────────────────────────────────────────────────────────────────────
 * Features:
 *   • aiEnabled toggle (start / stop tracking)
 *   • Per-user behavior time accumulation
 *   • Engagement score calculation
 *   • Agentic pattern analysis + warnings
 *   • Socket relay of AI results
 *   • Exposes saveMeetingReport() for CSV download
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';

import { SERVER_URL, AI_URL } from '../config';

const AI_SERVER_URL  = import.meta.env.VITE_AI_SERVER_URL  || AI_URL;
const API_SERVER_URL = import.meta.env.VITE_API_SERVER_URL || SERVER_URL;
const CAPTURE_MS     = 500;     // Issue 1: fast capture — 2 frames/sec
const JPEG_QUALITY   = 0.45;    // slightly lower quality = faster transfer
const CANVAS_WIDTH   = 320;
const MAX_RETRIES    = 3;
const TICK_SEC       = 0.6;     // adjusted for 500ms interval
const HISTORY_SIZE   = 5;      // Phase 7: short buffer
const CONFIRM_THRESH = 3;       // Phase 7: confirm if >= 3

// Phase 7 & 11: Priority order — higher index = highest priority
const STATUS_PRIORITY = [
  'attentive',
  'distracted',
  'drowsy',
  'phone',
  'multiple_faces',
  'no_face',
];

// Phase 1: Standard Enum
const STATUS_LABEL = {
  attentive:        'Attentive',
  distracted:       'Distracted',
  phone:            'Using Phone',
  drowsy:           'Sleepy',
  no_face:          'Not in Frame',
  multiple_faces:   'Multiple Faces',
  idle:             'Monitoring…',
  error:            'AI Offline',
};

/** Returns highest-priority status from last N frames */
function resolveStatus(history) {
  if (!history.length) return 'idle';
  const counts = {};
  history.forEach(s => { counts[s] = (counts[s] || 0) + 1; });
  for (let i = STATUS_PRIORITY.length - 1; i >= 0; i--) {
    const s = STATUS_PRIORITY[i];
    if ((counts[s] || 0) >= CONFIRM_THRESH) return s;
  }
  return history[history.length - 1];
}

// ── Debug Logger ──────────────────────────────────────────────────────────
const DEBUG = true;
function dbg(tag, ...args) {
  if (!DEBUG) return;
  const ts = new Date().toISOString().substring(11, 23);
  console.log(`%c[${ts}] [AI/${tag}]`, 'color:#a78bfa;font-weight:bold', ...args);
}

// ── Agentic pattern analyser ───────────────────────────────────────────────
function analysePatterns(tracker) {
  const { 
    attentiveTime, distractedTime, phoneTime,
    multiplePeopleTime, drowsyTime, poorPostureTime,
    speakingTime, speakingMutedTime, noFaceTime,
    totalTime, name 
  } = tracker;

  if (!totalTime) return { summary: 'No data yet', warnings: [], engagementScore: 0 };

  const attPct    = Math.round((attentiveTime / totalTime) * 100);
  const distPct   = Math.round((distractedTime / totalTime) * 100);
  const drowsyPct = Math.round((drowsyTime / totalTime) * 100);
  const phonePct  = Math.round((phoneTime / totalTime) * 100);
  const noFacePct = Math.round((noFaceTime / totalTime) * 100);

  const warnings = [];
  if (distractedTime  > 40) warnings.push(`Student distracted (${distPct}%)`);
  if (phoneTime       > 10) warnings.push(`Phone usage detected!`);
  if (drowsyTime      > 15) warnings.push(`Student looks drowsy.`);
  if (attPct          < 40) warnings.push(`Very low focus.`);

  const summary =
    `${name} is ${attPct}% engaged. ` +
    (phonePct > 10 ? `📵 Phone usage. ` : '') +
    (drowsyPct > 10 ? `😴 Sleepy. ` : '');

  return { summary, warnings, engagementScore: attPct };
}

// ── Initial tracker skeleton for one user ─────────────────────────────────
function makeTracker(userId, name) {
  return {
    userId, name,
    joinAt:             new Date().toISOString(),
    totalTime:          0,
    attentiveTime:      0,
    distractedTime:     0,
    phoneTime:          0,
    multiplePeopleTime: 0,
    drowsyTime:         0,
    poorPostureTime:    0,
    speakingTime:       0,
    speakingMutedTime:  0,
    noFaceTime:         0,
    lastStatus:         'idle',
    engagementScore:    0,
    warnings:           [],
    summary:            '',
    timeline:           [],   // [{ timestamp, status }]
  };
}

export default function useEngagementMonitor({
  localStream,
  peerStreams = {},   // { socketId: MediaStream } — for host-side peer monitoring
  participants = [],  // participant list for name lookup
  socket,
  userId,
  roomId,
  userName = 'You',
  isVideoOff = false,
  isMuted = false,      // NEW PROP
  aiEnabled  = false,   // ← TOGGLE
  isHost = false,
}) {
  // ── AI detection state ───────────────────────────────────────────────
  const [status,     setStatus]     = useState('idle');
  const [alert,      setAlert]      = useState(null);
  const [insights,   setInsights]   = useState(null);
  const [confidence, setConfidence] = useState(0);
  const [isRunning,  setIsRunning]  = useState(false);

  // ── Local behavior tracker (own user) ────────────────────────────────
  const [myTracker, setMyTracker] = useState(() => makeTracker(userId, userName));

  // ── All-participant tracker map ───────────────────
  const [allTrackers, setAllTrackers] = useState({});
  const [peerAiData, setPeerAiData]   = useState({}); // socketId → { status, alert, confidence }

  const intervalRef   = useRef(null);
  const canvasRef     = useRef(null);
  const videoRef      = useRef(null);
  const failCountRef  = useRef(0);
  const lastStatusRef = useRef('idle');
  const myTrackerRef  = useRef(myTracker);

  // ── Peer monitoring (host-side) ──────────────────────────────
  const peerVideoEls  = useRef({}); // { socketId: HTMLVideoElement }
  const peerIntervals = useRef({}); // { socketId: intervalId }
  const peerCanvases  = useRef({}); // { socketId: HTMLCanvasElement }
  const peerHistories = useRef({}); // { socketId: string[] } — smoothing buffers

  // Issue 2: Smoothing buffer for self
  const detectionHistoryRef = useRef([]);  // string[]
  // Issue 5: Popup cooldown — track last time
  const lastAlertRef    = useRef(0);
  const prevStatusRef   = useRef('idle');

  // Keep ref in sync
  useEffect(() => { myTrackerRef.current = myTracker; }, [myTracker]);

  // Phase 12: Popup Cooldown (No Spam)
  const showPopup = useCallback((msg) => {
    const now = Date.now();
    if (now - lastAlertRef.current > 1500) {
      setAlert(msg);
      lastAlertRef.current = now;
    }
  }, []);

  // Phase 4: Popup Messages
  const triggerAlert = useCallback((status) => {
    if (isHost) return;
    
    switch(status) {
      case "phone":
        showPopup("Stop using phone");
        break;
      case "distracted":
        showPopup("Pay attention");
        break;
      case "no_face":
        showPopup("Stay in frame");
        break;
      case "drowsy":
        showPopup("Wake up and pay attention 😴");
        break;
      case "multiple_faces":
        showPopup("Multiple persons detected");
        break;
      case "attentive":
        showPopup("Good! You are attentive");
        break;
      default:
        break;
    }
  }, [isHost, showPopup]);

  // Phase 3: Instant Popup System (No Delay)
  useEffect(() => {
    if (status !== prevStatusRef.current) {
      if (status !== 'idle' && status !== 'error') {
        triggerAlert(status);
      }
      prevStatusRef.current = status;
    }
  }, [status, triggerAlert]);

  // Create hidden canvas + video
  useEffect(() => {
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
      canvasRef.current.width  = CANVAS_WIDTH;
      canvasRef.current.height = Math.round(CANVAS_WIDTH * 0.5625);
    }
    if (!videoRef.current) {
      videoRef.current = document.createElement('video');
      Object.assign(videoRef.current, { muted: true, autoplay: true, playsInline: true });
      videoRef.current.style.display = 'none';
      document.body.appendChild(videoRef.current);
    }
  }, []);

  // ── Update a tracker with a new status tick ───────────────────────────
  const applyTick = useCallback((prev, status) => {
    const next = { ...prev };
    next.totalTime += TICK_SEC;
    // Phase 8: Engagement Tracking
    switch (status) {
      case 'attentive':      next.attentiveTime       += TICK_SEC; break;
      case 'distracted':     next.distractedTime      += TICK_SEC; break;
      case 'drowsy':         next.drowsyTime          += TICK_SEC; break;
      case 'no_face':        next.noFaceTime          += TICK_SEC; break;
      case 'phone':          next.phoneTime           += TICK_SEC; break;
      case 'multiple_faces': next.multiplePeopleTime  += TICK_SEC; break;
      default: break;
    }
    next.lastStatus = status;
    next.timeline = [...next.timeline, { timestamp: new Date().toISOString(), status }].slice(-300);
    const analysis = analysePatterns(next);
    next.engagementScore = analysis.engagementScore;
    next.warnings        = analysis.warnings;
    next.summary         = analysis.summary;
    return next;
  }, []);

  // ── Capture + analyse one frame ───────────────────────────────────────
  const analyseFrame = useCallback(async () => {
    if (!localStream || !canvasRef.current || !videoRef.current || !aiEnabled) return;
    
    // Feature: Disable AI for Host
    if (isHost) {
      dbg('Frame', 'Skipping AI analysis (isHost=true)');
      return;
    }

    if (isVideoOff) {
      const st = 'no_face';
      dbg('Frame', `Video off → status=no_face | userId=${userId}`);
      setStatus(st); // This will trigger the useEffect for alert
      setMyTracker(prev => applyTick(prev, st));
      socket?.emit('ai-alert', { userId, roomId, status: st, alert: '⚠️ Camera off', confidence: 1, insights: null });
      return;
    }

    const vid = videoRef.current;
    if (vid.srcObject !== localStream) {
      dbg('Frame', 'Attaching localStream to hidden video element');
      vid.srcObject = localStream;
      await vid.play().catch(() => {});
    }

    const canvas = canvasRef.current;
    canvas.getContext('2d').drawImage(vid, 0, 0, canvas.width, canvas.height);
    const b64Frame = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    dbg('Frame', `Captured ${Math.round(b64Frame.length / 1024)}KB frame | userId=${userId} | roomId=${roomId}`);

    const t0 = Date.now();
    try {
      const token = localStorage.getItem('token');
      if (!navigator.onLine) { showPopup('No internet connection'); return; }

      const res = await axios.post(`${AI_URL}/detect`, {
        userId, roomId, frame: b64Frame, ts: Date.now(), isMuted
      }, { headers: { 'Authorization': token ? `Bearer ${token}` : '' } });

      const data = res.data;
      const latency = Date.now() - t0;
      dbg('Frame', `✅ raw=${data.status} conf=${data.confidence} latency=${latency}ms`);
      failCountRef.current = 0;

      // Issue 2: Push to smoothing buffer
      const hist = detectionHistoryRef.current;
      hist.push(data.status);
      if (hist.length > HISTORY_SIZE) hist.shift();

      // Issue 7: Resolve confirmed status via priority
      const confirmedStatus = resolveStatus(hist);
      dbg('Frame', `confirmed=${confirmedStatus} (buffer=${hist.length})`);

      setStatus(confirmedStatus);
      setInsights(data.insights || null);
      setConfidence(data.confidence || 0);
      lastStatusRef.current = confirmedStatus;

      setMyTracker(prev => {
        const next = applyTick(prev, confirmedStatus);
        socket?.emit('ai-update', { userId, roomId, tracker: next });
        return next;
      });

      // Emit with confirmed status
      socket?.emit('ai-alert', {
        userId, roomId,
        status:     confirmedStatus,
        alert:      null,
        confidence: data.confidence,
        insights:   data.insights,
      });

    } catch (err) {
      dbg('Frame', `❌ Error #${failCountRef.current + 1}: ${err.message}`);
      failCountRef.current += 1;
      if (failCountRef.current >= MAX_RETRIES) {
        setIsRunning(false); 
        // Fallback to attentive or let Host's broadcast override it. Do not show "AI Offline".
        setStatus('attentive'); 
      }
    }
  }, [localStream, isVideoOff, isMuted, socket, userId, roomId, applyTick, aiEnabled, isHost]);

  // ── Start / stop based on aiEnabled toggle ────────────────────────────
  useEffect(() => {
    clearInterval(intervalRef.current);

    if (!aiEnabled || !localStream || !userId || !roomId || isHost) {
      setIsRunning(false);
      if (!aiEnabled || isHost) { setStatus('idle'); setAlert(null); }
      dbg('Monitor', `Not starting. aiEnabled=${aiEnabled} hasStream=${!!localStream} isHost=${isHost}`);
      return;
    }

    dbg('Monitor', `🟢 Starting AI monitor | userId=${userId} | roomId=${roomId} | interval=${CAPTURE_MS}ms`);
    failCountRef.current = 0;
    detectionHistoryRef.current = []; // reset buffer on start
    setIsRunning(true);
    const warmup = setTimeout(analyseFrame, 200); // Issue 1: fast warmup
    intervalRef.current = setInterval(analyseFrame, CAPTURE_MS);

    return () => {
      dbg('Monitor', '🔴 Stopping AI monitor');
      clearTimeout(warmup);
      clearInterval(intervalRef.current);
    };
  }, [aiEnabled, localStream, userId, roomId, analyseFrame]);

  // ── HOST-SIDE: Run AI on every peer stream ─────────────────────────────
  useEffect(() => {
    if (!isHost || !aiEnabled) {
      // Stop and clean up all peer monitors when AI is off or not host
      Object.values(peerIntervals.current).forEach(clearInterval);
      peerIntervals.current = {};
      Object.values(peerVideoEls.current).forEach(el => { try { el.remove(); } catch {} });
      peerVideoEls.current = {};
      peerCanvases.current = {};
      return;
    }

    const currentPeerIds = new Set(Object.keys(peerStreams));

    // Stop intervals for peers who left
    Object.keys(peerIntervals.current).forEach(sid => {
      if (!currentPeerIds.has(sid)) {
        clearInterval(peerIntervals.current[sid]);
        delete peerIntervals.current[sid];
        try { peerVideoEls.current[sid]?.remove(); } catch {}
        delete peerVideoEls.current[sid];
        delete peerCanvases.current[sid];
        dbg('PeerMonitor', `🔴 Stopped peer monitor for ${sid}`);
      }
    });

    // Start monitors for new peers (only non-host participants)
    Object.entries(peerStreams).forEach(([socketId, stream]) => {
      if (peerIntervals.current[socketId]) return; // already monitoring
      if (!stream || stream.getVideoTracks().length === 0) return;

      const participant = participants.find(p => p.socketId === socketId);
      // Skip if the peer is the host
      if (participant?.role === 'host') return;

      const peerUserId = participant?.userId || socketId;
      const peerName   = participant?.name   || 'Participant';

      // Create hidden video element for this peer
      const vid = document.createElement('video');
      vid.muted = true; vid.autoplay = true; vid.playsInline = true;
      vid.style.display = 'none';
      document.body.appendChild(vid);
      vid.srcObject = stream;
      vid.play().catch(() => {});
      peerVideoEls.current[socketId] = vid;

      // Create canvas for frame capture
      const canvas = document.createElement('canvas');
      canvas.width  = CANVAS_WIDTH;
      canvas.height = Math.round(CANVAS_WIDTH * 0.5625);
      peerCanvases.current[socketId] = canvas;

      dbg('PeerMonitor', `🟢 Starting peer monitor for ${peerName} (${socketId})`);

      // Initialize smoothing buffer for this peer
      peerHistories.current[socketId] = [];

      // Run AI capture on an interval (peers at 1s to reduce server load)
      const intervalId = setInterval(async () => {
        const el = peerVideoEls.current[socketId];
        const cv = peerCanvases.current[socketId];
        if (!el || !cv || el.readyState < 2) return;

        try {
          cv.getContext('2d').drawImage(el, 0, 0, cv.width, cv.height);
          const b64Frame = cv.toDataURL('image/jpeg', JPEG_QUALITY);
          const token = localStorage.getItem('token');

          const res = await fetch(`${AI_SERVER_URL}/detect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
            body: JSON.stringify({ userId: peerUserId, roomId, frame: b64Frame, ts: Date.now(), isMuted: false })
          });

          if (!res.ok) return;
          const data = await res.json();

          // Issue 2: Smoothing buffer per peer
          const ph = peerHistories.current[socketId] || [];
          ph.push(data.status);
          if (ph.length > HISTORY_SIZE) ph.shift();
          peerHistories.current[socketId] = ph;
          const confirmedStatus = resolveStatus(ph);

          dbg('PeerMonitor', `${peerName}: raw=${data.status} confirmed=${confirmedStatus}`);

          // Issue 8: Update allTrackers with proper time accumulation
          setAllTrackers(prev => {
            const existing = prev[socketId] || makeTracker(peerUserId, peerName);
            const next = applyTick({ ...existing, name: peerName }, confirmedStatus);
            
            // Host broadcasts the computed status to the participant!
            socket?.emit('ai-update', { userId: peerUserId, roomId, tracker: next, socketId });
            socket?.emit('ai-alert', {
              userId: peerUserId, roomId, socketId,
              status: confirmedStatus,
              alert: null,
              confidence: data.confidence,
              insights: data.insights
            });
            
            return { ...prev, [socketId]: next };
          });

          setPeerAiData(prev => ({
            ...prev,
            [socketId]: { status: confirmedStatus, alert: null, confidence: data.confidence, insights: data.insights }
          }));
        } catch (err) {
          dbg('PeerMonitor', `Error analyzing peer ${peerName}: ${err.message}`);
        }
      }, CAPTURE_MS * 2); // peers at 1s interval

      peerIntervals.current[socketId] = intervalId;
    });

    return () => {
      // Cleanup on effect re-run (aiEnabled/peerStreams changed)
    };
  }, [isHost, aiEnabled, peerStreams, participants, roomId]);

  // ── Listen for peer ai-update events (host gets all trackers) ─────────
  useEffect(() => {
    if (!socket) return;
    const handle = (data) => {
      if (!data?.tracker || !data.socketId) return;
      dbg('HostTracker', `Received ai-update | socketId=${data.socketId} | status=${data.tracker.lastStatus} | score=${data.tracker.engagementScore}%`);
      
      // If this is my tracker sent by the host, sync my local state!
      if (data.userId === userId && !isHost) {
        setStatus(data.tracker.lastStatus);
        setMyTracker(data.tracker);
      }
      
      setAllTrackers(prev => ({ ...prev, [data.socketId]: data.tracker }));
    };
    socket.on('ai-update', handle);
    return () => socket.off('ai-update', handle);
  }, [socket, userId, isHost]);

  // ── Listen for ai-alert (real-time status per participant) ─────────────
  useEffect(() => {
    if (!socket) return;
    const handleAlert = (data) => {
      if (!data?.socketId) return;
      dbg('PeerAI', `ai-alert | socketId=${data.socketId} | status=${data.status} | conf=${data.confidence}`);
      
      // If the host is telling me my status, update my UI!
      if (data.userId === userId && !isHost) {
        setStatus(data.status);
      }
      
      setPeerAiData(prev => ({
        ...prev,
        [data.socketId]: {
          status:     data.status,
          alert:      data.alert,
          confidence: data.confidence,
          insights:   data.insights,
        }
      }));
    };
    socket.on('ai-alert', handleAlert);
    return () => socket.off('ai-alert', handleAlert);
  }, [socket, userId, isHost]);

  // ── Save meeting report to backend ────────────────────────────────────
  const saveMeetingReport = useCallback(async ({
    participants,   // array of tracker objects from allTrackers
    duration,
    hostName,
  } = {}) => {
    try {
      dbg('Report', `Saving report | meetingId=${roomId} | participants=${participants?.length} | duration=${duration}s`);
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_SERVER_URL}/api/report/save`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({ meetingId: roomId, participants, duration, hostName }),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      const result = await res.json();
      dbg('Report', `✅ Saved | reportId=${result.reportId}`);
      return result;
    } catch (err) {
      console.error('[Report] Save error:', err);
      dbg('Report', `❌ Save failed: ${err.message}`);
      return null;
    }
  }, [roomId]);

  // ── Download CSV ──────────────────────────────────────────────────────
  const downloadCSV = useCallback(async () => {
    try {
      const url = `${API_SERVER_URL}/api/report/${roomId}/csv`;
      dbg('CSV', `Downloading CSV from: ${url}`);
      const token = localStorage.getItem('token');
      
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': token ? `Bearer ${token}` : ''
        }
      });

      if (!res.ok) throw new Error(`Download failed: ${res.status}`);

      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = blobUrl;
      const dateStr = new Date().toISOString().split('T')[0];
      a.download = `SmartMeet_Report_${roomId.slice(0, 8)}_${dateStr}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);

      dbg('CSV', 'Download successful');
    } catch (err) {
      console.error('[CSV] Download error:', err);
      alert(`CSV Download failed: ${err.message}`);
    }
  }, [roomId]);

  return {
    // Detection
    status, alert, insights, confidence, isRunning,
    // Own behavior tracking
    myTracker,
    // All participants (host use)
    allTrackers,
    peerAiData,     // ← real-time status map for TeacherDashboard
    // Actions
    saveMeetingReport,
    downloadCSV,
  };
}

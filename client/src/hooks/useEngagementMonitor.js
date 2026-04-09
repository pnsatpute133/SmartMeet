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

const AI_SERVER_URL  = import.meta.env.VITE_AI_SERVER_URL  || 'http://localhost:8000';
const API_SERVER_URL = import.meta.env.VITE_API_SERVER_URL || 'http://localhost:5002';
const CAPTURE_MS     = 2000;    // 1 frame every 2 seconds
const JPEG_QUALITY   = 0.50;
const CANVAS_WIDTH   = 320;
const MAX_RETRIES    = 3;
const TICK_SEC       = 2;       // seconds each sample represents

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
    speakingTime, speakingMutedTime,
    totalTime, name 
  } = tracker;

  if (!totalTime) return { summary: 'No data yet', warnings: [], engagementScore: 0 };

  const attPct    = Math.round(((attentiveTime + speakingTime) / totalTime) * 100);
  const distPct   = Math.round((distractedTime     / totalTime) * 100);
  const drowsyPct = Math.round((drowsyTime         / totalTime) * 100);

  const warnings = [];
  if (distractedTime  > 40) warnings.push(`Student distracted (${distPct}%)`);
  if (phoneTime       > 10) warnings.push(`Phone usage detected!`);
  if (drowsyTime      > 15) warnings.push(`Student looks drowsy.`);
  if (speakingMutedTime > 6) warnings.push(`Speaking while muted.`);
  if (attPct          < 40) warnings.push(`Very low focus.`);

  const summary =
    `${name} is ${attPct}% engaged. ` +
    (speakingMutedTime > 4 ? `🔇 Muted & Speaking. ` : '') +
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

  // Keep ref in sync
  useEffect(() => { myTrackerRef.current = myTracker; }, [myTracker]);

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
    switch (status) {
      case 'attentive':        next.attentiveTime       += TICK_SEC; break;
      case 'distracted':       
      case 'looking_sideways': 
      case 'looking_down':     next.distractedTime      += TICK_SEC; break;
      case 'phone':            next.phoneTime           += TICK_SEC; break;
      case 'multiple_faces':
      case 'multiple_people':  next.multiplePeopleTime  += TICK_SEC; break;
      case 'drowsy':           next.drowsyTime          += TICK_SEC; break;
      case 'speaking':         next.speakingTime        += TICK_SEC; break;
      case 'speaking_muted':   next.speakingMutedTime   += TICK_SEC; break;
      case 'no_face':          next.noFaceTime          += TICK_SEC; break;
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
      if (lastStatusRef.current !== st) {
        lastStatusRef.current = st;
        setStatus(st);
        setAlert('⚠️ Please turn on your camera');
        setMyTracker(prev => applyTick(prev, st));
        socket?.emit('ai-alert', { userId, roomId, status: st, alert: '⚠️ Camera off', confidence: 1, insights: null });
      }
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

    console.log(`[AI] 📤 Sending frame for user: ${userId}`);
    const t0 = Date.now();
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${AI_SERVER_URL}/detect`, {
        method: 'POST',
        mode: 'cors', // Explicitly handle CORS
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({
          userId,
          roomId,
          frame: b64Frame,
          ts: Date.now(),
          isMuted
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`AI Server Error (${res.status}): ${errText.slice(0, 100)}`);
      }
      
      const data = await res.json();
      const latency = Date.now() - t0;
      console.log(`[AI] 📥 Response:`, data.status, data.confidence);
      dbg('Frame', `✅ status=${data.status} conf=${data.confidence} alert=${JSON.stringify(data.alert)} latency=${latency}ms`);
      failCountRef.current = 0;

      setStatus(data.status);
      setAlert(data.alert || null);
      setInsights(data.insights || null);
      setConfidence(data.confidence || 0);
      lastStatusRef.current = data.status;

      setMyTracker(prev => {
        const next = applyTick(prev, data.status);
        dbg('Tracker', `Updated: attentive=${next.attentiveTime}s dist=${next.distractedTime}s score=${next.engagementScore}%`);
        socket?.emit('ai-update', { userId, roomId, tracker: next });
        return next;
      });

      socket?.emit('ai-alert', {
        userId, roomId,
        status:     data.status,
        alert:      data.alert,
        confidence: data.confidence,
        insights:   data.insights,
      });
      dbg('Socket', `Emitted ai-alert | status=${data.status}`);

    } catch (err) {
      console.error(`[AI] ❌ Connection error:`, err.message);
      dbg('Frame', `❌ Error #${failCountRef.current + 1}: ${err.message}`);
      failCountRef.current += 1;
      if (failCountRef.current >= MAX_RETRIES) {
        dbg('Frame', `Max retries hit (${MAX_RETRIES}), stopping AI monitor`);
        setIsRunning(false);
        setStatus('error');
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
    setIsRunning(true);
    const warmup = setTimeout(analyseFrame, 600);
    intervalRef.current = setInterval(analyseFrame, CAPTURE_MS);

    return () => {
      dbg('Monitor', '🔴 Stopping AI monitor');
      clearTimeout(warmup);
      clearInterval(intervalRef.current);
    };
  }, [aiEnabled, localStream, userId, roomId, analyseFrame]);

  // ── Listen for peer ai-update events (host gets all trackers) ─────────
  useEffect(() => {
    if (!socket) return;
    const handle = (data) => {
      if (!data?.tracker || !data.socketId) return;
      dbg('HostTracker', `Received ai-update | socketId=${data.socketId} | status=${data.tracker.lastStatus} | score=${data.tracker.engagementScore}%`);
      setAllTrackers(prev => ({ ...prev, [data.socketId]: data.tracker }));
    };
    socket.on('ai-update', handle);
    return () => socket.off('ai-update', handle);
  }, [socket]);

  // ── Listen for ai-alert (real-time status per participant) ─────────────
  useEffect(() => {
    if (!socket) return;
    const handleAlert = (data) => {
      if (!data?.socketId) return;
      dbg('PeerAI', `ai-alert | socketId=${data.socketId} | status=${data.status} | conf=${data.confidence}`);
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
  }, [socket]);

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

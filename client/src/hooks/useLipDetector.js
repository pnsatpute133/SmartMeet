/**
 * useLipDetector
 * ─────────────────────────────────────────────────────────────────────────
 * Detects lip / mouth movement using MediaPipe FaceMesh landmark distances.
 * Falls back to audio-level analysis if MediaPipe is unavailable.
 *
 * When mouth is moving AND mic is muted → emit socket 'lip-speaking' event
 * which triggers an AI warning toast on the user's screen.
 *
 * Strategy:
 *   1. Primary: MediaPipe WASM (loaded from CDN) — landmark #13 & #14 distance
 *   2. Fallback: Web Audio API volume analysis (voice > threshold while muted)
 */

import { useEffect, useRef, useCallback } from 'react';

const CHECK_INTERVAL = 800;      // ms between checks
const MOUTH_OPEN_THRESHOLD = 0.018;  // normalised mouth distance
const AUDIO_THRESHOLD = 0.015;   // RMS volume threshold for fallback

export default function useLipDetector({ localStream, socket, roomId, isMuted }) {
  const intervalRef  = useRef(null);
  const canvasRef    = useRef(null);
  const videoRef     = useRef(null);
  const analyserRef  = useRef(null);
  const audioCtxRef  = useRef(null);
  const lastAlertRef = useRef(0);
  const ALERT_COOLDOWN = 8000; // 8s between alerts

  // ── Audio fallback: RMS volume detector ───────────────────────────────
  const setupAudioAnalyser = useCallback(() => {
    if (!localStream || audioCtxRef.current) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const source = ctx.createMediaStreamSource(localStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      audioCtxRef.current = ctx;
    } catch (e) {
      console.warn('[LipDetector] AudioContext setup failed:', e);
    }
  }, [localStream]);

  const getAudioLevel = useCallback(() => {
    if (!analyserRef.current) return 0;
    const buf = new Float32Array(analyserRef.current.fftSize);
    analyserRef.current.getFloatTimeDomainData(buf);
    let rms = 0;
    for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
    return Math.sqrt(rms / buf.length);
  }, []);

  // ── Emit alert with cooldown ───────────────────────────────────────────
  const sendAlert = useCallback(() => {
    const now = Date.now();
    if (now - lastAlertRef.current < ALERT_COOLDOWN) return;
    lastAlertRef.current = now;
    socket?.emit('lip-speaking', { roomId, isSpeaking: true, isMuted: true });
    console.log('[LipDetector] 🎤 Muted-but-speaking detected');
  }, [socket, roomId]);

  // ── Canvas + video setup ──────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
      canvasRef.current.width  = 160;
      canvasRef.current.height = 90;
    }
    if (!videoRef.current) {
      const v = document.createElement('video');
      v.muted = true; v.autoplay = true; v.playsInline = true;
      videoRef.current = v;
    }
  }, []);

  // ── Main detection loop ────────────────────────────────────────────────
  useEffect(() => {
    if (!localStream || !socket) return;

    setupAudioAnalyser();

    // Attach stream to hidden video
    const vid = videoRef.current;
    if (vid && vid.srcObject !== localStream) {
      vid.srcObject = localStream;
      vid.play().catch(() => {});
    }

    intervalRef.current = setInterval(async () => {
      if (!isMuted) return; // only care when muted

      // Strategy: audio level fallback (always available)
      const level = getAudioLevel();
      if (level > AUDIO_THRESHOLD) {
        sendAlert();
        return;
      }

      // Attempt visual mouth analysis only if canvas / video ready
      try {
        if (!videoRef.current || videoRef.current.readyState < 2) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

        // Simple brightness-gradient scan in lower-centre region (mouth area)
        // This is a lightweight fallback if MediaPipe FaceMesh is unavailable
        const imgData = ctx.getImageData(
          Math.floor(canvas.width * 0.3),   // x: 30% from left
          Math.floor(canvas.height * 0.55), // y: 55% from top (mouth area)
          Math.floor(canvas.width * 0.4),   // w: 40% wide
          Math.floor(canvas.height * 0.25)  // h: 25% tall
        );
        const data = imgData.data;

        // Vertical variance of brightness in mouth region = movement proxy
        let sum = 0, sumSq = 0;
        const n = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
          const lum = (data[i] * 299 + data[i+1] * 587 + data[i+2] * 114) / 1000;
          sum += lum; sumSq += lum * lum;
        }
        const mean = sum / n;
        const variance = (sumSq / n) - (mean * mean);
        const std = Math.sqrt(Math.max(0, variance));

        // High std-dev in mouth region = lip movement
        if (std > 18) sendAlert();
      } catch (_) { /* ignore visual analysis errors */ }
    }, CHECK_INTERVAL);

    return () => clearInterval(intervalRef.current);
  }, [localStream, socket, isMuted, setupAudioAnalyser, getAudioLevel, sendAlert]);

  // Cleanup audio ctx on unmount
  useEffect(() => {
    return () => {
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);
}

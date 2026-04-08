/**
 * AIAlertToast
 * ─────────────────────────────────────────────────────────────────────────
 * Renders the per-user AI alert overlay: animated toast that slides in from
 * the top, colour-coded by severity.
 */

import { useEffect, useState } from 'react';

const STATUS_CONFIG = {
  attentive:        { color: '#22c55e', bg: 'rgba(34,197,94,0.12)',  icon: '✅', label: 'Attentive' },
  distracted:       { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', icon: '👀', label: 'Distracted' },
  phone:            { color: '#ef4444', bg: 'rgba(239,68,68,0.15)',  icon: '📵', label: 'Phone Detected' },
  multiple_people:  { color: '#a855f7', bg: 'rgba(168,85,247,0.15)', icon: '🚨', label: 'Multiple People' },
  drowsy:           { color: '#3b82f6', bg: 'rgba(59,130,246,0.15)', icon: '😴', label: 'Drowsy' },
  poor_posture:     { color: '#fb923c', bg: 'rgba(251,146,60,0.12)', icon: '🪑', label: 'Poor Posture' },
  speaking:         { color: '#2dd4bf', bg: 'rgba(45,212,191,0.12)', icon: '🎤', label: 'Speaking' },
  speaking_muted:   { color: '#f87171', bg: 'rgba(248,113,113,0.15)', icon: '🔇', label: 'Speaking While Muted' },
  no_face:          { color: '#6b7280', bg: 'rgba(107,114,128,0.12)', icon: '👤', label: 'No Face' },
  idle:             { color: '#3b82f6', bg: 'rgba(59,130,246,0.10)', icon: '🔵', label: 'Monitoring…' },
  error:            { color: '#ef4444', bg: 'rgba(239,68,68,0.12)', icon: '⚠️', label: 'AI Offline' },
};

export default function AIAlertToast({ alert, status, confidence }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!alert) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(t);
  }, [alert]);

  if (!alert || !visible) return null;

  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.idle;

  return (
    <div
      style={{
        position:    'fixed',
        top:         '80px',
        left:        '50%',
        transform:   'translateX(-50%)',
        zIndex:      9999,
        display:     'flex',
        alignItems:  'center',
        gap:         '12px',
        padding:     '14px 22px',
        borderRadius: '16px',
        background:  cfg.bg,
        border:      `1.5px solid ${cfg.color}40`,
        backdropFilter: 'blur(16px)',
        color:       '#f1f5f9',
        fontSize:    '14px',
        fontWeight:  '600',
        boxShadow:   `0 8px 32px ${cfg.color}20`,
        animation:   'aiSlideIn 0.4s cubic-bezier(0.34,1.56,0.64,1)',
        maxWidth:    '420px',
        pointerEvents: 'none',
      }}
    >
      <span style={{ fontSize: '20px' }}>{cfg.icon}</span>
      <div>
        <div style={{ color: cfg.color, fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '2px' }}>
          AI Alert — {cfg.label}
        </div>
        <div style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: 500 }}>{alert}</div>
      </div>
      {confidence > 0 && (
        <div style={{ marginLeft: 'auto', fontSize: '11px', color: cfg.color, fontWeight: 700, opacity: 0.8 }}>
          {Math.round(confidence * 100)}%
        </div>
      )}
      <style>{`
        @keyframes aiSlideIn {
          from { opacity: 0; transform: translateX(-50%) translateY(-16px) scale(0.95); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0)     scale(1); }
        }
      `}</style>
    </div>
  );
}

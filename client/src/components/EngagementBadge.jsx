/**
 * EngagementBadge — Issue 3: Real-time human-readable status label
 * Props: status — raw AI status string
 */

const CFG = {
  attentive:        { color: '#22c55e', bg: '#052e16b3', icon: '✅', text: 'Attentive' },
  speaking:         { color: '#2dd4bf', bg: '#042f2eb3', icon: '🎤', text: 'Speaking' },
  distracted:       { color: '#f59e0b', bg: '#431407b3', icon: '👀', text: 'Distracted' },
  looking_sideways: { color: '#f59e0b', bg: '#431407b3', icon: '↔️', text: 'Looking Away' },
  looking_down:     { color: '#f59e0b', bg: '#431407b3', icon: '⬇️', text: 'Looking Down' },
  looking_away:     { color: '#f59e0b', bg: '#431407b3', icon: '👀', text: 'Distracted' },
  phone:            { color: '#ef4444', bg: '#450a0ab3', icon: '📵', text: 'Using Phone' },
  drowsy:           { color: '#3b82f6', bg: '#1e3a5fb3', icon: '😴', text: 'Sleepy' },
  no_face:          { color: '#94a3b8', bg: '#0f172ab3', icon: '👤', text: 'Not in Frame' },
  multiple_faces:   { color: '#a855f7', bg: '#2e1065b3', icon: '👥', text: 'Multiple People' },
  multiple_people:  { color: '#a855f7', bg: '#2e1065b3', icon: '👥', text: 'Multiple People' },
  speaking_muted:   { color: '#f87171', bg: '#450a0ab3', icon: '🔇', text: 'Muted & Speaking' },
  talking_muted:    { color: '#f87171', bg: '#450a0ab3', icon: '🔇', text: 'Muted & Speaking' },
  poor_posture:     { color: '#fb923c', bg: '#431407b3', icon: '🪑', text: 'Poor Posture' },
  idle:             { color: '#3b82f6', bg: '#0f172ab3', icon: '🔵', text: 'Monitoring…' },
  error:            { color: '#6b7280', bg: '#1f2937b3', icon: '⚠️', text: 'AI Offline' },
};

export default function EngagementBadge({ status = 'idle' }) {
  const c = CFG[status] || CFG.idle;
  return (
    <div
      style={{
        display:       'inline-flex',
        alignItems:    'center',
        gap:           '5px',
        padding:       '2px 9px',
        borderRadius:  '999px',
        background:    c.bg,
        border:        `1px solid ${c.color}50`,
        fontSize:      '10px',
        fontWeight:    700,
        color:         c.color,
        backdropFilter:'blur(8px)',
        letterSpacing: '0.04em',
        lineHeight:    '18px',
        userSelect:    'none',
        transition:    'all 0.3s ease',
      }}
    >
      <span style={{ fontSize: '11px' }}>{c.icon}</span>
      {c.text}
    </div>
  );
}

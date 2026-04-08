/**
 * EngagementBadge
 * ─────────────────────────────────────────────────────────────────────────
 * Tiny coloured pill shown on each VideoTile overlay, indicating the AI
 * detected status of that participant.
 *
 * Props:
 *   status  — 'attentive' | 'distracted' | 'phone' | 'multiple_people' | 'no_face' | 'idle'
 */

const CFG = {
  attentive:       { color: '#22c55e', bg: '#052e16b3', icon: '✅', text: 'Attentive' },
  distracted:      { color: '#f59e0b', bg: '#431407b3', icon: '👀', text: 'Distracted' },
  phone:           { color: '#ef4444', bg: '#450a0ab3', icon: '📵', text: 'Phone' },
  multiple_people: { color: '#a855f7', bg: '#2e1065b3', icon: '👥', text: 'Multiple' },
  no_face:         { color: '#94a3b8', bg: '#0f172ab3', icon: '👤', text: 'No Face' },
  idle:            { color: '#3b82f6', bg: '#0f172ab3', icon: '🔵', text: '…' },
  error:           { color: '#6b7280', bg: '#1f2937b3', icon: '⚠️', text: 'AI Off' },
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
      }}
    >
      <span style={{ fontSize: '11px' }}>{c.icon}</span>
      {c.text}
    </div>
  );
}

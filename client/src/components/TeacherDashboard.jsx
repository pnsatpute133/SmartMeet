/**
 * TeacherDashboard — v2
 * ─────────────────────────────────────────────────────────────────────────
 * Full host dashboard with:
 *  • Live per-student behavior tracking tiles
 *  • Engagement score rings
 *  • Time bars (attentive / distracted / phone)
 *  • Agentic warning display
 *  • AI Toggle button (starts/stops tracking for ALL participants)
 *  • CSV Download button
 *  • Warn / Mute / Remove per student
 */

import { useMemo, useState } from 'react';
import {
  X, Brain, Download, Play, Square, BellRing,
  MicOff, UserMinus, TrendingUp, Clock, AlertTriangle,
} from 'lucide-react';

// ── Colour config per status ───────────────────────────────────────────────
const STATUS_CFG = {
  attentive:       { color: '#22c55e', icon: '✅', label: 'Attentive' },
  distracted:      { color: '#f59e0b', icon: '👀', label: 'Distracted' },
  phone:           { color: '#ef4444', icon: '📵', label: 'Phone' },
  multiple_people: { color: '#a855f7', icon: '👥', label: 'Multiple' },
  no_face:         { color: '#94a3b8', icon: '👤', label: 'No Face' },
  idle:            { color: '#3b82f6', icon: '⏸️', label: 'Idle' },
  error:           { color: '#6b7280', icon: '⚠️', label: 'AI Off' },
};

// ── SVG score ring ─────────────────────────────────────────────────────────
function ScoreRing({ score, size = 60 }) {
  const r    = (size / 2) - 6;
  const circ = 2 * Math.PI * r;
  const pct  = Math.max(0, Math.min(100, score || 0));
  const dash = (pct / 100) * circ;
  const col  = pct >= 70 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444';
  const half = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={half} cy={half} r={r} fill="none" stroke="#ffffff10" strokeWidth="5" />
      <circle
        cx={half} cy={half} r={r} fill="none"
        stroke={col} strokeWidth="5"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${half} ${half})`}
        style={{ transition: 'stroke-dasharray 0.5s ease' }}
      />
      <text x={half} y={half} textAnchor="middle" dominantBaseline="central"
            fill={col} fontSize={size * 0.22} fontWeight="700">
        {pct}
      </text>
    </svg>
  );
}

// ── Horizontal time bar ────────────────────────────────────────────────────
function TimeBar({ attentive, distracted, phone, multiPeople, total }) {
  const t = total || 1;
  const segments = [
    { pct: (attentive    / t) * 100, color: '#22c55e' },
    { pct: (distracted   / t) * 100, color: '#f59e0b' },
    { pct: (phone        / t) * 100, color: '#ef4444' },
    { pct: (multiPeople  / t) * 100, color: '#a855f7' },
  ];
  return (
    <div style={{ display: 'flex', height: '6px', borderRadius: '3px', overflow: 'hidden', background: '#1e293b', width: '100%' }}>
      {segments.map((s, i) => (
        <div key={i} style={{ width: `${s.pct}%`, background: s.color, transition: 'width 0.4s ease' }} />
      ))}
    </div>
  );
}

// ── Action icon button ─────────────────────────────────────────────────────
function ActionBtn({ icon, tooltip, color, onClick }) {
  return (
    <button title={tooltip} onClick={onClick}
      style={{
        background: `${color}18`, border: `1px solid ${color}35`,
        borderRadius: '8px', padding: '6px 8px', cursor: 'pointer', color,
        display: 'flex', alignItems: 'center', transition: 'background 0.15s',
      }}
      onMouseOver={e => e.currentTarget.style.background = `${color}30`}
      onMouseOut={e  => e.currentTarget.style.background = `${color}18`}
    >
      {icon}
    </button>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════
export default function TeacherDashboard({
  // Data
  allTrackers   = {},   // socketId → tracker from useEngagementMonitor
  peerAiData    = {},   // socketId → { status, alert, confidence }  (real-time status)
  participants  = [],   // from useMeetingStore
  myTracker     = null, // host's own tracker
  // State
  aiEnabled     = false,
  meetingTime   = '00:00',
  // Actions
  onToggleAI,
  onDownloadCSV,
  onDownloadAttendanceCSV,
  onSaveReport,
  onWarn,
  onMute,
  onRemove,
  onClose,
}) {
  const [activeTab, setActiveTab] = useState('live');   // 'live' | 'summary' | 'attendance'

  // Merge participants with tracker + AI data, sorted by concern level
  const rows = useMemo(() => {
    const STATUS_ORDER = { phone: 0, multiple_people: 1, distracted: 2, no_face: 3, attentive: 4, idle: 5 };
    return [...participants].map(p => {
      const tracker = allTrackers[p.socketId] || {
        totalTime: 0, attentiveTime: 0, distractedTime: 0,
        phoneTime: 0, multiplePeopleTime: 0, drowsyTime: 0,
        engagementScore: 0, warnings: [], summary: '', lastStatus: 'idle',
      };
      const ai = peerAiData[p.socketId] || { status: 'idle', confidence: 0 };
      return { ...p, tracker, ai };
    }).sort((a, b) =>
      (STATUS_ORDER[a.ai.status] ?? 9) - (STATUS_ORDER[b.ai.status] ?? 9)
    );
  }, [participants, allTrackers, peerAiData]);

  // Class-wide stats
  const classScore = useMemo(() => {
    const scores = rows.map(r => r.tracker.engagementScore).filter(s => s > 0);
    return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  }, [rows]);

  const alertCount = rows.filter(
    r => ['phone', 'multiple_people', 'distracted'].includes(r.ai.status)
  ).length;

  const fmt = (s) => {
    const m = Math.floor(s / 60), sec = s % 60;
    return `${m}m ${sec}s`;
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 8000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.80)', backdropFilter: 'blur(8px)',
      animation: 'dashIn 0.25s ease',
    }}>
      <div style={{
        width: '96vw', maxWidth: '920px', maxHeight: '90vh',
        background: 'linear-gradient(145deg,#0b1221,#0f1e35)',
        borderRadius: '24px', border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 40px 100px rgba(0,0,0,0.7)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>

        {/* ── HEADER ─────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(255,255,255,0.02)', gap: '12px', flexWrap: 'wrap',
        }}>
          {/* Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '38px', height: '38px', borderRadius: '10px',
              background: 'linear-gradient(135deg,#6366f1,#a855f7)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Brain size={20} color="#fff" />
            </div>
            <div>
              <div style={{ color: '#f8fafc', fontWeight: 700, fontSize: '16px' }}>
                AI Engagement Dashboard
              </div>
              <div style={{ color: '#475569', fontSize: '11px' }}>
                YOLOv11 · {participants.length} participant{participants.length !== 1 ? 's' : ''} · {meetingTime}
              </div>
            </div>
          </div>

          {/* Right controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {/* Class score */}
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: '#475569', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '2px' }}>Class Avg</div>
              <ScoreRing score={classScore} size={52} />
            </div>

            {/* Alert badge */}
            {alertCount > 0 && (
              <div style={{
                background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.35)',
                borderRadius: '10px', padding: '6px 14px', color: '#ef4444', fontSize: '12px', fontWeight: 700,
              }}>
                ⚠️ {alertCount} alert{alertCount > 1 ? 's' : ''}
              </div>
            )}

            {/* AI Toggle */}
            <button onClick={onToggleAI} style={{
              display: 'flex', alignItems: 'center', gap: '7px',
              padding: '8px 16px', borderRadius: '10px', cursor: 'pointer',
              fontWeight: 700, fontSize: '13px', border: 'none',
              background: aiEnabled
                ? 'linear-gradient(135deg,#ef4444,#dc2626)'
                : 'linear-gradient(135deg,#22c55e,#16a34a)',
              color: '#fff',
              boxShadow: aiEnabled ? '0 0 20px rgba(239,68,68,0.3)' : '0 0 20px rgba(34,197,94,0.3)',
              transition: 'all 0.2s',
            }}>
              {aiEnabled ? <Square size={14} /> : <Play size={14} />}
              {aiEnabled ? 'Stop AI' : 'Start AI'}
            </button>

            {/* Download CSV */}
            <button onClick={onDownloadCSV} style={{
              display: 'flex', alignItems: 'center', gap: '7px',
              padding: '8px 14px', borderRadius: '10px', cursor: 'pointer',
              fontWeight: 600, fontSize: '12px',
              background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.35)',
              color: '#818cf8',
            }}>
              <Download size={14} /> CSV
            </button>

            {/* Close */}
            <button onClick={onClose} style={{
              background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '9px', padding: '8px', cursor: 'pointer', color: '#64748b',
              display: 'flex', alignItems: 'center',
            }}>
              <X size={17} />
            </button>
          </div>
        </div>

        {/* ── TABS ─────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.05)',
          padding: '0 24px',
        }}>
          {[
            { id: 'live',       label: '🔴 Live Monitor' },
            { id: 'summary',    label: '📊 Summary' },
            { id: 'attendance', label: '📋 Attendance' },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              padding: '12px 20px', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
              color: activeTab === tab.id ? '#818cf8' : '#475569',
              borderBottom: activeTab === tab.id ? '2px solid #818cf8' : '2px solid transparent',
              background: 'none', border: 'none', transition: 'color 0.15s',
            }}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── CONTENT ────────────────────────────────────────────────── */}
        <div style={{ overflowY: 'auto', flex: 1 }}>

          {/* ═══ LIVE TAB ═══════════════════════════════════════════ */}
          {activeTab === 'live' && (
            <>
              {/* Table header */}
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 100px 90px 200px 120px',
                padding: '10px 24px 8px',
                color: '#334155', fontSize: '10px', fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.07em',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
              }}>
                <span>Student</span>
                <span>Status</span>
                <span>Score</span>
                <span>Time Breakdown</span>
                <span style={{ textAlign: 'right' }}>Actions</span>
              </div>

              {rows.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#334155', padding: '60px 0', fontSize: '14px' }}>
                  No participants yet
                </div>
              ) : rows.map(row => {
                const cfg      = STATUS_CFG[row.ai.status] || STATUS_CFG.idle;
                const isAlert  = ['phone', 'multiple_people', 'distracted'].includes(row.ai.status);
                const t        = row.tracker;
                const total    = t.totalTime || 1;

                return (
                  <div key={row.socketId} style={{
                    display: 'grid', gridTemplateColumns: '1fr 100px 90px 200px 120px',
                    alignItems: 'center', padding: '13px 24px',
                    borderBottom: '1px solid rgba(255,255,255,0.03)',
                    background: isAlert ? 'rgba(239,68,68,0.04)' : 'transparent',
                    transition: 'background 0.2s',
                  }}>
                    {/* Name + session time */}
                    <div>
                      <div style={{ color: '#f1f5f9', fontWeight: 600, fontSize: '13px' }}>{row.name}</div>
                      <div style={{ color: '#334155', fontSize: '10px', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                        <Clock size={9} />
                        {fmt(t.totalTime)} total
                      </div>
                    </div>

                    {/* Status pill */}
                    <div>
                      <div style={{
                        display: 'inline-flex', alignItems: 'center', gap: '5px',
                        padding: '3px 9px', borderRadius: '999px',
                        background: `${cfg.color}18`, border: `1px solid ${cfg.color}40`,
                        color: cfg.color, fontSize: '10px', fontWeight: 700,
                      }}>
                        <span>{cfg.icon}</span> {cfg.label}
                      </div>
                    </div>

                    {/* Score ring */}
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <ScoreRing score={t.engagementScore} size={48} />
                    </div>

                    {/* Time bars + legend */}
                    <div>
                      <TimeBar
                        attentive={t.attentiveTime}
                        distracted={t.distractedTime}
                        phone={t.phoneTime}
                        multiPeople={t.multiplePeopleTime}
                        total={total}
                      />
                      <div style={{ display: 'flex', gap: '8px', marginTop: '5px', flexWrap: 'wrap' }}>
                        {[
                          { c: '#22c55e', v: t.attentiveTime,      label: 'Att' },
                          { c: '#f59e0b', v: t.distractedTime,     label: 'Dis' },
                          { c: '#ef4444', v: t.phoneTime,          label: 'Ph' },
                        ].map(({ c, v, label }) => (
                          <span key={label} style={{ color: c, fontSize: '9px', fontWeight: 700 }}>
                            {label} {Math.round((v / total) * 100)}%
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      <ActionBtn icon={<BellRing size={12} />}   tooltip="Send Warning" color="#f59e0b" onClick={() => onWarn?.(row.socketId, row.name)} />
                      <ActionBtn icon={<MicOff size={12} />}     tooltip="Mute"         color="#ef4444" onClick={() => onMute?.(row.socketId)} />
                      <ActionBtn icon={<UserMinus size={12} />}  tooltip="Remove"       color="#6b7280" onClick={() => onRemove?.(row.socketId)} />
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* ═══ SUMMARY TAB ═════════════════════════════════════════ */}
          {activeTab === 'summary' && (
            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {rows.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#334155', padding: '40px 0' }}>No data yet</div>
              ) : rows.map(row => {
                const t = row.tracker;
                const w = t.warnings || [];
                return (
                  <div key={row.socketId} style={{
                    background: 'rgba(255,255,255,0.03)', borderRadius: '14px',
                    border: '1px solid rgba(255,255,255,0.06)', padding: '16px 20px',
                    display: 'flex', gap: '16px', alignItems: 'flex-start',
                  }}>
                    <ScoreRing score={t.engagementScore} size={56} />
                    <div style={{ flex: 1 }}>
                      <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '14px', marginBottom: '4px' }}>
                        {row.name}
                      </div>
                      <div style={{ color: '#64748b', fontSize: '12px', lineHeight: 1.6, marginBottom: '8px' }}>
                        {t.summary || 'AI tracking not yet active for this participant.'}
                      </div>
                      {w.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {w.map((warn, i) => (
                            <div key={i} style={{
                              display: 'flex', alignItems: 'center', gap: '6px',
                              color: '#f59e0b', fontSize: '11px',
                              background: 'rgba(245,158,11,0.08)',
                              borderRadius: '6px', padding: '4px 10px',
                            }}>
                              <AlertTriangle size={11} /> {warn}
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Mini time breakdown */}
                      <div style={{ display: 'flex', gap: '16px', marginTop: '10px', flexWrap: 'wrap' }}>
                        {[
                          { label: 'Attentive',  val: t.attentiveTime,  color: '#22c55e' },
                          { label: 'Distracted', val: t.distractedTime, color: '#f59e0b' },
                          { label: 'Phone',      val: t.phoneTime, color: '#ef4444' },
                        ].map(({ label, val, color }) => (
                          <div key={label} style={{ textAlign: 'center' }}>
                            <div style={{ color, fontSize: '16px', fontWeight: 800 }}>{fmt(val)}</div>
                            <div style={{ color: '#334155', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Download button at bottom */}
              <button onClick={onDownloadCSV} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: '8px', padding: '14px', borderRadius: '12px', cursor: 'pointer',
                fontWeight: 700, fontSize: '14px',
                background: 'linear-gradient(135deg,#6366f1,#a855f7)',
                color: '#fff', border: 'none', marginTop: '4px',
                boxShadow: '0 4px 20px rgba(99,102,241,0.3)',
              }}>
                <Download size={16} /> Download Full CSV Report
              </button>
            </div>
          )}

          {/* ═══ ATTENDANCE TAB ══════════════════════════════════════ */}
          {activeTab === 'attendance' && (
            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ color: '#94a3b8', fontSize: '13px' }}>
                  Attendance is automatically tracked when participants join &amp; leave.
                </div>
                <button onClick={onDownloadAttendanceCSV} style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '8px 14px', borderRadius: '10px', cursor: 'pointer',
                  fontWeight: 600, fontSize: '12px',
                  background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.35)',
                  color: '#22c55e',
                }}>
                  <Download size={13} /> Export Attendance CSV
                </button>
              </div>

              {/* Table */}
              <div style={{ borderRadius: '14px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
                {/* Header row */}
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 120px 120px 100px',
                  background: 'rgba(255,255,255,0.03)',
                  padding: '10px 18px',
                  color: '#334155', fontSize: '10px', fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.07em',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                }}>
                  <span>Participant</span>
                  <span>Joined</span>
                  <span>Left</span>
                  <span>Duration</span>
                </div>

                {/* Live participants (still in meeting) */}
                {participants.map(p => (
                  <div key={p.socketId} style={{
                    display: 'grid', gridTemplateColumns: '1fr 120px 120px 100px',
                    padding: '12px 18px', alignItems: 'center',
                    borderBottom: '1px solid rgba(255,255,255,0.03)',
                    background: 'rgba(34,197,94,0.02)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{
                        width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e',
                        animation: 'pulse 1.5s infinite', flexShrink: 0,
                      }} />
                      <span style={{ color: '#f1f5f9', fontWeight: 600, fontSize: '13px' }}>{p.name}</span>
                      <span style={{ color: '#475569', fontSize: '10px' }}>(in meeting)</span>
                    </div>
                    <span style={{ color: '#64748b', fontSize: '11px' }}>In progress</span>
                    <span style={{ color: '#334155', fontSize: '11px' }}>—</span>
                    <span style={{ color: '#22c55e', fontSize: '11px', fontWeight: 600 }}>Live</span>
                  </div>
                ))}

                {participants.length === 0 && (
                  <div style={{ textAlign: 'center', color: '#334155', padding: '40px', fontSize: '13px' }}>
                    No participants have joined this meeting yet.
                  </div>
                )}
              </div>

              <div style={{
                background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)',
                borderRadius: '10px', padding: '12px 16px',
                color: '#64748b', fontSize: '12px', lineHeight: 1.6,
              }}>
                <strong style={{ color: '#818cf8' }}>ℹ️ Full attendance records</strong> (including left participants) are saved to MongoDB
                when the meeting ends. Download the CSV after the session to get complete data.
              </div>
            </div>
          )}
        </div>

        {/* ── FOOTER ─────────────────────────────────────────────────── */}
        <div style={{
          padding: '10px 24px', borderTop: '1px solid rgba(255,255,255,0.05)',
          color: '#1e293b', fontSize: '10px', display: 'flex', alignItems: 'center', gap: '6px',
        }}>
          <span style={{
            width: '6px', height: '6px', borderRadius: '50%',
            background: aiEnabled ? '#22c55e' : '#475569',
            display: 'inline-block',
            animation: aiEnabled ? 'pulse 1.5s infinite' : 'none',
          }} />
          {aiEnabled ? 'AI monitoring active · YOLOv11 + MediaPipe · No video stored' : 'AI monitoring paused'}
        </div>
      </div>

      <style>{`
        @keyframes dashIn { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
        @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:0.3} }
      `}</style>
    </div>
  );
}

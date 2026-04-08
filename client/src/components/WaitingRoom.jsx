/**
 * WaitingRoom — shown to participants waiting for host approval
 */
import { useEffect, useState } from 'react';
import { Clock, User, XCircle } from 'lucide-react';

export default function WaitingRoom({ userName = 'You', meetingId = '', onCancel }) {
  const [dots, setDots] = useState('');
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const tick = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 600);
    const timer = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => { clearInterval(tick); clearInterval(timer); };
  }, []);

  const fmt = (s) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg,#0b1221 0%,#0f1e35 100%)',
    }}>
      {/* Ambient glow */}
      <div style={{
        position: 'absolute', width: '500px', height: '500px',
        borderRadius: '50%', background: 'radial-gradient(circle,rgba(99,102,241,0.15),transparent)',
        top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        pointerEvents: 'none',
      }} />

      <div style={{
        background: 'rgba(15,30,53,0.95)', border: '1px solid rgba(99,102,241,0.25)',
        borderRadius: '24px', padding: '52px 48px', textAlign: 'center',
        maxWidth: '440px', width: '90vw',
        boxShadow: '0 40px 100px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,102,241,0.1)',
        backdropFilter: 'blur(20px)',
        animation: 'fadeUp 0.4s ease',
      }}>
        {/* Spinner */}
        <div style={{
          width: '80px', height: '80px', borderRadius: '50%', margin: '0 auto 28px',
          background: 'linear-gradient(135deg,rgba(99,102,241,0.15),rgba(168,85,247,0.15))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 40px rgba(99,102,241,0.2)',
          position: 'relative',
        }}>
          <div style={{
            position: 'absolute', inset: '-3px', borderRadius: '50%',
            border: '3px solid transparent',
            borderTopColor: '#6366f1', borderRightColor: 'transparent',
            animation: 'spin 1.2s linear infinite',
          }} />
          <User size={32} color="#818cf8" />
        </div>

        <h1 style={{ color: '#f8fafc', fontSize: '22px', fontWeight: 800, margin: '0 0 8px' }}>
          Waiting to be admitted
        </h1>
        <p style={{ color: '#64748b', fontSize: '14px', margin: '0 0 28px', lineHeight: 1.6 }}>
          Hi <strong style={{ color: '#818cf8' }}>{userName}</strong>,<br />
          the host will let you in soon{dots}
        </p>

        {/* Meeting info */}
        <div style={{
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: '12px', padding: '14px 20px', marginBottom: '28px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ textAlign: 'left' }}>
            <div style={{ color: '#334155', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '3px' }}>Meeting ID</div>
            <div style={{ color: '#94a3b8', fontSize: '12px', fontFamily: 'monospace' }}>{meetingId.slice(0, 16)}…</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#475569', fontSize: '12px' }}>
            <Clock size={13} />
            {fmt(elapsed)}
          </div>
        </div>

        {/* Status dots indicator */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginBottom: '32px' }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: '8px', height: '8px', borderRadius: '50%',
              background: '#6366f1',
              animation: `pulse 1.5s ease ${i * 0.3}s infinite`,
            }} />
          ))}
        </div>

        <button onClick={onCancel} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
          padding: '12px 28px', borderRadius: '12px', cursor: 'pointer',
          background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)',
          color: '#ef4444', fontWeight: 600, fontSize: '14px', width: '100%',
          transition: 'all 0.15s',
        }}
          onMouseOver={e => e.currentTarget.style.background = 'rgba(239,68,68,0.18)'}
          onMouseOut={e => e.currentTarget.style.background = 'rgba(239,68,68,0.10)'}
        >
          <XCircle size={16} /> Leave
        </button>
      </div>

      <style>{`
        @keyframes fadeUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
        @keyframes spin   { to { transform: rotate(360deg); } }
        @keyframes pulse  { 0%,100%{opacity:0.3;transform:scale(0.8)} 50%{opacity:1;transform:scale(1)} }
      `}</style>
    </div>
  );
}

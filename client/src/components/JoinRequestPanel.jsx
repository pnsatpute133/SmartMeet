/**
 * JoinRequestPanel — host-side UI for pending join requests
 * Appears as a stacked notification system (like Google Meet's admit dialog)
 */
import { UserCheck, UserX, Clock, Users } from 'lucide-react';

export default function JoinRequestPanel({ requests = [], onApprove, onReject }) {
  if (requests.length === 0) return null;

  return (
    <div style={{
      position: 'fixed', top: '80px', right: '16px', zIndex: 9000,
      display: 'flex', flexDirection: 'column', gap: '10px',
      maxWidth: '340px', width: '90vw',
    }}>
      {requests.slice(0, 3).map((req, index) => (
        <div key={req.socketId} style={{
          background: 'linear-gradient(135deg,rgba(15,30,53,0.98),rgba(11,18,33,0.98))',
          border: '1px solid rgba(99,102,241,0.3)',
          borderRadius: '16px', padding: '16px 18px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,102,241,0.1)',
          backdropFilter: 'blur(20px)',
          animation: 'slideInRight 0.35s cubic-bezier(0.34,1.56,0.64,1)',
          animationDelay: `${index * 0.05}s`,
          animationFillMode: 'both',
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            {/* Avatar */}
            <div style={{
              width: '38px', height: '38px', borderRadius: '50%', flexShrink: 0,
              background: `hsl(${(req.name.charCodeAt(0) * 137) % 360}, 60%, 35%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: '15px', fontWeight: 700,
              border: '2px solid rgba(255,255,255,0.1)',
            }}>
              {req.name.charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {req.name}
              </div>
              <div style={{ color: '#475569', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Clock size={10} />
                wants to join
              </div>
            </div>
            <div style={{
              background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)',
              borderRadius: '999px', padding: '2px 8px',
              color: '#818cf8', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase',
            }}>
              Admit?
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => onApprove(req.socketId)}
              style={{
                flex: 1, padding: '9px 12px', borderRadius: '10px', cursor: 'pointer',
                background: 'linear-gradient(135deg,#22c55e,#16a34a)',
                color: '#fff', border: 'none', fontWeight: 700, fontSize: '13px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                boxShadow: '0 4px 15px rgba(34,197,94,0.3)',
                transition: 'all 0.15s',
              }}
              onMouseOver={e => e.currentTarget.style.transform = 'scale(1.02)'}
              onMouseOut={e => e.currentTarget.style.transform = 'scale(1)'}
            >
              <UserCheck size={14} /> Admit
            </button>
            <button
              onClick={() => onReject(req.socketId)}
              style={{
                flex: 1, padding: '9px 12px', borderRadius: '10px', cursor: 'pointer',
                background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
                color: '#ef4444', fontWeight: 700, fontSize: '13px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                transition: 'all 0.15s',
              }}
              onMouseOver={e => e.currentTarget.style.background = 'rgba(239,68,68,0.22)'}
              onMouseOut={e => e.currentTarget.style.background = 'rgba(239,68,68,0.12)'}
            >
              <UserX size={14} /> Deny
            </button>
          </div>
        </div>
      ))}

      {/* Overflow badge */}
      {requests.length > 3 && (
        <div style={{
          background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.25)',
          borderRadius: '10px', padding: '10px 16px',
          color: '#818cf8', fontSize: '12px', fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: '8px',
          backdropFilter: 'blur(10px)',
        }}>
          <Users size={14} />
          +{requests.length - 3} more waiting to join
        </div>
      )}

      <style>{`
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(60px) scale(0.95); }
          to   { opacity: 1; transform: translateX(0) scale(1); }
        }
      `}</style>
    </div>
  );
}

/**
 * RejectedScreen — shown when host denies entry
 */
import { XCircle, ArrowLeft } from 'lucide-react';

export default function RejectedScreen({ reason, onBack }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg,#0b1221,#1a0a0a)',
    }}>
      <div style={{
        background: 'rgba(15,10,10,0.95)', border: '1px solid rgba(239,68,68,0.25)',
        borderRadius: '24px', padding: '52px 48px', textAlign: 'center',
        maxWidth: '420px', width: '90vw',
        boxShadow: '0 40px 100px rgba(0,0,0,0.7), 0 0 60px rgba(239,68,68,0.05)',
        animation: 'fadeUp 0.4s ease',
      }}>
        <div style={{
          width: '72px', height: '72px', borderRadius: '50%', margin: '0 auto 24px',
          background: 'rgba(239,68,68,0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 40px rgba(239,68,68,0.15)',
        }}>
          <XCircle size={36} color="#ef4444" />
        </div>
        <h1 style={{ color: '#f8fafc', fontSize: '22px', fontWeight: 800, margin: '0 0 10px' }}>
          Entry Denied
        </h1>
        <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.7, margin: '0 0 32px' }}>
          {reason || 'The host did not admit you to this meeting.'}
        </p>
        <button
          onClick={onBack}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            padding: '13px 28px', borderRadius: '12px', cursor: 'pointer',
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
            color: '#e2e8f0', fontWeight: 600, fontSize: '14px', width: '100%',
            transition: 'all 0.15s',
          }}
        >
          <ArrowLeft size={16} /> Go Back
        </button>
      </div>
      <style>{`
        @keyframes fadeUp { from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)} }
      `}</style>
    </div>
  );
}

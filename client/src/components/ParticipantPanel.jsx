import { useState } from 'react';
import { X, MicOff, MoreVertical, UserMinus, Mic, VolumeX, Volume2, Crown, MonitorPlay, Copy, Check } from 'lucide-react';

export default function ParticipantPanel({ 
  onClose, 
  participants, 
  isHost, 
  currentUserId,
  onRemove, 
  onMuteAll,
  onMuteUser,
  onUnmuteUser,
  approveScreenShare,
  denyScreenShare,
  screenShareRequest,
  joinRequests = [],
  approveJoin,
  totalParticipants,
  localUser,
  localStatus,
}) {
  const [copiedLink, setCopiedLink] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const toggleMenu = (socketId) => {
    setOpenMenuId(openMenuId === socketId ? null : socketId);
  };

  // Separate host from other participants
  const hostParticipant = participants.find(p => p.role === 'host');
  const otherParticipants = participants.filter(p => p.role !== 'host');

  return (
    <div className="h-full flex flex-col">
      
      {/* Header */}
      <div className="flex items-center justify-between p-4 px-5 border-b border-[#3c4043] flex-shrink-0">
        <h2 className="text-[17px] font-normal text-[#e8eaed]">People</h2>
        <button 
          onClick={onClose}
          className="p-2 text-[#9aa0a6] hover:text-white transition-colors rounded-full hover:bg-white/5"
        >
          <X size={20} />
        </button>
      </div>

      {/* Join Requests (Waiting Room) */}
      {isHost && joinRequests.length > 0 && (
        <div className="px-4 pt-4 pb-2 border-b border-red-500/20 bg-red-500/5 flex-shrink-0 max-h-[220px] overflow-y-auto">
          <div className="flex items-center gap-2 mb-3 px-1">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <span className="text-[11px] font-bold text-red-500 uppercase tracking-widest">Waiting to join ({joinRequests.length})</span>
          </div>
          <div className="flex flex-col gap-2">
            {joinRequests.map(req => (
              <div key={req.socketId} className="bg-[#2d2e30] border border-white/5 p-3 rounded-xl flex items-center justify-between shadow-lg">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold text-white uppercase">
                    {req.fromName?.charAt(0)}
                  </div>
                  <span className="text-sm font-medium text-white truncate">{req.fromName}</span>
                </div>
                <div className="flex gap-1.5 ml-2">
                  <button 
                    onClick={() => approveJoin(req.socketId)}
                    className="p-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
                    title="Admit"
                  >
                    <Check size={16} />
                  </button>
                  <button 
                    className="p-1.5 bg-[#3c4043] hover:bg-[#4a4e51] text-white rounded-lg transition-colors"
                    title="Deny"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Screen Share Request Alert (Host Only) */}
      {isHost && screenShareRequest && (
        <div className="mx-4 mt-3 p-4 bg-gradient-to-r from-blue-900/40 to-blue-800/30 border border-blue-500/30 rounded-xl animate-pulse-slow">
          <div className="flex items-center gap-2 mb-2">
            <MonitorPlay size={16} className="text-blue-400" />
            <p className="text-sm font-medium text-blue-200">
              Screen share request
            </p>
          </div>
          <p className="text-[13px] text-blue-300/80 mb-3">
            <span className="font-semibold text-blue-200">{screenShareRequest.fromName}</span> wants to share their screen
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => approveScreenShare(screenShareRequest.fromSocketId)}
              className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition-all active:scale-95 shadow-lg shadow-blue-600/20"
            >
              Allow
            </button>
            <button
              onClick={() => denyScreenShare(screenShareRequest.fromSocketId)}
              className="flex-1 px-3 py-2 bg-[#3c4043] hover:bg-[#4a4e51] text-white rounded-lg text-xs font-semibold transition-all active:scale-95"
            >
              Deny
            </button>
          </div>
        </div>
      )}

      {/* Add People / Copy Link */}
      <div className="p-4 border-b border-[#3c4043]/50 flex flex-col gap-3 flex-shrink-0">
        <button 
          onClick={handleCopyLink}
          className="w-full h-11 flex items-center justify-center gap-2.5 bg-blue-600/10 hover:bg-blue-600/20 border border-blue-500/25 text-[#8ab4f8] rounded-full font-medium text-sm transition-all active:scale-[0.98]"
        >
          {copiedLink ? (
            <>
              <Check size={16} /> Link copied!
            </>
          ) : (
            <>
              <Copy size={16} /> Copy joining info
            </>
          )}
        </button>
         
        {isHost && (
          <button 
            onClick={onMuteAll}
            className="w-full h-10 flex items-center justify-center gap-2.5 bg-[#3c4043]/50 hover:bg-red-600/15 border border-[#5f6368]/30 hover:border-red-500/30 text-[#9aa0a6] hover:text-red-400 rounded-lg text-[13px] font-medium transition-all active:scale-[0.98]"
          >
            <VolumeX size={15} /> Mute all participants
          </button>
        )}
      </div>

      {/* Participants List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="px-5 py-3 flex items-center justify-between">
          <span className="text-[12px] font-medium text-[#9aa0a6] uppercase tracking-wider">In this call ({totalParticipants})</span>
        </div>

        {/* ── YOU (Local User) ── */}
        <div className="flex items-center justify-between px-5 py-3 bg-white/[0.02]">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-blue-700 rounded-full flex items-center justify-center text-sm font-semibold text-white flex-shrink-0 shadow-md">
              {localUser?.name?.charAt(0).toUpperCase() || 'Y'}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-[14px] font-medium text-[#e8eaed] flex items-center gap-2 truncate">
                {localUser?.name || 'You'} <span className="text-[#9aa0a6] text-[12px]">(You)</span>
                {isHost && (
                  <span className="text-[10px] bg-blue-600/30 text-blue-300 px-1.5 py-0.5 rounded flex items-center gap-1 flex-shrink-0">
                    <Crown size={9} /> HOST
                  </span>
                )}
              </span>
              <span className="text-[11px] text-[#9aa0a6]">
                {localStatus?.isMuted ? 'Microphone off' : 'Microphone on'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {localStatus?.isHandRaised && <span className="text-base">✋</span>}
            {localStatus?.isMuted ? (
              <MicOff size={16} className="text-[#ea4335]" />
            ) : (
              <Mic size={16} className="text-green-500" />
            )}
          </div>
        </div>

        {/* ── Remote Participants ── */}
        {participants.map((p) => (
          <div 
            key={p.socketId} 
            className="flex items-center justify-between px-5 py-3 group hover:bg-white/[0.03] transition-colors relative"
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold text-white flex-shrink-0 shadow-md ${
                p.role === 'host' 
                  ? 'bg-gradient-to-br from-amber-500 to-amber-700' 
                  : 'bg-gradient-to-br from-[#5f6368] to-[#3c4043]'
              }`}>
                {p.name?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[14px] font-medium text-[#e8eaed] flex items-center gap-2 truncate">
                  {p.name}
                  {p.role === 'host' && (
                    <span className="text-[10px] bg-amber-600/30 text-amber-300 px-1.5 py-0.5 rounded flex items-center gap-1 flex-shrink-0">
                      <Crown size={9} /> HOST
                    </span>
                  )}
                </span>
                <div className="text-[11px] text-[#9aa0a6] flex items-center gap-2">
                  {p.isMuted ? 'Microphone off' : 'Microphone on'}
                  {p.isScreenSharing && (
                    <span className="flex items-center gap-1 text-blue-400">
                      <MonitorPlay size={10} /> Presenting
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 flex-shrink-0">
              {p.isHandRaised && <span className="text-base">✋</span>}
              {p.isMuted ? (
                <MicOff size={16} className="text-[#ea4335]" />
              ) : (
                <Mic size={16} className="text-green-500" />
              )}
              
              {/* Host Controls for remote participants */}
              {isHost && p.role !== 'host' && (
                <div className="relative">
                  <button 
                    onClick={() => toggleMenu(p.socketId)}
                    className="p-1.5 text-[#9aa0a6] hover:text-white rounded-full transition-all opacity-0 group-hover:opacity-100 hover:bg-white/10"
                  >
                    <MoreVertical size={16} />
                  </button>
                  
                  {openMenuId === p.socketId && (
                    <>
                      {/* Backdrop */}
                      <div 
                        className="fixed inset-0 z-[90]" 
                        onClick={() => setOpenMenuId(null)} 
                      />
                      {/* Menu */}
                      <div className="absolute right-0 top-full mt-1 w-48 bg-[#2d2e30] border border-white/10 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.6)] z-[100] p-1.5 overflow-hidden">
                        {p.isMuted ? (
                          <button 
                            onClick={() => { onUnmuteUser(p.socketId); setOpenMenuId(null); }}
                            className="w-full text-left px-4 py-2.5 hover:bg-green-600/10 flex items-center gap-3 text-sm transition-colors text-green-400 rounded-lg"
                          >
                            <Volume2 size={15} /> Unmute
                          </button>
                        ) : (
                          <button 
                            onClick={() => { onMuteUser(p.socketId); setOpenMenuId(null); }}
                            className="w-full text-left px-4 py-2.5 hover:bg-red-600/10 flex items-center gap-3 text-sm transition-colors text-red-400 rounded-lg"
                          >
                            <MicOff size={15} /> Mute
                          </button>
                        )}
                        <button 
                          onClick={() => { onRemove(p.socketId); setOpenMenuId(null); }}
                          className="w-full text-left px-4 py-2.5 hover:bg-red-600/10 flex items-center gap-3 text-sm transition-colors text-red-400 rounded-lg"
                        >
                          <UserMinus size={15} /> Remove from call
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {participants.length === 0 && (
          <div className="px-5 py-10 text-center">
            <p className="text-[#9aa0a6] text-sm">You&apos;re the only one here.</p>
            <p className="text-[#5f6368] text-xs mt-1">Share the meeting link to invite others.</p>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse-slow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.85; }
        }
        .animate-pulse-slow {
          animation: pulse-slow 2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

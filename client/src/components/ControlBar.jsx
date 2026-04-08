import {
  Mic, MicOff, Video, VideoOff, ScreenShare, Hand,
  MessageSquare, Users, Info, MoreVertical, PhoneOff,
  SmilePlus, StopCircle
} from 'lucide-react';

export default function ControlBar({
  isMuted, onToggleMute,
  isVideoOff, onToggleVideo,
  isHandRaised, onToggleHand,
  onLeave,
  onToggleChat, onToggleParticipants,
  onScreenShare, isScreenSharing,
  meetingCode,
  onToggleReactions,
  onToggleOptions,
  activePanel,
  unreadCount = 0,
  participantCount = 1,
  joinRequestCount = 0,
}) {
  const base = "relative group p-3.5 rounded-full flex items-center justify-center transition-all duration-200 focus:outline-none bg-[#3c4043] border border-[#5f6368]/50 hover:bg-[#4a4e51]";
  const active = "p-3.5 rounded-full flex items-center justify-center transition-all duration-200 bg-[#ea4335] text-white hover:bg-[#d93025] focus:outline-none";
  const activeBlue = "relative group p-3.5 rounded-full flex items-center justify-center transition-all duration-200 bg-[#8ab4f8] text-black hover:bg-[#aecbfa] focus:outline-none";

  const Tooltip = ({ text }) => (
    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 px-2 py-1 bg-[#202124] text-white text-[11px] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none border border-white/10 shadow-lg z-50">
      {text}
    </span>
  );

  return (
    <div className="fixed bottom-0 left-0 w-full h-20 bg-[#202124]/95 backdrop-blur-sm border-t border-[#3c4043] flex items-center justify-between px-4 md:px-6 z-50">

      {/* ── Left: Meeting ID ─────────────────────────────── */}
      <div className="flex-1 flex items-center gap-3">
        <div className="hidden md:flex items-center text-white/70 text-[13px] font-mono group cursor-pointer hover:text-white px-2 py-1 rounded transition-colors whitespace-nowrap select-all max-w-[180px] truncate">
          {meetingCode}
        </div>
        <button className="p-2 text-[#9aa0a6] hover:bg-white/5 rounded-full transition-colors" title="Meeting info">
          <Info size={17} />
        </button>
      </div>

      {/* ── Center: Main Controls ────────────────────────── */}
      <div className="flex-[2] flex items-center justify-center gap-2 md:gap-3">

        {/* Mute */}
        <button onClick={onToggleMute} className={isMuted ? active : base} id="btn-mute">
          {isMuted ? <MicOff size={20} /> : <Mic size={20} className="text-white" />}
          {!isMuted && <Tooltip text="Mute" />}
          {isMuted  && <Tooltip text="Unmute" />}
        </button>

        {/* Video */}
        <button onClick={onToggleVideo} className={isVideoOff ? active : base} id="btn-video">
          {isVideoOff ? <VideoOff size={20} /> : <Video size={20} className="text-white" />}
          {!isVideoOff && <Tooltip text="Turn off camera" />}
          {isVideoOff  && <Tooltip text="Turn on camera" />}
        </button>

        {/* Raise Hand */}
        <button onClick={onToggleHand} className={isHandRaised ? activeBlue : base} id="btn-hand">
          <Hand size={20} className={isHandRaised ? 'text-black' : 'text-white'} />
          <Tooltip text={isHandRaised ? 'Lower hand' : 'Raise hand'} />
        </button>

        {/* Reactions */}
        <button onClick={onToggleReactions} className={base} id="btn-reactions">
          <SmilePlus size={20} className="text-white" />
          <Tooltip text="Send reaction" />
        </button>

        {/* Screen Share */}
        <button onClick={onScreenShare} className={isScreenSharing ? activeBlue : base} id="btn-screenshare">
          {isScreenSharing ? <StopCircle size={20} className="text-black" /> : <ScreenShare size={20} className="text-white" />}
          <Tooltip text={isScreenSharing ? 'Stop presenting' : 'Present now'} />
        </button>

        {/* More Options */}
        <button onClick={onToggleOptions} className={base} id="btn-options">
          <MoreVertical size={20} className="text-white" />
          <Tooltip text="More options" />
        </button>

        {/* Leave */}
        <button
          onClick={onLeave}
          id="btn-leave"
          className="p-3.5 px-5 rounded-full bg-[#ea4335] text-white hover:bg-[#d93025] flex items-center gap-2 ml-2 transition-all hover:scale-105 active:scale-95 shadow-lg shadow-red-500/20"
        >
          <PhoneOff size={20} />
          <span className="hidden lg:block font-bold text-sm">Leave</span>
        </button>
      </div>

      {/* ── Right: Chat, Participants ────────────────────── */}
      <div className="flex-1 flex items-center justify-end gap-1 md:gap-2">

        {/* Participants */}
        <button
          onClick={onToggleParticipants}
          id="btn-participants"
          className={`relative p-3 rounded-full transition-all group ${activePanel === 'participants' ? 'bg-white/10 text-white' : 'text-[#9aa0a6] hover:bg-white/5 hover:text-white'}`}
        >
          <Users size={20} />
          {participantCount > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-blue-600 text-white text-[10px] rounded-full flex items-center justify-center font-bold border-2 border-[#202124]">
              {participantCount > 9 ? '9+' : participantCount}
            </span>
          )}
          {joinRequestCount > 0 && (
            <span className="absolute -top-1 -left-1 w-4 h-4 bg-red-500 text-white text-[9px] rounded-full flex items-center justify-center font-black animate-bounce border-2 border-[#202124]">
              {joinRequestCount}
            </span>
          )}
          <Tooltip text="Show participants" />
        </button>

        {/* Chat */}
        <button
          onClick={onToggleChat}
          id="btn-chat"
          className={`relative p-3 rounded-full transition-all group ${activePanel === 'chat' ? 'bg-white/10 text-white' : 'text-[#9aa0a6] hover:bg-white/5 hover:text-white'}`}
        >
          <MessageSquare size={20} />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-blue-600 text-white text-[10px] rounded-full flex items-center justify-center font-bold">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
          <Tooltip text="Chat with everyone" />
        </button>
      </div>
    </div>
  );
}

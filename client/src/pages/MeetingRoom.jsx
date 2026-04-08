import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useAuthStore from '../store/useAuthStore';
import useMeetingStore from '../store/useMeetingStore';
import useWebRTC from '../hooks/useWebRTC';
import VideoTile from '../components/VideoTile';
import ControlBar from '../components/ControlBar';
import ChatPanel from '../components/ChatPanel';
import ParticipantPanel from '../components/ParticipantPanel';
import Reactions from '../components/Reactions';
import SettingsModal from '../components/SettingsModal';

// AI Monitoring Features (PHASE 2 RESTORATION)
import useEngagementMonitor from '../hooks/useEngagementMonitor';
import TeacherDashboard from '../components/TeacherDashboard';
import EngagementBadge from '../components/EngagementBadge';
import AIAlertToast from '../components/AIAlertToast';

import {
  Wifi, Clock, Loader2, CameraOff, Grid, Layout,
  Maximize, Settings, MoreVertical, X, Shield, Brain, ArrowRight
} from 'lucide-react';

export default function MeetingRoom() {
  console.log('[MeetingRoom] 🚀 Component Loaded');
  const { id: roomId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const {
    participants = [],
    localStatus,
    activePanel,
    setActivePanel,
    toggleLocalMute,
    toggleLocalVideo,
    toggleLocalHand,
    setLocalScreenSharing,
    setMeetingId,
    isHost,
    resetMeetingState,
  } = useMeetingStore();

  const {
    localStream,
    peerStreams = {},
    chatMessages = [],
    sendMessage,
    sendReaction,
    kickParticipant,
    muteAll,
    muteUser,
    unmuteUser,
    endMeeting,
    updateMediaState,
    raiseHand,
    shareScreen,
    stopScreenShare,
    switchDevice,
    requestScreenShare,
    approveScreenShare,
    denyScreenShare,
    error,
    socket,
    joinRequests = [],
    screenShareRequest,
    joinState,
    approveJoin,
    rejectJoin,
  } = useWebRTC(roomId, user);

  // ── AI Monitoring System (RESTORATION) ───────────────────
  const [aiEnabled, setAiEnabled]       = useState(false); // Default AI OFF
  const [showDashboard, setShowDashboard] = useState(false);

  // Feature: Host does not track their own engagement
  useEffect(() => {
    if (isHost) {
      console.log('[MeetingRoom] 🎓 User is HOST. AI tracking disabled for this user.');
    }
  }, [isHost]);

  const {
    status: myAiStatus,
    alert: aiAlert,
    insights: aiInsights,
    confidence: aiConfidence,
    myTracker,
    allTrackers,
    saveMeetingReport,
    downloadCSV,
  } = useEngagementMonitor({
    localStream,
    socket,
    userId: user?._id,
    roomId,
    userName: user?.name,
    isVideoOff: localStatus.isVideoOff,
    isMuted: localStatus.isMuted,
    aiEnabled,
    isHost,
  });

  const handleToggleAI = useCallback(() => {
    console.log('[MeetingRoom] 🧠 Toggling AI monitoring:', !aiEnabled);
    setAiEnabled(prev => !prev);
  }, [aiEnabled]);

  // ── Local UI State ─────────────────────────────────────────
  const [meetingTime, setMeetingTime]         = useState('00:00');
  const [screenStream, setScreenStream]       = useState(null);
  const [showReactions, setShowReactions]     = useState(false);
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [showSettings, setShowSettings]       = useState(false);
  const [layoutMode, setLayoutMode]           = useState('grid'); // 'grid' | 'spotlight'
  const [unreadCount, setUnreadCount]         = useState(0);
  const [screenSharePending, setScreenSharePending] = useState(false);

  const timerRef = useRef(null);

  // ── Meeting Timer ──────────────────────────────────────────
  useEffect(() => {
    if (!roomId) { navigate('/'); return; }
    setMeetingId(roomId);

    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      const diff = Math.floor((Date.now() - startTime) / 1000);
      const m = Math.floor(diff / 60).toString().padStart(2, '0');
      const s = (diff % 60).toString().padStart(2, '0');
      setMeetingTime(`${m}:${s}`);
    }, 1000);

    return () => {
      clearInterval(timerRef.current);
      resetMeetingState();
    };
  }, [roomId, setMeetingId, resetMeetingState, navigate]);

  // ── Sync media tracks with toggle state ───────────────────
  useEffect(() => {
    if (updateMediaState) {
      updateMediaState(localStatus.isMuted, localStatus.isVideoOff);
    }
  }, [localStatus.isMuted, localStatus.isVideoOff]);

  // ── Raise hand sync ───────────────────────────────────────
  useEffect(() => {
    if (raiseHand) raiseHand(localStatus.isHandRaised);
  }, [localStatus.isHandRaised]);

  // ── Unread message badge ───────────────────────────────────
  useEffect(() => {
    if (activePanel === 'chat') {
      setUnreadCount(0);
      return;
    }
    const lastMsg = chatMessages[chatMessages.length - 1];
    if (lastMsg && lastMsg.senderId !== user?._id) {
      setUnreadCount(prev => prev + 1);
    }
  }, [chatMessages.length, activePanel]);

  // ── Layout calculation ────────────────────────────────────
  const totalTiles = Object.keys(peerStreams || {}).length + 1; // +1 for local
  const gridClass =
    totalTiles === 1 ? 'grid-cols-1 max-w-3xl mx-auto' :
    totalTiles === 2 ? 'grid-cols-1 md:grid-cols-2 max-w-5xl mx-auto' :
    totalTiles <= 4  ? 'grid-cols-2' :
    totalTiles <= 6  ? 'grid-cols-2 lg:grid-cols-3' :
                       'grid-cols-3 lg:grid-cols-4';

  // ── Fullscreen handler ────────────────────────────────────
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen?.();
    }
    setShowOptionsMenu(false);
  }, []);

  // ── Screen share approval handling ──────────────────────────────
  useEffect(() => {
    if (localStatus.hasScreenShareApproval && !localStatus.isScreenSharing) {
      setScreenSharePending(true);
    }
  }, [localStatus.hasScreenShareApproval]);

  const handleStartScreenShare = useCallback(async () => {
    try {
      setScreenSharePending(false);
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      if (stream) {
        setLocalScreenSharing(true);
        setScreenStream(stream);
        await shareScreen(stream);
      }
    } catch (e) {
      console.error('[MeetingRoom] Screen share error:', e);
      setLocalScreenSharing(false);
    }
  }, [shareScreen, setLocalScreenSharing]);

  // ── Screen share toggle ───────────────────────────────────
  const handleScreenShare = useCallback(async () => {
    if (localStatus.isScreenSharing) {
      if (screenStream) {
        screenStream.getTracks().forEach(t => t.stop());
        setScreenStream(null);
      }
      stopScreenShare();
      setLocalScreenSharing(false);
    } else {
      if (!isHost) {
        requestScreenShare();
        alert('Screen share request sent to host. Waiting for approval...');
        return;
      }
      const stream = await shareScreen();
      if (stream) {
        setLocalScreenSharing(true);
        setScreenStream(stream);
      }
    }
  }, [localStatus.isScreenSharing, screenStream, shareScreen, stopScreenShare, setLocalScreenSharing, isHost, requestScreenShare]);

  // ── Host End Meeting with Auto-Save Report ───────────────
  const handleHostEndAll = useCallback(async () => {
    if (!window.confirm('End meeting for everyone and save report?')) return;

    // Merge my tracker and remote trackers
    const finalTrackers = [
      myTracker,
      ...Object.values(allTrackers)
    ];

    await saveMeetingReport({
      participants: finalTrackers,
      duration: meetingTime,
      hostName: user?.name
    });

    endMeeting(); // socket emit
    navigate('/');
  }, [myTracker, allTrackers, saveMeetingReport, meetingTime, user, endMeeting, navigate]);

  // ── Leave handler ─────────────────────────────────────────
  const handleLeave = useCallback(() => {
    localStream?.getTracks().forEach(t => t.stop());
    navigate('/');
  }, [localStream, navigate]);

  // ── Error State ───────────────────────────────────────────
  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#202124] text-white p-6">
        <div className="bg-[#2d2e30] p-10 rounded-3xl max-w-md text-center shadow-2xl border border-red-500/20">
          <CameraOff size={64} className="mx-auto mb-6 text-red-400" />
          <h2 className="text-2xl font-bold mb-4">Cannot Start Meeting</h2>
          <p className="text-gray-400 mb-8 leading-relaxed">{error}</p>
          <button
            onClick={() => navigate('/')}
            className="w-full py-4 bg-[#3c4043] rounded-2xl font-bold text-white hover:bg-[#4a4e51] transition-all"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  // ── Loading State ─────────────────────────────────────────
  if (!localStream && !error && joinState === 'idle') {
    return (
      <div className="flex flex-col h-screen items-center justify-center bg-[#202124] text-white gap-6">
        <div className="relative flex items-center justify-center p-10 bg-[#2d2e30] rounded-full shadow-2xl">
          <Loader2 size={52} className="animate-spin text-blue-500" />
          <div className="absolute inset-0 rounded-full bg-blue-500/10 blur-xl" />
        </div>
        <div className="text-center">
          <h2 className="text-xl font-medium mb-1">Starting your meeting…</h2>
          <p className="text-gray-500 text-sm">Please allow camera &amp; microphone access</p>
        </div>
      </div>
    );
  }

  // ── Waiting Room State ─────────────────────────────────────
  if (joinState === 'waiting') {
    return (
      <div className="flex flex-col h-screen items-center justify-center bg-[#202124] text-white p-6">
        <div className="max-w-xl w-full flex flex-col items-center">
          <div className="w-24 h-24 bg-blue-600/10 rounded-full flex items-center justify-center mb-10 relative">
            <Loader2 size={40} className="animate-spin text-blue-500" />
            <div className="absolute inset-0 border-2 border-blue-500/20 rounded-full animate-ping" />
          </div>
          <h1 className="text-3xl font-bold mb-4 tracking-tight">Asking to join...</h1>
          <p className="text-gray-400 text-center text-lg leading-relaxed mb-12">
            You'll join the meeting as soon as someone lets you in
          </p>
          <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 animate-[progress_3s_ease-in-out_infinite]" />
          </div>
        </div>
        <style>{`
          @keyframes progress {
            0% { width: 0%; transform: translateX(-100%); }
            50% { width: 100%; transform: translateX(0%); }
            100% { width: 0%; transform: translateX(100%); }
          }
        `}</style>
      </div>
    );
  }

  // ── Rejected State ─────────────────────────────────────────
  if (joinState === 'rejected') {
    return (
      <div className="flex h-screen items-center justify-center bg-[#202124] text-white p-6">
        <div className="bg-[#2d2e30] p-12 rounded-[40px] max-w-md text-center shadow-2xl border border-red-500/10">
          <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-8">
            <Shield size={32} className="text-red-400" />
          </div>
          <h2 className="text-3xl font-black mb-4">Entry Denied</h2>
          <p className="text-gray-400 mb-10 text-lg">Someone in the meeting has denied your request to join.</p>
          <button
            onClick={() => navigate('/')}
            className="w-full py-4.5 bg-white text-black rounded-2xl font-bold hover:bg-gray-200 transition-all active:scale-95 shadow-xl"
          >
            Return Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-screen bg-[#202124] overflow-hidden flex flex-col font-sans">

      {/* ── TOP HUD ───────────────────────────────────────── */}
      <div className="absolute top-0 left-0 w-full p-4 flex justify-between items-start pointer-events-none z-20">

        {/* Left: time + meetingId + host badge */}
        <div className="flex flex-col gap-2">
          <div className="px-4 py-1.5 bg-black/40 backdrop-blur-md rounded-xl flex items-center gap-3 text-white/90 text-sm font-medium border border-white/5 pointer-events-auto">
            <Clock size={15} className="text-blue-400" />
            <span>{meetingTime}</span>
            <span className="w-px h-3.5 bg-white/10" />
            <span className="opacity-70 uppercase text-[11px] tracking-wide max-w-[160px] truncate">{roomId}</span>
          </div>
          {isHost && (
            <div className="flex items-center gap-1.5 px-3 py-1 bg-blue-600/80 backdrop-blur-sm rounded-lg text-[11px] font-bold text-white uppercase tracking-widest w-fit pointer-events-auto border border-blue-400/20">
              <Shield size={10} /> Host
            </div>
          )}
        </div>

        {/* Right: connection status + layout toggle + AI Controls */}
        <div className="flex gap-2 pointer-events-auto flex-wrap justify-end">
          <button
            onClick={() => setLayoutMode(l => l === 'grid' ? 'spotlight' : 'grid')}
            className="px-3 py-1.5 bg-black/40 backdrop-blur-md rounded-xl flex items-center gap-2 text-[#9aa0a6] text-xs border border-white/5 hover:text-white transition-colors"
            title="Toggle layout"
          >
            {layoutMode === 'grid' ? <Grid size={14} /> : <Layout size={14} />}
          </button>

          {/* AI Status Badge (for Participants) */}
          {!isHost && (
            <div className="px-3 py-1.5 bg-black/40 backdrop-blur-md rounded-xl flex items-center gap-2 text-xs border border-white/5">
              <Brain size={13} className="text-purple-400" />
              <EngagementBadge status={aiEnabled ? (myAiStatus || 'idle') : 'idle'} />
            </div>
          )}

          {/* Host AI Buttons */}
          {isHost && (
            <>
              <button
                onClick={handleToggleAI}
                className={`px-3 py-1.5 backdrop-blur-md rounded-xl flex items-center gap-2 text-xs border font-bold transition-all ${
                  aiEnabled
                    ? 'bg-red-600/70 hover:bg-red-600/90 border-red-400/20 text-white'
                    : 'bg-green-600/70 hover:bg-green-600/90 border-green-400/20 text-white'
                }`}
              >
                {aiEnabled ? '⏹ Stop AI' : '▶ Start AI'}
              </button>
              <button
                onClick={() => setShowDashboard(true)}
                className="px-3 py-1.5 bg-purple-600/70 hover:bg-purple-600/90 backdrop-blur-md rounded-xl flex items-center gap-2 text-white text-xs border border-purple-400/20 transition-all font-semibold"
              >
                <Brain size={13} /> Dashboard
              </button>
            </>
          )}

          <div className="px-4 py-1.5 bg-black/40 backdrop-blur-md rounded-xl flex items-center gap-2 text-green-400 text-xs font-bold border border-white/5 uppercase tracking-widest">
            <Wifi size={13} className="animate-pulse" /> Live
          </div>
        </div>
      </div>

      {/* ── MAIN AREA (PHASE 1 Flex Layout) ────────────────────── */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden pt-16 pb-20 px-2 lg:px-4 gap-3 relative">
        <div className="flex-1 flex items-center justify-center overflow-hidden">
          <div className={`grid ${gridClass} gap-3 w-full h-full items-center content-center`}>
            {/* Local Video */}
            <VideoTile
              stream={screenStream || localStream}
              name={`${user?.name || 'You'}${localStatus.isScreenSharing ? ' (Screen)' : ' (You)'}`}
              isLocal={true}
              isMuted={localStatus.isMuted}
              isVideoOff={localStatus.isScreenSharing ? false : localStatus.isVideoOff}
              isHandRaised={localStatus.isHandRaised}
              isActiveSpeaker={localStatus.activeSpeaker === 'local'}
              isHost={isHost}
              role="You"
            />

            {/* Remote Participants */}
            {Object.entries(peerStreams || {}).map(([socketId, stream]) => {
              const p = participants?.find(x => x.socketId === socketId);
              return (
                <VideoTile
                  key={socketId}
                  stream={stream}
                  name={p?.name || 'Attendee'}
                  isMuted={p?.isMuted}
                  isVideoOff={p?.isVideoOff}
                  isHandRaised={p?.isHandRaised}
                  isActiveSpeaker={localStatus.activeSpeaker === socketId}
                  isHost={p?.role === 'host'}
                  role={p?.role}
                />
              );
            })}
          </div>
        </div>

        {/* Sliding Sidebar Panel (PHASE 11) */}
        <div 
          className={`
            transition-all duration-300 ease-in-out flex-shrink-0 overflow-hidden
            absolute md:relative right-0 md:right-auto top-0 bottom-0 md:h-full z-40 bg-[#202124] md:bg-transparent
            ${activePanel ? 'w-full md:w-[350px] lg:w-[360px] opacity-100 shadow-2xl md:shadow-none' : 'w-0 opacity-0 pointer-events-none'}
          `}
        >
          <div className="w-full h-full bg-[#202124] border border-[#3c4043] rounded-2xl overflow-hidden flex flex-col">
            {activePanel === 'chat' && (
              <ChatPanel 
                messages={chatMessages} 
                onSendMessage={sendMessage} 
                onClose={() => setActivePanel(null)} 
                currentUserId={user?._id} 
              />
            )}
            {activePanel === 'participants' && (
              <ParticipantPanel
                onClose={() => setActivePanel(null)}
                participants={participants}
                isHost={isHost}
                currentUserId={user?._id}
                localUser={user}
                localStatus={localStatus}
                onRemove={kickParticipant}
                onMuteUser={muteUser}
                onUnmuteUser={unmuteUser}
                onMuteAll={muteAll}
                approveScreenShare={approveScreenShare}
                denyScreenShare={denyScreenShare}
                screenShareRequest={screenShareRequest}
                joinRequests={joinRequests}
                approveJoin={approveJoin}
                totalParticipants={participants.length + 1}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── CONTROL BAR ───────────────────────────────────── */}
      <ControlBar
        isMuted={localStatus.isMuted}
        onToggleMute={toggleLocalMute}
        isVideoOff={localStatus.isVideoOff}
        onToggleVideo={toggleLocalVideo}
        isHandRaised={localStatus.isHandRaised}
        onToggleHand={toggleLocalHand}
        onLeave={handleLeave}
        onToggleChat={() => setActivePanel(activePanel === 'chat' ? null : 'chat')}
        onToggleParticipants={() => setActivePanel(activePanel === 'participants' ? null : 'participants')}
        meetingCode={roomId}
        isScreenSharing={localStatus.isScreenSharing}
        onScreenShare={handleScreenShare}
        activePanel={activePanel}
        onToggleReactions={() => setShowReactions(r => !r)}
        onToggleOptions={() => setShowOptionsMenu(m => !m)}
        unreadCount={unreadCount}
        participantCount={participants.length + 1}
        joinRequestCount={joinRequests.length}
      />

      {/* ── OPTIONS DROPDOWN ──────────────────────────────── */}
      {showOptionsMenu && (
        <div className="fixed bottom-24 right-4 w-64 bg-[#2d2e30] border border-white/10 rounded-2xl shadow-2xl z-[60] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/5">
            <span className="text-sm font-semibold text-gray-200">Meeting options</span>
            <button onClick={() => setShowOptionsMenu(false)} className="text-gray-500 hover:text-white transition-colors">
              <X size={17} />
            </button>
          </div>

          <div className="py-1">
            <button
              onClick={toggleFullscreen}
              className="w-full text-left px-5 py-3.5 hover:bg-white/5 flex items-center gap-4 transition-all text-sm text-gray-200"
            >
              <Maximize size={17} className="text-blue-400" /> Toggle fullscreen
            </button>
            <button
              onClick={() => { setLayoutMode(l => l === 'grid' ? 'spotlight' : 'grid'); setShowOptionsMenu(false); }}
              className="w-full text-left px-5 py-3.5 hover:bg-white/5 flex items-center gap-4 transition-all text-sm text-gray-200 border-t border-white/5"
            >
              <Grid size={17} className="text-blue-400" />
              {layoutMode === 'grid' ? 'Switch to spotlight' : 'Switch to grid'}
            </button>
            <button
              onClick={() => { setShowSettings(true); setShowOptionsMenu(false); }}
              className="w-full text-left px-5 py-3.5 hover:bg-white/5 flex items-center gap-4 transition-all text-sm text-gray-200 border-t border-white/5"
            >
              <Settings size={17} className="text-blue-400" /> Audio &amp; video settings
            </button>
            
            {/* Host Controls */}
            {isHost && (
              <>
                <div className="border-t border-white/5 my-1" />
                <button
                  onClick={() => { muteAll(); setShowOptionsMenu(false); }}
                  className="w-full text-left px-5 py-3.5 hover:bg-red-600/10 flex items-center gap-4 transition-all text-sm text-red-400"
                >
                  🔇 Mute all
                </button>
                <button
                  onClick={handleHostEndAll}
                  className="w-full text-left px-5 py-3.5 hover:bg-red-600/10 flex items-center gap-4 transition-all text-sm text-red-400 border-t border-white/5"
                >
                  🔴 End meeting for all
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Backdrop for options dropdown */}
      {showOptionsMenu && (
        <div className="fixed inset-0 z-[55]" onClick={() => setShowOptionsMenu(false)} />
      )}

      {/* ── REACTION PICKER ───────────────────────────────── */}
      {showReactions && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 p-2 bg-[#2d2e30]/95 border border-white/10 rounded-full flex gap-1 shadow-2xl z-50">
          {['👍', '❤️', '😂', '👏', '🎉', '🤔', '😲', '😢'].map(emoji => (
            <button
              key={emoji}
              onClick={() => { sendReaction?.(emoji); setShowReactions(false); }}
              className="text-2xl hover:bg-white/10 p-2.5 rounded-full transition-all hover:scale-125 active:scale-90"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* ── JOIN REQUEST TOAST (Host Only) ────────────────── */}
      {isHost && joinRequests.length > 0 && (
        <div className="fixed bottom-24 left-6 z-[60] animate-in slide-in-from-left duration-300">
          <div className="bg-[#2d2e30] border border-blue-500/30 p-4 rounded-2xl shadow-2xl flex items-center gap-4 max-w-sm">
            <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-sm font-bold text-white uppercase">
              {joinRequests[0].fromName?.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{joinRequests[0].fromName} wants to join</p>
              <p className="text-[11px] text-gray-400">Wait for approval</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => approveJoin(joinRequests[0].socketId)}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-all"
              >
                Admit
              </button>
              <button
                onClick={() => rejectJoin(joinRequests[0].socketId)}
                className="px-3 py-1.5 bg-[#3c4043] hover:bg-red-600/20 text-white rounded-lg text-xs font-bold transition-all"
              >
                Deny
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── AI ALERT TOASTS (Participants get alerts from host/AI) ── */}
      <AIAlertToast socket={socket} roomId={roomId} isHost={isHost} />

      {/* ── TEACHER DASHBOARD (Host Only) ────────────────── */}
      {isHost && showDashboard && (
        <TeacherDashboard
          onClose={() => setShowDashboard(false)}
          allTrackers={allTrackers}
          onDownloadCSV={downloadCSV}
          aiEnabled={aiEnabled}
          onToggleAI={handleToggleAI}
          meetingTime={meetingTime}
          participants={participants}
        />
      )}

      {/* ── FLOATING REACTIONS ────────────────────────────── */}
      <Reactions socket={socket} />

      {/* ── SCREEN SHARE APPROVED PROMPT ──────────────────── */}
      {screenSharePending && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 backdrop-blur-sm bg-black/40">
          <div className="bg-[#2d2e30] p-10 rounded-[40px] max-w-sm w-full text-center shadow-2xl border border-blue-500/20 animate-in fade-in zoom-in duration-300">
            <div className="w-20 h-20 bg-blue-600/20 rounded-full flex items-center justify-center mx-auto mb-8">
              <MonitorPlay size={32} className="text-blue-400" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Ready to present?</h2>
            <p className="text-gray-400 mb-10 text-sm">Host has approved your screen share. Click below to choose a window.</p>
            <div className="flex flex-col gap-3">
              <button
                onClick={handleStartScreenShare}
                className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-bold transition-all active:scale-95 shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2"
              >
                Start presenting <ArrowRight size={18} />
              </button>
              <button
                onClick={() => setScreenSharePending(false)}
                className="w-full py-3 text-gray-400 hover:text-white transition-colors text-sm font-medium"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── SETTINGS MODAL ───────────────────────────────── */}
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          localStream={localStream}
          onSwitchDevice={switchDevice}
        />
      )}
    </div>
  );
}

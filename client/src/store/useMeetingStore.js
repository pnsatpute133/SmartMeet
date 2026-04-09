import { create } from 'zustand';

// ── Debug Logger ──────────────────────────────────────────────────────────
const DEBUG = true;
function dbg(tag, ...args) {
  if (!DEBUG) return;
  const ts = new Date().toISOString().substring(11, 23);
  console.log(`%c[${ts}] [Store/${tag}]`, 'color:#34d399;font-weight:bold', ...args);
}

const useMeetingStore = create((set, get) => ({
  // ── Core ───────────────────────────────────────────
  meetingId: null,
  isHost: false,

  // ── Participants ───────────────────────────────────
  // Each participant: { socketId, userId, name, role, isMuted, isVideoOn, isScreenSharing, hasScreenShareApproval, joinedAt }
  participants: [],

  // ── Local User Status ──────────────────────────────
  localStatus: {
    isMuted: false,
    isVideoOff: false,
    isHandRaised: false,
    isScreenSharing: false,
    hasScreenShareApproval: false,
    activeSpeaker: null,
  },

  // ── Screen Share ───────────────────────────────────
  screenShareRequest: null, // { userId, name }
  screenSharePending: false,

  // ── UI ─────────────────────────────────────────────
  activePanel: null, // 'chat' | 'participants' | 'settings' | null

  // ── Core Setters ───────────────────────────────────
  setMeetingId:  (id)     => { dbg('meetingId', id); return set({ meetingId: id }); },
  setHostStatus: (status) => { dbg('isHost', status); return set({ isHost: status }); },

  // ── Participant Management ─────────────────────────
  // Full replacement (from server's participants-update)
  setParticipants: (newUsers) => set(state => {
    const updated = [...state.participants];
    
    newUsers.forEach(user => {
      const existingIdx = updated.findIndex(u => u.userId === user.userId || u.socketId === user.socketId);
      if (existingIdx !== -1) {
        // Update existing
        updated[existingIdx] = { ...updated[existingIdx], ...user };
      } else {
        // Add new
        updated.push({
          isMuted: false, 
          isVideoOn: true, 
          isHandRaised: false, 
          isScreenSharing: false,
          hasScreenShareApproval: false,
          ...user
        });
      }
    });

    // Remove users not in server list (to keep sync)
    const serverSocketIds = new Set(newUsers.map(u => u.socketId));
    const synced = updated.filter(p => serverSocketIds.has(p.socketId));

    dbg('setParticipants', `count=${synced.length} | users=[${synced.map(u => u.name).join(', ')}]`);
    return { participants: synced };
  }),

  // Upsert a single participant
  addParticipant: (user) => set(state => {
    dbg('addParticipant', `name=${user.name} socketId=${user.socketId}`);
    return {
      participants: [
        ...state.participants.filter(p => p.socketId !== user.socketId),
        { 
          isMuted: false, 
          isVideoOn: true, 
          isHandRaised: false, 
          isScreenSharing: false,
          hasScreenShareApproval: false,
          ...user 
        },
      ],
    };
  }),

  removeParticipant: (socketId) => set(state => {
    dbg('removeParticipant', `socketId=${socketId}`);
    return { participants: state.participants.filter(p => p.socketId !== socketId) };
  }),

  updateParticipantStatus: (socketId, updates) => set(state => {
    dbg('updateParticipantStatus', `socketId=${socketId}`, updates);
    return {
      participants: state.participants.map(p =>
        p.socketId === socketId ? { ...p, ...updates } : p
      ),
    };
  }),

  // ── Local Status ───────────────────────────────────
  toggleLocalMute: () => set(state => {
    dbg('toggleLocalMute', `isMuted => ${!state.localStatus.isMuted}`);
    return { localStatus: { ...state.localStatus, isMuted: !state.localStatus.isMuted } };
  }),
  // Force-mute from host (sets to muted, not toggle)
  muteLocal: () => {
    dbg('muteLocal', 'forced muted by host');
    return set(state => ({ localStatus: { ...state.localStatus, isMuted: true } }));
  },
  
  // Force-unmute from host
  unmuteLocal: () => {
    dbg('unmuteLocal', 'forced unmuted by host');
    return set(state => ({ localStatus: { ...state.localStatus, isMuted: false } }));
  },

  toggleLocalVideo: () => set(state => {
    dbg('toggleLocalVideo', `isVideoOff => ${!state.localStatus.isVideoOff}`);
    return { localStatus: { ...state.localStatus, isVideoOff: !state.localStatus.isVideoOff } };
  }),
  toggleLocalHand: () => set(state => ({
    localStatus: { ...state.localStatus, isHandRaised: !state.localStatus.isHandRaised },
  })),
  setLocalScreenSharing: (status) => { dbg('setLocalScreenSharing', status); return set(state => ({ localStatus: { ...state.localStatus, isScreenSharing: status } })); },
  setScreenShareApproval: (status) => { dbg('setScreenShareApproval', status); return set(state => ({ localStatus: { ...state.localStatus, hasScreenShareApproval: status } })); },
  setActiveSpeaker: (socketId) => set(state => ({
    localStatus: { ...state.localStatus, activeSpeaker: socketId },
  })),

  // ── Screen Share Requests ──────────────────────────
  setScreenShareRequest: (request) => { dbg('setScreenShareRequest', request); return set({ screenShareRequest: request }); },
  setScreenSharePending: (pending) => set({ screenSharePending: pending }),

  // ── UI ─────────────────────────────────────────────
  setActivePanel: (panel) => set({ activePanel: panel }),

  // ── Reset ──────────────────────────────────────────
  resetMeetingState: () => set({
    meetingId: null,
    isHost: false,
    participants: [],
    localStatus: {
      isMuted: false,
      isVideoOff: false,
      isHandRaised: false,
      isScreenSharing: false,
      hasScreenShareApproval: false,
      activeSpeaker: null,
    },
    screenShareRequest: null,
    screenSharePending: false,
    activePanel: null,
  }),
}));

export default useMeetingStore;

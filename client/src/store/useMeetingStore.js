import { create } from 'zustand';

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
  setMeetingId:  (id)     => set({ meetingId: id }),
  setHostStatus: (status) => set({ isHost: status }),

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

    return { participants: synced };
  }),

  // Upsert a single participant
  addParticipant: (user) => set(state => ({
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
  })),

  removeParticipant: (socketId) => set(state => ({
    participants: state.participants.filter(p => p.socketId !== socketId),
  })),

  updateParticipantStatus: (socketId, updates) => set(state => ({
    participants: state.participants.map(p =>
      p.socketId === socketId ? { ...p, ...updates } : p
    ),
  })),

  // ── Local Status ───────────────────────────────────
  toggleLocalMute: () => set(state => ({
    localStatus: { ...state.localStatus, isMuted: !state.localStatus.isMuted },
  })),
  // Force-mute from host (sets to muted, not toggle)
  muteLocal: () => set(state => ({
    localStatus: { ...state.localStatus, isMuted: true },
  })),
  
  // Force-unmute from host
  unmuteLocal: () => set(state => ({
    localStatus: { ...state.localStatus, isMuted: false },
  })),

  toggleLocalVideo: () => set(state => ({
    localStatus: { ...state.localStatus, isVideoOff: !state.localStatus.isVideoOff },
  })),
  toggleLocalHand: () => set(state => ({
    localStatus: { ...state.localStatus, isHandRaised: !state.localStatus.isHandRaised },
  })),
  setLocalScreenSharing: (status) => set(state => ({
    localStatus: { ...state.localStatus, isScreenSharing: status },
  })),
  setScreenShareApproval: (status) => set(state => ({
    localStatus: { ...state.localStatus, hasScreenShareApproval: status },
  })),
  setActiveSpeaker: (socketId) => set(state => ({
    localStatus: { ...state.localStatus, activeSpeaker: socketId },
  })),

  // ── Screen Share Requests ──────────────────────────
  setScreenShareRequest: (request) => set({ screenShareRequest: request }),
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

import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import useMeetingStore from '../store/useMeetingStore';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5002';

export default function useWebRTC(roomId, user) {
  const [localStream, setLocalStream]   = useState(null);
  const [peerStreams, setPeerStreams]    = useState({});  // { socketId: MediaStream }
  const [chatMessages, setChatMessages] = useState([]);
  const [error, setError]               = useState(null);
  const [socket, setSocket]             = useState(null);

  const socketRef = useRef(null);
  const peersRef  = useRef({});   // { socketId: RTCPeerConnection }
  const streamRef = useRef(null); // always holds latest stream

  const {
    addParticipant,
    removeParticipant,
    setParticipants,
    updateParticipantStatus,
    setActiveSpeaker,
    setHostStatus,
    setScreenShareRequest,
    setScreenShareApproval,
    muteLocal,
    unmuteLocal,
  } = useMeetingStore();

  const [joinState, setJoinState]       = useState('idle'); // 'idle' | 'waiting' | 'approved' | 'rejected'
  const [joinRequests, setJoinRequests] = useState([]);    // { socketId, fromName, fromUserId }

  // ─────────────────────────────────────────────────────────────
  // Active-speaker detection via AudioContext
  // ─────────────────────────────────────────────────────────────
  const detectActiveSpeaker = useCallback((stream, socketId) => {
    try {
      const ctx      = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      const source   = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      analyser.fftSize = 512;
      const data = new Uint8Array(analyser.frequencyBinCount);

      const check = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, v) => a + v, 0) / data.length;
        if (avg > 40) setActiveSpeaker(socketId);
        requestAnimationFrame(check);
      };
      check();
    } catch {
      /* non-fatal */
    }
  }, [setActiveSpeaker]);

  // ─────────────────────────────────────────────────────────────
  // create RTCPeerConnection and initiate offer to a remote socketId
  // ─────────────────────────────────────────────────────────────
  function createPeerConnectionAndOffer(toSocketId) {
    console.log("Creating peer for:", toSocketId);
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ]
    });

    const remoteStream = new MediaStream();
    setPeerStreams(prev => ({ ...prev, [toSocketId]: remoteStream }));

    pc.ontrack = (evt) => {
      console.log(`[WebRTC] 📹 Received remote track from: ${toSocketId}`);
      evt.streams[0].getTracks().forEach(t => remoteStream.addTrack(t));
      detectActiveSpeaker(remoteStream, toSocketId);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("ICE candidate (sent) ->", toSocketId);
        socketRef.current?.emit('ice-candidate', { toId: toSocketId, candidate: event.candidate });
      }
    };

    if (streamRef.current) {
      console.log(`[WebRTC] Adding local tracks to peer ${toSocketId}`);
      streamRef.current.getTracks().forEach(track => pc.addTrack(track, streamRef.current));
    }

    peersRef.current[toSocketId] = pc;

    pc.createOffer()
      .then(offer => pc.setLocalDescription(offer).then(() => offer))
      .then(offer => {
        console.log("Sending offer to:", toSocketId);
        socketRef.current?.emit('offer', { toId: toSocketId, sdp: offer });
      })
      .catch(err => console.error('[WebRTC] Offer error:', err));

    return pc;
  }

  // ─────────────────────────────────────────────────────────────
  // Create RTCPeerConnection and answer an incoming offer
  // ─────────────────────────────────────────────────────────────
  function createPeerConnectionAndAnswer(fromSocketId, offerSdp) {
    console.log("Creating peer for (answer):", fromSocketId);
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ]
    });

    const remoteStream = new MediaStream();
    setPeerStreams(prev => ({ ...prev, [fromSocketId]: remoteStream }));

    pc.ontrack = (evt) => {
      console.log(`[WebRTC] 📹 Received remote track from: ${fromSocketId}`);
      evt.streams[0].getTracks().forEach(t => remoteStream.addTrack(t));
      detectActiveSpeaker(remoteStream, fromSocketId);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("ICE candidate (sent) ->", fromSocketId);
        socketRef.current?.emit('ice-candidate', { toId: fromSocketId, candidate: event.candidate });
      }
    };

    if (streamRef.current) {
      console.log(`[WebRTC] Adding local tracks to peer ${fromSocketId}`);
      streamRef.current.getTracks().forEach(track => pc.addTrack(track, streamRef.current));
    }

    peersRef.current[fromSocketId] = pc;

    pc.setRemoteDescription(new RTCSessionDescription(offerSdp))
      .then(() => pc.createAnswer())
      .then(answer => pc.setLocalDescription(answer).then(() => answer))
      .then(answer => {
        console.log("Sending answer to:", fromSocketId);
        socketRef.current?.emit('answer', { toId: fromSocketId, sdp: answer });
      })
      .catch(err => console.error('[WebRTC] Answer error:', err));

    return pc;
  }

  // ─────────────────────────────────────────────────────────────
  // Cleanup a single peer
  // ─────────────────────────────────────────────────────────────
  function cleanupPeer(socketId) {
    try { peersRef.current[socketId]?.close?.(); } catch { /* ignore */ }
    delete peersRef.current[socketId];
    setPeerStreams(prev => {
      const next = { ...prev };
      delete next[socketId];
      return next;
    });
    removeParticipant(socketId);
  }

  // ─────────────────────────────────────────────────────────────
  // Socket creation — ONLY ONCE
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    console.log('[WebRTC] 🚀 Creating socket connection');

    const sock = io(SOCKET_URL, {
      transports: ['websocket'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });
    socketRef.current = sock;
    setSocket(sock);

    sock.on('connect', () => {
      console.log('[Socket] ✅ Connected:', sock.id);
    });
    sock.on('connect_error', err => {
      console.error('[Socket] ❌ Connection error:', err.message);
      setError('Cannot reach server. Is it running on port 5002?');
    });

    // ── JOIN FLOW EVENTS ──
    sock.on('waiting-room', () => {
      console.log('[WebRTC] ⏳ In waiting room...');
      setJoinState('waiting');
    });

    sock.on('join-approved', ({ role }) => {
      console.log('[WebRTC] 🎉 Join approved as', role);
      setJoinState('approved');
      setHostStatus(role === 'host');
    });

    sock.on('join-rejected', () => {
      console.log('[WebRTC] ❌ Join rejected');
      setJoinState('rejected');
    });

    console.log("Listening for join requests (Host side)");
    
    sock.on('join-request', ({ fromSocketId, fromName, fromUserId }) => {
      console.log("Join request received (client):", { fromName, fromUserId });
      setJoinRequests(prev => [...prev, { socketId: fromSocketId, fromName, fromUserId }]);
    });

    // Set up all event listeners here (offer/answer/ice using native RTCPeerConnection)
    // ── EVENT: I get list of existing users (as newcomer) ──
    sock.on('all-users', users => {
      console.log('[WebRTC] 👥 Existing users in room:', users.length);
      users.forEach(({ socketId, userId, name }) => {
        if (peersRef.current[socketId]) return; // Already connected
        // Initiate an outgoing peer connection (create offer)
        createPeerConnectionAndOffer(socketId);
        addParticipant({ socketId, userId, name });
      });
    });

    // ── EVENT: An existing user sees me join ───────────────
    sock.on('user-joined', ({ socketId, userId, name }) => {
      console.log('[WebRTC] 👋 New user joined:', name);
      if (peersRef.current[socketId]) return;
      // We'll await their offer and answer accordingly when offer arrives
      addParticipant({ socketId, userId, name });
    });

    // ── EVENT: Incoming offer from a remote peer ───────────
    sock.on('offer', ({ sdp, fromId }) => {
      console.log("Received offer from:", fromId);
      if (peersRef.current[fromId]) {
        console.warn('[WebRTC] offer received but peer exists, overwriting:', fromId);
      }
      createPeerConnectionAndAnswer(fromId, sdp);
    });

    sock.on('answer', ({ sdp, fromId }) => {
      console.log("Received answer from:", fromId);
      const pc = peersRef.current[fromId];
      if (pc) pc.setRemoteDescription(new RTCSessionDescription(sdp)).catch(e => console.error(e));
    });

    // ── EVENT: ICE candidate ───────────────────────────────
    sock.on('ice-candidate', ({ candidate, fromId }) => {
      console.log("ICE candidate (received) from:", fromId);
      const pc = peersRef.current[fromId];
      if (pc && candidate) pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error(e));
    });

    // ─────────────────────────────────────────────────────────
    // ROOM EVENTS (don't need stream)
    // ─────────────────────────────────────────────────────────

    // Full participant list sync from server
    sock.on('participants-update', users => {
      console.log('[WebRTC] 🔄 Participants update:', users.length, 'users');
      // We keep the local user separated in store logic if needed, but the store
      // setParticipants typically replaces the whole list. 
      // Important: filter out local user so we don't render our own tile from peerStreams
      const remoteUsers = users.filter(u => u.socketId !== sock.id);
      setParticipants(remoteUsers);

      // Also update isHost accurately from the list if not already set correctly
      const me = users.find(u => u.socketId === sock.id);
      if (me) {
        setHostStatus(me.role === 'host');
      }
    });

    sock.on('host-status', isHost => {
      console.log('[WebRTC] 👑 Host status updated:', isHost);
      setHostStatus(isHost);
    });

    sock.on('user-left', socketId => {
      console.log('[WebRTC] 👋 User left:', socketId);
      cleanupPeer(socketId);
    });

    sock.on('receive-message', msg => {
      console.log('[WebRTC] 💬 Received message:', msg.content);
      setChatMessages(prev => [...prev, msg]);
    });

    sock.on('user-media-status', ({ socketId, isMuted, isVideoOff }) => {
      console.log('[WebRTC] 🔊 Media status update:', socketId, { isMuted, isVideoOff });
      updateParticipantStatus(socketId, { isMuted, isVideoOff });
    });

    sock.on('user-hand-raised', ({ socketId, isRaised }) => {
      console.log('[WebRTC] ✋ Hand raise update:', socketId, isRaised);
      updateParticipantStatus(socketId, { isHandRaised: isRaised });
    });

    sock.on('force-mute', () => {
      console.log('[Socket] 🔇 Force-muted by host');
      if (streamRef.current) {
        const track = streamRef.current.getAudioTracks()[0];
        if (track) track.enabled = false;
      }
      muteLocal();
    });

    sock.on('force-mute-user', () => {
      console.log('[Socket] 🔇 You were muted by the host');
      if (streamRef.current) {
        const track = streamRef.current.getAudioTracks()[0];
        if (track) track.enabled = false;
      }
      muteLocal();
    });

    sock.on('force-unmute-user', () => {
      console.log('[Socket] 🔊 Force-unmuted by host');
      if (streamRef.current) {
        const track = streamRef.current.getAudioTracks()[0];
        if (track) track.enabled = true;
      }
      unmuteLocal();
    });

    // PHASE 6: Meeting ended by host
    sock.on('meeting-ended', () => {
      console.log('[Socket] 🔴 Host ended the meeting');
      alert('The host has ended this meeting.');
      window.location.href = '/';
    });

    // PHASE 8: Host receives screen share request
    sock.on('screen-share-request', ({ fromSocketId, fromName }) => {
      console.log('[Socket] 📺 Screen share request from:', fromName);
      setScreenShareRequest({ fromSocketId, fromName });
    });

    // PHASE 8: Screen share approval
    sock.on('screen-share-approved', () => {
      console.log('[Socket] ✅ Screen share approved by host');
      setScreenShareApproval(true);
    });

    sock.on('screen-share-denied', () => {
      console.log('[Socket] ❌ Screen share denied by host');
      setScreenShareApproval(false);
      alert('Host denied your screen share request.');
    });

    sock.on('kicked-from-room', () => {
      alert('You have been removed from this meeting by the host.');
      window.location.href = '/';
    });

    return () => {
      console.log('[WebRTC] 🧹 Disconnecting socket');
      sock.disconnect();
    };
  }, []); // Empty dependency — create socket ONLY ONCE

  // ─────────────────────────────────────────────────────────────
  // Room joining — when roomId and user are available
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!roomId || !user || !socketRef.current) return;

    console.log('[WebRTC] 📡 Joining room:', roomId, 'as', user.name);

    // Get media, THEN join room
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        console.log('[WebRTC] 🎥 Media acquired');
        streamRef.current = stream;
        setLocalStream(stream);

        // Emit join-request AFTER media is ready (Phase 1)
        console.log("Sending join request (client)");
        socketRef.current.emit('request-join', { 
          roomId, 
          userId: user._id, 
          name: user.name,
          joinState 
        });
        console.log('[Socket] 📡 Emitted request-join for', roomId, '(State:', joinState + ')');
      })
      .catch(err => {
        console.error('[WebRTC] ❌ Media error:', err);
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setError('Camera/microphone access was denied. Please allow access and refresh.');
        } else if (err.name === 'NotFoundError') {
          setError('No camera or microphone found. Connect a device and refresh.');
        } else {
          setError(`Media device error: ${err.message}`);
        }
      });
  }, [roomId, user, joinState]); // Join when roomId, user, or approval state changes

  // ─────────────────────────────────────────────────────────────
  // ACTIONS exposed to components
  // ─────────────────────────────────────────────────────────────

  const sendMessage = useCallback((content) => {
    console.log('[WebRTC] 💬 Sending message:', content);
    socketRef.current?.emit('send-message', { content });
  }, []);

  const sendReaction = useCallback((emoji) => {
    console.log('[WebRTC] 😊 Sending reaction:', emoji);
    socketRef.current?.emit('send-reaction', { emoji });
  }, []);

  const kickParticipant = useCallback((targetSocketId) => {
    console.log('[WebRTC] 🚫 Kicking participant:', targetSocketId);
    socketRef.current?.emit('remove-user', targetSocketId);
  }, []);

  const muteAll = useCallback(() => {
    console.log('[WebRTC] 🔇 Muting all');
    socketRef.current?.emit('mute-all');
  }, []);

  // PHASE 4: Mute specific user
  const muteUser = useCallback((targetSocketId) => {
    console.log('[WebRTC] 🔇 Muting user:', targetSocketId);
    socketRef.current?.emit('mute-user', targetSocketId);
  }, []);

  // PHASE 4: Unmute specific user
  const unmuteUser = useCallback((targetSocketId) => {
    console.log('[WebRTC] 🔊 Unmuting user:', targetSocketId);
    socketRef.current?.emit('unmute-user', targetSocketId);
  }, []);

  // PHASE 4: End meeting for all
  const endMeeting = useCallback(() => {
    console.log('[WebRTC] 🔴 Ending meeting');
    socketRef.current?.emit('end-meeting');
  }, []);

  // PHASE 6: Request screen share permission
  const requestScreenShare = useCallback(() => {
    console.log('[WebRTC] 📺 Requesting screen share permission');
    socketRef.current?.emit('request-screen-share');
  }, []);

  // PHASE 6: Approve screen share
  const approveScreenShare = useCallback((targetSocketId) => {
    console.log('[WebRTC] ✅ Approving screen share for:', targetSocketId);
    socketRef.current?.emit('approve-screen-share', targetSocketId);
  }, []);

  // PHASE 6: Deny screen share
  const denyScreenShare = useCallback((targetSocketId) => {
    console.log('[WebRTC] ❌ Denying screen share for:', targetSocketId);
    socketRef.current?.emit('deny-screen-share', targetSocketId);
  }, []);

  const updateMediaState = useCallback((isMuted, isVideoOff) => {
    console.log('[WebRTC] 🔊 Updating media state:', { isMuted, isVideoOff });
    socketRef.current?.emit('toggle-media', { isMuted, isVideoOff });
    if (streamRef.current) {
      const audioTrack = streamRef.current.getAudioTracks()[0];
      const videoTrack = streamRef.current.getVideoTracks()[0];
      if (audioTrack) audioTrack.enabled = !isMuted;
      if (videoTrack) videoTrack.enabled = !isVideoOff;
    }
  }, []);

  const raiseHand = useCallback((isRaised) => {
    console.log('[WebRTC] ✋ Raising hand:', isRaised);
    socketRef.current?.emit('raise-hand', { isRaised });
  }, []);

  const shareScreen = useCallback(async (existingStream = null) => {
    try {
      // PHASE 8: Check if host approval is required (if not host)
      const { isHost } = useMeetingStore.getState();
      if (!isHost && !useMeetingStore.getState().localStatus.hasScreenShareApproval) {
        console.log('[WebRTC] 📺 Requesting screen share permission (not host)');
        requestScreenShare();
        return null;
      }

      console.log('[WebRTC] 📡 Starting screen share...');
      const screenStream = existingStream || await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const screenTrack  = screenStream.getVideoTracks()[0];

      // PHASE 2: Replace video track for ALL existing peers (CRITICAL)
      Object.entries(peersRef.current).forEach(([socketId, peer]) => {
        const sender = peer.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
          console.log('[WebRTC] Replacing track for peer:', socketId);
          sender.replaceTrack(screenTrack).catch(e => console.error('[WebRTC] replaceTrack error:', e));
        }
      });

      // UPDATE MASTER REFERENCE so new joiners get the screen track
      // We create a combined stream to keep audio from mic if possible, or just the screen video
      const newStream = new MediaStream([
        screenTrack,
        ...streamRef.current.getAudioTracks()
      ]);
      streamRef.current = newStream;
      setLocalStream(newStream);

      // Notify server (PHASE 6)
      socketRef.current?.emit('toggle-screen-share', { isSharing: true });

      screenTrack.onended = () => stopScreenShare(screenTrack);
      return screenStream;
    } catch (e) {
      console.error('[WebRTC] Screen share error:', e.message);
      return null;
    }
  }, []);

  const stopScreenShare = useCallback((screenTrack) => {
    console.log('[WebRTC] 📡 Stopping screen share, restoring camera...');
    try { screenTrack?.stop(); } catch { /* ignore */ }
    
    // Re-apply camera track
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(camStream => {
        const camTrack = camStream.getVideoTracks()[0];
        
        // Replace for all peers
        Object.values(peersRef.current).forEach(peer => {
          const sender = peer.getSenders().find(s => s.track?.kind === 'video');
          if (sender) {
            sender.replaceTrack(camTrack).catch(e => console.error('[WebRTC] restoreTrack error:', e));
          }
        });

        // Update master reference
        const restoredStream = new MediaStream([
          camTrack,
          ...camStream.getAudioTracks()
        ]);
        streamRef.current = restoredStream;
        setLocalStream(restoredStream);

        // Notify server
        socketRef.current?.emit('toggle-screen-share', { isSharing: false });
      });
  }, []);

  const switchDevice = useCallback(async (kind, deviceId) => {
    try {
      const constraints = kind === 'videoinput'
        ? { video: { deviceId: { exact: deviceId } }, audio: false }
        : { audio: { deviceId: { exact: deviceId } }, video: false };

      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      const newTrack  = kind === 'videoinput'
        ? newStream.getVideoTracks()[0]
        : newStream.getAudioTracks()[0];

      const oldTrack = kind === 'videoinput'
        ? streamRef.current?.getVideoTracks()[0]
        : streamRef.current?.getAudioTracks()[0];

      if (oldTrack && streamRef.current) {
        streamRef.current.removeTrack(oldTrack);
        streamRef.current.addTrack(newTrack);
        oldTrack.stop();

        Object.values(peersRef.current).forEach(peer => {
          const sender = peer.getSenders().find(s => s.track?.kind === (kind === 'videoinput' ? 'video' : 'audio'));
          if (sender) {
            sender.replaceTrack(newTrack).catch(e => console.error('[WebRTC] replaceTrack error:', e));
          }
        });

        // Force re-render for local video
        setLocalStream(new MediaStream(streamRef.current.getTracks()));
      }
    } catch (err) {
      console.error('[WebRTC] Device switch error:', err.message);
    }
  }, []);

  const approveJoin = useCallback((socketId) => {
    console.log('[WebRTC] ✅ Approving join:', socketId);
    socketRef.current?.emit('approve-join', { roomId, userId: socketId });
    setJoinRequests(prev => prev.filter(r => r.socketId !== socketId));
  }, [roomId]);

  const rejectJoin = useCallback((socketId) => {
    console.log('[WebRTC] ❌ Rejecting join:', socketId);
    socketRef.current?.emit('reject-join', { roomId, userId: socketId });
    setJoinRequests(prev => prev.filter(r => r.socketId !== socketId));
  }, [roomId]);

  return {
    localStream,
    peerStreams,
    chatMessages,
    error,
    socket,
    joinState,
    joinRequests,
    // actions
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
    approveJoin,
    rejectJoin,
  };
}

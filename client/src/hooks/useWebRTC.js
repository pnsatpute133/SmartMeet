import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { BASE_URL } from '../config';
import useMeetingStore from '../store/useMeetingStore';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || BASE_URL;

export default function useWebRTC(roomId, user) {
  const [localStream, setLocalStream]   = useState(null);
  const [peerStreams, setPeerStreams]    = useState({});  // { socketId: MediaStream }
  const [chatMessages, setChatMessages] = useState([]);
  const [error, setError]               = useState(null);
  const [socket, setSocket]             = useState(null);

  const socketRef = useRef(null);
  const peersRef  = useRef({});   // { socketId: RTCPeerConnection }
  const streamRef = useRef(null); // always holds latest stream
  const pendingCandidates = useRef({}); // { socketId: RTCIceCandidateInit[] }

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
    participants, // Added for debugging phase 8
  } = useMeetingStore();

  const [joinState, setJoinState]           = useState('idle');
  const [joinRequests, setJoinRequests]     = useState([]);
  const [screenShareRequest, setScreenShareRequestLocal] = useState(null); // local mirror
  const isJoinedRef = useRef(false);

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
  // Per-peer negotiation flags  (Perfect Negotiation pattern)
  // ─────────────────────────────────────────────────────────────
  const makingOffer  = useRef({}); // { socketId: bool }
  const ignoreOffer  = useRef({}); // { socketId: bool }
  const isSettingRemoteAnswerPending = useRef({}); // { socketId: bool }

  // ─────────────────────────────────────────────────────────────
  // Create / retrieve a RTCPeerConnection for a remote socketId.
  // Implements MDN "Perfect Negotiation" to survive offer collisions.
  // ─────────────────────────────────────────────────────────────
  function getOrCreatePeer(remoteSocketId) {
    if (peersRef.current[remoteSocketId]) return peersRef.current[remoteSocketId];

    console.log('[WebRTC] 🔗 Creating peer for:', remoteSocketId);

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun.services.mozilla.com' }
      ]
    });

    const remoteStream = new MediaStream();
    setPeerStreams(prev => ({ ...prev, [remoteSocketId]: remoteStream }));

    pc.ontrack = (evt) => {
      console.log(`[WebRTC] 📹 Remote track from: ${remoteSocketId} | kind: ${evt.track.kind}`);
      
      // Add the specific track that triggered this event
      remoteStream.addTrack(evt.track);
      
      // Force React state update by creating a new MediaStream reference
      const updatedStream = new MediaStream(remoteStream.getTracks());
      setPeerStreams(prev => ({ ...prev, [remoteSocketId]: updatedStream }));
      
      detectActiveSpeaker(updatedStream, remoteSocketId);
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        socketRef.current?.emit('ice-candidate', { toId: remoteSocketId, candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] Connection [${remoteSocketId}]:`, pc.connectionState);
      if (pc.connectionState === 'failed') {
        console.warn('[WebRTC] Connection failed, restarting ICE for', remoteSocketId);
        pc.restartIce?.();
      }
    };

    pc.onsignalingstatechange = () => {
      console.log(`[WebRTC] Signaling [${remoteSocketId}]:`, pc.signalingState);
    };

    // Perfect Negotiation — re-negotiate when needed
    pc.onnegotiationneeded = async () => {
      try {
        makingOffer.current[remoteSocketId] = true;
        await pc.setLocalDescription();  // browser auto-creates offer
        console.log('[WebRTC] 📤 Sending offer to:', remoteSocketId);
        socketRef.current?.emit('offer', { toId: remoteSocketId, sdp: pc.localDescription });
      } catch (err) {
        console.error('[WebRTC] onnegotiationneeded error:', err);
      } finally {
        makingOffer.current[remoteSocketId] = false;
      }
    };

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => pc.addTrack(track, streamRef.current));
    }

    peersRef.current[remoteSocketId] = pc;
    if (!pendingCandidates.current[remoteSocketId]) {
      pendingCandidates.current[remoteSocketId] = [];
    }
    return pc;
  }

  // ─────────────────────────────────────────────────────────────
  // Kept for backward compat — now delegates to getOrCreatePeer
  // ─────────────────────────────────────────────────────────────
  function createPeerConnectionAndOffer(toSocketId) {
    getOrCreatePeer(toSocketId); // onnegotiationneeded fires automatically after addTrack
  }

  function createPeerConnectionAndAnswer(fromSocketId, offerSdp) {
    // Handled by the offer socket handler using Perfect Negotiation
    handleIncomingOffer(fromSocketId, offerSdp);
  }

  async function handleIncomingOffer(fromSocketId, offerSdp) {
    const pc = getOrCreatePeer(fromSocketId);

    // Determine politeness: the socket with the lexicographically smaller ID is polite
    const myId = socketRef.current?.id || '';
    const polite = myId < fromSocketId;

    const offerCollision =
      (offerSdp.type === 'offer') &&
      (makingOffer.current[fromSocketId] || pc.signalingState !== 'stable');

    ignoreOffer.current[fromSocketId] = !polite && offerCollision;

    if (ignoreOffer.current[fromSocketId]) {
      console.log('[WebRTC] 🚦 Offer collision — impolite side handled (ignored) offer from', fromSocketId);
      return;
    }

    try {
      if (offerCollision) {
        // Polite side: rollback own offer, then accept theirs
        await pc.setLocalDescription({ type: 'rollback' });
        await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
      } else {
        await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
      }

      // Flush any buffered ICE candidates
      const queued = pendingCandidates.current[fromSocketId] || [];
      if (queued.length > 0) {
        console.log(`[WebRTC] Flushing ${queued.length} buffered ICE candidates for`, fromSocketId);
        for (const c of queued) {
          await pc.addIceCandidate(new RTCIceCandidate(c)).catch(e =>
            console.warn('[WebRTC] Buffered ICE error:', e)
          );
        }
        pendingCandidates.current[fromSocketId] = [];
      }

      if (offerSdp.type === 'offer') {
        await pc.setLocalDescription();  // browser auto-creates answer
        console.log('[WebRTC] 📤 Sending answer to:', fromSocketId);
        socketRef.current?.emit('answer', { toId: fromSocketId, sdp: pc.localDescription });
      }
    } catch (err) {
      console.error('[WebRTC] handleIncomingOffer error:', err);
    }
  }


  // ─────────────────────────────────────────────────────────────
  // Cleanup a single peer
  // ─────────────────────────────────────────────────────────────
  function cleanupPeer(socketId) {
    try { peersRef.current[socketId]?.close?.(); } catch { /* ignore */ }
    delete peersRef.current[socketId];
    delete pendingCandidates.current[socketId];
    delete makingOffer.current[socketId];
    delete ignoreOffer.current[socketId];
    delete isSettingRemoteAnswerPending.current[socketId];
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
      reconnection: true,
      reconnectionAttempts: 5
    });
    socketRef.current = sock;
    setSocket(sock);

    sock.on('connect', () => {
      console.log('[Socket] ✅ Connected:', sock.id);
      // PHASE 10: SOCKET CONNECTION CHECK
      console.log("Socket connected:", sock.id);
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

    const joinMeetingRoom = () => {
      if (sock.roomIdEmitted) return;
      sock.roomIdEmitted = true;
      sock.emit('join-room', { 
        roomId: roomId, 
        userId: user._id || user.userId, 
        name: user.name
      });
    };

    sock.on('join-approved', ({ role }) => {
      console.log('[WebRTC] 🎉 Join approved as', role);
      setJoinState('approved');
      setHostStatus(role === 'host');
      joinMeetingRoom();
    });

    sock.on('join-rejected', () => {
      console.log('[WebRTC] ❌ Join rejected');
      setJoinState('rejected');
    });

    console.log("Listening for join requests (Host side)");
    
    sock.on('join-request', ({ socketId, name, userId }) => {
      console.log("Join request received (client):", { name, userId });
      setJoinRequests(prev => {
        if (prev.find(r => r.socketId === socketId)) return prev;
        return [...prev, { socketId, fromName: name, fromUserId: userId }];
      });
    });

    // PHASE 4: FRONTEND HANDLE USERS
    sock.on("existing-users", (users) => {
      users.forEach(userId => {
        // userId is actually the socketId here
        console.log("Creating peer:", userId);
        createPeerConnectionAndOffer(userId);
      });
    });

    // PHASE 5: HANDLE NEW USER JOIN
    sock.on("user-joined", ({ userId, name }) => {
      console.log("User joined:", userId);
      // Wait for incoming offer to prevent collision
      
      // Update UI state
      addParticipant({ socketId: userId, userId, name });
    });

    // ── EVENT: Incoming offer from a remote peer ───────────
    sock.on('offer', ({ sdp, fromId }) => {
      console.log('[WebRTC] 📨 Received offer from:', fromId);
      createPeerConnectionAndAnswer(fromId, sdp);
    });

    sock.on('answer', ({ sdp, fromId }) => {
      const pc = peersRef.current[fromId];
      if (!pc) {
        console.warn('[WebRTC] answer: no peer found for', fromId);
        return;
      }
      // Perfect Negotiation: ignore answer if we ignored the offer
      if (ignoreOffer.current[fromId]) {
        console.log('[WebRTC] 📋 Ignoring answer from', fromId, '(it belongs to an ignored collision offer)');
        return;
      }
      // Only apply answer when waiting for one
      if (pc.signalingState !== 'have-local-offer') {
        console.warn(`[WebRTC] ⚠️ Ignoring answer from ${fromId} — state: ${pc.signalingState}`);
        return;
      }
      console.log('[WebRTC] ✅ Applying answer from:', fromId);
      pc.setRemoteDescription(new RTCSessionDescription(sdp))
        .then(() => {
          // Flush any ICE candidates buffered while waiting for answer
          const queued = pendingCandidates.current[fromId] || [];
          if (queued.length > 0) {
            console.log(`[WebRTC] Flushing ${queued.length} post-answer ICE candidates for`, fromId);
            queued.forEach(c =>
              pc.addIceCandidate(new RTCIceCandidate(c)).catch(e => console.warn('[WebRTC] ICE flush error:', e))
            );
            pendingCandidates.current[fromId] = [];
          }
        })
        .catch(e => console.error('[WebRTC] setRemoteDescription(answer) error:', e));
    });

    // ── EVENT: ICE candidate ───────────────────────────────
    sock.on('ice-candidate', ({ candidate, fromId }) => {
      // Ensure peer exists even if ICE candidate arrives slightly before the offer
      const pc = getOrCreatePeer(fromId);
      if (!candidate) return;

      // Guard: only add candidate once remote description is set
      if (pc.remoteDescription && pc.remoteDescription.type) {
        pc.addIceCandidate(new RTCIceCandidate(candidate))
          .catch(e => console.warn('[WebRTC] addIceCandidate error:', e));
      } else {
        // Queue the candidate until remote description is set
        if (!pendingCandidates.current[fromId]) {
          pendingCandidates.current[fromId] = [];
        }
        pendingCandidates.current[fromId].push(candidate);
        console.log(`[WebRTC] 📦 Buffered early ICE candidate for ${fromId}`);
      }
    });

    // ─────────────────────────────────────────────────────────
    // ROOM EVENTS (don't need stream)
    // ─────────────────────────────────────────────────────────

    // Full participant list sync from server
    sock.on('participants-update', users => {
      console.log('[WebRTC] 🔄 Participants update:', users.length, 'users');
      // Filter out local user
      const remoteUsers = users.filter(u => u.socketId !== sock.id);
      
      // PHASE 1: Fix participant state overwriting
      setParticipants(remoteUsers);

      // PHASE 8: Mandatory Logs
      console.log("Participants state:", useMeetingStore.getState().participants);
      console.log("Peers:", peersRef.current);
      console.log("Host socket:", sock.id);

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
    sock.on('screen-share-request', (data) => {
      console.log('[WebRTC] 📺 Host received screen-share-request:', data);
      const req = { userId: data.userId, name: data.name };
      setScreenShareRequest(req);      // update Zustand store
      setScreenShareRequestLocal(req); // update local state (used in return)
    });

    sock.on('screen-share-approved', () => {
      console.log('[Socket] ✅ Screen share approved by host');
      setScreenShareApproval(true);
    });

    sock.on('screen-share-denied', () => {
      console.log('[Socket] ❌ Screen share denied by host');
      setScreenShareApproval(false);
      setScreenShareRequestLocal(null);
      alert('Host denied your screen share request.');
    });

    sock.on('kicked-from-room', () => {
      alert('You have been removed from this meeting by the host.');
      window.location.href = '/';
    });

    sock.on('host-warning', ({ message }) => {
      console.log('[Socket] ⚠️ Host warning received:', message);
      alert(message);
    });

    return () => {
      console.log('[WebRTC] 🧹 Cleaning up socket listeners');
      sock.off('connect');
      sock.off('connect_error');
      sock.off('waiting-room');
      sock.off('join-approved');
      sock.off('join-rejected');
      sock.off('join-request');
      sock.off('all-users');
      sock.off('user-joined');
      sock.off('offer');
      sock.off('answer');
      sock.off('ice-candidate');
      sock.off('participants-update');
      sock.off('host-status');
      sock.off('user-left');
      sock.off('receive-message');
      sock.off('user-media-status');
      sock.off('user-hand-raised');
      sock.off('force-mute');
      sock.off('force-mute-user');
      sock.off('force-unmute-user');
      sock.off('meeting-ended');
      sock.off('screen-share-request');
      sock.off('screen-share-approved');
      sock.off('screen-share-denied');
      sock.off('kicked-from-room');
      sock.off('host-warning');
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
        
        // PHASE 1: VERIFY ROOM JOIN (CRITICAL)
        if (!isJoinedRef.current || joinState === 'idle') {
          console.log("Joining room:", roomId);
          socketRef.current.emit('request-join', { 
            roomId: roomId, 
            userId: user._id || user.userId, 
            name: user.name
          });
          isJoinedRef.current = true;
        }
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
    // MANDATORY DEBUG LOG
    console.log("Sending screen share request");
    
    console.log('[WebRTC] 📺 Requesting screen share permission');
    socketRef.current?.emit('request-screen-share', {
      roomId,
      userId: user?._id || user?.userId,
      name: user?.name
    });
  }, [roomId, user]);

  // PHASE 6: Approve screen share
  const approveScreenShare = useCallback((userId) => {
    console.log('[WebRTC] ✅ Approving screen share for:', userId);
    socketRef.current?.emit('approve-screen-share', {
      roomId,
      userId 
    });
    setScreenShareRequestLocal(null); // Clear local mirror to close popup
  }, [roomId]);

  // PHASE 6: Deny screen share
  const denyScreenShare = useCallback((userId) => {
    console.log('[WebRTC] ❌ Denying screen share for:', userId);
    socketRef.current?.emit('deny-screen-share', userId);
    setScreenShareRequestLocal(null); // Clear local mirror to close popup
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
    socketRef.current?.emit('approve-join', { roomId, socketId });
    setJoinRequests(prev => prev.filter(r => r.socketId !== socketId));
  }, [roomId]);

  const rejectJoin = useCallback((socketId) => {
    console.log('[WebRTC] ❌ Rejecting join:', socketId);
    socketRef.current?.emit('reject-join', { socketId });
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
    screenShareRequest: screenShareRequest !== undefined
      ? screenShareRequest   // from local state (always fresh)
      : null,
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

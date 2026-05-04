const Meeting = require('../models/Meeting');
const Message = require('../models/Message');

// ── Debug Logger ──────────────────────────────────────────────────────────
const DEBUG = true;
function dbg(tag, ...args) {
  if (!DEBUG) return;
  const ts = new Date().toISOString().substring(11, 23);
  console.log(`[${ts}] [DEBUG][${tag}]`, ...args);
}
function roomSnap(roomId) {
  if (!rooms[roomId]) return { error: 'room not found' };
  const r = rooms[roomId];
  return {
    host: r.host?.name,
    userCount: Object.keys(r.users).length,
    waitingCount: Object.keys(r.waitingUsers).length,
    users: Object.values(r.users).map(u => `${u.name}(${u.role})`),
    waiting: Object.values(r.waitingUsers).map(u => u.name),
  };
}

// In-memory room state — survives individual socket disconnects
// Structure: roomId -> { 
//   hostSocketId, 
//   users: { socketId -> { socketId, userId, name, role, isMuted, isVideoOn, isScreenSharing, joinedAt } },
//   screenShareRequest: { fromSocketId, requestedAt }
// }
const rooms = {};

// ── Participant cap ───────────────────────────────────────────────────────
const MAX_PARTICIPANTS = 30;

// Helper: Save final report to DB (Attendance + AI Summary)
async function saveFinalReport(roomId, roomData) {
  try {
    dbg('DB', `Saving final report for room: ${roomId}`);

    const now = new Date();
    // Issue 4: Use attendanceMap (keyed by userId) as source of truth
    const aMap = roomData.attendanceMap || {};

    // Flush users still active in room into the map
    Object.values(roomData.users || {}).forEach(user => {
      const joinTime = user.joinedAt ? new Date(user.joinedAt) : now;
      const entry = aMap[user.userId];
      if (entry) {
        entry.leaveTime = now;
        entry.durationSeconds = Math.max(
          entry.durationSeconds,
          Math.floor((now - new Date(entry.joinTime)) / 1000)
        );
      } else {
        aMap[user.userId] = {
          userId: user.userId, name: user.name, role: user.role,
          joinTime, leaveTime: now,
          durationSeconds: Math.max(0, Math.floor((now - joinTime) / 1000)),
        };
      }
    });

    const dedupedLog = Object.values(aMap);
    dbg('DB', `Attendance records (1 per user): ${dedupedLog.length}`);

    const MeetingReport = require('../models/MeetingReport');
    await MeetingReport.findOneAndUpdate(
      { meetingId: roomId },
      { $set: { meetingId: roomId, endedAt: now, attendance: dedupedLog } },
      { upsert: true }
    );
    console.log(`[Database] ✅ Final attendance saved for ${roomId} (${dedupedLog.length} users)`);
  } catch (err) {
    console.error('[Database] ❌ Report save error:', err.message);
    dbg('DB', 'Full error:', err);
  }
}

// Helper: broadcast updated participants list to everyone in a room
function broadcastParticipants(io, roomId) {
  if (!rooms[roomId]) return;
  const users = Object.values(rooms[roomId].users).map(u => ({
    socketId: u.socketId,
    userId: u.userId,
    name: u.name,
    role: u.role,
    isMuted: u.isMuted || false,
    isVideoOn: !u.isVideoOff, // Convert isVideoOff to isVideoOn
    isScreenSharing: u.isScreenSharing || false,
    joinedAt: u.joinedAt,
  }));
  dbg('Broadcast', `participants-update to room ${roomId}: ${users.length} users`);
  io.to(roomId).emit('participants-update', users);
}

module.exports = (io, socket) => {
  console.log(`[Socket] ✅ New connection: ${socket.id}`);

  // ═══════════════════════════════════════════════
  // JOIN ROOM & WAITING ROOM (Phase 1 & 2)
  // ═══════════════════════════════════════════════
  socket.on('join-room', handleJoin);

  socket.on('request-join', ({ roomId, userId, name }) => {
    if (!roomId || !userId || !name) return;

    if (!rooms[roomId]) {
      // First person, room doesn't exist, so they are the host and join immediately
      return handleJoin({ roomId, userId, name });
    }

    // ── Capacity check ──────────────────────────────────────────────────────
    const currentCount = Object.keys(rooms[roomId].users).length;
    if (currentCount >= MAX_PARTICIPANTS) {
      console.warn(`[Socket] 🚫 Room ${roomId} is full (${currentCount}/${MAX_PARTICIPANTS}). Rejecting ${name}.`);
      socket.emit('room-full', { max: MAX_PARTICIPANTS });
      return;
    }

    const hostSocketId = rooms[roomId].hostSocketId;
    rooms[roomId].waitingUsers[socket.id] = {
      socketId: socket.id,
      userId,
      name
    };

    socket.emit('waiting-room');

    io.to(hostSocketId).emit("join-request", {
      userId,
      name,
      socketId: socket.id
    });
  });

  async function handleJoin({ roomId, userId, name, joinState }) {
    if (!roomId || !userId || !name) return;

    // ── Capacity check (skip for the very first join that creates the room) ──
    if (rooms[roomId]) {
      const currentCount = Object.keys(rooms[roomId].users).length;
      if (currentCount >= MAX_PARTICIPANTS) {
        console.warn(`[Socket] 🚫 Room ${roomId} is full (${currentCount}/${MAX_PARTICIPANTS}). Rejecting ${name}.`);
        socket.emit('room-full', { max: MAX_PARTICIPANTS });
        return;
      }
    }

    // PHASE 2: BACKEND ROOM JOIN FIX
    socket.join(roomId);
    console.log(`User ${userId} joined room ${roomId}`);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        hostSocketId: socket.id,
        host: { socketId: socket.id, userId, name },
        users: {},
        waitingUsers: {},
        attendanceLog: [],     // kept for compat
        attendanceMap: {},     // Issue 4: keyed by userId — 1 row per user
        screenShareRequest: null
      };
    }

    const role = (rooms[roomId].hostSocketId === socket.id) ? 'host' : 'participant';
    
    rooms[roomId].users[socket.id] = {
      socketId: socket.id, userId, name, role,
      isMuted: false, isVideoOff: false, isScreenSharing: false, joinedAt: new Date()
    };

    // Issue 4: Upsert attendance map — preserve joinTime on reconnect
    if (!rooms[roomId].attendanceMap) rooms[roomId].attendanceMap = {};
    if (!rooms[roomId].attendanceMap[userId]) {
      rooms[roomId].attendanceMap[userId] = {
        userId, name, role,
        joinTime: new Date(),
        leaveTime: null,
        durationSeconds: 0,
      };
    } else {
      // Reconnect: update socket reference but keep original joinTime
      rooms[roomId].attendanceMap[userId].name = name;
      dbg('Attendance', `User ${name} reconnected — updating existing attendance entry`);
    }
    
    socket.roomId = roomId; socket.userId = userId; socket.userName = name; socket.role = role;

    socket.emit('join-approved', { role });
    if (role === 'host') socket.emit('host-status', true);

    // PHASE 3: EXISTING USERS LIST
    const clients = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
    // Send existing users to the newcomer (filter self out)
    socket.emit("existing-users", clients.filter(id => id !== socket.id));

    // Notify others
    socket.to(roomId).emit("user-joined", { userId: socket.id, name });

    broadcastParticipants(io, roomId);
  }

  socket.on('approve-join', ({ roomId, socketId }) => {
    const room = rooms[roomId];
    if (!room || room.hostSocketId !== socket.id) return;

    const waiter = room.waitingUsers[socketId];
    if (!waiter) return;

    console.log(`[Socket] ✅ Host approved ${waiter.name}`);
    delete room.waitingUsers[socketId];
    
    io.sockets.sockets.get(socketId)?.join(roomId);
    io.to(socketId).emit('join-approved', { roomId, role: 'participant' });
  });

  socket.on('reject-join', ({ socketId }) => {
    console.log(`[Socket] ❌ Host rejected join request for ${socketId}`);
    // Clear from waiting list if exists in any room
    for (let rId in rooms) {
      if (rooms[rId].waitingUsers[socketId]) {
         delete rooms[rId].waitingUsers[socketId];
      }
    }
    io.to(socketId).emit('join-rejected');
  });

  // ═══════════════════════════════════════════════
  // WEBRTC SIGNALING RELAY
  // ═══════════════════════════════════════════════
  socket.on('sending-signal', ({ signal, toId }) => {
    console.log(`[Signaling] 📤 Offer: ${socket.id} → ${toId}`);
    dbg('Signal', `sending-signal type=${signal?.type || 'unknown'} | from=${socket.id} to=${toId}`);
    io.to(toId).emit('user-received-offer', {
      signal,
      fromId: socket.id,
      fromName: socket.userName,
      fromUserId: socket.userId,
    });
  });

  socket.on('returning-signal', ({ signal, toId }) => {
    console.log(`[Signaling] 📥 Answer: ${socket.id} → ${toId}`);
    dbg('Signal', `returning-signal type=${signal?.type || 'unknown'} | from=${socket.id} to=${toId}`);
    io.to(toId).emit('receiving-returned-signal', {
      signal,
      fromId: socket.id,
    });
  });

  socket.on('ice-candidate', ({ candidate, toId }) => {
    console.log(`[Signaling] 🧊 ICE: ${socket.id} → ${toId}`);
    dbg('ICE', `candidate protocol=${candidate?.protocol} | from=${socket.id} to=${toId}`);
    io.to(toId).emit('ice-candidate', { candidate, fromId: socket.id });
  });

  // New-style offer/answer events (native RTCPeerConnection flow)
  socket.on('offer', ({ toId, sdp }) => {
    console.log(`[Signaling] 📨 Offer relay: ${socket.id} → ${toId}`);
    dbg('Signal', `offer sdpType=${sdp?.type} | from=${socket.id} to=${toId}`);
    io.to(toId).emit('offer', { sdp, fromId: socket.id });
  });

  socket.on('answer', ({ toId, sdp }) => {
    console.log(`[Signaling] ✅ Answer relay: ${socket.id} → ${toId}`);
    dbg('Signal', `answer sdpType=${sdp?.type} | from=${socket.id} to=${toId}`);
    io.to(toId).emit('answer', { sdp, fromId: socket.id });
  });

  // ═══════════════════════════════════════════════
  // CHAT
  // ═══════════════════════════════════════════════
  socket.on('send-message', async ({ content }) => {
    const roomId = socket.roomId;
    if (!roomId || !content?.trim()) return;

    console.log(`[Chat] 💬 ${socket.userName}: ${content.trim()}`);
    dbg('Chat', `sender=${socket.userId} | roomId=${roomId} | length=${content.trim().length}`);

    const messageData = {
      roomId,
      senderId: socket.userId,
      senderName: socket.userName,
      content: content.trim(),
      timestamp: new Date(),
    };

    // Broadcast immediately (don't wait for DB)
    io.to(roomId).emit('receive-message', messageData);
    dbg('Chat', `Broadcasted to room ${roomId}`);

    // Persist
    try {
      const msg = new Message(messageData);
      await msg.save();
      dbg('Chat', `Message saved to DB: ${msg._id}`);
    } catch (err) {
      console.error('[Socket] Message save error:', err.message);
    }
  });

  // ═══════════════════════════════════════════════
  // MEDIA STATE SYNC (PHASE 8 - Sync all users)
  // ═══════════════════════════════════════════════
  socket.on('toggle-media', ({ isMuted, isVideoOff }) => {
    const roomId = socket.roomId;
    if (!roomId) return;

    console.log(`[Media] 🔊 ${socket.userName}: muted=${isMuted}, videoOff=${isVideoOff}`);
    dbg('Media', `toggle-media | user=${socket.userName} | room=${roomId}`);

    // Update in-memory store
    if (rooms[roomId]?.users[socket.id]) {
      rooms[roomId].users[socket.id].isMuted = isMuted;
      rooms[roomId].users[socket.id].isVideoOff = isVideoOff;
    }

    // Notify peers
    socket.to(roomId).emit('user-media-status', { socketId: socket.id, isMuted, isVideoOff });

    // Re-broadcast participants so sidebar updates icons
    broadcastParticipants(io, roomId);
  });

  // SCREEN SHARE STATE SYNC
  socket.on('toggle-screen-share', ({ isSharing }) => {
    const roomId = socket.roomId;
    if (!roomId) return;

    console.log(`[ScreenShare] 📺 ${socket.userName}: sharing=${isSharing}`);

    if (rooms[roomId]?.users[socket.id]) {
      rooms[roomId].users[socket.id].isScreenSharing = isSharing;
    }

    // Notify all users
    io.to(roomId).emit('user-screen-share-status', {
      socketId: socket.id,
      isScreenSharing: isSharing
    });

    broadcastParticipants(io, roomId);
  });

  // ═══════════════════════════════════════════════
  // REACTIONS
  // ═══════════════════════════════════════════════
  socket.on('send-reaction', ({ emoji }) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    console.log(`[Reaction] 😊 ${socket.userName}: ${emoji}`);
    dbg('Reaction', `emoji=${emoji} | from=${socket.userName} | room=${roomId}`);
    io.to(roomId).emit('receive-reaction', {
      emoji,
      fromId: socket.id,
      fromName: socket.userName,
    });
  });

  // ═══════════════════════════════════════════════
  // HAND RAISE
  // ═══════════════════════════════════════════════
  socket.on('raise-hand', ({ isRaised }) => {
    const roomId = socket.roomId;
    if (!roomId) return;
    console.log(`[Hand] ✋ ${socket.userName}: ${isRaised ? 'raised' : 'lowered'}`);
    dbg('Hand', `isRaised=${isRaised} | room=${roomId} | user=${socket.userName}`);
    if (rooms[roomId]?.users[socket.id]) {
      rooms[roomId].users[socket.id].isHandRaised = isRaised;
    }
    socket.to(roomId).emit('user-hand-raised', { socketId: socket.id, isRaised });
    broadcastParticipants(io, roomId);
  });

  // ═══════════════════════════════════════════════
  // HOST CONTROLS (PHASE 4 & 5)
  // ═══════════════════════════════════════════════

  // 1. END MEETING FOR ALL
  socket.on('end-meeting', () => {
    const roomId = socket.roomId;
    if (!roomId) return;

    // Validate host
    if (rooms[roomId]?.hostSocketId !== socket.id) {
      console.warn(`[Socket] 🚫 Non-host ${socket.id} tried to end meeting`);
      return;
    }

    console.log(`[Socket] 🔴 Host ${socket.userName} ending meeting ${roomId}`);
    io.to(roomId).emit('meeting-ended');

    // ── ATTENDANCE FIX: Save report before deleting room ──────────────────
    if (rooms[roomId]) {
      dbg('Room', `Host ending meeting. Saving attendance for ${roomId}`);
      saveFinalReport(roomId, rooms[roomId]);
    }

    // Disconnect all sockets in room
    const socketsInRoom = io.sockets.adapter.rooms.get(roomId);
    if (socketsInRoom) {
      socketsInRoom.forEach(socketId => {
        io.sockets.sockets.get(socketId)?.disconnect(true);
      });
    }
    delete rooms[roomId];
  });

  // 2. MUTE ALL PARTICIPANTS
  socket.on('mute-all', () => {
    const roomId = socket.roomId;
    if (!roomId) return;

    // Validate host
    if (rooms[roomId]?.hostSocketId !== socket.id) {
      console.warn(`[Socket] 🚫 Non-host ${socket.id} tried mute-all`);
      return;
    }

    console.log(`[Socket] 🔇 Host ${socket.userName} muting all in ${roomId}`);

    // Mute all participants in in-memory store
    Object.values(rooms[roomId].users).forEach(user => {
      if (user.role === 'participant') {
        user.isMuted = true;
      }
    });

    // Notify all participants to mute locally
    socket.to(roomId).emit('force-mute');
    broadcastParticipants(io, roomId);
  });

  // 3. MUTE SPECIFIC USER
  socket.on('mute-user', (targetSocketId) => {
    const roomId = socket.roomId;
    if (!roomId) return;

    // Validate host
    if (rooms[roomId]?.hostSocketId !== socket.id) {
      console.warn(`[Socket] 🚫 Non-host ${socket.id} tried mute-user`);
      return;
    }

    if (!rooms[roomId].users[targetSocketId]) {
      console.warn(`[Socket] User ${targetSocketId} not found`);
      return;
    }

    console.log(`[Socket] 🔇 Host muting specific user ${targetSocketId}`);
    rooms[roomId].users[targetSocketId].isMuted = true;

    io.to(targetSocketId).emit('force-mute-user');
    broadcastParticipants(io, roomId);
  });

  // 4. UNMUTE SPECIFIC USER (Host can unmute)
  socket.on('unmute-user', (targetSocketId) => {
    const roomId = socket.roomId;
    if (!roomId) return;

    // Validate host
    if (rooms[roomId]?.hostSocketId !== socket.id) {
      console.warn(`[Socket] 🚫 Non-host ${socket.id} tried unmute-user`);
      return;
    }

    if (!rooms[roomId].users[targetSocketId]) {
      console.warn(`[Socket] User ${targetSocketId} not found`);
      return;
    }

    console.log(`[Socket] 🔊 Host unmuting user ${targetSocketId}`);
    rooms[roomId].users[targetSocketId].isMuted = false;

    io.to(targetSocketId).emit('force-unmute-user');
    broadcastParticipants(io, roomId);
  });

  // 5. REMOVE USER FROM MEETING
  socket.on('remove-user', (targetSocketId) => {
    const roomId = socket.roomId;
    if (!roomId) return;

    // Validate host
    if (rooms[roomId]?.hostSocketId !== socket.id) {
      console.warn(`[Socket] 🚫 Non-host ${socket.id} tried remove-user`);
      return;
    }

    if (!rooms[roomId].users[targetSocketId]) {
      console.warn(`[Socket] User ${targetSocketId} not found`);
      return;
    }

    console.log(`[Socket] 🚫 Host ${socket.userName} removing ${targetSocketId} from ${roomId}`);

    // Notify target user they're being kicked
    io.to(targetSocketId).emit('kicked-from-room');

    // Disconnect the target socket
    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) {
      targetSocket.disconnect(true);
    }
  });

  // 6. SCREEN SHARE PERMISSION REQUEST
  socket.on('request-screen-share', (data) => {
    const { roomId } = data;
    const room = rooms[roomId];

    // MANDATORY DEBUG LOG
    console.log("Received request:", data);

    const host = room?.host;

    if (!host) {
      console.log("Host not found");
      return;
    }

    console.log("Sending screen request to host:", host.socketId);

    // Notify host of screen share request
    io.to(host.socketId).emit('screen-share-request', data);
  });

  // 7. HOST APPROVES SCREEN SHARE
  socket.on('approve-screen-share', ({ roomId, userId }) => {
    const rId = roomId || socket.roomId;
    if (!rId || !rooms[rId]) return;

    // Validate host
    if (rooms[rId]?.hostSocketId !== socket.id) {
      console.warn(`[Socket] 🚫 Non-host tried approve-screen-share`);
      return;
    }

    const userSocket = [...io.sockets.sockets.values()].find(s => s.userId === userId);
    if (!userSocket) {
      console.log("[ScreenShare] ❌ User not found for screen share approval, userId:", userId);
      return;
    }

    console.log(`[ScreenShare] ✅ Host approved screen share for userId=${userId} socket=${userSocket.id}`);
    dbg('ScreenShare', `Emitting screen-share-approved to ${userSocket.id}`);

    io.to(userSocket.id).emit('screen-share-approved');

    // Update tracking & clear the pending request
    if (rooms[rId].users[userSocket.id]) {
      rooms[rId].users[userSocket.id].hasScreenShareApproval = true;
    }
    rooms[rId].screenShareRequest = null;
    broadcastParticipants(io, rId);
  });

  // 8. HOST DENIES SCREEN SHARE
  socket.on('deny-screen-share', (userId) => {
    const roomId = socket.roomId;
    if (!roomId) return;

    // Validate host
    if (rooms[roomId]?.hostSocketId !== socket.id) {
      console.warn(`[Socket] 🚫 Non-host tried deny-screen-share`);
      return;
    }

    const userSocket = [...io.sockets.sockets.values()].find(s => s.userId === userId);

    if (userSocket) {
      console.log(`[Socket] ❌ Host denied screen share for ${userId}`);
      io.to(userSocket.id).emit('screen-share-denied');
    }

    if (rooms[roomId]) {
      rooms[roomId].screenShareRequest = null;
    }
  });

  // OLD HOST CONTROLS (compatibility, redirects to new)
  socket.on('kick-participant', (targetSocketId) => {
    socket.emit('remove-user', targetSocketId);
  });

  // ═══════════════════════════════════════════════
  // AI MONITORING (PHASE 7)
  // ═══════════════════════════════════════════════

  socket.on('ai-update', (data) => {
    // data: { userId, roomId, tracker }
    const roomId = socket.roomId; // Use server-authoritative roomId
    if (!roomId || !rooms[roomId]) return;

    const room = rooms[roomId];
    dbg('AI', `ai-update from ${socket.userName}(${socket.id}) | status=${data.tracker?.lastStatus} | score=${data.tracker?.engagementScore}%`);

    const payload = { ...data, socketId: socket.id };

    // 1. Forward to host specifically (guaranteed delivery)
    if (room.hostSocketId && room.hostSocketId !== socket.id) {
      io.to(room.hostSocketId).emit('ai-update', payload);
      dbg('AI', `ai-update → HOST(${room.hostSocketId})`);
    }

    // 2. Also broadcast to rest of room (other participants)
    socket.to(roomId).emit('ai-update', payload);
  });

  socket.on('ai-alert', (data) => {
    // data: { userId, roomId, status, alert, confidence, insights }
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;

    dbg('AI', `ai-alert from ${socket.userName}(${socket.id}) | status=${data.status} | alert="${data.alert}"`);

    const room = rooms[roomId];
    const payload = { ...data, socketId: socket.id };

    // Forward alert to host specifically
    if (room.hostSocketId && room.hostSocketId !== socket.id) {
      io.to(room.hostSocketId).emit('ai-alert', payload);
    }

    // Broadcast to rest of room
    socket.to(roomId).emit('ai-alert', payload);
  });

  // 9. HOST SENDS WARNING TO PARTICIPANT
  socket.on('send-warning', ({ targetSocketId, message }) => {
    const roomId = socket.roomId;
    if (rooms[roomId]?.hostSocketId !== socket.id) return;
    io.to(targetSocketId).emit('host-warning', { message });
  });

  // 10. HOST TOGGLES AI FOR ROOM
  socket.on('set-ai-status', ({ roomId, enabled }) => {
    if (!rooms[roomId] || rooms[roomId].hostSocketId !== socket.id) return;
    dbg('AI', `Host ${socket.userName} setting room AI to: ${enabled}`);
    io.to(roomId).emit('ai-status-update', { enabled });
  });

  // ═══════════════════════════════════════════════
  // DISCONNECT (PHASE 10 - Handle edge cases)
  // ═══════════════════════════════════════════════
  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    console.log(`[Socket] ❌ Disconnected: ${socket.id} from room ${roomId || 'none'}`);
    dbg('Disconnect', `user=${socket.userName || 'unknown'} | role=${socket.role || 'unknown'} | room=${roomId || 'none'}`);

    if (!roomId || !rooms[roomId]) return;

    const room = rooms[roomId];
    const user = room.users[socket.id];

    // Issue 4: Update attendanceMap on disconnect (upsert by userId)
    if (user) {
      const leaveTime = new Date();
      const duration = Math.floor((leaveTime - new Date(user.joinedAt)) / 1000);
      dbg('Attendance', `${user.name} session ended: ${duration}s in room ${roomId}`);

      if (!room.attendanceMap) room.attendanceMap = {};
      const existing = room.attendanceMap[user.userId];
      if (existing) {
        // Accumulate total time (handles reconnects)
        existing.leaveTime = leaveTime;
        existing.durationSeconds += Math.max(0, duration);
      } else {
        room.attendanceMap[user.userId] = {
          userId: user.userId, name: user.name, role: user.role,
          joinTime: user.joinedAt, leaveTime,
          durationSeconds: Math.max(0, duration),
        };
      }
    }

    // Remove from room map
    delete room.users[socket.id];

    // Notify peers
    socket.to(roomId).emit('user-left', socket.id);

    if (Object.keys(room.users).length === 0) {
      // Last person left — clean up room
      console.log(`[Socket] 🗑️ Room ${roomId} is now empty. Saving report...`);
      dbg('Room', `Closing room ${roomId} | total logs: ${room.attendanceLog.length}`);
      saveFinalReport(roomId, room);
      delete rooms[roomId];
    } else if (room.hostSocketId === socket.id) {
      // Host left — promote next person (PHASE 2)
      const users = Object.values(room.users);
      if (users.length > 0) {
        const nextUser = users[0];
        room.hostSocketId = nextUser.socketId;
        room.host = { socketId: nextUser.socketId, userId: nextUser.userId, name: nextUser.name };
        room.users[nextUser.socketId].role = 'host';
        io.to(nextUser.socketId).emit('host-status', true);
        console.log(`[Socket] 👑 New host promoted: ${nextUser.name} (${nextUser.socketId})`);
        dbg('Promote', `New host: ${nextUser.name} | room: ${roomId}`);
        broadcastParticipants(io, roomId);
      }
    } else {
      dbg('Disconnect', `Room ${roomId} still has ${Object.keys(room.users).length} user(s)`);
      broadcastParticipants(io, roomId);
    }
  });
};

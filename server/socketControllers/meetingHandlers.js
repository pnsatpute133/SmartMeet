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

// Helper: Save final report to DB (Attendance + AI Summary)
async function saveFinalReport(roomId, roomData) {
  try {
    dbg('DB', `Saving final report for room: ${roomId}`);

    // ── ATTENDANCE FIX: Process users still in the room ──────────────────
    const now = new Date();
    Object.values(roomData.users || {}).forEach(user => {
      const joinTime = user.joinedAt ? new Date(user.joinedAt) : now;
      const duration = Math.floor((now - joinTime) / 1000);
      
      roomData.attendanceLog.push({
        userId: user.userId,
        name: user.name,
        role: user.role,
        joinTime: joinTime,
        leaveTime: now,
        durationSeconds: duration > 0 ? duration : 0
      });
    });
    // Optional: deduplicate if needed, but usually users are unique per socketId
    
    dbg('DB', `Attendance records total: ${roomData.attendanceLog?.length || 0}`);
    const MeetingReport = require('../models/MeetingReport');
    await MeetingReport.findOneAndUpdate(
      { meetingId: roomId },
      {
        $set: {
          meetingId: roomId,
          endedAt: now,
          attendance: roomData.attendanceLog
        }
      },
      { upsert: true }
    );
    console.log(`[Database] ✅ Final attendance saved for ${roomId}`);
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
  socket.on('request-join', handleJoin);

  async function handleJoin({ roomId, userId, name, joinState }) {
    if (!roomId || !userId || !name) {
      dbg('Join', `❌ Missing fields: roomId=${roomId}, userId=${userId}, name=${name}`);
      return;
    }
    console.log("Join request received (server):", { roomId, userId, name, joinState });
    dbg('Join', `socket=${socket.id} | rooms active: ${Object.keys(rooms).length}`);

    // Init room if new
    if (!rooms[roomId]) {
      dbg('Join', `🏛 Creating new room: ${roomId}`);
      rooms[roomId] = {
        host: { socketId: socket.id, userId, name }, // Phase 5 structure
        hostSocketId: socket.id, // Keep for compatibility
        users: {},
        waitingUsers: {},
        attendanceLog: [],
        screenShareRequest: null
      };
    }

    const room = rooms[roomId];
    console.log("Room Host:", room.host?.socketId);
    dbg('Join', `Room snapshot:`, roomSnap(roomId));

    // CASE 1: Host Entry
    if (room.hostSocketId === socket.id || Object.keys(room.users).length === 0) {
      room.hostSocketId = socket.id;
      room.host = { socketId: socket.id, userId, name };
      room.users[socket.id] = {
        socketId: socket.id, userId, name, role: 'host',
        isMuted: false, isVideoOff: false, isScreenSharing: false, joinedAt: new Date()
      };
      socket.roomId = roomId; socket.userId = userId; socket.userName = name; socket.role = 'host';
      socket.join(roomId);
      socket.emit('join-approved', { role: 'host' });
      socket.emit('host-status', true);
      broadcastParticipants(io, roomId);
      console.log(`[Socket] 👑 ${name} joined as HOST`);
      dbg('Join', `👑 Host ${name} in room ${roomId} | Room: ${JSON.stringify(roomSnap(roomId))}`);
      return;
    }

    // CASE 2: Approved Participant Entry
    if (joinState === 'approved' || (room.users[socket.id] && room.users[socket.id].role !== 'host')) {
      room.users[socket.id] = {
        socketId: socket.id, userId, name, role: 'participant',
        isMuted: false, isVideoOff: false, isScreenSharing: false, joinedAt: new Date()
      };
      socket.roomId = roomId; socket.userId = userId; socket.userName = name; socket.role = 'participant';
      socket.join(roomId);
      const others = Object.values(room.users)
        .filter(u => u.socketId !== socket.id)
        .map(u => ({ socketId: u.socketId, userId: u.userId, name: u.name }));
      dbg('Join', `✅ ${name} approved. Sending all-users: [${others.map(o => o.name).join(', ')}]`);
      socket.emit('all-users', others);
      socket.to(roomId).emit('user-joined', { socketId: socket.id, userId, name });
      broadcastParticipants(io, roomId);
      console.log(`[Socket] ✅ ${name} entered meeting after approval`);
      dbg('Join', `Room after approval: ${JSON.stringify(roomSnap(roomId))}`);
      return;
    }

    // CASE 3: New Participant (Needs host approval - Phase 2)
    console.log(`[Socket] ⏳ ${name} is waiting for host approval at ${room.hostSocketId}`);
    dbg('Join', `Waiting room for ${name}. Host socket: ${room.hostSocketId}`);
    room.waitingUsers[socket.id] = { socketId: socket.id, userId, name };

    io.to(room.hostSocketId).emit('join-request', {
      fromSocketId: socket.id,
      fromName: name,
      fromUserId: userId
    });
    dbg('Join', `📨 join-request sent to host ${room.hostSocketId}`);

    socket.emit('waiting-room');
  }

  socket.on('approve-join', ({ roomId, userId: targetSocketId }) => {
    const room = rooms[roomId];
    dbg('Approve', `Host ${socket.id} approving ${targetSocketId}`);
    if (!room || room.hostSocketId !== socket.id) {
      dbg('Approve', `❌ Auth fail: room=${!!room} | isHost=${room?.hostSocketId === socket.id}`);
      return;
    }

    const waiter = room.waitingUsers[targetSocketId];
    if (!waiter) {
      dbg('Approve', `❌ Waiter ${targetSocketId} not in waiting list`);
      return;
    }

    console.log(`[Socket] ✅ Host approved ${waiter.name}`);
    dbg('Approve', `Room waiting list before: ${JSON.stringify(Object.keys(room.waitingUsers))}`);
    room.users[targetSocketId] = { ...waiter, role: 'participant' };
    delete room.waitingUsers[targetSocketId];
    io.to(targetSocketId).emit('join-approved', { role: 'participant' });
    dbg('Approve', `✅ Emitted join-approved to ${targetSocketId}`);
  });

  socket.on('reject-join', ({ roomId, userId: targetSocketId }) => {
    const room = rooms[roomId];
    if (!room || room.hostSocketId !== socket.id) return;

    console.log(`[Socket] ❌ Host rejected join request for ${targetSocketId}`);
    dbg('Reject', `Removing ${targetSocketId} from waiting list`);
    delete room.waitingUsers[targetSocketId];
    io.to(targetSocketId).emit('join-rejected');
    dbg('Reject', `❌ Emitted join-rejected to ${targetSocketId}`);
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

    // PHASE 2: Attendance Tracking (Log leave time)
    if (user) {
      const leaveTime = new Date();
      const duration = Math.floor((leaveTime - new Date(user.joinedAt)) / 1000);
      dbg('Attendance', `${user.name} stayed ${duration}s in room ${roomId}`);
      room.attendanceLog.push({
        userId: user.userId,
        name: user.name,
        role: user.role,
        joinTime: user.joinedAt,
        leaveTime: leaveTime,
        durationSeconds: duration > 0 ? duration : 0
      });
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

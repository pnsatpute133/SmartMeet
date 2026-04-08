const Meeting = require('../models/Meeting');
const Message = require('../models/Message');

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
    const MeetingReport = require('../models/MeetingReport');
    await MeetingReport.findOneAndUpdate(
      { meetingId: roomId },
      {
        $set: {
          meetingId:  roomId,
          endedAt:    new Date(),
          attendance: roomData.attendanceLog
        }
      },
      { upsert: true }
    );
    console.log(`[Database] ✅ Final attendance saved for ${roomId}`);
  } catch (err) {
    console.error('[Database] ❌ Report save error:', err.message);
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
    if (!roomId || !userId || !name) return;
    console.log("Join request received (server):", { roomId, userId, name, joinState });

    // Init room if new
    if (!rooms[roomId]) {
      rooms[roomId] = { 
        hostSocketId: socket.id, // Current user is host of new room
        users: {}, 
        waitingUsers: {}, 
        attendanceLog: [], 
        screenShareRequest: null 
      };
    }

    const room = rooms[roomId];
    console.log("Room Host:", room.hostSocketId);

    // CASE 1: Host Entry
    if (room.hostSocketId === socket.id || Object.keys(room.users).length === 0) {
      room.hostSocketId = socket.id;
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
       socket.emit('all-users', others);
       socket.to(roomId).emit('user-joined', { socketId: socket.id, userId, name });
       broadcastParticipants(io, roomId);
       console.log(`[Socket] ✅ ${name} entered meeting after approval`);
       return;
    }

    // CASE 3: New Participant (Needs host approval - Phase 2)
    console.log(`[Socket] ⏳ ${name} is waiting for host approval at ${room.hostSocketId}`);
    room.waitingUsers[socket.id] = { socketId: socket.id, userId, name };
    
    io.to(room.hostSocketId).emit('join-request', {
      fromSocketId: socket.id,
      fromName:     name,
      fromUserId:   userId
    });
    
    socket.emit('waiting-room');
  }

  socket.on('approve-join', ({ roomId, userId: targetSocketId }) => {
    const room = rooms[roomId];
    if (!room || room.hostSocketId !== socket.id) return;

    const waiter = room.waitingUsers[targetSocketId];
    if (!waiter) return;

    console.log(`[Socket] ✅ Host approved ${waiter.name}`);
    room.users[targetSocketId] = { ...waiter, role: 'participant' }; 
    delete room.waitingUsers[targetSocketId];
    io.to(targetSocketId).emit('join-approved', { role: 'participant' });
  });

  socket.on('reject-join', ({ roomId, userId: targetSocketId }) => {
    const room = rooms[roomId];
    if (!room || room.hostSocketId !== socket.id) return;

    console.log(`[Socket] ❌ Host rejected join request for ${targetSocketId}`);
    delete room.waitingUsers[targetSocketId];
    io.to(targetSocketId).emit('join-rejected');
  });

  // ═══════════════════════════════════════════════
  // WEBRTC SIGNALING RELAY
  // ═══════════════════════════════════════════════
  socket.on('sending-signal', ({ signal, toId }) => {
    console.log(`[Signaling] 📤 Offer: ${socket.id} → ${toId}`);
    io.to(toId).emit('user-received-offer', {
      signal,
      fromId: socket.id,
      fromName: socket.userName,
      fromUserId: socket.userId,
    });
  });

  socket.on('returning-signal', ({ signal, toId }) => {
    console.log(`[Signaling] 📥 Answer: ${socket.id} → ${toId}`);
    io.to(toId).emit('receiving-returned-signal', {
      signal,
      fromId: socket.id,
    });
  });

  socket.on('ice-candidate', ({ candidate, toId }) => {
    console.log(`[Signaling] 🧊 ICE: ${socket.id} → ${toId}`);
    io.to(toId).emit('ice-candidate', { candidate, fromId: socket.id });
  });

  // New-style offer/answer events (native RTCPeerConnection flow)
  socket.on('offer', ({ toId, sdp }) => {
    console.log(`[Signaling] 📨 Offer relay: ${socket.id} → ${toId}`);
    io.to(toId).emit('offer', { sdp, fromId: socket.id });
  });

  socket.on('answer', ({ toId, sdp }) => {
    console.log(`[Signaling] ✅ Answer relay: ${socket.id} → ${toId}`);
    io.to(toId).emit('answer', { sdp, fromId: socket.id });
  });

  // ═══════════════════════════════════════════════
  // CHAT
  // ═══════════════════════════════════════════════
  socket.on('send-message', async ({ content }) => {
    const roomId = socket.roomId;
    if (!roomId || !content?.trim()) return;

    console.log(`[Chat] 💬 ${socket.userName}: ${content.trim()}`);

    const messageData = {
      roomId,
      senderId: socket.userId,
      senderName: socket.userName,
      content: content.trim(),
      timestamp: new Date(),
    };

    // Broadcast immediately (don't wait for DB)
    io.to(roomId).emit('receive-message', messageData);

    // Persist
    try {
      const msg = new Message(messageData);
      await msg.save();
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

  // 6. SCREEN SHARE PERMISSION REQUEST (PHASE 6)
  socket.on('request-screen-share', () => {
    const roomId = socket.roomId;
    if (!roomId) return;

    console.log(`[Socket] 📺 ${socket.userName} requesting screen share in ${roomId}`);
    
    const room = rooms[roomId];
    room.screenShareRequest = {
      fromSocketId: socket.id,
      fromName: socket.userName,
      requestedAt: new Date(),
    };

    // Notify host of screen share request
    const hostSocket = io.sockets.sockets.get(room.hostSocketId);
    if (hostSocket) {
      hostSocket.emit('screen-share-request', {
        fromSocketId: socket.id,
        fromName: socket.userName,
      });
    }
  });

  // 7. HOST APPROVES SCREEN SHARE
  socket.on('approve-screen-share', (targetSocketId) => {
    const roomId = socket.roomId;
    if (!roomId) return;

    // Validate host
    if (rooms[roomId]?.hostSocketId !== socket.id) {
      console.warn(`[Socket] 🚫 Non-host tried approve-screen-share`);
      return;
    }

    console.log(`[Socket] ✅ Host approved screen share for ${targetSocketId}`);
    
    // Notify the requester they're approved
    io.to(targetSocketId).emit('screen-share-approved');
    
    // Update local tracking
    if (rooms[roomId].users[targetSocketId]) {
      rooms[roomId].users[targetSocketId].hasScreenShareApproval = true;
    }

    broadcastParticipants(io, roomId);
  });

  // 8. HOST DENIES SCREEN SHARE
  socket.on('deny-screen-share', (targetSocketId) => {
    const roomId = socket.roomId;
    if (!roomId) return;

    // Validate host
    if (rooms[roomId]?.hostSocketId !== socket.id) {
      console.warn(`[Socket] 🚫 Non-host tried deny-screen-share`);
      return;
    }

    console.log(`[Socket] ❌ Host denied screen share for ${targetSocketId}`);
    
    io.to(targetSocketId).emit('screen-share-denied');
    rooms[roomId].screenShareRequest = null;
  });

  // OLD HOST CONTROLS (compatibility, redirects to new)
  socket.on('kick-participant', (targetSocketId) => {
    socket.emit('remove-user', targetSocketId);
  });

  // ═══════════════════════════════════════════════
  // DISCONNECT (PHASE 10 - Handle edge cases)
  // ═══════════════════════════════════════════════
  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    console.log(`[Socket] ❌ Disconnected: ${socket.id} from room ${roomId || 'none'}`);

    if (!roomId || !rooms[roomId]) return;

    const room = rooms[roomId];
    const user = room.users[socket.id];

    // PHASE 2: Attendance Tracking (Log leave time)
    if (user) {
      const leaveTime = new Date();
      const duration = Math.floor((leaveTime - new Date(user.joinedAt)) / 1000);
      room.attendanceLog.push({
        userId:          user.userId,
        name:            user.name,
        role:            user.role,
        joinTime:        user.joinedAt,
        leaveTime:       leaveTime,
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
      saveFinalReport(roomId, room);
      delete rooms[roomId];
    } else if (room.hostSocketId === socket.id) {
      // Host left — promote next person (PHASE 2)
      const nextSocketId = Object.keys(room.users)[0];
      room.hostSocketId = nextSocketId;
      room.users[nextSocketId].role = 'host';
      io.to(nextSocketId).emit('host-status', true);
      console.log(`[Socket] 👑 New host promoted: ${nextSocketId}`);
      broadcastParticipants(io, roomId);
    } else {
      broadcastParticipants(io, roomId);
    }
  });
};

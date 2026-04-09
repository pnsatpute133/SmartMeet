const express = require('express');
const router = express.Router();
const Meeting = require('../models/Meeting');

const DEBUG = true;
function dbg(tag, ...args) {
  if (!DEBUG) return;
  const ts = new Date().toISOString().substring(11, 23);
  console.log(`[${ts}] [DEBUG][Meeting/${tag}]`, ...args);
}

// GET /api/meetings - Fetch all meetings where user was host or participant
router.get('/', async (req, res) => {
  try {
    const { userId } = req.query;
    dbg('GET/', `userId=${userId}`);
    if (!userId) return res.status(400).json({ message: "userId is required" });

    const meetings = await Meeting.find({
      $or: [
        { hostId: userId },
        { 'participants.userId': userId }
      ]
    }).sort({ createdAt: -1 });

    dbg('GET/', `Found ${meetings.length} meetings for userId=${userId}`);
    res.json(meetings);
  } catch (err) {
    console.error('[Meeting] GET / error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// POST /api/meetings - Create a new meeting entry when user starts a meeting
router.post('/', async (req, res) => {
  try {
    const { meetingId, hostId } = req.body;
    dbg('POST/', `meetingId=${meetingId} | hostId=${hostId}`);
    
    if (!meetingId || !hostId) {
      return res.status(400).json({ message: "meetingId and hostId are required" });
    }

    // Check if meeting with this ID already exists
    let meeting = await Meeting.findOne({ meetingId });
    if (meeting) {
      dbg('POST/', `Meeting ${meetingId} already exists, returning existing record`);
      return res.json(meeting);
    }

    // FIX: participants must match the sub-document schema { userId, name, joinedAt }
    meeting = new Meeting({
      meetingId,
      hostId,
      participants: [{
        userId: hostId,
        name: 'Host',
        joinedAt: new Date()
      }],
      isActive: true,
      startTime: new Date()
    });

    await meeting.save();
    dbg('POST/', `✅ Meeting created: ${meeting._id}`);
    res.status(201).json(meeting);
  } catch (err) {
    console.error('[Meeting Route] POST error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/meetings/join - Track participant joining
router.put('/join', async (req, res) => {
  try {
    const { meetingId, userId, name } = req.body;
    dbg('PUT/join', `meetingId=${meetingId} | userId=${userId} | name=${name}`);

    // FIX: $addToSet must use the correct sub-document shape
    const meeting = await Meeting.findOneAndUpdate(
      { meetingId },
      {
        $addToSet: {
          participants: {
            userId,
            name: name || 'Participant',
            joinedAt: new Date()
          }
        }
      },
      { new: true }
    );
    if (!meeting) {
      dbg('PUT/join', `❌ Meeting ${meetingId} not found`);
      return res.status(404).json({ message: "Meeting not found" });
    }
    dbg('PUT/join', `✅ Participant ${name} added to ${meetingId} | total: ${meeting.participants.length}`);
    res.json(meeting);
  } catch (err) {
    console.error('[Meeting] PUT/join error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;

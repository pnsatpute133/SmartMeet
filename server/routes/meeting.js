const express = require('express');
const router = express.Router();
const Meeting = require('../models/Meeting');

// GET /api/meetings - Fetch all meetings where user was host or participant
router.get('/', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ message: "userId is required" });

    const meetings = await Meeting.find({
      $or: [
        { hostId: userId },
        { 'participants.userId': userId }
      ]
    }).sort({ createdAt: -1 });

    res.json(meetings);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/meetings - Create a new meeting entry when user starts a meeting
router.post('/', async (req, res) => {
  try {
    const { meetingId, hostId } = req.body;
    
    if (!meetingId || !hostId) {
      return res.status(400).json({ message: "meetingId and hostId are required" });
    }

    // Check if meeting with this ID already exists
    let meeting = await Meeting.findOne({ meetingId });
    if (meeting) return res.json(meeting);

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
    if (!meeting) return res.status(404).json({ message: "Meeting not found" });
    res.json(meeting);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;

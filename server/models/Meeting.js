const mongoose = require('mongoose');

const MeetingSchema = new mongoose.Schema({
  meetingId: {
    type: String,
    required: true,
    unique: true,
  },
  title: String,
  hostId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  participants: [
    {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      name: String,
      joinedAt: { type: Date, default: Date.now },
      leftAt: Date
    }
  ],
  isActive: {
    type: Boolean,
    default: true,
  },
  scheduledAt: Date, // Supported for "Schedule meeting" feature
  startTime: { type: Date },
  endTime: Date,
  duration: Number, // in minutes
  chatSummary: String,
}, { timestamps: true });

module.exports = mongoose.model('Meeting', MeetingSchema);

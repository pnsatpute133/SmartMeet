const mongoose = require('mongoose');

const ParticipantReportSchema = new mongoose.Schema({
  userId:          { type: String, required: true },
  name:            { type: String, required: true },
  totalTime:       { type: Number, default: 0 },      // seconds
  attentiveTime:   { type: Number, default: 0 },
  distractedTime:  { type: Number, default: 0 },
  phoneUsageTime:  { type: Number, default: 0 },
  multiplePeopleTime: { type: Number, default: 0 },
  noFaceTime:      { type: Number, default: 0 },
  engagementScore: { type: Number, default: 0 },      // 0–100
  warnings:        [String],
  summary:         { type: String, default: '' },
  timeline: [{
    timestamp: Date,
    status:    String,
  }],
}, { _id: false });

// ── Attendance record per participant ──────────────────────────────────────
const AttendanceRecordSchema = new mongoose.Schema({
  userId:          { type: String, default: '' },
  name:            { type: String, required: true },
  role:            { type: String, default: 'participant' },
  joinTime:        { type: Date, required: true },
  leaveTime:       { type: Date },
  durationSeconds: { type: Number, default: 0 },
}, { _id: false });

const MeetingReportSchema = new mongoose.Schema({
  meetingId:    { type: String, required: true, index: true },
  startedAt:    { type: Date,   default: Date.now },
  endedAt:      { type: Date },
  duration:     { type: Number, default: 0 },   // seconds (from AI report)
  hostName:     { type: String, default: '' },
  participants: [ParticipantReportSchema],       // AI engagement data
  attendance:   [AttendanceRecordSchema],        // join/leave tracking
  aiEnabled:    { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('MeetingReport', MeetingReportSchema);

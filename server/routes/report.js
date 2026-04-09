const express = require('express');
const router  = express.Router();
const { Parser } = require('json2csv');
const MeetingReport = require('../models/MeetingReport');
const { protect } = require('../middleware/authMiddleware');

const DEBUG = true;
function dbg(tag, ...args) {
  if (!DEBUG) return;
  const ts = new Date().toISOString().substring(11, 23);
  console.log(`[${ts}] [DEBUG][Report/${tag}]`, ...args);
}

// ══════════════════════════════════════════════════════════════════════════
// POST /api/report/save
// Called by host when meeting ends (or periodically from socket handler)
// Body: { meetingId, participants:[...], duration, hostName }
// ══════════════════════════════════════════════════════════════════════════
router.post('/save', protect, async (req, res) => {
  try {
    const { meetingId, participants, duration, hostName } = req.body;
    dbg('save', `meetingId=${meetingId} | participants=${participants?.length} | duration=${duration}s | host=${hostName}`);
    if (!meetingId) return res.status(400).json({ message: 'meetingId required' });

    // Upsert: update existing report or create new one
    const report = await MeetingReport.findOneAndUpdate(
      { meetingId },
      {
        $set: {
          meetingId,
          hostName:     hostName || '',
          duration:     duration || 0,
          endedAt:      new Date(),
          participants: (participants || []).map(p => ({
            userId:             p.userId,
            name:               p.name,
            totalTime:          p.totalTime          || 0,
            attentiveTime:      p.attentiveTime      || 0,
            distractedTime:     p.distractedTime     || 0,
            phoneTime:          p.phoneTime          || 0,
            multiplePeopleTime: p.multiplePeopleTime || 0,
            drowsyTime:         p.drowsyTime         || 0,
            poorPostureTime:    p.poorPostureTime    || 0,
            speakingTime:       p.speakingTime       || 0,
            speakingMutedTime:  p.speakingMutedTime  || 0,
            noFaceTime:         p.noFaceTime         || 0,
            engagementScore:    p.engagementScore    || 0,
            warnings:           p.warnings           || [],
            summary:            p.summary            || '',
            timeline:           (p.timeline || []).slice(-200),
          })),
        }
      },
      { upsert: true, new: true }
    );

    res.json({ message: 'Report saved', reportId: report._id });
    dbg('save', `✅ Saved reportId=${report._id} | meetingId=${meetingId}`);
  } catch (err) {
    console.error('[Report] save error:', err.message);
    dbg('save', `❌ Error: ${err.message}`);
    res.status(500).json({ message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// GET /api/report/:meetingId
// Returns stored report JSON
// ══════════════════════════════════════════════════════════════════════════
router.get('/:meetingId', protect, async (req, res) => {
  try {
    dbg('get', `meetingId=${req.params.meetingId}`);
    const report = await MeetingReport.findOne({ meetingId: req.params.meetingId });
    if (!report) {
      dbg('get', `❌ Report not found for ${req.params.meetingId}`);
      return res.status(404).json({ message: 'Report not found' });
    }
    dbg('get', `✅ Found report: ${report._id} | participants=${report.participants?.length}`);
    res.json(report);
  } catch (err) {
    dbg('get', `❌ Error: ${err.message}`);
    res.status(500).json({ message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// GET /api/report/:meetingId/csv
// Generates and downloads CSV file
// ══════════════════════════════════════════════════════════════════════════
router.get('/:meetingId/csv', protect, async (req, res) => {
  try {
    dbg('csv', `Generating CSV for meetingId=${req.params.meetingId}`);
    const report = await MeetingReport.findOne({ meetingId: req.params.meetingId });

    // If no saved report yet, return empty CSV with headers
    const participants = report?.participants || [];

    const csvData = participants.map(p => {
      const total = p.totalTime || 1; // avoid div/0
      return {
        'Name':          p.name,
        'Duration':      `${p.totalTime}s`,
        'Engagement %':  `${p.engagementScore}%`,
        'Phone %':       `${Math.round((p.phoneTime / total) * 100)}%`,
        'Distracted %':  `${Math.round((p.distractedTime / total) * 100)}%`,
        'Drowsy %':      `${Math.round(((p.drowsyTime || 0) / total) * 100)}%`,
        'Warnings':      (p.warnings || []).join(' | '),
        'Summary':       p.summary || '',
      };
    });

    if (csvData.length === 0) {
      csvData.push({
        'Name': 'No data',
        'Duration': '0s',
        'Engagement %': '0%',
        'Phone %': '0%',
        'Distracted %': '0%',
        'Drowsy %': '0%',
        'Warnings': '',
        'Summary': 'No AI tracking data recorded for this meeting',
      });
    }

    const fields = [
      'Name', 'Duration', 'Engagement %',
      'Phone %', 'Distracted %', 'Drowsy %',
      'Warnings', 'Summary',
    ];

    const parser = new Parser({ fields });
    const csv    = parser.parse(csvData);

    const meetingId  = req.params.meetingId;
    const dateStr    = new Date().toISOString().split('T')[0];
    const filename   = `SmartMeet_Report_${meetingId.slice(0, 8)}_${dateStr}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv);
  } catch (err) {
    console.error('[Report] CSV error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// GET /api/report/:meetingId/attendance
// Returns attendance records as JSON
// ══════════════════════════════════════════════════════════════════════════
router.get('/:meetingId/attendance', protect, async (req, res) => {
  try {
    const report = await MeetingReport.findOne(
      { meetingId: req.params.meetingId },
      'attendance meetingId startedAt endedAt hostName'
    );
    if (!report) return res.status(404).json({ message: 'No attendance data found' });
    res.json({
      meetingId: report.meetingId,
      hostName:  report.hostName,
      startedAt: report.startedAt,
      endedAt:   report.endedAt,
      attendance: report.attendance || [],
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// GET /api/report/:meetingId/attendance/csv
// Downloads attendance as CSV: Name, Role, Join Time, Leave Time, Duration
// ══════════════════════════════════════════════════════════════════════════
router.get('/:meetingId/attendance/csv', protect, async (req, res) => {
  try {
    const report = await MeetingReport.findOne({ meetingId: req.params.meetingId });

    const records = report?.attendance || [];
    const meetingId = req.params.meetingId;

    const fmt = (d) => d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A';
    const fmtDur = (s) => {
      if (!s) return '0m 0s';
      const m = Math.floor(s / 60);
      const sec = s % 60;
      return `${m}m ${sec}s`;
    };

    const csvData = records.length > 0
      ? records.map(r => ({
          'Name':        r.name,
          'Role':        r.role || 'participant',
          'Join Time':   fmt(r.joinTime),
          'Leave Time':  fmt(r.leaveTime),
          'Duration':    fmtDur(r.durationSeconds),
          'Duration (s)': r.durationSeconds || 0,
        }))
      : [{ 'Name': 'No attendance data', 'Role': '', 'Join Time': '', 'Leave Time': '', 'Duration': '', 'Duration (s)': 0 }];

    const fields = ['Name', 'Role', 'Join Time', 'Leave Time', 'Duration', 'Duration (s)'];
    const parser  = new Parser({ fields });
    const csv     = parser.parse(csvData);

    const dateStr  = new Date().toISOString().split('T')[0];
    const filename = `SmartMeet_Attendance_${meetingId.slice(0, 8)}_${dateStr}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv);
  } catch (err) {
    console.error('[Attendance] CSV error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// GET /api/report (list all reports — host utility)
// ══════════════════════════════════════════════════════════════════════════
router.get('/', protect, async (req, res) => {
  try {
    const reports = await MeetingReport
      .find({}, 'meetingId hostName startedAt endedAt duration participants')
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(reports);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;

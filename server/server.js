require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

// ── Debug Logger ────────────────────────────────────────────────────────────
const DEBUG = true; // Set false to silence debug logs
function dbg(tag, ...args) {
  if (!DEBUG) return;
  const ts = new Date().toISOString().substring(11, 23); // HH:MM:SS.mmm
  console.log(`[${ts}] [DEBUG][${tag}]`, ...args);
}

const authRoutes    = require('./routes/auth');
const meetingRoutes = require('./routes/meeting');
const reportRoutes  = require('./routes/report');
const meetingHandlers = require('./socketControllers/meetingHandlers');

const app = express();
const server = http.createServer(app);

// Enable CORS
app.use(cors({
  origin: '*',
  credentials: true
}));
app.use(express.json());

// Server Logging Middleware
app.use((req, res, next) => {
  const ts = new Date().toISOString().substring(11, 23);
  console.log(`[${ts}] [HTTP] ${req.method} ${req.url} — IP: ${req.ip}`);
  if (req.body && Object.keys(req.body).length > 0) {
    // Mask password fields in logs
    const safeBody = { ...req.body };
    if (safeBody.password) safeBody.password = '***';
    console.log(`[${ts}] [HTTP Body]`, JSON.stringify(safeBody));
  }
  const start = Date.now();
  res.on('finish', () => {
    const dur = Date.now() - start;
    console.log(`[${ts}] [HTTP Res] ${req.method} ${req.url} → ${res.statusCode} (${dur}ms)`);
  });
  next();
});

// Database connection
dbg('DB', `Connecting to MongoDB: ${process.env.MONGO_URI?.replace(/:([^@]+)@/, ':***@')}`);
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('[DB] ✅ MongoDB connected');
    dbg('DB', 'Connection state:', mongoose.connection.readyState);
  })
  .catch(err => {
    console.error('[DB] ❌ MongoDB connection error:', err.message);
  });

mongoose.connection.on('disconnected', () => console.warn('[DB] ⚠️ MongoDB disconnected'));
mongoose.connection.on('reconnected', () => console.log('[DB] 🔁 MongoDB reconnected'));

// Routes
app.use('/api/auth',     authRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/report',   reportRoutes);

// Global try-catch for unhandled errors
app.use((err, req, res, next) => {
  console.error('Server Error:', err.stack);
  res.status(500).json({ message: err.message || 'Something broke on the server!' });
});

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: '*'
  }
});

let socketCount = 0;
io.on('connection', (socket) => {
  socketCount++;
  dbg('Socket', `New connection: ${socket.id} | Total connected: ${socketCount}`);
  meetingHandlers(io, socket);
  socket.on('disconnect', () => {
    socketCount--;
    dbg('Socket', `Disconnected: ${socket.id} | Total connected: ${socketCount}`);
  });
});

const PORT = process.env.PORT || 5002;
server.listen(PORT, "0.0.0.0", () => {
  console.log('╔══════════════════════════════════════════════╗');
  console.log(`║  SmartMeet Server — port ${PORT}               ║`);
  console.log(`║  DEBUG mode: ${DEBUG ? 'ON ' : 'OFF'} | ENV: ${process.env.NODE_ENV || 'development'}     ║`);
  console.log('╚══════════════════════════════════════════════╝');
  dbg('Server', `Listening on http://localhost:${PORT}`);
});

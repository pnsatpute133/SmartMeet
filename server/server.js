require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

const authRoutes    = require('./routes/auth');
const meetingRoutes = require('./routes/meeting');
const reportRoutes  = require('./routes/report');
const meetingHandlers = require('./socketControllers/meetingHandlers');

const app = express();
const server = http.createServer(app);

// Enable CORS for all routes and origins
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));
app.use(express.json());

// Server Logging Middleware
app.use((req, res, next) => {
  console.log(`[Server Log] ${req.method} ${req.url}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log(`[Server Payload]`, req.body);
  }
  next();
});

// Database connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.log(err));

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
    origin: '*',
    methods: ['GET', 'POST']
  }
});

io.on('connection', (socket) => {
  meetingHandlers(io, socket);
});

const PORT = process.env.PORT || 5002;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const rateLimitHeaders = require('./middleware/rateLimitHeaders');
const checkRouter = require('./routes/check');
const adminRouter = require('./routes/admin');

const redisClient = require('./redis/client');

// Global middleware
app.use(cors());
app.use(express.json());
app.use(rateLimitHeaders);

// Inject WebSocket instance into request context
app.use((req, res, next) => {
  req.io = io;
  next();
});

// GET /health check endpoint
app.get('/health', async (req, res) => {
  try {
    const pong = await redisClient.ping();
    if (pong === 'PONG') {
      return res.status(200).json({ status: 'UP', redis: 'CONNECTED' });
    }
    throw new Error('Redis ping failed');
  } catch (error) {
    return res.status(503).json({ status: 'DOWN', redis: 'DISCONNECTED', error: error.message });
  }
});

// Mount routes
app.use('/', checkRouter);
app.use('/admin', adminRouter);

// Serve dashboard static assets if built
const dashboardDistPath = path.join(__dirname, '../dashboard/dist');
if (fs.existsSync(dashboardDistPath)) {
  console.log(`Serving dashboard static files from: ${dashboardDistPath}`);
  app.use(express.static(dashboardDistPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(dashboardDistPath, 'index.html'));
  });
} else {
  console.log('Dashboard build not found, API running as standalone service.');
  app.get('/', (req, res) => {
    res.json({ message: 'Rate Limiter microservice API is active' });
  });
}

// WebSocket connection logs
io.on('connection', (socket) => {
  console.log('Dashboard client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Dashboard client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Rate limiter microservice listening on port ${PORT}`);
});

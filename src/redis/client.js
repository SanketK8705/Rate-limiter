const Redis = require('ioredis');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl);

// Read Lua scripts
const tokenBucketScript = fs.readFileSync(
  path.join(__dirname, 'scripts', 'tokenBucket.lua'),
  'utf8'
);
const slidingWindowScript = fs.readFileSync(
  path.join(__dirname, 'scripts', 'slidingWindow.lua'),
  'utf8'
);

// Define custom atomic commands in Redis
redis.defineCommand('rateLimitTokenBucket', {
  numberOfKeys: 1,
  lua: tokenBucketScript
});

redis.defineCommand('rateLimitSlidingWindow', {
  numberOfKeys: 1,
  lua: slidingWindowScript
});

redis.on('connect', () => {
  console.log('Connected to Redis successfully');
});

redis.on('error', (err) => {
  console.error('Redis connection error:', err);
});

module.exports = redis;

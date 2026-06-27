const express = require('express');
const router = express.Router();
const redis = require('../redis/client');

// POST /admin/config
router.post('/config', async (req, res) => {
  const { clientId, endpoint, limit, refillRate, burstSize, algorithm, windowSize } = req.body;
  const errors = [];

  // 1. Validate Client ID
  if (!clientId || typeof clientId !== 'string' || clientId.trim() === '') {
    errors.push('clientId is required and must be a non-empty string');
  }

  // 2. Validate Endpoint (optional)
  if (endpoint !== undefined && (typeof endpoint !== 'string' || endpoint.trim() === '')) {
    errors.push('endpoint must be a non-empty string if provided');
  }

  // 3. Validate Algorithm
  const algo = algorithm || 'tokenBucket';
  if (algo !== 'tokenBucket' && algo !== 'slidingWindow') {
    errors.push('algorithm must be tokenBucket or slidingWindow');
  }

  // 4. Validate Limit
  const parsedLimit = Number(limit);
  if (limit === undefined || isNaN(parsedLimit) || !Number.isInteger(parsedLimit) || parsedLimit <= 0) {
    errors.push('limit is required and must be a positive integer');
  }

  // 5. Algorithm-specific validation
  if (algo === 'tokenBucket') {
    const parsedRefillRate = Number(refillRate);
    if (refillRate === undefined || isNaN(parsedRefillRate) || parsedRefillRate <= 0) {
      errors.push('refillRate is required and must be a positive number');
    }

    const parsedBurstSize = Number(burstSize);
    if (burstSize === undefined || isNaN(parsedBurstSize) || !Number.isInteger(parsedBurstSize) || parsedBurstSize <= 0) {
      errors.push('burstSize is required and must be a positive integer');
    } else if (parsedBurstSize < parsedLimit) {
      errors.push('burstSize must be greater than or equal to limit');
    }
  } else if (algo === 'slidingWindow') {
    const parsedWindowSize = Number(windowSize);
    if (windowSize === undefined || isNaN(parsedWindowSize) || !Number.isInteger(parsedWindowSize) || parsedWindowSize <= 0) {
      errors.push('windowSize is required and must be a positive integer');
    }
  }

  // If there are errors, return 400 Bad Request
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Input validation failed', details: errors });
  }

  // Setup configuration keys
  const configKey = endpoint ? `config:${clientId}:${endpoint}` : `config:${clientId}`;

  try {
    if (algo === 'tokenBucket') {
      const configLimit = Math.floor(Number(limit));
      const configRefillRate = Number(refillRate);
      const configBurstSize = Math.floor(Number(burstSize));

      const payload = {
        algorithm: 'tokenBucket',
        limit: configLimit,
        refillRate: configRefillRate,
        burstSize: configBurstSize
      };
      if (endpoint) payload.endpoint = endpoint;

      await redis.hset(configKey, payload);
    } else {
      const configLimit = Math.floor(Number(limit));
      const configWindowSize = Math.floor(Number(windowSize));

      const payload = {
        algorithm: 'slidingWindow',
        limit: configLimit,
        windowSize: configWindowSize
      };
      if (endpoint) payload.endpoint = endpoint;

      await redis.hset(configKey, payload);
    }

    // Set TTL on config (30 days)
    await redis.expire(configKey, 30 * 24 * 3600);

    const updatedConfig = await redis.hgetall(configKey);

    // Notify connected websockets about config update
    if (req.io) {
      req.io.emit('configUpdate', { clientId, endpoint, config: updatedConfig });
    }

    return res.status(200).json({
      message: 'Configuration updated successfully',
      clientId,
      endpoint: endpoint || null,
      config: updatedConfig
    });
  } catch (error) {
    console.error('Error saving config to Redis:', error);
    return res.status(500).json({ error: 'Failed to update config' });
  }
});

// Helper to safely parse numbers
function tonumber(val, defaultVal) {
  const num = Number(val);
  return isNaN(num) ? defaultVal : num;
}

module.exports = router;

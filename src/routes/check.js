const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const redis = require('../redis/client');

// POST /check
router.post('/check', async (req, res) => {
  const { clientId, endpoint, cost = 1 } = req.body;

  // Fallback to IP address if clientId is not supplied
  const resolvedClientId = clientId || req.ip || 'anonymous';
  
  try {
    // 1. Fetch client configuration from Redis (scoped first, then fallback client-wide)
    let config = {};
    if (endpoint) {
      config = await redis.hgetall(`config:${resolvedClientId}:${endpoint}`);
    }
    
    // If no endpoint-specific config exists, fallback to client-wide config
    if (Object.keys(config).length === 0) {
      config = await redis.hgetall(`config:${resolvedClientId}`);
    }

    const algorithm = config.algorithm || 'tokenBucket';
    const now = Date.now() / 1000; // time in seconds (float)

    let allowed, remaining, limit, resetAt, retryAfter = 0;

    const suffix = endpoint ? `:${endpoint}` : '';

    if (algorithm === 'tokenBucket') {
      // Setup Defaults if no config is stored
      const limitVal = Number(config.limit || 10);
      const refillRate = Number(config.refillRate || 0.1666); // ~10 per minute
      const burstSize = Number(config.burstSize || 10);

      const bucketKey = `bucket:${resolvedClientId}${suffix}`;

      // Call atomic Lua custom command
      const result = await redis.rateLimitTokenBucket(
        bucketKey,
        limitVal,
        refillRate,
        burstSize,
        now,
        cost
      );

      allowed = result[0] === 1;
      remaining = result[1];
      limit = result[2];
      resetAt = result[3];

      // Calculate Retry-After if denied
      if (!allowed) {
        retryAfter = Math.ceil((cost - remaining) / refillRate);
      }
    } else if (algorithm === 'slidingWindow') {
      const limitVal = Number(config.limit || 10);
      const windowSize = Number(config.windowSize || 60); // default to 60 seconds

      const windowKey = `window:${resolvedClientId}${suffix}`;
      const memberId = crypto.randomUUID();

      // Call atomic Lua custom command
      const result = await redis.rateLimitSlidingWindow(
        windowKey,
        limitVal,
        windowSize,
        now,
        memberId,
        cost
      );

      allowed = result[0] === 1;
      remaining = result[1];
      limit = result[2];
      resetAt = result[3];

      // Calculate Retry-After if denied
      if (!allowed) {
        retryAfter = Math.max(1, Math.ceil(resetAt - now));
      }
    }

    // 2. Set response headers
    res.setRateLimitHeaders(limit, remaining, resetAt);
    if (!allowed && retryAfter > 0) {
      res.setHeader('Retry-After', String(retryAfter));
    }

    // 3. Emit update over websockets to the dashboard client
    const logEvent = {
      clientId: resolvedClientId,
      endpoint: endpoint || null,
      algorithm,
      allowed,
      remaining,
      limit,
      resetAt,
      retryAfter: allowed ? 0 : retryAfter,
      timestamp: Date.now()
    };

    if (req.io) {
      req.io.emit('rateCheck', logEvent);
    }

    // 4. Return result (429 status code if denied, 200 if allowed)
    const statusCode = allowed ? 200 : 429;
    const responsePayload = {
      allowed,
      remaining,
      limit,
      resetAt
    };
    if (!allowed) {
      responsePayload.retryAfter = retryAfter;
    }

    return res.status(statusCode).json(responsePayload);
  } catch (error) {
    console.error('Error during rate-limit execution:', error);
    return res.status(500).json({ error: 'Internal rate-limiting error' });
  }
});

module.exports = router;

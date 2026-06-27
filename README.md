# Token Bucket & Sliding Window Rate Limiter Microservice

> A production-grade standalone API microservice that rate-limits other APIs — not a library, a networked service.

🚀 **Live Demo:** https://rate-limiter-service-n1dk.onrender.com  
📦 **GitHub:** https://github.com/SanketK8705/Rate-limiter

---

## What Is This?

Every API needs rate limiting. Most developers import a library and move on. This project builds rate limiting as a **standalone microservice** — a separate server that any API calls before processing a request.

```
Your App  →  POST /check { clientId }  →  Rate Limiter  →  ALLOW / DENY
```

If allowed → proceed. If denied → return 429 Too Many Requests.

This forces real engineering: shared state, clock precision, atomic operations, and concurrency — instead of just calling a library.

---

## Architecture

```
   Client App / API Gateway
            │
            ▼
     POST /check { clientId: "user_123" }
            │
            ▼
   Rate Limiter Service (Node.js + Express)
            │
            ├──► Redis (atomic Lua script: read + decrement in one step)
            │
            └──► Socket.io ──► Live Dashboard (React)
            │
            ▼
   Response:
   {
     "allowed": true,
     "remaining": 9,
     "limit": 10,
     "resetAt": 1782550505
   }

   Headers:
     X-RateLimit-Limit: 10
     X-RateLimit-Remaining: 9
     X-RateLimit-Reset: 1782550505
     Retry-After: 7  (on 429 responses)
```

---

## The Hard Problem: Race Conditions

Two requests arrive at the exact same millisecond. Both read Redis: `tokens = 1`. Both think they can proceed. Both get ALLOWED. But only 1 token existed.

**This is a double-spend bug.** Standard GET → SET patterns are not safe under concurrent load.

**Fix:** Atomic Lua script executed at the Redis level. Read and decrement happen in a single uninterruptible operation. No two requests can interleave.

```lua
local current = redis.call('GET', KEYS[1])
if current and tonumber(current) > 0 then
    redis.call('DECR', KEYS[1])
    return 1  -- ALLOW
else
    return 0  -- DENY
end
```

**Proof:** Load tested at 500 concurrent req/sec — 8,900 requests, 0 failures, p99 latency 5ms. Concurrency test: 20 simultaneous requests against a bucket of 10 — exactly 10 ALLOW, 10 DENY. Zero double-spends.

---

## Features

### Core
| # | Feature | Details |
|---|---------|---------|
| 01 | **Check Endpoint** | `POST /check` — returns ALLOW/DENY + standard headers |
| 02 | **Admin Config** | `POST /admin/config` — per-client limits, algorithm, burst size |
| 03 | **Persistent State** | Redis — survives server restarts, horizontally scalable |
| 04 | **Race Condition Safe** | Atomic Lua scripts — proven under 500 req/sec load |
| 05 | **Dual Algorithms** | Token Bucket (burst-tolerant) + Sliding Window (strict) |
| 06 | **Per-Endpoint Limiting** | Scope limits to specific routes: `clientId:endpoint` |
| 07 | **HTTP Spec Compliance** | 429 status, `Retry-After`, `X-RateLimit-*` headers |
| 08 | **Input Validation** | 400 errors with detailed messages on bad admin config |
| 09 | **Health Endpoint** | `GET /health` — Redis ping verification + uptime |
| 10 | **Live Dashboard** | React + Socket.io — real-time allowed/denied feed, client registry |

### Load Test Results
```
Total requests:     8,900
Failed requests:    0
Peak throughput:    500 req/sec
p50 latency:        1ms
p95 latency:        3ms
p99 latency:        5ms
```

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Server | Node.js + Express |
| State | Redis 7+ |
| Atomic Ops | Custom Lua scripts |
| Real-time | Socket.io |
| Dashboard | React + Vite |
| Load Testing | Artillery |
| Deploy | Render + Redis Cloud |

---

## API Reference

### `POST /check`
Check if a client is within their rate limit.

**Request:**
```json
{
  "clientId": "user_123",
  "endpoint": "/login"
}
```

**Response (200 — Allowed):**
```json
{
  "allowed": true,
  "remaining": 9,
  "limit": 10,
  "resetAt": 1782550505
}
```

**Response (429 — Blocked):**
```json
{
  "allowed": false,
  "remaining": 0,
  "limit": 10,
  "resetAt": 1782550505,
  "retryAfter": 7
}
```

---

### `POST /admin/config`
Configure rate limit for a specific client.

**Token Bucket:**
```json
{
  "clientId": "user_123",
  "algorithm": "tokenBucket",
  "limit": 10,
  "refillRate": 2,
  "burstSize": 15
}
```

**Sliding Window:**
```json
{
  "clientId": "user_123",
  "algorithm": "slidingWindow",
  "limit": 10,
  "windowSize": 30
}
```

**Per-Endpoint:**
```json
{
  "clientId": "user_123",
  "endpoint": "/login",
  "algorithm": "tokenBucket",
  "limit": 3,
  "refillRate": 1,
  "burstSize": 3
}
```

---

### `GET /health`
```json
{
  "status": "UP",
  "redis": "CONNECTED"
}
```

---

## Running Locally

### Prerequisites
- Node.js v18+
- Redis (via Homebrew or Docker)

```bash
# Install Redis (macOS)
brew install redis
brew services start redis

# Verify
redis-cli ping  # → PONG
```

### Setup

```bash
# Clone
git clone https://github.com/SanketK8705/Rate-limiter.git
cd Rate-limiter

# Install backend deps
npm install

# Build dashboard
cd dashboard && npm install && npm run build && cd ..

# Environment
echo "PORT=3000\nREDIS_URL=redis://localhost:6379" > .env

# Start
npm start
```

Open `http://localhost:3000`

---

## Testing

### Quick Tests
```bash
# Health
curl http://localhost:3000/health

# Single check
curl -X POST http://localhost:3000/check \
  -H "Content-Type: application/json" \
  -d '{"clientId": "user_123"}'

# Drain bucket (10 allow, 5 deny)
for i in {1..15}; do
  curl -s -X POST http://localhost:3000/check \
    -H "Content-Type: application/json" \
    -d '{"clientId": "user_123"}'
  echo ""
done

# Concurrency test (20 simultaneous — exactly 10 allowed)
for i in {1..20}; do
  curl -s -X POST http://localhost:3000/check \
    -H "Content-Type: application/json" \
    -d '{"clientId": "concurrency_test"}' &
done
wait
```

### Attack Demo
```bash
npm run demo
```
Simulates a normal user + attacker. Watch dashboard at `http://localhost:3000`.

### Load Test
```bash
cd tests/load
npx artillery run artillery.yml
```

---

## Architectural Decisions

See [DECISIONS.md](./DECISIONS.md) for full rationale on:
- Why Redis over PostgreSQL for state
- Why Lua scripts over transactions
- Why Token Bucket as default over Sliding Window
- Fail-open vs fail-closed on Redis downtime
- Why microservice over library

---

## Integration Example

Plug this into any existing Node.js app:

```javascript
// middleware/rateLimiter.js
async function checkRateLimit(req, res, next) {
  const response = await fetch('https://rate-limiter-service-n1dk.onrender.com/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: req.ip,
      endpoint: req.path
    })
  });

  const { allowed, retryAfter } = await response.json();

  if (!allowed) {
    return res.status(429).json({
      error: 'Too many requests',
      retryAfter
    });
  }

  next();
}

// Apply to any route
app.use('/api', checkRateLimit);
```

---

## Project Structure

```
rate-limiter/
├── src/
│   ├── index.js                  # Express server + Socket.io
│   ├── routes/
│   │   ├── check.js              # POST /check
│   │   └── admin.js              # POST /admin/config
│   ├── algorithms/
│   │   ├── tokenBucket.js        # Token bucket implementation
│   │   └── slidingWindow.js      # Sliding window implementation
│   ├── redis/
│   │   ├── client.js             # Redis connection
│   │   └── scripts/              # Lua atomic scripts
│   ├── middleware/
│   │   └── rateLimitHeaders.js   # X-RateLimit-* headers
│   └── demo.js                   # Attack simulation
├── dashboard/                    # React + Vite frontend
├── tests/load/
│   └── artillery.yml             # Load test config
├── rate-limiter.postman_collection.json
├── DECISIONS.md
└── README.md
```

---

## Built By

**Sanket K** — [@SanketK8705](https://github.com/SanketK8705)  
CS Student, CMR Institute of Technology, Bengaluru
# Token Bucket & Sliding Window Rate Limiter Microservice

A standalone API microservice that rate-limits other APIs. Built with **Node.js, Express, and Redis**, this service implements both the **Token Bucket** and **Sliding Window** rate limiting algorithms using atomic Lua scripts to prevent race conditions (double-spend bugs) under high concurrent load.

It also features a premium, light-themed live analytics dashboard designed with **NewForm aesthetics** (Linen and Voltage green colors) utilizing interactive canvas fluid effects and React Bits components.

---

## Architecture Diagram

```
   Client Gateway / App
            │
            ▼
     POST /check { clientId: "user_123" }
            │
            ▼
   Rate Limiter Service (Node.js/Express) ◄──► WebSockets (Socket.io) ◄──► Live Dashboard (React)
            │
            ▼
    Redis (Stores bucket state per client)
    [Atomic Lua evaluation: read + update in single step]
            │
            ▼
   Response: { allowed: true/false, remaining: 9, limit: 10, resetAt: 1782550505 }
   Headers:
     X-RateLimit-Limit: 10
     X-RateLimit-Remaining: 9
     X-RateLimit-Reset: 1782550505
```

---

## Core Features

1. **Check Endpoint (`POST /check`)**: Microservices hit this endpoint with `{ clientId }` and get a JSON decision on whether to proceed or block, along with standard rate-limit headers.
2. **Admin Config Endpoint (`POST /admin/config`)**: Customize limits per client: configure algorithm type, max limit, refill rates, and window sizes.
3. **Persistent State**: State resides in Redis, allowing the rate-limiting service to be completely stateless and horizontal-scaling friendly.
4. **Race-Condition Free**: Uses Redis-level custom Lua scripts to fetch, verify, and update tokens/events in a single atomic transaction. No two overlapping HTTP requests can double-allocate a token.
5. **Dual Algorithms**: Supports both the burst-tolerant **Token Bucket** and strict **Sliding Window** rate limiters, configurable dynamically per client ID.
6. **Live Analytics Dashboard**: Visualizes global checks count, live allowed/denied counts, real-time throughput (RPS), and a scrolling stream of recent check entries.

---

## Tech Stack

| Layer | Tech |
|---|---|
| **Server Engine** | Node.js + Express |
| **State Cache** | Redis 7+ |
| **Atomic Operations** | Custom Lua scripts (`redis.call`) |
| **Real-time Streaming** | WebSockets (Socket.io) |
| **Dashboard UI** | Vite + React (Three.js/framer-motion) |
| **Visual Aesthetics** | NewForm Design Tokens (Linen canvas, Obsidian Ink typography, Voltage Green details) |
| **Load Testing** | Artillery |

---

## Getting Started

### Prerequisites

- Node.js (v18+)
- Redis running locally on port `6379` (via Homebrew or Docker)

To run Redis using Homebrew (macOS):
```bash
brew install redis
brew services start redis
```

### Installation

1. Install backend dependencies:
   ```bash
   npm install
   ```

2. Build the React dashboard:
   ```bash
   cd dashboard
   npm install
   npm run build
   cd ..
   ```

3. Create a `.env` file in the root directory:
   ```env
   PORT=3000
   REDIS_URL=redis://localhost:6379
   ```

### Running the Service

Start the server:
```bash
npm start
```
The server will boot on port `3000`. If the dashboard is built (`dashboard/dist` exists), it will serve the dashboard statically on `http://localhost:3000/`. Otherwise, developers can run the Vite dev server for the dashboard:
```bash
cd dashboard
npm run dev
```

---

## API Endpoints

### 1. Check Rate Limit
* **Route**: `POST /check`
* **Headers**: `Content-Type: application/json`
* **Body**:
  ```json
  {
    "clientId": "user_123",
    "cost": 1
  }
  ```
* **Response Headers**:
  - `X-RateLimit-Limit`: Maximum quota allocation (e.g. `10`)
  - `X-RateLimit-Remaining`: Remaining tokens or available slots in the current window (e.g. `9`)
  - `X-RateLimit-Reset`: Unix timestamp when the limit resets completely (e.g. `1782550505`)
* **Response Body**:
  ```json
  {
    "allowed": true,
    "remaining": 9,
    "limit": 10,
    "resetAt": 1782550505
  }
  ```

### 2. Configure Client Rate
* **Route**: `POST /admin/config`
* **Headers**: `Content-Type: application/json`
* **Body (Token Bucket)**:
  ```json
  {
    "clientId": "user_123",
    "algorithm": "tokenBucket",
    "limit": 20,
    "refillRate": 5,
    "burstSize": 25
  }
  ```
* **Body (Sliding Window)**:
  ```json
  {
    "clientId": "user_123",
    "algorithm": "slidingWindow",
    "limit": 10,
    "windowSize": 30
  }
  ```

---

## Load Testing

We use **Artillery** to verify performance and race safety under 500+ requests per second load.

Run the test suite:
```bash
npx artillery run tests/load/artillery.yml
```
This tests ramp-up to 500 concurrent req/sec and verifies Redis handles Lua operations atomically under heavy concurrent load, preventing race conditions or double- spend.

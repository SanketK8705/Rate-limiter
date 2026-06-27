# Architectural Decisions Log

This document outlines the major architectural and design decisions chosen for the Token Bucket Rate Limiter Service.

---

## 1. Microservice Model (Networked Service vs. Library)
* **Decision**: Implement the rate limiter as a standalone microservice instead of an imported library.
* **Rationale**:
  - **Statelessness**: Decoupling the rate limiter allows the core application servers to remain completely stateless.
  - **Shared State**: Multi-region or multiple microservice instances can share a centralized quota pool, ensuring limits are consistent across all servers.
  - **Language Independence**: Any backend system (Go, Python, Java, Ruby) can call this service using simple JSON HTTP requests.

---

## 2. Shared Cache Storage (Redis)
* **Decision**: Use Redis as the single source of truth for rate-limiter bucket state and configuration storage.
* **Rationale**:
  - **In-Memory Speed**: Redis processes requests in memory with sub-millisecond latencies, making it fast enough to be placed in front of high-traffic APIs.
  - **Data Structure Support**: Sorted Sets (ZSET) are ideal for tracking Sliding Windows, and Hashes are perfect for Token Bucket variables and client configurations.
  - **High Availability**: Redis Sentinel or Redis Cluster configurations provide high availability and failover replication.

---

## 3. Concurrency Safety (Atomic Redis Lua Scripts)
* **Decision**: Implement rate-limiting checks inside Lua scripts evaluated on the Redis server.
* **Rationale**:
  - **Atomic Transaction**: Redis executes Lua scripts sequentially in a single thread, guaranteeing that the "read" and "decrement" steps are completely atomic. No two HTTP requests can interleave and read the same token count before either decrements it.
  - **Reduced Network Roundtrips**: Instead of making multiple calls (HMGET, compute in Node, HMSET), all logic resides in a single Lua invocation, decreasing network overhead and latency.

---

## 4. Rate-Limiting Algorithms
* **Decision**: Support both **Token Bucket** and **Sliding Window** rate limiters.
* **Rationale**:
  - **Token Bucket**: Perfect for APIs that allow burst traffic (e.g. file uploads, batches) while enforcing an average rate limit over time.
  - **Sliding Window**: Ideal for strict endpoint controls (e.g. authentication, checkout payment calls) where bursts must be outright prohibited to protect resources.
  - **Fallback Resolution**: Configuration keys check for scoped `/checkout` overrides before falling back to client-wide configs, allowing granular control per route.

---

## 5. Socket-Driven Visual Stream (WebSockets)
* **Decision**: Use WebSockets (Socket.io) to push check evaluations to the visual dashboard in real-time.
* **Rationale**:
  - **Non-blocking Metrics**: Logging calls emit events asynchronously over Socket.io, bypassing HTTP polling cycles and allowing the dashboard to feel instantaneous.
  - **Active Client Tracking**: Client states are dynamically updated inside the browser, rendering green/red active indicator badges indicating health status at a glance.

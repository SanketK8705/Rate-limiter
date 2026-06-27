local key = KEYS[1]
local limit = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local burstSize = tonumber(ARGV[3])
local now = tonumber(ARGV[4])
local cost = tonumber(ARGV[5] or 1)

local data = redis.call('HMGET', key, 'tokens', 'lastRefilled')
local tokens = tonumber(data[1])
local lastRefilled = tonumber(data[2])

if not tokens then
    tokens = burstSize
    lastRefilled = now
else
    local elapsed = math.max(0, now - lastRefilled)
    local refill = elapsed * refillRate
    tokens = math.min(burstSize, tokens + refill)
    lastRefilled = now
end

local allowed = 0
if tokens >= cost then
    tokens = tokens - cost
    allowed = 1
end

redis.call('HMSET', key, 'tokens', tokens, 'lastRefilled', lastRefilled)
-- Set TTL of 24 hours to automatically cleanup inactive clients
redis.call('EXPIRE', key, 86400)

-- Compute when the bucket will be fully refilled
local timeToFull = 0
if tokens < burstSize and refillRate > 0 then
    timeToFull = (burstSize - tokens) / refillRate
end
local resetAt = math.ceil(now + timeToFull)

return {allowed, math.floor(tokens), burstSize, resetAt}

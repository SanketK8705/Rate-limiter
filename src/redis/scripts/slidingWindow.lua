local key = KEYS[1]
local limit = tonumber(ARGV[1])
local windowSize = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local memberId = ARGV[4]
local cost = tonumber(ARGV[5] or 1)

-- Remove requests that fell out of the sliding window
local clearBefore = now - windowSize
redis.call('ZREMRANGEBYSCORE', key, '-inf', clearBefore)

-- Count current requests in this window
local count = redis.call('ZCARD', key)

local allowed = 0
local remaining = limit - count

if count + cost <= limit then
    for i = 1, cost do
        redis.call('ZADD', key, now, memberId .. '_' .. i)
    end
    allowed = 1
    remaining = limit - (count + cost)
end

-- Cleanup key after window duration
redis.call('EXPIRE', key, math.ceil(windowSize * 2))

-- Find the oldest request to calculate when the next slot will free up
local oldest = redis.call('ZRANGEBYSCORE', key, '-inf', '+inf', 'WITHSCORES', 'LIMIT', 0, 1)
local resetAt = math.ceil(now + windowSize)
if oldest and oldest[2] then
    resetAt = math.ceil(tonumber(oldest[2]) + windowSize)
end

return {allowed, remaining, limit, resetAt}

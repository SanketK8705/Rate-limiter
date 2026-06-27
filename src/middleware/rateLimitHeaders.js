module.exports = (req, res, next) => {
  res.setRateLimitHeaders = (limit, remaining, resetAt) => {
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(resetAt));
  };
  next();
};

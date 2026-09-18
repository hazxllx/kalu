import ApiError from '../utils/apiError.js';

/**
 * Minimal in-memory fixed-window rate limiter.
 *
 * Used to protect expensive / abuse-prone endpoints (identity verification
 * session creation, public registration). It is intentionally dependency-free
 * and per-process: behind multiple instances it is a soft limit only. When the
 * deployment grows, replace it with a shared store (e.g. Redis) without
 * changing the call sites.
 */
const buckets = new Map();
let lastPrune = Date.now();

const prune = (now, windowMs) => {
  if (now - lastPrune < windowMs) return;
  for (const [key, entry] of buckets) {
    if (now - entry.start >= windowMs) buckets.delete(key);
  }
  lastPrune = now;
};

const rateLimit = ({ windowMs = 60_000, max = 30, keyFn = null, message } = {}) => {
  return (req, res, next) => {
    const key = keyFn ? keyFn(req) : req.user?.id || req.ip || 'anonymous';
    const now = Date.now();
    prune(now, windowMs);

    const entry = buckets.get(key);
    if (!entry || now - entry.start >= windowMs) {
      buckets.set(key, { start: now, count: 1 });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.start + windowMs - now) / 1000)));
      return next(new ApiError(429, message || 'Too many requests. Please try again later.'));
    }
    return next();
  };
};

export default rateLimit;

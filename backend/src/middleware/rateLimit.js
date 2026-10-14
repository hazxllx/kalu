import rateLimitLib, { ipKeyGenerator } from 'express-rate-limit';

const normalizeKeyPart = (value) => {
  if (value === undefined || value === null) return 'anonymous';
  if (typeof value === 'string') {
    const normalized = value.trim().replace(/[\u0000-\u001F\u007F]/g, '');
    return normalized || 'anonymous';
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
};

export const getClientIdentifier = (req) => {
  if (req.user?.id) return `user:${normalizeKeyPart(req.user.id)}`;

  return `ip:${ipKeyGenerator(req.ip || 'unknown')}`;
};

const rateLimit = ({
  windowMs = 60_000,
  max = 30,
  keyFn = null,
  message = 'Too many requests. Please try again later.',
} = {}) => rateLimitLib({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const customKey = keyFn ? keyFn(req) : getClientIdentifier(req);
    return normalizeKeyPart(customKey);
  },
  handler: (req, res) => {
    const retryAfter = Math.max(
      1,
      Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000),
    );
    res.set('Retry-After', String(retryAfter));
    res.status(429).json({
      error: {
        message,
        retryAfter,
      },
    });
  },
});

export default rateLimit;

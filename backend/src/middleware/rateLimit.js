import rateLimitLib, { ipKeyGenerator } from 'express-rate-limit';

/**
 * @module middleware/rateLimit
 *
 * Configurable HTTP rate-limiting middleware factory for KALUSAGAP.
 * Position in request pipeline:
 *   - Public routes (auth, registration): `route -> rateLimit -> validate -> controller -> service`
 *   - Protected routes: `route -> authenticate -> authorize -> rateLimit -> controller -> service`
 *
 * Protects authentication, registration, upload, and sensitive clinical/community
 * mutation endpoints against brute-force attempts and request flooding. Keys
 * authenticated traffic per `req.user.id` (avoiding shared-IP false positives at
 * barangay halls or RHUs) and unauthenticated traffic per IPv6-safe client IP,
 * returning RFC-compliant `RateLimit-*` + `Retry-After` headers and KALUSAGAP's
 * standard `{ error: { message, retryAfter } }` 429 JSON envelope.
 */

/**
 * Sanitizes a rate-limit bucket key segment by trimming whitespace, stripping
 * ASCII control characters, and defaulting empty/missing inputs to `'anonymous'`.
 *
 * @param {*} value - Raw identifier value.
 * @returns {string} Safe non-empty key segment.
 */
const normalizeKeyPart = (value) => {
  if (value === undefined || value === null) return 'anonymous';
  if (typeof value === 'string') {
    const normalized = value.trim().replace(/[\u0000-\u001F\u007F]/g, '');
    return normalized || 'anonymous';
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
};

/**
 * Resolves the default rate-limit bucket identifier for a request:
 * prefers `user:<id>` when `authenticate` has already populated `req.user.id`,
 * otherwise falls back to `ip:<normalizedIp>` using `express-rate-limit`'s
 * IPv6-aware `ipKeyGenerator`.
 *
 * @param {Object} req - Express request object.
 * @returns {string} Scoped client identifier (`user:...` or `ip:...`).
 */
export const getClientIdentifier = (req) => {
  if (req.user?.id) return `user:${normalizeKeyPart(req.user.id)}`;

  return `ip:${ipKeyGenerator(req.ip || 'unknown')}`;
};

/**
 * Creates an Express rate-limiting middleware instance with standardized 429
 * JSON error formatting and `Retry-After` seconds header.
 *
 * @param {Object} [options={}] - Rate limiter configuration.
 * @param {number} [options.windowMs=60000] - Sliding/fixed window duration in milliseconds.
 * @param {number} [options.max=30] - Maximum allowed requests per key within `windowMs`.
 * @param {Function|null} [options.keyFn=null] - Optional custom `(req) => string` bucket key builder.
 * @param {string} [options.message='Too many requests. Please try again later.'] - User-facing 429 error message.
 * @returns {Function} Express rate-limiting middleware.
 */
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

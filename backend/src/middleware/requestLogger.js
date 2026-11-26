// backend/src/middleware/requestLogger.js
import { record } from '../services/systemLogs.service.js';
import env from '../config/env.js';

/**
 * @module middleware/requestLogger
 *
 * Privacy-preserving HTTP request logger and runtime audit middleware for KALUSAGAP.
 * Position in request pipeline (registered globally in `app.js` ahead of routes):
 *   `requestLogger -> route -> authenticate -> authorize -> controller -> service -> repository/Supabase`
 *
 * Logs method, path, status, and duration only. Request bodies, headers,
 * tokens, and query strings are never logged, because they can carry
 * passwords and personal health information (PHI).
 *
 * The same summary is persisted to `public.system_logs` (System Management -> Logs)
 * via `systemLogs.service.js` so the System Log displays real runtime activity.
 * Persistence is fire-and-forget: it never blocks or fails the HTTP response, and
 * is skipped automatically when Supabase is not configured.
 */

/**
 * Assigns a correlation `req.requestId`, measures high-resolution response
 * latency, logs sanitized request metadata to stdout, and asynchronously
 * records runtime activity to `public.system_logs` on response completion.
 *
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next callback.
 */
const requestLogger = (req, res, next) => {
  const startedAt = process.hrtime.bigint();
  // Correlates a log line with the server console and the error handler.
  req.requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${ms.toFixed(1)}ms`);

    if (!env.isSupabaseConfigured) return;
    // `req.user` is set by `authenticate`, which runs after this middleware, so
    // it is available on the finish event for protected routes.
    void record({
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: ms,
      actorId: req.user?.id || null,
      actorRole: req.user?.role || '',
      requestId: req.requestId,
    });
  });

  next();
};

export default requestLogger;

import { record } from '../services/systemLogs.service.js';
import env from '../config/env.js';

/**
 * Minimal request logger.
 *
 * Logs method, path, status, and duration only. Request bodies, headers,
 * tokens, and query strings are never logged, because they can carry
 * passwords and personal health information.
 *
 * The same line is persisted to public.system_logs (System Management → Logs)
 * so the System Log shows real runtime activity instead of an empty table. The
 * write is fire-and-forget: it never blocks or fails the response, and it is
 * skipped entirely when Supabase is not configured.
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

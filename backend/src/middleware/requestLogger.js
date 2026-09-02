/**
 * Minimal request logger.
 *
 * Logs method, path, status, and duration only. Request bodies, headers,
 * tokens, and query strings are never logged, because they can carry
 * passwords and personal health information.
 */
const requestLogger = (req, res, next) => {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${ms.toFixed(1)}ms`);
  });

  next();
};

export default requestLogger;

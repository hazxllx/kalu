import app from './app.js';
import env from './config/env.js';
import { currentDriverName } from './repositories/index.js';
import { startPersonnelNotificationWorker } from './services/personnelNotifications.service.js';

/**
 * KALUSAGAP HTTP server entrypoint.
 *
 * Wraps the Express application (`app.js`, which executes the
 * `route -> authenticate -> authorize -> controller -> service -> repository/Supabase`
 * request pipeline), binds `env.port`, starts the background personnel
 * notification polling worker once the socket is listening, and coordinates
 * graceful shutdown on OS termination signals.
 *
 * The server never seeds fabricated data on startup: the local file driver
 * initializes an empty store when needed, and the Supabase driver reads/writes
 * the live PostgreSQL database, ensuring every environment serves genuine records.
 *
 * @returns {Promise<Object>} Active Node `http.Server` instance
 */
const boot = async () => {
  if (!env.isProduction && (!env.isSupabaseConfigured || !env.supabaseAnonKey || !env.otpPepper)) {
    throw new Error('Supabase URL, anon/service keys, and OTP_PEPPER are required in backend/.env.');
  }
  let stopNotificationWorker = async () => {};
  let shuttingDown = false;
  const server = app.listen(env.port, env.isProduction ? '0.0.0.0' : '127.0.0.1', () => {
    console.log(`KALUSAGAP backend running in ${env.nodeEnv} mode`);
    console.log(`Listening on http://localhost:${env.port}`);
    console.log(`Data driver: ${currentDriverName()}`);
    console.log(`Health check:  http://localhost:${env.port}/api/health`);
    console.log(`Allowed origins: ${env.clientUrls.join(', ')}`);
    // Start the periodic personnel notification worker only if shutdown has not already begun.
    if (!shuttingDown) stopNotificationWorker = startPersonnelNotificationWorker();
  });

  // Idempotent teardown handler: stops background polling first, then drains
  // in-flight HTTP requests via `server.close` before exiting cleanly.
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down.`);
    const workerStopped = stopNotificationWorker();
    server.close(async () => {
      await workerStopped;
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
};

export default boot();

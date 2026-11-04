import app from './app.js';
import env from './config/env.js';
import { currentDriverName } from './repositories/index.js';
import { startPersonnelNotificationWorker } from './services/personnelNotifications.service.js';

/**
 * Process entry point: starts the HTTP listener and shuts down cleanly on
 * signals.
 *
 * The server no longer seeds any fabricated data. The file driver starts with
 * an empty store, and the Supabase driver reads/writes the real database, so
 * every environment serves only genuine records.
 */
const boot = async () => {
  let stopNotificationWorker = async () => {};
  let shuttingDown = false;
  const server = app.listen(env.port, () => {
    console.log(`KALUSAGAP backend running in ${env.nodeEnv} mode`);
    console.log(`Listening on http://localhost:${env.port}`);
    console.log(`Data driver: ${currentDriverName()}`);
    console.log(`Health check:  http://localhost:${env.port}/api/health`);
    console.log(`Allowed origins: ${env.clientUrls.join(', ')}`);
    if (!shuttingDown) stopNotificationWorker = startPersonnelNotificationWorker();
  });

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

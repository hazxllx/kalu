import app from './app.js';
import env from './config/env.js';
import { seedLocalDataIfEmpty } from './services/seed.service.js';
import { currentDriverName } from './repositories/index.js';

/**
 * Process entry point: seeds local demo data when running on the file driver,
 * starts the HTTP listener, and shuts down cleanly on signals.
 */
const boot = async () => {
  let seedMessage = '';
  try {
    const seed = await seedLocalDataIfEmpty();
    if (seed.seeded) seedMessage = ' (local demo data seeded)';
  } catch (err) {
    console.warn('Local seed skipped:', err.message);
  }

  const server = app.listen(env.port, () => {
    console.log(`KALUSAGAP backend running in ${env.nodeEnv} mode`);
    console.log(`Listening on http://localhost:${env.port}`);
    console.log(`Data driver: ${currentDriverName()}${seedMessage}`);
    console.log(`Health check:  http://localhost:${env.port}/api/health`);
    console.log(`Allowed origins: ${env.clientUrls.join(', ')}`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down.`);
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
};

export default boot();

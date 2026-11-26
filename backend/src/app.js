// backend/src/app.js
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import env from './config/env.js';
import errorHandler from './middleware/errorHandler.js';
import notFoundHandler from './middleware/notFoundHandler.js';
import rateLimit from './middleware/rateLimit.js';
import requestLogger from './middleware/requestLogger.js';
import apiRoutes from './routes/index.js';
import { getBpConfig } from './services/bpConfig.service.js';
import { DEFAULT_BP_THRESHOLDS, setBloodPressureConfig } from './config/bpThresholds.js';

/**
 * KALUSAGAP Express application assembly.
 *
 * Intended request flow:
 *   route -> authenticate -> authorize -> controller -> service -> repository/Supabase
 *
 * `app.js` only wires middleware and mounts `/api` routes; `server.js` binds
 * the HTTP port and background workers. Keeping them separate allows automated
 * tests to import the Express app without opening a network listener.
 *
 * Authentication (`middleware/authenticate.js`) and role/station/barangay
 * authorization (`middleware/authorize.js`, `middleware/authorizeStation.js`)
 * are applied per-route in `routes/`. `/api/health` stays public; `/api/auth`
 * endpoints coordinate with Supabase Auth; all clinical, community, and admin
 * route groups require a verified session and least-privilege role checks.
 */
const app = express();

// Hide framework fingerprint, honor reverse-proxy X-Forwarded-For hops (per
// env.trustProxy) so rate limiting and audit logs see real client IPs, and
// apply Helmet security headers while permitting cross-origin blob/asset reads
// from allowlisted frontend origins.
app.disable('x-powered-by');
app.set('trust proxy', env.trustProxy);
app.use(helmet({ crossOriginResourcePolicy: false }));

// CORS runs before body parsing, rate limiting, routing, and authentication so
// browser preflight requests complete without being challenged for a token.
// Credentialed requests use an exact-origin allowlist, never a wildcard.
// Custom headers support safe mutation replay (`Idempotency-Key`), optimistic
// concurrency (`If-Match`), and offline queue synchronization (`X-Kalusagap-Sync`).
app.use(cors({
  origin: env.clientUrls,
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'If-Match', 'X-Kalusagap-Sync'],
  maxAge: 600,
  optionsSuccessStatus: 204,
}));

// Enforce payload size caps before route handlers parse JSON or form bodies,
// then log every incoming request with correlation metadata.
app.use(express.json({ limit: env.requestBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: env.requestBodyLimit }));
app.use(requestLogger);

// Global baseline rate limiter across all `/api` endpoints; sensitive auth and
// upload routes layer stricter per-route limiters on top of this ceiling.
const apiLimiter = rateLimit({
  windowMs: env.apiRateLimitWindowMs,
  max: env.apiRateLimitMaxRequests,
  message: 'Too many requests. Please try again later.',
});

app.use('/api', apiLimiter);
let bpConfigInitialization;
app.use('/api', (req, res, next) => {
  if (!bpConfigInitialization) {
    bpConfigInitialization = getBpConfig().catch(() => {
      setBloodPressureConfig({ thresholds: DEFAULT_BP_THRESHOLDS, source: 'default' });
      console.error('Could not load BP threshold settings; shared defaults remain active.');
      return null;
    });
  }
  bpConfigInitialization.then(() => next()).catch(next);
});
app.use('/api', apiRoutes);

// Unknown routes and uncaught operational/programming errors are handled last, in that order.
app.use(notFoundHandler);
app.use(errorHandler);

export default app;

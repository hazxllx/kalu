import cors from 'cors';
import express from 'express';

import env from './config/env.js';
import errorHandler from './middleware/errorHandler.js';
import notFoundHandler from './middleware/notFoundHandler.js';
import requestLogger from './middleware/requestLogger.js';
import apiRoutes from './routes/index.js';

/**
 * Express application wiring.
 *
 * Intended request flow:  route -> authenticate -> authorize -> controller -> service -> Supabase/PostgreSQL
 *
 * `app.js` only assembles the app; `server.js` starts it. Keeping them apart
 * means tests can import the app without opening a port.
 *
 * Authentication (`middleware/authenticate.js`) and role-based authorization
 * (`middleware/authorize.js`) are applied per-route in `routes/`. `/api/health`
 * stays public; `/api/auth/*` uses Supabase Auth; every other group is
 * protected and role-scoped.
 */
const app = express();

// CORS is restricted to the origins listed in CLIENT_URL — never a wildcard.
app.use(cors({ origin: env.clientUrls, credentials: true }));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

app.use('/api', apiRoutes);

// Unknown routes and errors are handled last, in that order.
app.use(notFoundHandler);
app.use(errorHandler);

export default app;

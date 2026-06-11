import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import * as Sentry from '@sentry/node';
import pinoHttp from 'pino-http';

import { env } from './config/env';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/error';
import { registerJobs } from './jobs/scheduler';

import batches from './routes/batches.routes';
import candidates from './routes/candidates.routes';
import attendance from './routes/attendance.routes';
import assessments from './routes/assessments.routes';
import feedback from './routes/feedback.routes';
import notifications from './routes/notifications.routes';
import dashboard from './routes/dashboard.routes';
import toppers from './routes/toppers.routes';
import users from './routes/users.routes';
import audit from './routes/audit.routes';
import reports from './routes/reports.routes';
import ai from './routes/ai.routes';
import internalRoutes from './routes/internal.routes';

if (env.SENTRY_DSN) Sentry.init({ dsn: env.SENTRY_DSN, tracesSampleRate: 0.2 });

const app = express();
app.use(helmet());
app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
app.use(express.json({ limit: '20mb' }));
app.use(pinoHttp({ logger }));

app.get('/healthz', (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.use('/api/batches', batches);
app.use('/api/candidates', candidates);
app.use('/api/attendance', attendance);
app.use('/api/assessments', assessments);
app.use('/api/feedback', feedback);
app.use('/api/notifications', notifications);
app.use('/api/dashboard', dashboard);
app.use('/api/toppers', toppers);
app.use('/api/users', users);
app.use('/api/audit', audit);
app.use('/api/reports', reports);
app.use('/api/ai', ai);
app.use('/internal', internalRoutes);

app.use(errorHandler);

registerJobs();

app.listen(env.PORT, () => logger.info(`API on :${env.PORT}`));

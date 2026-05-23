import type { ErrorRequestHandler } from 'express';
import * as Sentry from '@sentry/node';
import { logger } from '../utils/logger';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err.name === 'UnauthorizedError' || err.status === 401)
    return res.status(401).json({ error: 'Unauthorized' });
  Sentry.captureException(err);
  logger.error({ err }, 'unhandled error');
  res.status(err.status || 500).json({ error: err.message || 'Internal error' });
};

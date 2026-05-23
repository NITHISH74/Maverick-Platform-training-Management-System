import axios from 'axios';
import { env } from '../config/env';

export const aiClient = axios.create({
  baseURL: env.AI_SERVICE_URL,
  timeout: 60_000,
  headers: { 'x-internal-token': env.INTERNAL_SHARED_SECRET },
});

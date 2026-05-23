import { auth } from 'express-oauth2-jwt-bearer';
import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { supabase } from '../config/supabase';

export const checkJwt = auth({
  audience: env.AUTH0_AUDIENCE,
  issuerBaseURL: `https://${env.AUTH0_DOMAIN}/`,
  tokenSigningAlg: 'RS256',
});

export interface AuthUser {
  id: number;
  auth0_sub: string;
  email: string;
  role: 'admin' | 'coordinator' | 'trainer';
  full_name: string;
}

declare module 'express-serve-static-core' {
  interface Request { user?: AuthUser }
}

export async function attachUser(req: Request, res: Response, next: NextFunction) {
  const sub = (req as any).auth?.payload?.sub;
  if (!sub) return res.status(401).json({ error: 'no sub claim' });
  const { data, error } = await supabase.from('users').select('*').eq('auth0_sub', sub).maybeSingle();
  if (error) return next(error);
  if (!data) return res.status(401).json({ error: 'user not provisioned' });
  req.user = data as AuthUser;
  next();
}

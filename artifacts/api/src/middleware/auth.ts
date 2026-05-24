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

async function fetchEmailFromUserinfo(req: Request): Promise<string | undefined> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return undefined;
  try {
    const resp = await fetch(`https://${env.AUTH0_DOMAIN}/userinfo`, {
      headers: { Authorization: authHeader },
    });
    if (!resp.ok) return undefined;
    const info = (await resp.json()) as { email?: string; name?: string };
    return info.email;
  } catch {
    return undefined;
  }
}

export async function attachUser(req: Request, res: Response, next: NextFunction) {
  const payload = (req as any).auth?.payload ?? {};
  const sub: string | undefined = payload.sub;
  if (!sub) return res.status(401).json({ error: 'no sub claim' });

  // 1) Look up by auth0_sub
  let { data, error } = await supabase.from('users').select('*').eq('auth0_sub', sub).maybeSingle();
  if (error) return next(error);

  // 2) Fall back: claim seeded row by email (from JWT, custom claim, or /userinfo)
  if (!data) {
    let email: string | undefined =
      payload.email || payload['https://maverick/email'];
    if (!email) email = await fetchEmailFromUserinfo(req);
    if (email) {
      const lookup = await supabase.from('users').select('*').eq('email', email).maybeSingle();
      if (lookup.error) return next(lookup.error);
      if (lookup.data) {
        const upd = await supabase.from('users').update({ auth0_sub: sub }).eq('id', lookup.data.id).select('*').single();
        if (upd.error) return next(upd.error);
        data = upd.data;
      }
    }
  }

  if (!data) return res.status(401).json({ error: 'user not provisioned' });
  req.user = data as AuthUser;
  next();
}

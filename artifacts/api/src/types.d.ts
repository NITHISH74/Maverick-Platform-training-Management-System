import 'express';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        auth0_sub: string;
        email: string;
        role: 'admin' | 'coordinator' | 'trainer';
        full_name: string;
      };
    }
  }
}

export {};

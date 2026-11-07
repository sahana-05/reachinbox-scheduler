import { NextFunction, Request, Response } from 'express';
import { verifyToken } from '../auth/token';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authorization = req.header('authorization');
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = bearer ?? req.cookies?.token;
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  try {
    req.userId = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

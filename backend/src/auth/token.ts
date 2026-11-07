import jwt, { JwtPayload, SignOptions } from 'jsonwebtoken';
import { config } from '../config';

export function issueToken(userId: string): string {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: config.jwtExpiresIn as SignOptions['expiresIn'] });
}

export function verifyToken(token: string): string {
  const payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
  if (typeof payload.sub !== 'string') throw new Error('Invalid token subject');
  return payload.sub;
}

export function signSlackState(userId: string): string {
  return jwt.sign({ sub: userId, purpose: 'slack-oauth' }, config.jwtSecret, { expiresIn: '10m' });
}

export function verifySlackState(state: string): string {
  const payload = jwt.verify(state, config.jwtSecret) as JwtPayload;
  if (payload.purpose !== 'slack-oauth' || typeof payload.sub !== 'string') throw new Error('Invalid OAuth state');
  return payload.sub;
}

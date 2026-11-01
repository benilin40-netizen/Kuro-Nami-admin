import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { db } from './db';
import { AdminRole, AuthenticatedAdmin, LogSeverity } from '../shared/types';
import { recordSystemLog } from './monitoring';

export const SESSION_COOKIE_NAME = 'kn_admin_session';

export type PermissionScope =
  | 'catalog:read'
  | 'catalog:write'
  | 'infra:read'
  | 'infra:write'
  | 'assets:read'
  | 'assets:write'
  | 'users:read'
  | 'users:write'
  | 'treasury:read'
  | 'treasury:write'
  | 'analytics:read'
  | 'monitoring:read'
  | 'audit:read'
  | 'settings:manage';

const ROLE_PERMISSIONS: Record<AdminRole, PermissionScope[]> = {
  [AdminRole.OWNER]: [
    'catalog:read',
    'catalog:write',
    'infra:read',
    'infra:write',
    'assets:read',
    'assets:write',
    'users:read',
    'users:write',
    'treasury:read',
    'treasury:write',
    'analytics:read',
    'monitoring:read',
    'audit:read',
    'settings:manage',
  ],
  [AdminRole.CONTENT_ADMIN]: [
    'catalog:read',
    'catalog:write',
    'assets:read',
    'assets:write',
    'analytics:read',
  ],
  [AdminRole.INFRA_ADMIN]: [
    'infra:read',
    'infra:write',
    'assets:read',
    'assets:write',
    'monitoring:read',
    'analytics:read',
  ],
  [AdminRole.SUPPORT_MOD]: [
    'users:read',
    'users:write',
    'catalog:read',
    'analytics:read',
  ],
  [AdminRole.AUDITOR]: [
    'catalog:read',
    'infra:read',
    'assets:read',
    'users:read',
    'treasury:read',
    'analytics:read',
    'monitoring:read',
    'audit:read',
  ],
};

declare global {
  namespace Express {
    interface Request {
      admin?: AuthenticatedAdmin;
    }
  }
}

export function hashSecret(secret: string, saltHex?: string): { hash: string; salt: string } {
  const salt = saltHex || crypto.randomBytes(32).toString('hex');
  const derived = crypto.scryptSync(secret, Buffer.from(salt, 'hex'), 64);
  return { hash: derived.toString('hex'), salt };
}

export function verifySecret(secret: string, expectedHashHex: string, saltHex: string): boolean {
  try {
    const derived = crypto.scryptSync(secret, Buffer.from(saltHex, 'hex'), 64);
    const expected = Buffer.from(expectedHashHex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function sha256Hex(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function generateOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function generateRecoveryKey(): string {
  const raw = crypto.randomBytes(18).toString('hex').toUpperCase();
  return `KN-${raw.slice(0, 6)}-${raw.slice(6, 12)}-${raw.slice(12, 18)}-${raw.slice(18, 24)}-${raw.slice(24, 30)}`;
}

export function validatePasswordStrength(password: string): string | null {
  if (typeof password !== 'string' || password.length < 1) {
    return 'Password cannot be empty.';
  }
  return null;
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    if (key) out[key] = val;
  }
  return out;
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

export function setSessionCookie(res: Response, rawToken: string, ttlHours = 24): void {
  const maxAgeSec = ttlHours * 3600;
  const isProd = process.env.NODE_ENV === 'production';
  // Support iframe preview context while keeping HttpOnly protection
  const sameSite = isProd ? 'None; Secure' : 'Lax';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}; Path=/; HttpOnly; Max-Age=${maxAgeSec}; SameSite=${sameSite}`
  );
}

export function clearSessionCookie(res: Response): void {
  const isProd = process.env.NODE_ENV === 'production';
  const sameSite = isProd ? 'None; Secure' : 'Lax';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0; SameSite=${sameSite}`
  );
}

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateBucket>();

export function createRateLimiter(options: {
  keyPrefix: string;
  windowMs: number;
  maxRequests: number;
}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = getClientIp(req);
    const key = `${options.keyPrefix}:${ip}`;
    const now = Date.now();
    const existing = rateLimitStore.get(key);

    if (!existing || existing.resetAt <= now) {
      rateLimitStore.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    existing.count += 1;
    if (existing.count > options.maxRequests) {
      const retryAfterSec = Math.ceil((existing.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      recordSystemLog({
        workspaceId: req.admin?.workspaceId || null,
        severity: LogSeverity.WARN,
        component: 'RateLimiter',
        message: `Rate limit exceeded on ${options.keyPrefix} from IP ${ip}`,
      });
      res.status(429).json({
        error: 'Too many requests. Please wait before retrying.',
        retryAfterSeconds: retryAfterSec,
      });
      return;
    }

    next();
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const cookies = parseCookies(req.headers.cookie);
  let rawToken = cookies[SESSION_COOKIE_NAME];

  const authHeader = req.headers.authorization;
  if (!rawToken && authHeader && authHeader.startsWith('Bearer ')) {
    rawToken = authHeader.slice(7).trim();
  }

  if (!rawToken) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  const tokenHash = sha256Hex(rawToken);
  const nowIso = new Date().toISOString();

  const row = db
    .prepare(
      `
      SELECT
        s.id AS session_id,
        s.csrf_token,
        s.expires_at,
        s.revoked_at,
        a.id AS admin_id,
        a.username,
        a.display_name,
        a.role,
        a.workspace_id,
        a.is_locked,
        a.last_login_at,
        w.name AS workspace_name
      FROM admin_sessions s
      JOIN admin_accounts a ON a.id = s.admin_id
      JOIN workspaces w ON w.id = s.workspace_id
      WHERE s.token_hash = ?
    `
    )
    .get(tokenHash) as
    | {
        session_id: string;
        csrf_token: string;
        expires_at: string;
        revoked_at: string | null;
        admin_id: string;
        username: string;
        display_name: string;
        role: AdminRole;
        workspace_id: string;
        is_locked: number;
        last_login_at: string | null;
        workspace_name: string;
      }
    | undefined;

  if (!row || row.revoked_at || row.expires_at <= nowIso || row.is_locked) {
    res.status(401).json({ error: 'Session expired or revoked. Please sign in again.' });
    return;
  }

  // Enforce CSRF token validation on all state-mutating methods
  const mutatingMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
  if (mutatingMethods.includes(req.method.toUpperCase())) {
    const providedCsrf = req.headers['x-csrf-token'];
    if (typeof providedCsrf !== 'string' || providedCsrf !== row.csrf_token) {
      recordSystemLog({
        workspaceId: row.workspace_id,
        severity: LogSeverity.WARN,
        component: 'CSRFGuard',
        message: `Rejected mutating request ${req.method} ${req.originalUrl} due to invalid or missing X-CSRF-Token`,
      });
      res.status(403).json({ error: 'Invalid or missing CSRF security token.' });
      return;
    }
  }

  req.admin = {
    id: row.admin_id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    csrfToken: row.csrf_token,
    sessionId: row.session_id,
    lastLoginAt: row.last_login_at,
  };

  next();
}

export function requirePermission(scope: PermissionScope) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.admin) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const allowed = ROLE_PERMISSIONS[req.admin.role] || [];
    if (!allowed.includes(scope)) {
      recordSystemLog({
        workspaceId: req.admin.workspaceId,
        severity: LogSeverity.WARN,
        component: 'RBACGuard',
        message: `Access denied for ${req.admin.username} (${req.admin.role}) on required scope ${scope}`,
      });
      res.status(403).json({
        error: `Insufficient role permissions. Required capability: ${scope}`,
      });
      return;
    }
    next();
  };
}

export function hasPermission(role: AdminRole, scope: PermissionScope): boolean {
  return (ROLE_PERMISSIONS[role] || []).includes(scope);
}

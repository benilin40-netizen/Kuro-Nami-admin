import crypto from 'crypto';
import { Router } from 'express';
import { db } from '../db';
import {
  AdminRole,
  LogSeverity,
  OwnerProvisionSlot,
} from '../../shared/types';
import {
  clearSessionCookie,
  createRateLimiter,
  generateOpaqueToken,
  generateRecoveryKey,
  getClientIp,
  hashSecret,
  parseCookies,
  requireAuth,
  requirePermission,
  SESSION_COOKIE_NAME,
  setSessionCookie,
  sha256Hex,
  validatePasswordStrength,
  verifySecret,
} from '../security';
import { recordAuditLog, recordSystemLog } from '../monitoring';

export const authRouter = Router();

const authLimiter = createRateLimiter({
  keyPrefix: 'auth_sensitive',
  windowMs: 60_000,
  maxRequests: 20,
});

function logLoginEvent(params: {
  adminId?: string | null;
  workspaceId?: string | null;
  usernameAttempted: string;
  eventType: string;
  success: boolean;
  ipAddress: string;
  userAgent: string;
  detail?: string;
}): void {
  db.prepare(
    `
    INSERT INTO login_history (
      id, admin_id, workspace_id, username_attempted, event_type, success, ip_address, user_agent, detail, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    `lhist_${crypto.randomUUID()}`,
    params.adminId || null,
    params.workspaceId || null,
    params.usernameAttempted.slice(0, 120),
    params.eventType,
    params.success ? 1 : 0,
    params.ipAddress,
    (params.userAgent || 'unknown').slice(0, 255),
    params.detail || null,
    new Date().toISOString()
  );
}

authRouter.get('/status', (req, res) => {
  const ownerRows = db
    .prepare(
      `
      SELECT a.id, a.username, a.display_name, a.workspace_id, a.is_provisioned, a.provisioned_at, w.name AS workspace_name
      FROM admin_accounts a
      JOIN workspaces w ON w.id = a.workspace_id
      WHERE a.is_owner_slot = 1
      ORDER BY a.username ASC
    `
    )
    .all() as Array<{
    id: string;
    username: string;
    display_name: string;
    workspace_id: string;
    is_provisioned: number;
    provisioned_at: string | null;
    workspace_name: string;
  }>;

  const ownerSlots: OwnerProvisionSlot[] = ownerRows.map((r) => ({
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    workspaceId: r.workspace_id,
    workspaceName: r.workspace_name,
    isProvisioned: Boolean(r.is_provisioned),
    provisionedAt: r.provisioned_at,
  }));

  const requiresProvisioningToken = Boolean(
    process.env.ADMIN_PROVISIONING_TOKEN && process.env.ADMIN_PROVISIONING_TOKEN.trim().length > 0
  );

  // Check if caller currently holds a valid session
  const cookies = parseCookies(req.headers.cookie);
  let rawToken = cookies[SESSION_COOKIE_NAME];
  const authHeader = req.headers.authorization;
  if (!rawToken && authHeader && authHeader.startsWith('Bearer ')) {
    rawToken = authHeader.slice(7).trim();
  }

  let currentAdmin = null;
  if (rawToken) {
    const tokenHash = sha256Hex(rawToken);
    const nowIso = new Date().toISOString();
    const sessionRow = db
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

    if (sessionRow && !sessionRow.revoked_at && sessionRow.expires_at > nowIso && !sessionRow.is_locked) {
      currentAdmin = {
        id: sessionRow.admin_id,
        username: sessionRow.username,
        displayName: sessionRow.display_name,
        role: sessionRow.role,
        workspaceId: sessionRow.workspace_id,
        workspaceName: sessionRow.workspace_name,
        csrfToken: sessionRow.csrf_token,
        sessionId: sessionRow.session_id,
        lastLoginAt: sessionRow.last_login_at,
      };
    }
  }

  res.json({
    ownerSlots,
    requiresProvisioningToken,
    currentAdmin,
  });
});

authRouter.post('/provision-owner', authLimiter, (req, res) => {
  const { ownerAccountId, password, confirmPassword, provisioningToken } = req.body || {};
  const ip = getClientIp(req);
  const ua = String(req.headers['user-agent'] || 'unknown');

  if (!ownerAccountId || typeof ownerAccountId !== 'string') {
    res.status(400).json({ error: 'Designated owner account selection is required.' });
    return;
  }

  const requiredEnvToken = process.env.ADMIN_PROVISIONING_TOKEN?.trim();
  if (requiredEnvToken && provisioningToken !== requiredEnvToken) {
    recordSystemLog({
      severity: LogSeverity.WARN,
      component: 'OwnerProvisioning',
      message: `Invalid provisioning authorization token attempt from ${ip}`,
    });
    res.status(403).json({ error: 'Invalid server provisioning authorization token.' });
    return;
  }

  if (password !== confirmPassword) {
    res.status(400).json({ error: 'Password confirmation does not match.' });
    return;
  }

  const strengthErr = validatePasswordStrength(password);
  if (strengthErr) {
    res.status(400).json({ error: strengthErr });
    return;
  }

  const ownerRow = db
    .prepare(
      `
      SELECT a.*, w.name AS workspace_name
      FROM admin_accounts a
      JOIN workspaces w ON w.id = a.workspace_id
      WHERE a.id = ? AND a.is_owner_slot = 1
    `
    )
    .get(ownerAccountId) as
    | {
        id: string;
        username: string;
        display_name: string;
        role: AdminRole;
        workspace_id: string;
        is_provisioned: number;
        workspace_name: string;
      }
    | undefined;

  if (!ownerRow) {
    res.status(404).json({ error: 'Designated owner slot not found. Public registration is disabled.' });
    return;
  }

  if (ownerRow.is_provisioned) {
    res.status(409).json({
      error: `Owner account "${ownerRow.username}" has already completed initial provisioning.`,
    });
    return;
  }

  const pwHash = hashSecret(password);
  const rawRecoveryKey = generateRecoveryKey();
  const recHash = hashSecret(rawRecoveryKey);

  const rawSessionToken = generateOpaqueToken(32);
  const sessionTokenHash = sha256Hex(rawSessionToken);
  const csrfToken = generateOpaqueToken(24);
  const sessionId = `sess_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const ttlHours = Math.max(1, Number(process.env.SESSION_TTL_HOURS) || 24);
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();

  const provisionTx = db.transaction(() => {
    const updateRes = db
      .prepare(
        `
        UPDATE admin_accounts
        SET is_provisioned = 1,
            password_hash = ?,
            password_salt = ?,
            recovery_key_hash = ?,
            recovery_key_salt = ?,
            provisioned_at = ?,
            last_login_at = ?,
            updated_at = ?
        WHERE id = ? AND is_provisioned = 0
      `
      )
      .run(pwHash.hash, pwHash.salt, recHash.hash, recHash.salt, now, now, now, ownerRow.id);

    if (updateRes.changes !== 1) {
      throw new Error('Provisioning race condition detected.');
    }

    db.prepare(
      `
      INSERT INTO admin_sessions (
        id, admin_id, workspace_id, token_hash, csrf_token, ip_address, user_agent, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      sessionId,
      ownerRow.id,
      ownerRow.workspace_id,
      sessionTokenHash,
      csrfToken,
      ip,
      ua.slice(0, 255),
      now,
      expiresAt
    );
  });

  try {
    provisionTx();
  } catch {
    res.status(409).json({ error: 'Owner account already provisioned.' });
    return;
  }

  logLoginEvent({
    adminId: ownerRow.id,
    workspaceId: ownerRow.workspace_id,
    usernameAttempted: ownerRow.username,
    eventType: 'OWNER_INITIAL_PROVISIONING',
    success: true,
    ipAddress: ip,
    userAgent: ua,
    detail: 'Completed one-time initial owner password setup and isolated workspace activation.',
  });

  recordAuditLog({
    workspaceId: ownerRow.workspace_id,
    adminId: ownerRow.id,
    adminUsername: ownerRow.username,
    action: 'OWNER_ACCOUNT_PROVISIONED',
    resourceType: 'ADMIN_ACCOUNT',
    resourceId: ownerRow.id,
    previousValue: { isProvisioned: false },
    newValue: { isProvisioned: true, workspaceId: ownerRow.workspace_id },
    status: 'SUCCESS',
    ipAddress: ip,
  });

  setSessionCookie(res, rawSessionToken, ttlHours);

  res.status(201).json({
    admin: {
      id: ownerRow.id,
      username: ownerRow.username,
      displayName: ownerRow.display_name,
      role: ownerRow.role,
      workspaceId: ownerRow.workspace_id,
      workspaceName: ownerRow.workspace_name,
      csrfToken,
      sessionId,
      lastLoginAt: now,
    },
    sessionToken: rawSessionToken,
    oneTimeRecoveryKey: rawRecoveryKey,
  });
});

authRouter.post('/login', authLimiter, (req, res) => {
  const { username, password } = req.body || {};
  const ip = getClientIp(req);
  const ua = String(req.headers['user-agent'] || 'unknown');

  const trimmedUsername = typeof username === 'string' ? username.trim() : '';
  if (!trimmedUsername || typeof password !== 'string' || !password) {
    res.status(400).json({ error: 'Username and password are required.' });
    return;
  }

  const account = db
    .prepare(
      `
      SELECT a.*, w.name AS workspace_name
      FROM admin_accounts a
      JOIN workspaces w ON w.id = a.workspace_id
      WHERE LOWER(a.username) = LOWER(?)
    `
    )
    .get(trimmedUsername) as
    | {
        id: string;
        username: string;
        display_name: string;
        role: AdminRole;
        workspace_id: string;
        is_provisioned: number;
        password_hash: string | null;
        password_salt: string | null;
        is_locked: number;
        failed_login_attempts: number;
        last_failed_login_at: string | null;
        workspace_name: string;
      }
    | undefined;

  if (!account) {
    logLoginEvent({
      usernameAttempted: trimmedUsername,
      eventType: 'LOGIN_ATTEMPT',
      success: false,
      ipAddress: ip,
      userAgent: ua,
      detail: 'Unknown administrator username.',
    });
    recordSystemLog({
      severity: LogSeverity.WARN,
      component: 'AdminAuth',
      message: `Failed login for non-existent administrator "${trimmedUsername}" from ${ip}`,
    });
    res.status(401).json({ error: 'Invalid administrator credentials.' });
    return;
  }

  if (!account.is_provisioned || !account.password_hash || !account.password_salt) {
    logLoginEvent({
      adminId: account.id,
      workspaceId: account.workspace_id,
      usernameAttempted: account.username,
      eventType: 'LOGIN_ATTEMPT',
      success: false,
      ipAddress: ip,
      userAgent: ua,
      detail: 'Account has not completed initial owner provisioning.',
    });
    res.status(403).json({
      error: `Account "${account.username}" has not been provisioned yet. Complete Initial Owner Provisioning first.`,
    });
    return;
  }

  // Check temporary brute-force lockout (6 failed attempts within 15 minutes)
  if (account.is_locked) {
    res.status(423).json({
      error: 'Administrator account is locked. Use Password Recovery or owner intervention.',
    });
    return;
  }

  if (account.failed_login_attempts >= 6 && account.last_failed_login_at) {
    const elapsedMs = Date.now() - new Date(account.last_failed_login_at).getTime();
    if (elapsedMs < 15 * 60 * 1000) {
      logLoginEvent({
        adminId: account.id,
        workspaceId: account.workspace_id,
        usernameAttempted: account.username,
        eventType: 'LOCKOUT_BLOCK',
        success: false,
        ipAddress: ip,
        userAgent: ua,
        detail: 'Blocked due to repeated failed password attempts.',
      });
      res.status(423).json({
        error: 'Too many failed login attempts. Account temporarily protected for 15 minutes or until reset via Recovery Key.',
      });
      return;
    }
  }

  const valid = verifySecret(password, account.password_hash, account.password_salt);
  const now = new Date().toISOString();

  if (!valid) {
    const nextFails = account.failed_login_attempts + 1;
    db.prepare(
      `UPDATE admin_accounts SET failed_login_attempts = ?, last_failed_login_at = ?, updated_at = ? WHERE id = ?`
    ).run(nextFails, now, now, account.id);

    logLoginEvent({
      adminId: account.id,
      workspaceId: account.workspace_id,
      usernameAttempted: account.username,
      eventType: 'LOGIN_FAILED',
      success: false,
      ipAddress: ip,
      userAgent: ua,
      detail: `Invalid password (attempt ${nextFails}).`,
    });

    recordSystemLog({
      workspaceId: account.workspace_id,
      severity: LogSeverity.WARN,
      component: 'AdminAuth',
      message: `Authentication failure for "${account.username}" from IP ${ip} (attempt ${nextFails})`,
    });

    recordAuditLog({
      workspaceId: account.workspace_id,
      adminId: account.id,
      adminUsername: account.username,
      action: 'ADMIN_LOGIN_FAILED',
      resourceType: 'ADMIN_SESSION',
      status: 'FAILURE',
      ipAddress: ip,
    });

    res.status(401).json({ error: 'Invalid administrator credentials.' });
    return;
  }

  const rawSessionToken = generateOpaqueToken(32);
  const sessionTokenHash = sha256Hex(rawSessionToken);
  const csrfToken = generateOpaqueToken(24);
  const sessionId = `sess_${crypto.randomUUID()}`;
  const ttlHours = Math.max(1, Number(process.env.SESSION_TTL_HOURS) || 24);
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();

  db.transaction(() => {
    db.prepare(
      `UPDATE admin_accounts SET failed_login_attempts = 0, last_login_at = ?, updated_at = ? WHERE id = ?`
    ).run(now, now, account.id);

    db.prepare(
      `
      INSERT INTO admin_sessions (
        id, admin_id, workspace_id, token_hash, csrf_token, ip_address, user_agent, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      sessionId,
      account.id,
      account.workspace_id,
      sessionTokenHash,
      csrfToken,
      ip,
      ua.slice(0, 255),
      now,
      expiresAt
    );
  })();

  logLoginEvent({
    adminId: account.id,
    workspaceId: account.workspace_id,
    usernameAttempted: account.username,
    eventType: 'LOGIN_SUCCESS',
    success: true,
    ipAddress: ip,
    userAgent: ua,
    detail: `Session ${sessionId} established.`,
  });

  recordAuditLog({
    workspaceId: account.workspace_id,
    adminId: account.id,
    adminUsername: account.username,
    action: 'ADMIN_LOGIN_SUCCESS',
    resourceType: 'ADMIN_SESSION',
    resourceId: sessionId,
    status: 'SUCCESS',
    ipAddress: ip,
  });

  setSessionCookie(res, rawSessionToken, ttlHours);

  res.json({
    admin: {
      id: account.id,
      username: account.username,
      displayName: account.display_name,
      role: account.role,
      workspaceId: account.workspace_id,
      workspaceName: account.workspace_name,
      csrfToken,
      sessionId,
      lastLoginAt: now,
    },
    sessionToken: rawSessionToken,
  });
});

authRouter.post('/logout', requireAuth, (req, res) => {
  const admin = req.admin!;
  const ip = getClientIp(req);
  const now = new Date().toISOString();

  db.prepare(`UPDATE admin_sessions SET revoked_at = ? WHERE id = ? AND workspace_id = ?`).run(
    now,
    admin.sessionId,
    admin.workspaceId
  );

  recordAuditLog({
    workspaceId: admin.workspaceId,
    adminId: admin.id,
    adminUsername: admin.username,
    action: 'ADMIN_LOGOUT',
    resourceType: 'ADMIN_SESSION',
    resourceId: admin.sessionId,
    status: 'SUCCESS',
    ipAddress: ip,
  });

  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.post('/reset-password', authLimiter, (req, res) => {
  const { username, recoveryKey, newPassword, confirmPassword } = req.body || {};
  const ip = getClientIp(req);
  const ua = String(req.headers['user-agent'] || 'unknown');

  if (!username || !recoveryKey || !newPassword) {
    res.status(400).json({ error: 'Username, recovery key, and new password are required.' });
    return;
  }

  if (newPassword !== confirmPassword) {
    res.status(400).json({ error: 'Password confirmation does not match.' });
    return;
  }

  const strengthErr = validatePasswordStrength(newPassword);
  if (strengthErr) {
    res.status(400).json({ error: strengthErr });
    return;
  }

  const account = db
    .prepare(`SELECT * FROM admin_accounts WHERE LOWER(username) = LOWER(?)`)
    .get(String(username).trim()) as
    | {
        id: string;
        username: string;
        workspace_id: string;
        is_provisioned: number;
        recovery_key_hash: string | null;
        recovery_key_salt: string | null;
      }
    | undefined;

  if (
    !account ||
    !account.is_provisioned ||
    !account.recovery_key_hash ||
    !account.recovery_key_salt ||
    !verifySecret(String(recoveryKey).trim(), account.recovery_key_hash, account.recovery_key_salt)
  ) {
    if (account) {
      recordSystemLog({
        workspaceId: account.workspace_id,
        severity: LogSeverity.WARN,
        component: 'PasswordRecovery',
        message: `Failed recovery key verification for "${account.username}" from ${ip}`,
      });
    }
    res.status(401).json({ error: 'Invalid username or cryptographic recovery key.' });
    return;
  }

  const nextPw = hashSecret(newPassword);
  const nextRawRecovery = generateRecoveryKey();
  const nextRecHash = hashSecret(nextRawRecovery);
  const now = new Date().toISOString();

  db.transaction(() => {
    db.prepare(
      `
      UPDATE admin_accounts
      SET password_hash = ?,
          password_salt = ?,
          recovery_key_hash = ?,
          recovery_key_salt = ?,
          failed_login_attempts = 0,
          is_locked = 0,
          updated_at = ?
      WHERE id = ?
    `
    ).run(nextPw.hash, nextPw.salt, nextRecHash.hash, nextRecHash.salt, now, account.id);

    // Revoke all active sessions on password reset
    db.prepare(`UPDATE admin_sessions SET revoked_at = ? WHERE admin_id = ? AND revoked_at IS NULL`).run(
      now,
      account.id
    );
  })();

  logLoginEvent({
    adminId: account.id,
    workspaceId: account.workspace_id,
    usernameAttempted: account.username,
    eventType: 'PASSWORD_RESET_COMPLETED',
    success: true,
    ipAddress: ip,
    userAgent: ua,
    detail: 'Password reset via recovery key; prior sessions revoked.',
  });

  recordAuditLog({
    workspaceId: account.workspace_id,
    adminId: account.id,
    adminUsername: account.username,
    action: 'ADMIN_PASSWORD_RESET',
    resourceType: 'ADMIN_ACCOUNT',
    resourceId: account.id,
    status: 'SUCCESS',
    ipAddress: ip,
  });

  res.json({
    ok: true,
    newRecoveryKey: nextRawRecovery,
  });
});

authRouter.post('/change-password', requireAuth, authLimiter, (req, res) => {
  const admin = req.admin!;
  const ip = getClientIp(req);
  const { currentPassword, newPassword, confirmPassword } = req.body || {};

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: 'Current password and new password are required.' });
    return;
  }
  if (newPassword !== confirmPassword) {
    res.status(400).json({ error: 'Password confirmation does not match.' });
    return;
  }

  const strengthErr = validatePasswordStrength(newPassword);
  if (strengthErr) {
    res.status(400).json({ error: strengthErr });
    return;
  }

  const row = db
    .prepare(`SELECT password_hash, password_salt FROM admin_accounts WHERE id = ? AND workspace_id = ?`)
    .get(admin.id, admin.workspaceId) as
    | { password_hash: string; password_salt: string }
    | undefined;

  if (!row || !verifySecret(currentPassword, row.password_hash, row.password_salt)) {
    recordAuditLog({
      workspaceId: admin.workspaceId,
      adminId: admin.id,
      adminUsername: admin.username,
      action: 'ADMIN_PASSWORD_CHANGE_FAILED',
      resourceType: 'ADMIN_ACCOUNT',
      resourceId: admin.id,
      status: 'FAILURE',
      ipAddress: ip,
    });
    res.status(401).json({ error: 'Current password is incorrect.' });
    return;
  }

  const nextPw = hashSecret(newPassword);
  const now = new Date().toISOString();

  db.transaction(() => {
    db.prepare(
      `UPDATE admin_accounts SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`
    ).run(nextPw.hash, nextPw.salt, now, admin.id, admin.workspaceId);

    // Revoke other sessions except current
    db.prepare(
      `UPDATE admin_sessions SET revoked_at = ? WHERE admin_id = ? AND id != ? AND revoked_at IS NULL`
    ).run(now, admin.id, admin.sessionId);
  })();

  recordAuditLog({
    workspaceId: admin.workspaceId,
    adminId: admin.id,
    adminUsername: admin.username,
    action: 'ADMIN_PASSWORD_CHANGED',
    resourceType: 'ADMIN_ACCOUNT',
    resourceId: admin.id,
    status: 'SUCCESS',
    ipAddress: ip,
  });

  res.json({ ok: true });
});

authRouter.get('/security', requireAuth, (req, res) => {
  const admin = req.admin!;
  const nowIso = new Date().toISOString();

  const loginHistory = db
    .prepare(
      `
      SELECT id, username_attempted, event_type, success, ip_address, user_agent, detail, created_at
      FROM login_history
      WHERE workspace_id = ?
      ORDER BY created_at DESC
      LIMIT 60
    `
    )
    .all(admin.workspaceId);

  const activeSessions = db
    .prepare(
      `
      SELECT s.id, s.admin_id, a.username, a.role, s.ip_address, s.user_agent, s.created_at, s.expires_at
      FROM admin_sessions s
      JOIN admin_accounts a ON a.id = s.admin_id
      WHERE s.workspace_id = ? AND s.revoked_at IS NULL AND s.expires_at > ?
      ORDER BY s.created_at DESC
    `
    )
    .all(admin.workspaceId, nowIso);

  const workspaceStaff = db
    .prepare(
      `
      SELECT id, username, display_name, role, is_owner_slot, is_provisioned, is_locked, failed_login_attempts, last_login_at, created_at
      FROM admin_accounts
      WHERE workspace_id = ?
      ORDER BY is_owner_slot DESC, created_at ASC
    `
    )
    .all(admin.workspaceId);

  res.json({
    loginHistory,
    activeSessions,
    workspaceStaff,
    currentSessionId: admin.sessionId,
  });
});

authRouter.post('/sessions/:id/revoke', requireAuth, (req, res) => {
  const admin = req.admin!;
  const targetSessionId = req.params.id;
  const ip = getClientIp(req);

  const target = db
    .prepare(`SELECT id, admin_id FROM admin_sessions WHERE id = ? AND workspace_id = ?`)
    .get(targetSessionId, admin.workspaceId) as { id: string; admin_id: string } | undefined;

  if (!target) {
    res.status(404).json({ error: 'Session not found in your workspace.' });
    return;
  }

  if (target.admin_id !== admin.id && admin.role !== AdminRole.OWNER) {
    res.status(403).json({ error: 'Only the workspace Owner can revoke another staff session.' });
    return;
  }

  db.prepare(`UPDATE admin_sessions SET revoked_at = ? WHERE id = ? AND workspace_id = ?`).run(
    new Date().toISOString(),
    targetSessionId,
    admin.workspaceId
  );

  recordAuditLog({
    workspaceId: admin.workspaceId,
    adminId: admin.id,
    adminUsername: admin.username,
    action: 'SESSION_REVOKED',
    resourceType: 'ADMIN_SESSION',
    resourceId: targetSessionId,
    status: 'SUCCESS',
    ipAddress: ip,
  });

  res.json({ ok: true });
});

authRouter.post('/staff', requireAuth, requirePermission('settings:manage'), (req, res) => {
  const admin = req.admin!;
  const ip = getClientIp(req);
  const { username, displayName, role, password } = req.body || {};

  if (admin.role !== AdminRole.OWNER) {
    res.status(403).json({ error: 'Only designated Workspace Owners can create staff accounts.' });
    return;
  }

  const cleanUser = typeof username === 'string' ? username.trim() : '';
  const cleanDisplay = typeof displayName === 'string' ? displayName.trim() : cleanUser;
  const allowedStaffRoles = [
    AdminRole.CONTENT_ADMIN,
    AdminRole.INFRA_ADMIN,
    AdminRole.SUPPORT_MOD,
    AdminRole.AUDITOR,
  ];

  if (!cleanUser || cleanUser.length < 3) {
    res.status(400).json({ error: 'Staff username must be at least 3 characters.' });
    return;
  }
  if (!allowedStaffRoles.includes(role)) {
    res.status(400).json({ error: 'Invalid delegated staff role.' });
    return;
  }

  const strengthErr = validatePasswordStrength(password);
  if (strengthErr) {
    res.status(400).json({ error: strengthErr });
    return;
  }

  const exists = db
    .prepare(`SELECT id FROM admin_accounts WHERE LOWER(username) = LOWER(?)`)
    .get(cleanUser);
  if (exists) {
    res.status(409).json({ error: 'Administrator username already exists.' });
    return;
  }

  const pwHash = hashSecret(password);
  const recKey = generateRecoveryKey();
  const recHash = hashSecret(recKey);
  const id = `staff_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  db.prepare(
    `
    INSERT INTO admin_accounts (
      id, username, display_name, role, workspace_id, is_owner_slot, is_provisioned,
      password_hash, password_salt, recovery_key_hash, recovery_key_salt, provisioned_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    id,
    cleanUser,
    cleanDisplay,
    role,
    admin.workspaceId,
    pwHash.hash,
    pwHash.salt,
    recHash.hash,
    recHash.salt,
    now,
    now,
    now
  );

  recordAuditLog({
    workspaceId: admin.workspaceId,
    adminId: admin.id,
    adminUsername: admin.username,
    action: 'STAFF_ADMIN_CREATED',
    resourceType: 'ADMIN_ACCOUNT',
    resourceId: id,
    newValue: { username: cleanUser, role, workspaceId: admin.workspaceId },
    status: 'SUCCESS',
    ipAddress: ip,
  });

  res.status(201).json({
    id,
    username: cleanUser,
    role,
    recoveryKey: recKey,
  });
});

authRouter.patch('/staff/:id', requireAuth, requirePermission('settings:manage'), (req, res) => {
  const admin = req.admin!;
  const ip = getClientIp(req);
  const staffId = req.params.id;
  const { isLocked, role } = req.body || {};

  const target = db
    .prepare(`SELECT * FROM admin_accounts WHERE id = ? AND workspace_id = ?`)
    .get(staffId, admin.workspaceId) as
    | { id: string; username: string; role: AdminRole; is_owner_slot: number; is_locked: number }
    | undefined;

  if (!target) {
    res.status(404).json({ error: 'Staff account not found in workspace.' });
    return;
  }
  if (target.is_owner_slot) {
    res.status(400).json({ error: 'Designated Owner accounts cannot be demoted or locked here.' });
    return;
  }

  const nextLocked = typeof isLocked === 'boolean' ? (isLocked ? 1 : 0) : target.is_locked;
  const nextRole = role || target.role;
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE admin_accounts SET is_locked = ?, role = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`
  ).run(nextLocked, nextRole, now, staffId, admin.workspaceId);

  if (nextLocked) {
    db.prepare(`UPDATE admin_sessions SET revoked_at = ? WHERE admin_id = ? AND revoked_at IS NULL`).run(
      now,
      staffId
    );
  }

  recordAuditLog({
    workspaceId: admin.workspaceId,
    adminId: admin.id,
    adminUsername: admin.username,
    action: 'STAFF_ADMIN_UPDATED',
    resourceType: 'ADMIN_ACCOUNT',
    resourceId: staffId,
    previousValue: { isLocked: Boolean(target.is_locked), role: target.role },
    newValue: { isLocked: Boolean(nextLocked), role: nextRole },
    status: 'SUCCESS',
    ipAddress: ip,
  });

  res.json({ ok: true });
});

import crypto from 'crypto';
import { Router } from 'express';
import { checkDatabaseLatencyMs, db } from '../db';
import {
  LogSeverity,
  ManagedUserRecord,
  ProviderHealthStatus,
  StorageHealthStatus,
  StorageServerRecord,
  TreasuryTransactionRecord,
} from '../../shared/types';
import { getClientIp, requireAuth, requirePermission } from '../security';
import { getTelemetrySummary, recordAuditLog, recordSystemLog } from '../monitoring';
import { computeLogicalStoragePool } from '../adapters/storageAdapter';
import {
  DOCUMENTED_API_CONTRACTS,
  getUpstreamConfig,
  testUpstreamKuroNamiConnection,
} from '../adapters/upstreamContract';

export const opsRouter = Router();

function maskEmail(rawEmail: string): string {
  const trimmed = rawEmail.trim();
  const atIdx = trimmed.indexOf('@');
  if (atIdx <= 1) return '***@redacted';
  const local = trimmed.slice(0, atIdx);
  const domain = trimmed.slice(atIdx + 1);
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

function getWorkspaceStoragePool(workspaceId: string) {
  const serverRows = db
    .prepare(`SELECT * FROM storage_servers WHERE workspace_id = ?`)
    .all(workspaceId) as Array<Record<string, unknown>>;

  const mapped: StorageServerRecord[] = serverRows.map((r) => ({
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    name: String(r.name),
    adapterType: r.adapter_type as StorageServerRecord['adapterType'],
    endpointUrl: String(r.endpoint_url || ''),
    bucketOrVolume: String(r.bucket_or_volume || ''),
    region: String(r.region || 'auto'),
    envCredentialPrefix: String(r.env_credential_prefix || ''),
    hasEnvCredentials: false,
    enabled: Boolean(r.enabled),
    isVerified: Boolean(r.is_verified),
    healthStatus: r.health_status as StorageHealthStatus,
    configuredCapacityBytes: Number(r.configured_capacity_bytes || 0),
    usedCapacityBytes: Number(r.used_capacity_bytes || 0),
    backupDestinationId: r.backup_destination_id ? String(r.backup_destination_id) : null,
    failedUploadsCount: Number(r.failed_uploads_count || 0),
    lastTestedAt: r.last_tested_at ? String(r.last_tested_at) : null,
    lastLatencyMs: r.last_latency_ms !== null ? Number(r.last_latency_ms) : null,
    lastError: r.last_error ? String(r.last_error) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));

  return {
    servers: mapped,
    pool: computeLogicalStoragePool(mapped),
  };
}

// ============================================================================
// OVERVIEW DASHBOARD AGGREGATOR
// ============================================================================

opsRouter.get('/overview', requireAuth, (req, res) => {
  const workspaceId = req.admin!.workspaceId;
  const upstream = getUpstreamConfig(workspaceId);
  const upstreamConnected = upstream.connectionStatus === 'CONNECTED';

  const animeCount = (
    db
      .prepare(`SELECT COUNT(*) AS cnt FROM anime_catalog WHERE workspace_id = ?`)
      .get(workspaceId) as { cnt: number }
  ).cnt;

  const episodeCount = (
    db
      .prepare(`SELECT COUNT(*) AS cnt FROM episodes WHERE workspace_id = ?`)
      .get(workspaceId) as { cnt: number }
  ).cnt;

  const syncedUsersCount = (
    db
      .prepare(`SELECT COUNT(*) AS cnt FROM managed_users WHERE workspace_id = ?`)
      .get(workspaceId) as { cnt: number }
  ).cnt;

  const providers = db
    .prepare(
      `SELECT id, name, slug, enabled, status, last_response_time_ms, failed_requests, timeout_errors, availability_percent FROM streaming_providers WHERE workspace_id = ? ORDER BY fallback_priority ASC`
    )
    .all(workspaceId) as Array<{
    id: string;
    name: string;
    slug: string;
    enabled: number;
    status: ProviderHealthStatus;
    last_response_time_ms: number | null;
    failed_requests: number;
    timeout_errors: number;
    availability_percent: number | null;
  }>;

  const activeProvidersCount = providers.filter(
    (p) => p.enabled && p.status === ProviderHealthStatus.CONNECTED
  ).length;
  const enabledProvidersCount = providers.filter((p) => p.enabled).length;

  const { servers, pool } = getWorkspaceStoragePool(workspaceId);
  const dbCheck = checkDatabaseLatencyMs();
  const telemetry = getTelemetrySummary(workspaceId);

  const treasury = db
    .prepare(`SELECT balance_cents, currency FROM treasury_accounts WHERE workspace_id = ?`)
    .get(workspaceId) as { balance_cents: number; currency: string } | undefined;

  const recentAudit = db
    .prepare(
      `SELECT id, admin_username, action, resource_type, resource_id, status, created_at FROM audit_logs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 10`
    )
    .all(workspaceId);

  // Derive genuine system warnings from actual system state
  const warnings: Array<{ severity: 'WARN' | 'ERROR'; title: string; detail: string }> = [];
  if (!upstreamConnected) {
    warnings.push({
      severity: 'WARN',
      title: 'Main KURO NAMI Backend Disconnected',
      detail:
        'Operating in standalone administrative mode. Upstream registered user telemetry and live playback streams await API connection in Admin Settings.',
    });
  }

  const unconfiguredBuiltIns = providers.filter(
    (p) => p.status === ProviderHealthStatus.NOT_CONFIGURED
  );
  if (unconfiguredBuiltIns.length > 0) {
    warnings.push({
      severity: 'WARN',
      title: `${unconfiguredBuiltIns.length} Streaming Provider(s) Unconfigured`,
      detail: `${unconfiguredBuiltIns.map((p) => p.name).join(', ')} require endpoint configuration and connectivity verification.`,
    });
  }

  const authFailedProviders = providers.filter((p) => p.status === ProviderHealthStatus.AUTH_FAILED);
  if (authFailedProviders.length > 0) {
    warnings.push({
      severity: 'ERROR',
      title: 'Streaming Provider Authentication Failure',
      detail: `${authFailedProviders.map((p) => p.name).join(', ')} failed authentication. Verify server environment API keys.`,
    });
  }

  const untestedServers = servers.filter((s) => s.enabled && !s.isVerified);
  if (untestedServers.length > 0) {
    warnings.push({
      severity: 'WARN',
      title: `${untestedServers.length} Storage Node(s) Unverified`,
      detail: `${untestedServers.map((s) => s.name).join(', ')} have not passed connectivity testing yet.`,
    });
  }

  if (pool.utilizationPercent >= 85) {
    warnings.push({
      severity: 'ERROR',
      title: 'High Logical Storage Pool Utilization',
      detail: `Storage pool is at ${pool.utilizationPercent}% capacity.`,
    });
  }

  res.json({
    upstream,
    metrics: {
      totalRegisteredUsers: upstreamConnected || syncedUsersCount > 0 ? syncedUsersCount : null,
      usersPendingUpstream: !upstreamConnected && syncedUsersCount === 0,
      totalAnimeTitles: animeCount,
      totalEpisodes: episodeCount,
      activeStreamingProviders: activeProvidersCount,
      enabledStreamingProviders: enabledProvidersCount,
      totalStreamingProviders: providers.length,
      configuredStorageServers: servers.length,
      verifiedStorageServers: pool.verifiedConnectedServers,
      storagePool: pool,
      failedPlaybackOrResolutionRequests: providers.reduce((s, p) => s + p.failed_requests, 0),
      playbackPendingUpstream: !upstreamConnected,
      treasuryBalanceCents: treasury?.balance_cents ?? 0,
      treasuryCurrency: treasury?.currency ?? 'USD',
    },
    apiHealth: {
      adminBackendHealthy: true,
      sqliteConnected: dbCheck.ok,
      sqliteLatencyMs: dbCheck.latencyMs,
      avgRequestLatencyMs: telemetry.avgLatencyMs,
      failedApiRequests: telemetry.failedApiRequests,
      upstreamStatus: upstream.connectionStatus,
    },
    providersSummary: providers,
    recentAudit,
    warnings,
  });
});

// ============================================================================
// USER MANAGEMENT (NO PASSWORD EXPOSURE, WORKSPACE ISOLATED)
// ============================================================================

opsRouter.get('/users', requireAuth, requirePermission('users:read'), (req, res) => {
  const workspaceId = req.admin!.workspaceId;
  const search = String(req.query.search || '').trim().toLowerCase();
  const statusFilter = String(req.query.status || '').trim();
  const upstream = getUpstreamConfig(workspaceId);

  const rows = db
    .prepare(`SELECT * FROM managed_users WHERE workspace_id = ? ORDER BY registered_at DESC`)
    .all(workspaceId) as Array<Record<string, unknown>>;

  let items: ManagedUserRecord[] = rows.map((r) => {
    let restrictions: string[] = [];
    let reports: ManagedUserRecord['reports'] = [];
    try {
      restrictions = JSON.parse(String(r.restrictions_json || '[]'));
    } catch {
      restrictions = [];
    }
    try {
      reports = JSON.parse(String(r.reports_json || '[]'));
    } catch {
      reports = [];
    }

    return {
      id: String(r.id),
      workspaceId: String(r.workspace_id),
      upstreamUserId: String(r.upstream_user_id),
      username: String(r.username),
      emailMasked: String(r.email_masked),
      accountStatus: (r.account_status as ManagedUserRecord['accountStatus']) || 'ACTIVE',
      restrictions,
      suspensionReason: r.suspension_reason ? String(r.suspension_reason) : null,
      registeredAt: String(r.registered_at),
      lastActiveAt: r.last_active_at ? String(r.last_active_at) : null,
      activityCount: Number(r.activity_count || 0),
      openReportsCount: reports.filter((rep) => !rep.resolved).length,
      reports,
      syncedAt: String(r.synced_at),
    };
  });

  if (search) {
    items = items.filter((u) =>
      [u.username, u.upstreamUserId, u.emailMasked].join(' ').toLowerCase().includes(search)
    );
  }
  if (statusFilter && statusFilter !== 'ALL') {
    items = items.filter((u) => u.accountStatus === statusFilter);
  }

  res.json({
    upstreamConnectionStatus: upstream.connectionStatus,
    items,
  });
});

// Allows importing/registering an upstream user moderation record via contract payload (never stores passwords)
opsRouter.post('/users/sync-record', requireAuth, requirePermission('users:write'), (req, res) => {
  const admin = req.admin!;
  const ip = getClientIp(req);
  const { upstreamUserId, username, email, registeredAt } = req.body || {};

  const cleanUpstreamId = typeof upstreamUserId === 'string' ? upstreamUserId.trim() : '';
  const cleanUsername = typeof username === 'string' ? username.trim() : '';
  if (!cleanUpstreamId || !cleanUsername) {
    res.status(400).json({ error: 'Upstream user ID and username are required.' });
    return;
  }

  const masked = typeof email === 'string' && email.includes('@') ? maskEmail(email) : '***@redacted';
  const id = `usr_${crypto.randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();
  const regDate = registeredAt ? String(registeredAt) : now;

  try {
    db.prepare(
      `
      INSERT INTO managed_users (
        id, workspace_id, upstream_user_id, username, email_masked, account_status,
        restrictions_json, registered_at, synced_at
      ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', '[]', ?, ?)
    `
    ).run(id, admin.workspaceId, cleanUpstreamId, cleanUsername, masked, regDate, now);
  } catch {
    res.status(409).json({ error: 'Upstream user ID already exists in this workspace directory.' });
    return;
  }

  recordAuditLog({
    workspaceId: admin.workspaceId,
    adminId: admin.id,
    adminUsername: admin.username,
    action: 'USER_RECORD_REGISTERED',
    resourceType: 'PLATFORM_USER',
    resourceId: id,
    newValue: { upstreamUserId: cleanUpstreamId, username: cleanUsername },
    status: 'SUCCESS',
    ipAddress: ip,
  });

  res.status(201).json({ id, upstreamUserId: cleanUpstreamId, username: cleanUsername });
});

opsRouter.patch('/users/:id/moderation', requireAuth, requirePermission('users:write'), (req, res) => {
  const admin = req.admin!;
  const ip = getClientIp(req);
  const userId = req.params.id;
  const { accountStatus, suspensionReason, restrictions, resolveReportId, addReport } = req.body || {};

  const existing = db
    .prepare(`SELECT * FROM managed_users WHERE id = ? AND workspace_id = ?`)
    .get(userId, admin.workspaceId) as Record<string, unknown> | undefined;

  if (!existing) {
    res.status(404).json({ error: 'User record not found in your workspace.' });
    return;
  }

  const allowedStatuses = ['ACTIVE', 'SUSPENDED', 'RESTRICTED'];
  const nextStatus = allowedStatuses.includes(accountStatus)
    ? accountStatus
    : String(existing.account_status);

  const nextReason =
    nextStatus === 'SUSPENDED'
      ? String(suspensionReason || existing.suspension_reason || 'Policy violation')
      : null;

  const nextRestrictions: string[] = Array.isArray(restrictions)
    ? restrictions.map((r: unknown) => String(r).trim()).filter(Boolean)
    : JSON.parse(String(existing.restrictions_json || '[]'));

  let reports: ManagedUserRecord['reports'] = [];
  try {
    reports = JSON.parse(String(existing.reports_json || '[]'));
  } catch {
    reports = [];
  }

  if (resolveReportId) {
    reports = reports.map((rep) =>
      rep.id === resolveReportId ? { ...rep, resolved: true } : rep
    );
  }

  if (addReport && typeof addReport.summary === 'string' && addReport.summary.trim()) {
    reports.unshift({
      id: `rep_${crypto.randomUUID().slice(0, 8)}`,
      category: String(addReport.category || 'Playback / Conduct'),
      summary: addReport.summary.trim(),
      reportedAt: new Date().toISOString(),
      resolved: false,
    });
  }

  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE managed_users
    SET account_status = ?, suspension_reason = ?, restrictions_json = ?, reports_json = ?, synced_at = ?
    WHERE id = ? AND workspace_id = ?
  `
  ).run(
    nextStatus,
    nextReason,
    JSON.stringify(nextRestrictions),
    JSON.stringify(reports),
    now,
    userId,
    admin.workspaceId
  );

  recordAuditLog({
    workspaceId: admin.workspaceId,
    adminId: admin.id,
    adminUsername: admin.username,
    action: 'USER_MODERATION_UPDATED',
    resourceType: 'PLATFORM_USER',
    resourceId: userId,
    previousValue: { status: existing.account_status, restrictions: existing.restrictions_json },
    newValue: { status: nextStatus, suspensionReason: nextReason, restrictions: nextRestrictions },
    status: 'SUCCESS',
    ipAddress: ip,
  });

  res.json({ ok: true });
});

// ============================================================================
// ASSET TREASURY & FINANCIAL CONTROLS (INITIAL BALANCE STRICTLY ZERO)
// ============================================================================

opsRouter.get('/treasury', requireAuth, requirePermission('treasury:read'), (req, res) => {
  const workspaceId = req.admin!.workspaceId;

  const account = db
    .prepare(`SELECT * FROM treasury_accounts WHERE workspace_id = ?`)
    .get(workspaceId) as
    | { workspace_id: string; balance_cents: number; currency: string; updated_at: string }
    | undefined;

  const txRows = db
    .prepare(
      `SELECT * FROM treasury_transactions WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 100`
    )
    .all(workspaceId) as Array<Record<string, unknown>>;

  const transactions: TreasuryTransactionRecord[] = txRows.map((t) => ({
    id: String(t.id),
    workspaceId: String(t.workspace_id),
    type: t.type as 'DEPOSIT' | 'WITHDRAWAL',
    amountCents: Number(t.amount_cents),
    balanceBeforeCents: Number(t.balance_before_cents),
    balanceAfterCents: Number(t.balance_after_cents),
    currency: String(t.currency),
    referenceCode: String(t.reference_code),
    description: String(t.description),
    authorizedByAdminId: String(t.authorized_by_admin_id),
    authorizedByUsername: String(t.authorized_by_username),
    createdAt: String(t.created_at),
  }));

  res.json({
    balanceCents: account?.balance_cents ?? 0,
    currency: account?.currency ?? 'USD',
    updatedAt: account?.updated_at ?? null,
    transactions,
  });
});

opsRouter.post(
  '/treasury/transactions',
  requireAuth,
  requirePermission('treasury:write'),
  (req, res) => {
    const admin = req.admin!;
    const ip = getClientIp(req);
    const { type, amountDollars, description, referenceCode } = req.body || {};

    if (type !== 'DEPOSIT' && type !== 'WITHDRAWAL') {
      res.status(400).json({ error: 'Transaction type must be DEPOSIT or WITHDRAWAL.' });
      return;
    }

    const parsedAmount = Number(amountDollars);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      res.status(400).json({ error: 'Transaction amount must be greater than 0.00.' });
      return;
    }

    const amountCents = Math.round(parsedAmount * 100);
    if (amountCents <= 0) {
      res.status(400).json({ error: 'Minimum transaction granularity is 0.01.' });
      return;
    }

    const cleanDesc = typeof description === 'string' ? description.trim() : '';
    if (cleanDesc.length < 4) {
      res.status(400).json({ error: 'A descriptive transaction reason (min 4 chars) is required.' });
      return;
    }

    const cleanRef =
      typeof referenceCode === 'string' && referenceCode.trim()
        ? referenceCode.trim()
        : `TR-${Date.now().toString(36).toUpperCase()}`;

    const txId = `ttx_${crypto.randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();

    let resultRecord: TreasuryTransactionRecord | null = null;

    try {
      const executeLedgerTx = db.transaction(() => {
        const account = db
          .prepare(`SELECT balance_cents, currency FROM treasury_accounts WHERE workspace_id = ?`)
          .get(admin.workspaceId) as { balance_cents: number; currency: string } | undefined;

        const balanceBefore = account?.balance_cents ?? 0;
        const currency = account?.currency ?? 'USD';
        const balanceAfter =
          type === 'DEPOSIT' ? balanceBefore + amountCents : balanceBefore - amountCents;

        if (balanceAfter < 0) {
          throw new Error('INSUFFICIENT_TREASURY_FUNDS');
        }

        db.prepare(
          `UPDATE treasury_accounts SET balance_cents = ?, updated_at = ? WHERE workspace_id = ?`
        ).run(balanceAfter, now, admin.workspaceId);

        db.prepare(
          `
          INSERT INTO treasury_transactions (
            id, workspace_id, type, amount_cents, balance_before_cents, balance_after_cents,
            currency, reference_code, description, authorized_by_admin_id, authorized_by_username, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        ).run(
          txId,
          admin.workspaceId,
          type,
          amountCents,
          balanceBefore,
          balanceAfter,
          currency,
          cleanRef,
          cleanDesc,
          admin.id,
          admin.username,
          now
        );

        resultRecord = {
          id: txId,
          workspaceId: admin.workspaceId,
          type,
          amountCents,
          balanceBeforeCents: balanceBefore,
          balanceAfterCents: balanceAfter,
          currency,
          referenceCode: cleanRef,
          description: cleanDesc,
          authorizedByAdminId: admin.id,
          authorizedByUsername: admin.username,
          createdAt: now,
        };
      });

      executeLedgerTx();
    } catch (err: unknown) {
      const isOverdraft = err instanceof Error && err.message === 'INSUFFICIENT_TREASURY_FUNDS';
      recordAuditLog({
        workspaceId: admin.workspaceId,
        adminId: admin.id,
        adminUsername: admin.username,
        action: `TREASURY_${type}_REJECTED`,
        resourceType: 'TREASURY',
        newValue: { amountCents, referenceCode: cleanRef, reason: isOverdraft ? 'Insufficient balance' : 'DB error' },
        status: 'FAILURE',
        ipAddress: ip,
      });

      res.status(isOverdraft ? 409 : 500).json({
        error: isOverdraft
          ? 'Withdrawal exceeds available workspace treasury balance.'
          : 'Failed to execute treasury transaction.',
      });
      return;
    }

    recordAuditLog({
      workspaceId: admin.workspaceId,
      adminId: admin.id,
      adminUsername: admin.username,
      action: `TREASURY_${type}`,
      resourceType: 'TREASURY',
      resourceId: txId,
      previousValue: { balanceCents: resultRecord!.balanceBeforeCents },
      newValue: {
        balanceCents: resultRecord!.balanceAfterCents,
        amountCents,
        referenceCode: cleanRef,
        description: cleanDesc,
      },
      status: 'SUCCESS',
      ipAddress: ip,
    });

    res.status(201).json(resultRecord);
  }
);

// ============================================================================
// ANALYTICS & REPORTING (ACTUAL CONNECTED DATA ONLY, NO FAKE SERIES)
// ============================================================================

opsRouter.get('/analytics', requireAuth, requirePermission('analytics:read'), (req, res) => {
  const workspaceId = req.admin!.workspaceId;
  const fromDate = String(req.query.from || '').trim();
  const toDate = String(req.query.to || '').trim();
  const upstream = getUpstreamConfig(workspaceId);

  const dateClause =
    fromDate && toDate ? ` AND created_at >= ? AND created_at <= ?` : '';
  const dateParams = fromDate && toDate ? [`${fromDate}T00:00:00.000Z`, `${toDate}T23:59:59.999Z`] : [];

  // Administrative activity grouped by day (actual audit records)
  const adminActivityByDay = db
    .prepare(
      `
      SELECT substr(created_at, 1, 10) AS day,
             COUNT(*) AS actions_count,
             SUM(CASE WHEN status = 'FAILURE' THEN 1 ELSE 0 END) AS failed_count
      FROM audit_logs
      WHERE workspace_id = ? ${dateClause}
      GROUP BY substr(created_at, 1, 10)
      ORDER BY day ASC
    `
    )
    .all(workspaceId, ...dateParams);

  // User registration trends from actual synced managed_users
  const userRegistrationsByDay = db
    .prepare(
      `
      SELECT substr(registered_at, 1, 10) AS day, COUNT(*) AS registrations
      FROM managed_users
      WHERE workspace_id = ?
      GROUP BY substr(registered_at, 1, 10)
      ORDER BY day ASC
    `
    )
    .all(workspaceId);

  // Provider performance from actual provider records
  const providerPerformance = db
    .prepare(
      `
      SELECT name, slug, status, last_response_time_ms, total_requests, failed_requests,
             timeout_errors, resolution_attempts, resolution_successes, availability_percent
      FROM streaming_providers
      WHERE workspace_id = ?
      ORDER BY fallback_priority ASC
    `
    )
    .all(workspaceId);

  const { servers, pool } = getWorkspaceStoragePool(workspaceId);
  const telemetry = getTelemetrySummary(workspaceId);

  res.json({
    upstreamConnected: upstream.connectionStatus === 'CONNECTED',
    upstreamStatus: upstream.connectionStatus,
    adminActivityByDay,
    userRegistrationsByDay,
    providerPerformance,
    storageUsage: {
      pool,
      servers: servers.map((s) => ({
        name: s.name,
        adapterType: s.adapterType,
        configuredBytes: s.configuredCapacityBytes,
        usedBytes: s.usedCapacityBytes,
        enabled: s.enabled,
        isVerified: s.isVerified,
      })),
    },
    apiLatencySamples: telemetry.recentSamples,
    // Most-watched anime/episodes and live playback telemetry require main KURO NAMI upstream connection
    playbackTelemetry: {
      availableFromUpstream: upstream.connectionStatus === 'CONNECTED',
      mostWatchedAnime: [],
      mostWatchedEpisodes: [],
      note:
        upstream.connectionStatus === 'CONNECTED'
          ? 'Connected to upstream telemetry bridge.'
          : 'Awaiting connection to main KURO NAMI playback telemetry endpoint (/admin-bridge/v1/analytics/playback-summary).',
    },
  });
});

// ============================================================================
// SYSTEM MONITORING & AUDIT LOGS
// ============================================================================

opsRouter.get('/monitoring', requireAuth, requirePermission('monitoring:read'), (req, res) => {
  const workspaceId = req.admin!.workspaceId;
  const severity = String(req.query.severity || '').trim();
  const search = String(req.query.search || '').trim().toLowerCase();

  const dbHealth = checkDatabaseLatencyMs();
  const telemetry = getTelemetrySummary(workspaceId);
  const upstream = getUpstreamConfig(workspaceId);
  const { servers, pool } = getWorkspaceStoragePool(workspaceId);

  const providers = db
    .prepare(
      `SELECT id, name, slug, enabled, status, last_response_time_ms, last_tested_at, last_error_message FROM streaming_providers WHERE workspace_id = ? ORDER BY fallback_priority ASC`
    )
    .all(workspaceId);

  const authFailuresCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM login_history WHERE (workspace_id = ? OR workspace_id IS NULL) AND success = 0`
      )
      .get(workspaceId) as { cnt: number }
  ).cnt;

  let sysLogs = db
    .prepare(
      `
      SELECT id, workspace_id, severity, component, message, metadata_json, created_at
      FROM system_logs
      WHERE workspace_id = ? OR workspace_id IS NULL
      ORDER BY created_at DESC
      LIMIT 200
    `
    )
    .all(workspaceId) as Array<{
    id: string;
    workspace_id: string | null;
    severity: LogSeverity;
    component: string;
    message: string;
    metadata_json: string | null;
    created_at: string;
  }>;

  if (severity && severity !== 'ALL') {
    sysLogs = sysLogs.filter((l) => l.severity === severity);
  }
  if (search) {
    sysLogs = sysLogs.filter((l) =>
      `${l.component} ${l.message} ${l.severity}`.toLowerCase().includes(search)
    );
  }

  res.json({
    runtime: {
      status: dbHealth.ok ? 'OPERATIONAL' : 'DEGRADED',
      uptimeSeconds: Math.floor(process.uptime()),
      nodeVersion: process.version,
      memoryRssBytes: process.memoryUsage().rss,
      sqliteConnected: dbHealth.ok,
      sqliteLatencyMs: dbHealth.latencyMs,
    },
    telemetry,
    authFailuresCount,
    upstream,
    providers,
    storageServers: servers,
    storagePool: pool,
    logs: sysLogs.map((l) => ({
      id: l.id,
      workspaceId: l.workspace_id,
      severity: l.severity,
      component: l.component,
      message: l.message,
      metadataJson: l.metadata_json,
      createdAt: l.created_at,
    })),
  });
});

opsRouter.get('/audit-logs', requireAuth, requirePermission('audit:read'), (req, res) => {
  const workspaceId = req.admin!.workspaceId;
  const search = String(req.query.search || '').trim().toLowerCase();
  const statusFilter = String(req.query.status || '').trim();
  const resourceFilter = String(req.query.resourceType || '').trim();

  const rows = db
    .prepare(
      `SELECT * FROM audit_logs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 250`
    )
    .all(workspaceId) as Array<Record<string, unknown>>;

  let items = rows.map((r) => ({
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    adminId: r.admin_id ? String(r.admin_id) : null,
    adminUsername: String(r.admin_username),
    action: String(r.action),
    resourceType: String(r.resource_type),
    resourceId: r.resource_id ? String(r.resource_id) : null,
    previousValue: r.previous_value ? String(r.previous_value) : null,
    newValue: r.new_value ? String(r.new_value) : null,
    status: (r.status as 'SUCCESS' | 'FAILURE') || 'SUCCESS',
    ipAddress: String(r.ip_address),
    createdAt: String(r.created_at),
  }));

  if (statusFilter && statusFilter !== 'ALL') {
    items = items.filter((a) => a.status === statusFilter);
  }
  if (resourceFilter && resourceFilter !== 'ALL') {
    items = items.filter((a) => a.resourceType === resourceFilter);
  }
  if (search) {
    items = items.filter((a) =>
      [a.adminUsername, a.action, a.resourceType, a.resourceId || '', a.ipAddress]
        .join(' ')
        .toLowerCase()
        .includes(search)
    );
  }

  res.json({ items });
});

// ============================================================================
// FUTURE KURO NAMI UPSTREAM INTEGRATION & CONTRACTS
// ============================================================================

opsRouter.get('/integration', requireAuth, (req, res) => {
  const workspaceId = req.admin!.workspaceId;
  const config = getUpstreamConfig(workspaceId);

  res.json({
    config,
    contracts: DOCUMENTED_API_CONTRACTS,
  });
});

opsRouter.put('/integration', requireAuth, requirePermission('settings:manage'), (req, res) => {
  const admin = req.admin!;
  const ip = getClientIp(req);
  const { baseUrl, healthPath, apiVersion, envApiKeyVar, syncMode } = req.body || {};

  const prev = getUpstreamConfig(admin.workspaceId);
  const cleanUrl = typeof baseUrl === 'string' ? baseUrl.trim() : prev.baseUrl;
  const cleanHealth =
    typeof healthPath === 'string' && healthPath.trim() ? healthPath.trim() : prev.healthPath;
  const cleanVer =
    typeof apiVersion === 'string' && apiVersion.trim() ? apiVersion.trim() : prev.apiVersion;
  const cleanEnvVar =
    typeof envApiKeyVar === 'string' && envApiKeyVar.trim()
      ? envApiKeyVar.trim().replace(/[^A-Z0-9_]/gi, '')
      : prev.envApiKeyVar;

  const allowedModes = ['DISCONNECTED', 'READ_ONLY_VERIFY', 'CONTROLLED_SYNC'];
  const nextMode = allowedModes.includes(syncMode) ? syncMode : prev.syncMode;

  // Reset verified status if endpoint changed so we never claim connection without testing
  const nextStatus =
    !cleanUrl || nextMode === 'DISCONNECTED'
      ? 'NOT_CONNECTED'
      : cleanUrl !== prev.baseUrl
        ? 'NOT_CONNECTED'
        : prev.connectionStatus;

  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE integration_configs
    SET base_url = ?, health_path = ?, api_version = ?, env_api_key_var = ?,
        sync_mode = ?, connection_status = ?, updated_at = ?
    WHERE workspace_id = ?
  `
  ).run(cleanUrl, cleanHealth, cleanVer, cleanEnvVar, nextMode, nextStatus, now, admin.workspaceId);

  recordAuditLog({
    workspaceId: admin.workspaceId,
    adminId: admin.id,
    adminUsername: admin.username,
    action: 'UPSTREAM_INTEGRATION_UPDATED',
    resourceType: 'INTEGRATION_CONFIG',
    resourceId: admin.workspaceId,
    previousValue: { baseUrl: prev.baseUrl, syncMode: prev.syncMode },
    newValue: { baseUrl: cleanUrl, syncMode: nextMode, healthPath: cleanHealth },
    status: 'SUCCESS',
    ipAddress: ip,
  });

  res.json({ config: getUpstreamConfig(admin.workspaceId) });
});

opsRouter.post(
  '/integration/test',
  requireAuth,
  requirePermission('settings:manage'),
  async (req, res) => {
    const admin = req.admin!;
    const ip = getClientIp(req);
    const current = getUpstreamConfig(admin.workspaceId);

    const probe = await testUpstreamKuroNamiConnection({
      workspaceId: admin.workspaceId,
      baseUrl: current.baseUrl,
      healthPath: current.healthPath,
      envApiKeyVar: current.envApiKeyVar,
    });

    const now = new Date().toISOString();
    db.prepare(
      `
      UPDATE integration_configs
      SET connection_status = ?, last_tested_at = ?, last_latency_ms = ?, last_status_message = ?, updated_at = ?
      WHERE workspace_id = ?
    `
    ).run(
      probe.connectionStatus,
      now,
      probe.latencyMs,
      probe.statusMessage,
      now,
      admin.workspaceId
    );

    if (probe.connectionStatus !== 'CONNECTED') {
      recordSystemLog({
        workspaceId: admin.workspaceId,
        severity: LogSeverity.WARN,
        component: 'UpstreamBridge',
        message: probe.statusMessage,
      });
    }

    recordAuditLog({
      workspaceId: admin.workspaceId,
      adminId: admin.id,
      adminUsername: admin.username,
      action: 'UPSTREAM_CONNECTION_TESTED',
      resourceType: 'INTEGRATION_CONFIG',
      resourceId: admin.workspaceId,
      newValue: {
        connectionStatus: probe.connectionStatus,
        latencyMs: probe.latencyMs,
        message: probe.statusMessage,
      },
      status: probe.connectionStatus === 'CONNECTED' ? 'SUCCESS' : 'FAILURE',
      ipAddress: ip,
    });

    res.json({
      probe,
      config: getUpstreamConfig(admin.workspaceId),
    });
  }
);

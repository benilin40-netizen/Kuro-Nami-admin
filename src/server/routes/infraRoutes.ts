import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import multer from 'multer';
import { db, uploadsDir } from '../db';
import {
  AssetCategory,
  AssetRecord,
  LogSeverity,
  ProviderHealthStatus,
  StorageAdapterType,
  StorageHealthStatus,
  StorageServerRecord,
  StreamingProviderRecord,
} from '../../shared/types';
import { getClientIp, requireAuth, requirePermission, sha256Hex } from '../security';
import { recordAuditLog, recordSystemLog } from '../monitoring';
import { hasServerEnvSecret, probeStreamingProvider } from '../adapters/providerAdapter';
import {
  computeLogicalStoragePool,
  getStorageAdapter,
  hasStorageEnvCredentials,
  recalculateServerUsedCapacity,
} from '../adapters/storageAdapter';

export const infraRouter = Router();

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'text/vtt',
  'text/plain',
  'application/x-subrip',
  'video/mp4',
  'video/webm',
  'application/json',
]);

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 12);
    cb(null, `asset_${crypto.randomUUID()}${ext}`);
  },
});

const uploadMiddleware = multer({
  storage: uploadStorage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB secure administrative limit
  },
  fileFilter: (_req, file, cb) => {
    const extLower = path.extname(file.originalname).toLowerCase();
    const isSubtitleExt = ['.srt', '.vtt', '.ass', '.ssa'].includes(extLower);
    if (ALLOWED_MIME_TYPES.has(file.mimetype) || isSubtitleExt) {
      cb(null, true);
    } else {
      cb(new Error(`Disallowed file MIME type: ${file.mimetype}`));
    }
  },
});

function mapProviderRow(row: Record<string, unknown>): StreamingProviderRecord {
  const envVar = String(row.env_secret_var || '');
  let capabilities = { dns: false, tls: false, http: false, api: false, auth: false, search: false, episodes: false, playback: false };
  try {
    if (typeof row.capabilities_json === 'string') {
      capabilities = JSON.parse(row.capabilities_json);
    }
  } catch {}

  let diagnosticDetails = {};
  try {
    if (typeof row.diagnostic_details_json === 'string') {
      diagnosticDetails = JSON.parse(row.diagnostic_details_json);
    }
  } catch {}

  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    slug: String(row.slug),
    name: String(row.name),
    websiteUrl: String(row.website_url || ''),
    integrationType: String(row.integration_type || 'Standard API'),
    isBuiltIn: Boolean(row.is_built_in),
    baseUrl: String(row.base_url || ''),
    healthEndpoint: String(row.health_endpoint || '/'),
    envSecretVar: envVar,
    hasEnvSecret: hasServerEnvSecret(envVar),
    enabled: Boolean(row.enabled),
    status: (row.status as ProviderHealthStatus) || ProviderHealthStatus.NOT_CONFIGURED,
    timeoutMs: Number(row.timeout_ms || 8000),
    retryCount: Number(row.retry_count || 2),
    fallbackPriority: Number(row.fallback_priority || 1),
    lastResponseTimeMs:
      row.last_response_time_ms !== null && row.last_response_time_ms !== undefined
        ? Number(row.last_response_time_ms)
        : null,
    totalRequests: Number(row.total_requests || 0),
    failedRequests: Number(row.failed_requests || 0),
    timeoutErrors: Number(row.timeout_errors || 0),
    resolutionAttempts: Number(row.resolution_attempts || 0),
    resolutionSuccesses: Number(row.resolution_successes || 0),
    availabilityPercent:
      row.availability_percent !== null && row.availability_percent !== undefined
        ? Number(row.availability_percent)
        : null,
    lastTestedAt: row.last_tested_at ? String(row.last_tested_at) : null,
    lastErrorMessage: row.last_error_message ? String(row.last_error_message) : null,
    capabilities,
    diagnosticDetails,
    updatedAt: String(row.updated_at),
  };
}

function mapStorageRow(row: Record<string, unknown>): StorageServerRecord {
  const adapterType =
    (row.adapter_type as StorageAdapterType) || StorageAdapterType.S3_COMPATIBLE;
  const prefix = String(row.env_credential_prefix || '');
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    adapterType,
    endpointUrl: String(row.endpoint_url || ''),
    bucketOrVolume: String(row.bucket_or_volume || ''),
    region: String(row.region || 'auto'),
    envCredentialPrefix: prefix,
    hasEnvCredentials: hasStorageEnvCredentials(prefix, adapterType),
    enabled: Boolean(row.enabled),
    isVerified: Boolean(row.is_verified),
    healthStatus: (row.health_status as StorageHealthStatus) || StorageHealthStatus.UNTESTED,
    configuredCapacityBytes: Number(row.configured_capacity_bytes || 0),
    usedCapacityBytes: Number(row.used_capacity_bytes || 0),
    backupDestinationId: row.backup_destination_id ? String(row.backup_destination_id) : null,
    failedUploadsCount: Number(row.failed_uploads_count || 0),
    assignedAssetsCount: Number(row.assigned_assets_count || 0),
    lastTestedAt: row.last_tested_at ? String(row.last_tested_at) : null,
    lastLatencyMs:
      row.last_latency_ms !== null && row.last_latency_ms !== undefined
        ? Number(row.last_latency_ms)
        : null,
    lastError: row.last_error ? String(row.last_error) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function getAssetReferences(workspaceId: string, assetId: string): string[] {
  const refs: string[] = [];
  const animeRefs = db
    .prepare(
      `SELECT id, title FROM anime_catalog WHERE workspace_id = ? AND (poster_asset_id = ? OR background_asset_id = ?)`
    )
    .all(workspaceId, assetId, assetId) as Array<{ id: string; title: string }>;

  for (const a of animeRefs) {
    refs.push(`Anime: ${a.title} (${a.id})`);
  }

  const epRefs = db
    .prepare(
      `SELECT id, title, episode_number FROM episodes WHERE workspace_id = ? AND (thumbnail_asset_id = ? OR subtitle_asset_id = ? OR video_asset_id = ?)`
    )
    .all(workspaceId, assetId, assetId, assetId) as Array<{
    id: string;
    title: string;
    episode_number: number;
  }>;

  for (const e of epRefs) {
    refs.push(`Episode ${e.episode_number}: ${e.title} (${e.id})`);
  }

  return refs;
}

// ============================================================================
// STREAMING PROVIDER MANAGEMENT
// ============================================================================

infraRouter.get('/providers', requireAuth, requirePermission('infra:read'), (req, res) => {
  const workspaceId = req.admin!.workspaceId;
  const rows = db
    .prepare(
      `SELECT * FROM streaming_providers WHERE workspace_id = ? ORDER BY fallback_priority ASC, name ASC`
    )
    .all(workspaceId) as Array<Record<string, unknown>>;

  const logs = db
    .prepare(
      `SELECT * FROM provider_logs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 80`
    )
    .all(workspaceId);

  res.json({
    providers: rows.map(mapProviderRow),
    logs,
  });
});

infraRouter.post('/providers', requireAuth, requirePermission('infra:write'), (req, res) => {
  const admin = req.admin!;
  const ip = getClientIp(req);
  const body = req.body || {};

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    res.status(400).json({ error: 'Provider name is required.' });
    return;
  }

  const slug =
    typeof body.slug === 'string' && body.slug.trim()
      ? body.slug
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_.-]/g, '_')
      : name.toLowerCase().replace(/[^a-z0-9_.-]/g, '_');

  const exists = db
    .prepare(`SELECT id FROM streaming_providers WHERE workspace_id = ? AND slug = ?`)
    .get(admin.workspaceId, slug);
  if (exists) {
    res.status(409).json({ error: `Provider with slug "${slug}" already exists in workspace.` });
    return;
  }

  const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
  const healthEndpoint =
    typeof body.healthEndpoint === 'string' && body.healthEndpoint.trim()
      ? body.healthEndpoint.trim()
      : '/';
  const envSecretVar =
    typeof body.envSecretVar === 'string'
      ? body.envSecretVar.trim().replace(/[^A-Z0-9_]/gi, '')
      : '';
  const enabled = Boolean(body.enabled);
  const timeoutMs = Math.max(1000, Math.min(30000, Number(body.timeoutMs) || 8000));
  const retryCount = Math.max(0, Math.min(5, Number(body.retryCount) ?? 2));
  const fallbackPriority = Math.max(1, Number(body.fallbackPriority) || 5);

  const initialStatus = baseUrl
    ? ProviderHealthStatus.CONFIGURED_UNREACHABLE
    : ProviderHealthStatus.NOT_CONFIGURED;
  const id = `prov_${crypto.randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();

  db.prepare(
    `
    INSERT INTO streaming_providers (
      id, workspace_id, slug, name, is_built_in, base_url, health_endpoint,
      env_secret_var, enabled, status, timeout_ms, retry_count, fallback_priority, updated_at
    ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    id,
    admin.workspaceId,
    slug,
    name,
    baseUrl,
    healthEndpoint,
    envSecretVar,
    enabled ? 1 : 0,
    initialStatus,
    timeoutMs,
    retryCount,
    fallbackPriority,
    now
  );

  recordAuditLog({
    workspaceId: admin.workspaceId,
    adminId: admin.id,
    adminUsername: admin.username,
    action: 'STREAMING_PROVIDER_ADDED',
    resourceType: 'STREAMING_PROVIDER',
    resourceId: id,
    newValue: { name, slug, baseUrl, envSecretVar, timeoutMs, retryCount, fallbackPriority },
    status: 'SUCCESS',
    ipAddress: ip,
  });

  const created = db
    .prepare(`SELECT * FROM streaming_providers WHERE id = ?`)
    .get(id) as Record<string, unknown>;
  res.status(201).json(mapProviderRow(created));
});

infraRouter.put('/providers/:id', requireAuth, requirePermission('infra:write'), (req, res) => {
  const admin = req.admin!;
  const ip = getClientIp(req);
  const providerId = req.params.id;
  const body = req.body || {};

  const existingRow = db
    .prepare(`SELECT * FROM streaming_providers WHERE id = ? AND workspace_id = ?`)
    .get(providerId, admin.workspaceId) as Record<string, unknown> | undefined;

  if (!existingRow) {
    res.status(404).json({ error: 'Provider configuration not found.' });
    return;
  }

  const prev = mapProviderRow(existingRow);
  const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : prev.baseUrl;
  const healthEndpoint =
    typeof body.healthEndpoint === 'string' && body.healthEndpoint.trim()
      ? body.healthEndpoint.trim()
      : prev.healthEndpoint;
  const envSecretVar =
    typeof body.envSecretVar === 'string'
      ? body.envSecretVar.trim().replace(/[^A-Z0-9_]/gi, '')
      : prev.envSecretVar;
  const enabled = typeof body.enabled === 'boolean' ? body.enabled : prev.enabled;
  const timeoutMs =
    body.timeoutMs !== undefined
      ? Math.max(1000, Math.min(30000, Number(body.timeoutMs) || 8000))
      : prev.timeoutMs;
  const retryCount =
    body.retryCount !== undefined
      ? Math.max(0, Math.min(5, Number(body.retryCount) || 0))
      : prev.retryCount;
  const fallbackPriority =
    body.fallbackPriority !== undefined
      ? Math.max(1, Number(body.fallbackPriority) || 1)
      : prev.fallbackPriority;

  // Never falsely mark connected on config change; require connectivity test
  let nextStatus = prev.status;
  if (!baseUrl) {
    nextStatus = ProviderHealthStatus.NOT_CONFIGURED;
  } else if (baseUrl !== prev.baseUrl || envSecretVar !== prev.envSecretVar) {
    nextStatus = ProviderHealthStatus.CONFIGURED_UNREACHABLE;
  }

  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE streaming_providers
    SET base_url = ?, health_endpoint = ?, env_secret_var = ?, enabled = ?,
        status = ?, timeout_ms = ?, retry_count = ?, fallback_priority = ?, updated_at = ?
    WHERE id = ? AND workspace_id = ?
  `
  ).run(
    baseUrl,
    healthEndpoint,
    envSecretVar,
    enabled ? 1 : 0,
    nextStatus,
    timeoutMs,
    retryCount,
    fallbackPriority,
    now,
    providerId,
    admin.workspaceId
  );

  recordAuditLog({
    workspaceId: admin.workspaceId,
    adminId: admin.id,
    adminUsername: admin.username,
    action: 'STREAMING_PROVIDER_UPDATED',
    resourceType: 'STREAMING_PROVIDER',
    resourceId: providerId,
    previousValue: {
      baseUrl: prev.baseUrl,
      enabled: prev.enabled,
      timeoutMs: prev.timeoutMs,
      retryCount: prev.retryCount,
      fallbackPriority: prev.fallbackPriority,
    },
    newValue: { baseUrl, enabled, timeoutMs, retryCount, fallbackPriority },
    status: 'SUCCESS',
    ipAddress: ip,
  });

  const updated = db
    .prepare(`SELECT * FROM streaming_providers WHERE id = ?`)
    .get(providerId) as Record<string, unknown>;
  res.json(mapProviderRow(updated));
});

infraRouter.post(
  '/providers/:id/test',
  requireAuth,
  requirePermission('infra:write'),
  async (req, res) => {
    const admin = req.admin!;
    const ip = getClientIp(req);
    const providerId = req.params.id;

    const existingRow = db
      .prepare(`SELECT * FROM streaming_providers WHERE id = ? AND workspace_id = ?`)
      .get(providerId, admin.workspaceId) as Record<string, unknown> | undefined;

    if (!existingRow) {
      res.status(404).json({ error: 'Provider configuration not found.' });
      return;
    }

    const provider = mapProviderRow(existingRow);
    const probe = await probeStreamingProvider({
      workspaceId: admin.workspaceId,
      providerId: provider.id,
      providerSlug: provider.slug,
      providerName: provider.name,
      baseUrl: provider.baseUrl,
      healthEndpoint: provider.healthEndpoint,
      envSecretVar: provider.envSecretVar,
      timeoutMs: provider.timeoutMs,
      retryCount: provider.retryCount,
    });

    recordAuditLog({
      workspaceId: admin.workspaceId,
      adminId: admin.id,
      adminUsername: admin.username,
      action: 'STREAMING_PROVIDER_TESTED',
      resourceType: 'STREAMING_PROVIDER',
      resourceId: provider.id,
      newValue: { status: probe.status, latencyMs: probe.latencyMs },
      status: probe.status === ProviderHealthStatus.CONNECTED ? 'SUCCESS' : 'FAILURE',
      ipAddress: ip,
    });

    const refreshed = db
      .prepare(`SELECT * FROM streaming_providers WHERE id = ?`)
      .get(provider.id) as Record<string, unknown>;

    res.json({
      probe,
      provider: mapProviderRow(refreshed),
    });
  }
);

// ============================================================================
// STORAGE SERVER POOL MANAGEMENT
// ============================================================================

infraRouter.get('/storage', requireAuth, requirePermission('infra:read'), (req, res) => {
  const workspaceId = req.admin!.workspaceId;
  const rows = db
    .prepare(
      `
      SELECT s.*,
             (SELECT COUNT(*) FROM assets a WHERE a.storage_server_id = s.id AND a.workspace_id = s.workspace_id AND a.upload_status = 'STORED') AS assigned_assets_count
      FROM storage_servers s
      WHERE s.workspace_id = ?
      ORDER BY s.created_at ASC
    `
    )
    .all(workspaceId) as Array<Record<string, unknown>>;

  const servers = rows.map(mapStorageRow);
  const pool = computeLogicalStoragePool(servers);

  res.json({
    pool,
    servers,
  });
});

infraRouter.post('/storage', requireAuth, requirePermission('infra:write'), (req, res) => {
  const admin = req.admin!;
  const ip = getClientIp(req);
  const body = req.body || {};

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const bucketOrVolume = typeof body.bucketOrVolume === 'string' ? body.bucketOrVolume.trim() : '';
  if (!name || !bucketOrVolume) {
    res.status(400).json({ error: 'Storage server name and bucket/volume identifier are required.' });
    return;
  }

  const adapterType = Object.values(StorageAdapterType).includes(body.adapterType)
    ? (body.adapterType as StorageAdapterType)
    : StorageAdapterType.S3_COMPATIBLE;
  const endpointUrl = typeof body.endpointUrl === 'string' ? body.endpointUrl.trim() : '';
  const region = typeof body.region === 'string' && body.region.trim() ? body.region.trim() : 'auto';
  const envCredentialPrefix =
    typeof body.envCredentialPrefix === 'string'
      ? body.envCredentialPrefix.trim().replace(/[^A-Z0-9_]/gi, '')
      : '';
  const configuredCapacityGb = Math.max(1, Number(body.configuredCapacityGb) || 100);
  const configuredCapacityBytes = Math.round(configuredCapacityGb * 1024 * 1024 * 1024);
  const enabled = body.enabled !== false;
  const backupDestinationId = body.backupDestinationId || null;

  const id = `stg_${crypto.randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();

  // Strictly initialized as UNTESTED (is_verified = 0) until connection test runs!
  db.prepare(
    `
    INSERT INTO storage_servers (
      id, workspace_id, name, adapter_type, endpoint_url, bucket_or_volume, region,
      env_credential_prefix, enabled, is_verified, health_status, configured_capacity_bytes,
      used_capacity_bytes, backup_destination_id, failed_uploads_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?, 0, ?, ?)
  `
  ).run(
    id,
    admin.workspaceId,
    name,
    adapterType,
    endpointUrl,
    bucketOrVolume,
    region,
    envCredentialPrefix,
    enabled ? 1 : 0,
    enabled ? StorageHealthStatus.UNTESTED : StorageHealthStatus.DISABLED,
    configuredCapacityBytes,
    backupDestinationId,
    now,
    now
  );

  recordAuditLog({
    workspaceId: admin.workspaceId,
    adminId: admin.id,
    adminUsername: admin.username,
    action: 'STORAGE_SERVER_ADDED',
    resourceType: 'STORAGE_SERVER',
    resourceId: id,
    newValue: { name, adapterType, bucketOrVolume, configuredCapacityGb },
    status: 'SUCCESS',
    ipAddress: ip,
  });

  const row = db
    .prepare(`SELECT *, 0 AS assigned_assets_count FROM storage_servers WHERE id = ?`)
    .get(id) as Record<string, unknown>;
  res.status(201).json(mapStorageRow(row));
});

infraRouter.put('/storage/:id', requireAuth, requirePermission('infra:write'), (req, res) => {
  const admin = req.admin!;
  const ip = getClientIp(req);
  const serverId = req.params.id;
  const body = req.body || {};

  const existingRow = db
    .prepare(`SELECT *, 0 AS assigned_assets_count FROM storage_servers WHERE id = ? AND workspace_id = ?`)
    .get(serverId, admin.workspaceId) as Record<string, unknown> | undefined;

  if (!existingRow) {
    res.status(404).json({ error: 'Storage server not found.' });
    return;
  }

  const prev = mapStorageRow(existingRow);
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : prev.name;
  const adapterType = Object.values(StorageAdapterType).includes(body.adapterType)
    ? (body.adapterType as StorageAdapterType)
    : prev.adapterType;
  const endpointUrl =
    typeof body.endpointUrl === 'string' ? body.endpointUrl.trim() : prev.endpointUrl;
  const bucketOrVolume =
    typeof body.bucketOrVolume === 'string' && body.bucketOrVolume.trim()
      ? body.bucketOrVolume.trim()
      : prev.bucketOrVolume;
  const region = typeof body.region === 'string' ? body.region.trim() : prev.region;
  const envCredentialPrefix =
    typeof body.envCredentialPrefix === 'string'
      ? body.envCredentialPrefix.trim().replace(/[^A-Z0-9_]/gi, '')
      : prev.envCredentialPrefix;
  const enabled = typeof body.enabled === 'boolean' ? body.enabled : prev.enabled;
  const configuredCapacityBytes =
    body.configuredCapacityGb !== undefined
      ? Math.round(Math.max(1, Number(body.configuredCapacityGb)) * 1024 * 1024 * 1024)
      : prev.configuredCapacityBytes;
  const backupDestinationId =
    body.backupDestinationId !== undefined
      ? body.backupDestinationId === serverId
        ? null
        : body.backupDestinationId || null
      : prev.backupDestinationId;

  const connectionChanged =
    endpointUrl !== prev.endpointUrl ||
    bucketOrVolume !== prev.bucketOrVolume ||
    adapterType !== prev.adapterType ||
    envCredentialPrefix !== prev.envCredentialPrefix;

  const isVerified = connectionChanged ? 0 : prev.isVerified ? 1 : 0;
  let healthStatus = prev.healthStatus;
  if (!enabled) {
    healthStatus = StorageHealthStatus.DISABLED;
  } else if (connectionChanged || !isVerified) {
    healthStatus = StorageHealthStatus.UNTESTED;
  } else if (prev.healthStatus === StorageHealthStatus.DISABLED) {
    healthStatus = StorageHealthStatus.CONNECTED;
  }

  const now = new Date().toISOString();

  db.prepare(
    `
    UPDATE storage_servers
    SET name = ?, adapter_type = ?, endpoint_url = ?, bucket_or_volume = ?, region = ?,
        env_credential_prefix = ?, enabled = ?, is_verified = ?, health_status = ?,
        configured_capacity_bytes = ?, backup_destination_id = ?, updated_at = ?
    WHERE id = ? AND workspace_id = ?
  `
  ).run(
    name,
    adapterType,
    endpointUrl,
    bucketOrVolume,
    region,
    envCredentialPrefix,
    enabled ? 1 : 0,
    isVerified,
    healthStatus,
    configuredCapacityBytes,
    backupDestinationId,
    now,
    serverId,
    admin.workspaceId
  );

  recordAuditLog({
    workspaceId: admin.workspaceId,
    adminId: admin.id,
    adminUsername: admin.username,
    action: 'STORAGE_SERVER_UPDATED',
    resourceType: 'STORAGE_SERVER',
    resourceId: serverId,
    previousValue: { name: prev.name, enabled: prev.enabled, capacityBytes: prev.configuredCapacityBytes },
    newValue: { name, enabled, capacityBytes: configuredCapacityBytes },
    status: 'SUCCESS',
    ipAddress: ip,
  });

  const updated = db
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM assets a WHERE a.storage_server_id = s.id AND a.workspace_id = s.workspace_id) AS assigned_assets_count FROM storage_servers s WHERE s.id = ?`
    )
    .get(serverId) as Record<string, unknown>;
  res.json(mapStorageRow(updated));
});

infraRouter.post(
  '/storage/:id/test',
  requireAuth,
  requirePermission('infra:write'),
  async (req, res) => {
    const admin = req.admin!;
    const ip = getClientIp(req);
    const serverId = req.params.id;

    const existingRow = db
      .prepare(`SELECT *, 0 AS assigned_assets_count FROM storage_servers WHERE id = ? AND workspace_id = ?`)
      .get(serverId, admin.workspaceId) as Record<string, unknown> | undefined;

    if (!existingRow) {
      res.status(404).json({ error: 'Storage server not found.' });
      return;
    }

    const server = mapStorageRow(existingRow);
    const adapter = getStorageAdapter(server.adapterType);
    const result = await adapter.testConnection({
      endpointUrl: server.endpointUrl,
      bucketOrVolume: server.bucketOrVolume,
      region: server.region,
      envCredentialPrefix: server.envCredentialPrefix,
    });

    const now = new Date().toISOString();
    const finalStatus = server.enabled ? result.healthStatus : StorageHealthStatus.DISABLED;

    db.prepare(
      `
      UPDATE storage_servers
      SET is_verified = ?,
          health_status = ?,
          last_tested_at = ?,
          last_latency_ms = ?,
          last_error = ?,
          updated_at = ?
      WHERE id = ? AND workspace_id = ?
    `
    ).run(
      result.verified ? 1 : 0,
      finalStatus,
      now,
      result.latencyMs,
      result.verified ? null : result.message,
      now,
      serverId,
      admin.workspaceId
    );

    if (!result.verified) {
      recordSystemLog({
        workspaceId: admin.workspaceId,
        severity: LogSeverity.WARN,
        component: `StoragePool:${server.name}`,
        message: result.message,
      });
    }

    recordAuditLog({
      workspaceId: admin.workspaceId,
      adminId: admin.id,
      adminUsername: admin.username,
      action: 'STORAGE_SERVER_TESTED',
      resourceType: 'STORAGE_SERVER',
      resourceId: serverId,
      newValue: { verified: result.verified, healthStatus: finalStatus, latencyMs: result.latencyMs },
      status: result.verified ? 'SUCCESS' : 'FAILURE',
      ipAddress: ip,
    });

    const refreshed = db
      .prepare(
        `SELECT s.*, (SELECT COUNT(*) FROM assets a WHERE a.storage_server_id = s.id AND a.workspace_id = s.workspace_id) AS assigned_assets_count FROM storage_servers s WHERE s.id = ?`
      )
      .get(serverId) as Record<string, unknown>;

    res.json({
      result,
      server: mapStorageRow(refreshed),
    });
  }
);

infraRouter.delete('/storage/:id', requireAuth, requirePermission('infra:write'), (req, res) => {
  const admin = req.admin!;
  const ip = getClientIp(req);
  const serverId = req.params.id;

  const existing = db
    .prepare(`SELECT id, name FROM storage_servers WHERE id = ? AND workspace_id = ?`)
    .get(serverId, admin.workspaceId) as { id: string; name: string } | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Storage server not found.' });
    return;
  }

  const assignedAssets = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM assets WHERE workspace_id = ? AND storage_server_id = ? AND upload_status = 'STORED'`
    )
    .get(admin.workspaceId, serverId) as { cnt: number };

  if (assignedAssets.cnt > 0) {
    res.status(409).json({
      error: `Cannot remove storage server "${existing.name}" while ${assignedAssets.cnt} active asset(s) reside on it. Reassign or delete those assets first.`,
    });
    return;
  }

  db.prepare(`DELETE FROM storage_servers WHERE id = ? AND workspace_id = ?`).run(
    serverId,
    admin.workspaceId
  );

  recordAuditLog({
    workspaceId: admin.workspaceId,
    adminId: admin.id,
    adminUsername: admin.username,
    action: 'STORAGE_SERVER_REMOVED',
    resourceType: 'STORAGE_SERVER',
    resourceId: serverId,
    previousValue: { name: existing.name },
    status: 'SUCCESS',
    ipAddress: ip,
  });

  res.json({ ok: true });
});

// ============================================================================
// CENTRAL ASSET MANAGEMENT
// ============================================================================

infraRouter.get('/assets', requireAuth, requirePermission('assets:read'), (req, res) => {
  const workspaceId = req.admin!.workspaceId;
  const category = String(req.query.category || '').trim();
  const search = String(req.query.search || '').trim().toLowerCase();

  const rows = db
    .prepare(
      `
      SELECT a.*, s.name AS storage_server_name
      FROM assets a
      LEFT JOIN storage_servers s ON s.id = a.storage_server_id
      WHERE a.workspace_id = ?
      ORDER BY a.created_at DESC
    `
    )
    .all(workspaceId) as Array<Record<string, unknown>>;

  let items: AssetRecord[] = rows.map((r) => ({
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    originalFilename: String(r.original_filename),
    mimeType: String(r.mime_type),
    sizeBytes: Number(r.size_bytes),
    checksumSha256: String(r.checksum_sha256),
    category: (r.category as AssetCategory) || AssetCategory.OTHER_MEDIA,
    storageServerId: r.storage_server_id ? String(r.storage_server_id) : null,
    storageServerName: r.storage_server_name ? String(r.storage_server_name) : 'Local Staging Buffer',
    uploadStatus: (r.upload_status as AssetRecord['uploadStatus']) || 'STORED',
    linkedAnimeId: r.linked_anime_id ? String(r.linked_anime_id) : null,
    linkedEpisodeId: r.linked_episode_id ? String(r.linked_episode_id) : null,
    inUseReferences: getAssetReferences(workspaceId, String(r.id)),
    uploadedBy: String(r.uploaded_by),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));

  if (category && category !== 'ALL') {
    items = items.filter((a) => a.category === category);
  }

  if (search) {
    items = items.filter((a) =>
      [a.originalFilename, a.id, a.mimeType, a.storageServerName || '', a.category]
        .join(' ')
        .toLowerCase()
        .includes(search)
    );
  }

  res.json({ items });
});

infraRouter.post(
  '/assets/upload',
  requireAuth,
  requirePermission('assets:write'),
  (req, res, next) => {
    uploadMiddleware.single('file')(req, res, (err) => {
      if (err) {
        // Track failed upload on target storage server if provided
        const targetServerId = req.body?.storageServerId;
        if (targetServerId && req.admin) {
          db.prepare(
            `UPDATE storage_servers SET failed_uploads_count = failed_uploads_count + 1 WHERE id = ? AND workspace_id = ?`
          ).run(String(targetServerId), req.admin.workspaceId);
        }
        recordSystemLog({
          workspaceId: req.admin?.workspaceId || null,
          severity: LogSeverity.WARN,
          component: 'AssetUpload',
          message: `Upload rejected: ${err instanceof Error ? err.message : 'Upload error'}`,
        });
        res.status(400).json({ error: err instanceof Error ? err.message : 'File upload failed.' });
        return;
      }
      next();
    });
  },
  (req, res) => {
    const admin = req.admin!;
    const ip = getClientIp(req);
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'Multipart file payload is required.' });
      return;
    }

    const category = Object.values(AssetCategory).includes(req.body?.category)
      ? (req.body.category as AssetCategory)
      : AssetCategory.OTHER_MEDIA;
    const storageServerId = req.body?.storageServerId ? String(req.body.storageServerId) : null;
    const linkedAnimeId = req.body?.linkedAnimeId ? String(req.body.linkedAnimeId) : null;
    const linkedEpisodeId = req.body?.linkedEpisodeId ? String(req.body.linkedEpisodeId) : null;

    // Verify storage server capacity if assigned
    if (storageServerId) {
      const server = db
        .prepare(`SELECT * FROM storage_servers WHERE id = ? AND workspace_id = ?`)
        .get(storageServerId, admin.workspaceId) as
        | {
            id: string;
            enabled: number;
            configured_capacity_bytes: number;
            used_capacity_bytes: number;
          }
        | undefined;

      if (!server || !server.enabled) {
        fs.unlinkSync(file.path);
        res.status(400).json({ error: 'Selected destination storage server is unavailable or disabled.' });
        return;
      }

      if (server.used_capacity_bytes + file.size > server.configured_capacity_bytes) {
        fs.unlinkSync(file.path);
        db.prepare(
          `UPDATE storage_servers SET failed_uploads_count = failed_uploads_count + 1 WHERE id = ?`
        ).run(server.id);
        res.status(409).json({
          error: 'Upload exceeds configured capacity of the selected storage server.',
        });
        return;
      }
    }

    const fileBuffer = fs.readFileSync(file.path);
    const checksum = sha256Hex(fileBuffer);
    const id = `ast_${crypto.randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();

    db.prepare(
      `
      INSERT INTO assets (
        id, workspace_id, original_filename, stored_filename, mime_type, size_bytes,
        checksum_sha256, category, storage_server_id, upload_status, linked_anime_id,
        linked_episode_id, uploaded_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'STORED', ?, ?, ?, ?, ?)
    `
    ).run(
      id,
      admin.workspaceId,
      file.originalname,
      file.filename,
      file.mimetype,
      file.size,
      checksum,
      category,
      storageServerId,
      linkedAnimeId,
      linkedEpisodeId,
      admin.username,
      now,
      now
    );

    if (storageServerId) {
      recalculateServerUsedCapacity(admin.workspaceId, storageServerId);
    }

    recordAuditLog({
      workspaceId: admin.workspaceId,
      adminId: admin.id,
      adminUsername: admin.username,
      action: 'ASSET_UPLOADED',
      resourceType: 'ASSET',
      resourceId: id,
      newValue: {
        filename: file.originalname,
        sizeBytes: file.size,
        category,
        storageServerId,
        checksumSha256: checksum,
      },
      status: 'SUCCESS',
      ipAddress: ip,
    });

    res.status(201).json({
      id,
      originalFilename: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      checksumSha256: checksum,
      category,
      storageServerId,
      uploadStatus: 'STORED',
      createdAt: now,
    });
  }
);

infraRouter.post(
  '/assets/:id/replace',
  requireAuth,
  requirePermission('assets:write'),
  (req, res, next) => {
    uploadMiddleware.single('file')(req, res, (err) => {
      if (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Replacement upload failed.' });
        return;
      }
      next();
    });
  },
  (req, res) => {
    const admin = req.admin!;
    const ip = getClientIp(req);
    const assetId = req.params.id;
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'Replacement file is required.' });
      return;
    }

    const existing = db
      .prepare(`SELECT * FROM assets WHERE id = ? AND workspace_id = ?`)
      .get(assetId, admin.workspaceId) as
      | {
          id: string;
          original_filename: string;
          stored_filename: string;
          size_bytes: number;
          storage_server_id: string | null;
        }
      | undefined;

    if (!existing) {
      fs.unlinkSync(file.path);
      res.status(404).json({ error: 'Asset record not found.' });
      return;
    }

    const oldFilePath = path.join(uploadsDir, existing.stored_filename);
    if (fs.existsSync(oldFilePath)) {
      try {
        fs.unlinkSync(oldFilePath);
      } catch {
        // Ignore cleanup failure
      }
    }

    const checksum = sha256Hex(fs.readFileSync(file.path));
    const now = new Date().toISOString();

    db.prepare(
      `
      UPDATE assets
      SET original_filename = ?, stored_filename = ?, mime_type = ?, size_bytes = ?,
          checksum_sha256 = ?, uploaded_by = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ?
    `
    ).run(
      file.originalname,
      file.filename,
      file.mimetype,
      file.size,
      checksum,
      admin.username,
      now,
      assetId,
      admin.workspaceId
    );

    if (existing.storage_server_id) {
      recalculateServerUsedCapacity(admin.workspaceId, existing.storage_server_id);
    }

    recordAuditLog({
      workspaceId: admin.workspaceId,
      adminId: admin.id,
      adminUsername: admin.username,
      action: 'ASSET_REPLACED',
      resourceType: 'ASSET',
      resourceId: assetId,
      previousValue: { filename: existing.original_filename, sizeBytes: existing.size_bytes },
      newValue: { filename: file.originalname, sizeBytes: file.size, checksum },
      status: 'SUCCESS',
      ipAddress: ip,
    });

    res.json({ ok: true });
  }
);

infraRouter.patch('/assets/:id', requireAuth, requirePermission('assets:write'), (req, res) => {
  const admin = req.admin!;
  const ip = getClientIp(req);
  const assetId = req.params.id;
  const { category, storageServerId } = req.body || {};

  const existing = db
    .prepare(`SELECT * FROM assets WHERE id = ? AND workspace_id = ?`)
    .get(assetId, admin.workspaceId) as
    | { id: string; category: string; storage_server_id: string | null }
    | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Asset not found.' });
    return;
  }

  const nextCategory = Object.values(AssetCategory).includes(category)
    ? category
    : existing.category;
  const nextServerId =
    storageServerId !== undefined ? storageServerId || null : existing.storage_server_id;
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE assets SET category = ?, storage_server_id = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`
  ).run(nextCategory, nextServerId, now, assetId, admin.workspaceId);

  if (existing.storage_server_id) {
    recalculateServerUsedCapacity(admin.workspaceId, existing.storage_server_id);
  }
  if (nextServerId) {
    recalculateServerUsedCapacity(admin.workspaceId, nextServerId);
  }

  recordAuditLog({
    workspaceId: admin.workspaceId,
    adminId: admin.id,
    adminUsername: admin.username,
    action: 'ASSET_ORGANIZED',
    resourceType: 'ASSET',
    resourceId: assetId,
    previousValue: { category: existing.category, storageServerId: existing.storage_server_id },
    newValue: { category: nextCategory, storageServerId: nextServerId },
    status: 'SUCCESS',
    ipAddress: ip,
  });

  res.json({ ok: true });
});

infraRouter.get('/assets/:id/file', requireAuth, requirePermission('assets:read'), (req, res) => {
  const workspaceId = req.admin!.workspaceId;
  const assetId = req.params.id;

  const asset = db
    .prepare(`SELECT stored_filename, original_filename, mime_type FROM assets WHERE id = ? AND workspace_id = ?`)
    .get(assetId, workspaceId) as
    | { stored_filename: string; original_filename: string; mime_type: string }
    | undefined;

  if (!asset) {
    res.status(404).json({ error: 'Asset not found.' });
    return;
  }

  const safePath = path.join(uploadsDir, path.basename(asset.stored_filename));
  if (!fs.existsSync(safePath)) {
    res.status(404).json({ error: 'Stored binary file missing from staging volume.' });
    return;
  }

  res.setHeader('Content-Type', asset.mime_type);
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${asset.original_filename.replace(/"/g, '')}"`
  );
  res.sendFile(safePath);
});

infraRouter.delete('/assets/:id', requireAuth, requirePermission('assets:write'), (req, res) => {
  const admin = req.admin!;
  const ip = getClientIp(req);
  const assetId = req.params.id;

  const existing = db
    .prepare(`SELECT * FROM assets WHERE id = ? AND workspace_id = ?`)
    .get(assetId, admin.workspaceId) as
    | {
        id: string;
        original_filename: string;
        stored_filename: string;
        storage_server_id: string | null;
      }
    | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Asset not found.' });
    return;
  }

  // Prevent accidental deletion of assets still referenced by Anime or Episodes
  const inUseRefs = getAssetReferences(admin.workspaceId, assetId);
  if (inUseRefs.length > 0) {
    res.status(409).json({
      error: `Asset is currently in use and cannot be deleted. Detach it first from: ${inUseRefs.join(', ')}`,
      inUseReferences: inUseRefs,
    });
    return;
  }

  const filePath = path.join(uploadsDir, path.basename(existing.stored_filename));
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Ignore unlink race
    }
  }

  db.prepare(`DELETE FROM assets WHERE id = ? AND workspace_id = ?`).run(assetId, admin.workspaceId);

  if (existing.storage_server_id) {
    recalculateServerUsedCapacity(admin.workspaceId, existing.storage_server_id);
  }

  recordAuditLog({
    workspaceId: admin.workspaceId,
    adminId: admin.id,
    adminUsername: admin.username,
    action: 'ASSET_DELETED',
    resourceType: 'ASSET',
    resourceId: assetId,
    previousValue: { filename: existing.original_filename },
    status: 'SUCCESS',
    ipAddress: ip,
  });

  res.json({ ok: true });
});

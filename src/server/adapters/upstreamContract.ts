import { ProposedApiContract, UpstreamIntegrationConfig } from '../../shared/types';
import { db } from '../db';

export function getUpstreamConfig(workspaceId: string): UpstreamIntegrationConfig {
  const row = db
    .prepare(`SELECT * FROM integration_configs WHERE workspace_id = ?`)
    .get(workspaceId) as
    | {
        workspace_id: string;
        base_url: string;
        health_path: string;
        api_version: string;
        env_api_key_var: string;
        sync_mode: 'DISCONNECTED' | 'READ_ONLY_VERIFY' | 'CONTROLLED_SYNC';
        connection_status: 'NOT_CONNECTED' | 'CONNECTED' | 'UNREACHABLE' | 'AUTH_ERROR';
        last_tested_at: string | null;
        last_latency_ms: number | null;
        last_status_message: string | null;
        updated_at: string;
      }
    | undefined;

  const envVar = row?.env_api_key_var || 'KURO_NAMI_UPSTREAM_API_KEY';
  const hasEnvApiKey = Boolean(process.env[envVar] && process.env[envVar]!.trim().length > 0);

  if (!row) {
    return {
      workspaceId,
      baseUrl: '',
      healthPath: '/api/v1/health',
      apiVersion: 'v1',
      envApiKeyVar: envVar,
      hasEnvApiKey,
      syncMode: 'DISCONNECTED',
      connectionStatus: 'NOT_CONNECTED',
      lastTestedAt: null,
      lastLatencyMs: null,
      lastStatusMessage: 'Upstream KURO NAMI backend is not connected yet.',
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    workspaceId: row.workspace_id,
    baseUrl: row.base_url,
    healthPath: row.health_path,
    apiVersion: row.api_version,
    envApiKeyVar: row.env_api_key_var,
    hasEnvApiKey,
    syncMode: row.sync_mode,
    connectionStatus: row.connection_status,
    lastTestedAt: row.last_tested_at,
    lastLatencyMs: row.last_latency_ms,
    lastStatusMessage: row.last_status_message,
    updatedAt: row.updated_at,
  };
}

/**
 * Non-destructive read-only connectivity check against the main KURO NAMI backend.
 * Never mutates or overwrites production data during initial connection.
 */
export async function testUpstreamKuroNamiConnection(params: {
  workspaceId: string;
  baseUrl: string;
  healthPath: string;
  envApiKeyVar: string;
}): Promise<{
  connectionStatus: 'NOT_CONNECTED' | 'CONNECTED' | 'UNREACHABLE' | 'AUTH_ERROR';
  latencyMs: number | null;
  statusMessage: string;
}> {
  const trimmedUrl = (params.baseUrl || '').trim();
  if (!trimmedUrl) {
    return {
      connectionStatus: 'NOT_CONNECTED',
      latencyMs: null,
      statusMessage: 'No upstream KURO NAMI base URL configured.',
    };
  }

  let targetUrl: string;
  try {
    const parsedBase = new URL(trimmedUrl);
    if (parsedBase.protocol !== 'https:' && parsedBase.protocol !== 'http:') {
      throw new Error('Protocol must be http or https.');
    }
    targetUrl = new URL(params.healthPath?.trim() || '/api/v1/health', parsedBase).toString();
  } catch {
    return {
      connectionStatus: 'UNREACHABLE',
      latencyMs: null,
      statusMessage: 'Invalid upstream base URL or health endpoint path.',
    };
  }

  const apiKey = params.envApiKeyVar?.trim()
    ? process.env[params.envApiKeyVar.trim()]?.trim()
    : undefined;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const start = performance.now();

  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-KuroNami-Admin-Probe': 'read-only-handshake',
      'X-KuroNami-Workspace': params.workspaceId,
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const res = await fetch(targetUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - start);

    if (res.status === 401 || res.status === 403) {
      return {
        connectionStatus: 'AUTH_ERROR',
        latencyMs,
        statusMessage: `Upstream reachable (${latencyMs}ms) but rejected authorization (HTTP ${res.status}). Check ${params.envApiKeyVar}.`,
      };
    }

    if (res.status >= 200 && res.status < 300) {
      return {
        connectionStatus: 'CONNECTED',
        latencyMs,
        statusMessage: `Read-only handshake verified (${latencyMs}ms, HTTP ${res.status}). Production data untouched.`,
      };
    }

    return {
      connectionStatus: 'UNREACHABLE',
      latencyMs,
      statusMessage: `Upstream responded with HTTP ${res.status} (${latencyMs}ms).`,
    };
  } catch (err: unknown) {
    clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - start);
    return {
      connectionStatus: 'UNREACHABLE',
      latencyMs,
      statusMessage: `Failed to reach upstream endpoint: ${
        err instanceof Error ? err.message : 'Connection error'
      }`,
    };
  }
}

/**
 * Clearly separates Proposed Upstream KURO NAMI API Contracts (for future main platform bridge)
 * from Verified Local Admin Endpoints (currently running and active in KURO NAMI ADMIN).
 */
export const DOCUMENTED_API_CONTRACTS: ProposedApiContract[] = [
  // --- VERIFIED LOCAL ADMIN ENDPOINTS ---
  {
    domain: 'Authentication',
    version: 'v1',
    contractStatus: 'VERIFIED_ADMIN_LOCAL_ENDPOINT',
    method: 'POST',
    path: '/api/v1/auth/provision-owner',
    description: 'One-time password & recovery key provisioning for BeniLin or Shana Love.',
    authRequirement: 'Unprovisioned owner slot + optional ADMIN_PROVISIONING_TOKEN',
    idempotencyAndSyncNotes: 'Permanently locks owner provisioning flag once completed.',
  },
  {
    domain: 'Authentication',
    version: 'v1',
    contractStatus: 'VERIFIED_ADMIN_LOCAL_ENDPOINT',
    method: 'POST',
    path: '/api/v1/auth/login',
    description: 'Authenticates administrator and issues HttpOnly session + CSRF token.',
    authRequirement: 'Valid admin username & scrypt-verified password',
    idempotencyAndSyncNotes: 'Enforces workspace isolation (ws_benilin vs ws_shana_love).',
  },
  {
    domain: 'Anime Management',
    version: 'v1',
    contractStatus: 'VERIFIED_ADMIN_LOCAL_ENDPOINT',
    method: 'GET',
    path: '/api/v1/anime',
    description: 'Lists workspace anime records with search, filtering, sorting, and pagination.',
    authRequirement: 'Session + catalog:read',
    idempotencyAndSyncNotes: 'Preserves external IDs (AniList, MAL, Kitsu) distinct from internal kn_anime_* ID.',
  },
  {
    domain: 'Episode Management',
    version: 'v1',
    contractStatus: 'VERIFIED_ADMIN_LOCAL_ENDPOINT',
    method: 'POST',
    path: '/api/v1/episodes/bulk',
    description: 'Creates ordered episode batches for a target anime season.',
    authRequirement: 'Session + CSRF + catalog:write',
    idempotencyAndSyncNotes: 'Maintains upstreamEpisodeId mapping to avoid duplicate episode creation.',
  },
  {
    domain: 'Streaming Providers',
    version: 'v1',
    contractStatus: 'VERIFIED_ADMIN_LOCAL_ENDPOINT',
    method: 'POST',
    path: '/api/v1/providers/:id/test',
    description: 'Executes live connectivity probe with server-side env credential resolution.',
    authRequirement: 'Session + CSRF + infra:write',
    idempotencyAndSyncNotes: 'Classifies into 5 discrete states without exposing API keys to client.',
  },
  {
    domain: 'Storage Servers',
    version: 'v1',
    contractStatus: 'VERIFIED_ADMIN_LOCAL_ENDPOINT',
    method: 'GET',
    path: '/api/v1/storage',
    description: 'Returns storage nodes and aggregated Logical KURO NAMI Storage Pool metrics.',
    authRequirement: 'Session + infra:read',
    idempotencyAndSyncNotes: 'Total = Sum(configured), Used = Sum(actual used), Available = Total - Used.',
  },
  {
    domain: 'Assets',
    version: 'v1',
    contractStatus: 'VERIFIED_ADMIN_LOCAL_ENDPOINT',
    method: 'POST',
    path: '/api/v1/assets/upload',
    description: 'Multipart upload with SHA-256 checksum, MIME validation, and storage server routing.',
    authRequirement: 'Session + CSRF + assets:write',
    idempotencyAndSyncNotes: 'Blocks deletion (HTTP 409) when referenced by any anime or episode.',
  },
  {
    domain: 'Treasury',
    version: 'v1',
    contractStatus: 'VERIFIED_ADMIN_LOCAL_ENDPOINT',
    method: 'POST',
    path: '/api/v1/treasury/transactions',
    description: 'Executes atomic SQLite deposit/withdrawal transaction starting from 0.00 balance.',
    authRequirement: 'Session + CSRF + treasury:write',
    idempotencyAndSyncNotes: 'Protected by database CHECK(balance_cents >= 0) and append-only triggers.',
  },

  // --- PROPOSED UPSTREAM KURO NAMI INTEGRATION CONTRACTS ---
  {
    domain: 'Authentication',
    version: 'v1-proposed',
    contractStatus: 'PROPOSED_UPSTREAM_CONTRACT',
    method: 'POST',
    path: '/admin-bridge/v1/auth/verify-owner-assertion',
    description: 'Proposed HMAC-signed assertion exchange between KURO NAMI ADMIN and main platform.',
    authRequirement: 'Bearer KURO_NAMI_UPSTREAM_API_KEY + X-KuroNami-Signature',
    idempotencyAndSyncNotes: 'Maps BeniLin and Shana Love owner principals without allowing public web users admin elevation.',
  },
  {
    domain: 'Anime Management',
    version: 'v1-proposed',
    contractStatus: 'PROPOSED_UPSTREAM_CONTRACT',
    method: 'PUT',
    path: '/admin-bridge/v1/catalog/anime/:upstreamKuroNamiId',
    description: 'Proposed idempotent upsert/patch of authoritative anime metadata on main KURO NAMI DB.',
    authRequirement: 'Bearer KURO_NAMI_UPSTREAM_API_KEY + If-Match ETag',
    idempotencyAndSyncNotes: 'Requires ETag optimistic concurrency so initial connection never overwrites newer upstream edits.',
  },
  {
    domain: 'Episode Management',
    version: 'v1-proposed',
    contractStatus: 'PROPOSED_UPSTREAM_CONTRACT',
    method: 'PUT',
    path: '/admin-bridge/v1/catalog/anime/:upstreamKuroNamiId/episodes/sync',
    description: 'Proposed batch synchronization of episode numbers, seasons, audio flags, and verified sources.',
    authRequirement: 'Bearer KURO_NAMI_UPSTREAM_API_KEY',
    idempotencyAndSyncNotes: 'Keyed by (upstream_anime_id, season_number, episode_number) to prevent duplicate episodes.',
  },
  {
    domain: 'Streaming Providers',
    version: 'v1-proposed',
    contractStatus: 'PROPOSED_UPSTREAM_CONTRACT',
    method: 'PATCH',
    path: '/admin-bridge/v1/streaming/providers/:slug/routing',
    description: 'Proposed control contract to push fallback priority, timeout limits, and enable/disable state.',
    authRequirement: 'Bearer KURO_NAMI_UPSTREAM_API_KEY',
    idempotencyAndSyncNotes: 'Preserves existing main-site provider configurations unless explicitly promoted.',
  },
  {
    domain: 'Storage Servers',
    version: 'v1-proposed',
    contractStatus: 'PROPOSED_UPSTREAM_CONTRACT',
    method: 'GET',
    path: '/admin-bridge/v1/storage/pool-telemetry',
    description: 'Proposed upstream storage node usage & failed-upload telemetry feed.',
    authRequirement: 'Bearer KURO_NAMI_UPSTREAM_API_KEY',
    idempotencyAndSyncNotes: 'Read-only pull merged into the unified KURO NAMI Storage Pool calculator.',
  },
  {
    domain: 'Assets',
    version: 'v1-proposed',
    contractStatus: 'PROPOSED_UPSTREAM_CONTRACT',
    method: 'POST',
    path: '/admin-bridge/v1/assets/presign-promotion',
    description: 'Proposed signed transfer endpoint for promoting staged posters, subtitles, and authorized media.',
    authRequirement: 'Bearer KURO_NAMI_UPSTREAM_API_KEY',
    idempotencyAndSyncNotes: 'Verifies SHA-256 digest before updating live CDN pointers.',
  },
  {
    domain: 'Users',
    version: 'v1-proposed',
    contractStatus: 'PROPOSED_UPSTREAM_CONTRACT',
    method: 'GET',
    path: '/admin-bridge/v1/users',
    description: 'Proposed paginated user moderation directory excluding password hashes and private tokens.',
    authRequirement: 'Bearer KURO_NAMI_UPSTREAM_API_KEY + X-KuroNami-Workspace',
    idempotencyAndSyncNotes: 'Read-only pagination + PATCH /admin-bridge/v1/users/:id/moderation for suspensions.',
  },
  {
    domain: 'Analytics',
    version: 'v1-proposed',
    contractStatus: 'PROPOSED_UPSTREAM_CONTRACT',
    method: 'GET',
    path: '/admin-bridge/v1/analytics/playback-summary',
    description: 'Proposed aggregated series for registrations, top watched titles/episodes, and playback failures.',
    authRequirement: 'Bearer KURO_NAMI_UPSTREAM_API_KEY',
    idempotencyAndSyncNotes: 'Accepts ?from=ISO&to=ISO date window.',
  },
  {
    domain: 'Monitoring',
    version: 'v1-proposed',
    contractStatus: 'PROPOSED_UPSTREAM_CONTRACT',
    method: 'GET',
    path: '/admin-bridge/v1/health/deep',
    description: 'Proposed upstream database, cache, and resolver health check endpoint.',
    authRequirement: 'Bearer KURO_NAMI_UPSTREAM_API_KEY',
    idempotencyAndSyncNotes: 'Strictly read-only diagnostic endpoint used during connection handshake.',
  },
];

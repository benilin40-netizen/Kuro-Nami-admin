import fs from 'fs';
import path from 'path';
import { db, uploadsDir } from '../db';
import {
  StorageAdapterType,
  StorageHealthStatus,
  StoragePoolSummary,
  StorageServerRecord,
} from '../../shared/types';

export interface StorageConnectionTestResult {
  verified: boolean;
  healthStatus: StorageHealthStatus;
  latencyMs: number;
  message: string;
}

export interface StorageProviderAdapter {
  readonly type: StorageAdapterType;
  testConnection(config: {
    endpointUrl: string;
    bucketOrVolume: string;
    region: string;
    envCredentialPrefix: string;
  }): Promise<StorageConnectionTestResult>;
}

export function hasStorageEnvCredentials(prefix: string, adapterType: StorageAdapterType): boolean {
  if (adapterType === StorageAdapterType.LOCAL_VOLUME) {
    return true;
  }
  const cleanPrefix = (prefix || '').trim();
  if (!cleanPrefix) return false;
  const keyId = process.env[`${cleanPrefix}_ACCESS_KEY_ID`] || process.env[`${cleanPrefix}_KEY`];
  const secret =
    process.env[`${cleanPrefix}_SECRET_ACCESS_KEY`] || process.env[`${cleanPrefix}_SECRET`];
  return Boolean(keyId && keyId.trim() && secret && secret.trim());
}

class CloudHttpStorageAdapter implements StorageProviderAdapter {
  constructor(public readonly type: StorageAdapterType) {}

  async testConnection(config: {
    endpointUrl: string;
    bucketOrVolume: string;
    region: string;
    envCredentialPrefix: string;
  }): Promise<StorageConnectionTestResult> {
    const start = performance.now();
    const endpoint = (config.endpointUrl || '').trim();

    if (!endpoint) {
      return {
        verified: false,
        healthStatus: StorageHealthStatus.UNREACHABLE,
        latencyMs: 0,
        message: 'Endpoint URL is required to verify remote object storage connectivity.',
      };
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(endpoint);
      if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
        throw new Error('Unsupported protocol');
      }
    } catch {
      return {
        verified: false,
        healthStatus: StorageHealthStatus.UNREACHABLE,
        latencyMs: 0,
        message: 'Endpoint URL syntax is invalid.',
      };
    }

    const prefix = (config.envCredentialPrefix || '').trim();
    const hasCreds = hasStorageEnvCredentials(prefix, this.type);
    if (prefix && !hasCreds) {
      return {
        verified: false,
        healthStatus: StorageHealthStatus.AUTH_FAILED,
        latencyMs: Math.round(performance.now() - start),
        message: `Server environment credentials (${prefix}_ACCESS_KEY_ID / ${prefix}_SECRET_ACCESS_KEY) are not set on backend.`,
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);

    try {
      const response = await fetch(parsedUrl.toString(), {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'User-Agent': `KuroNami-StoragePool-Adapter/${this.type}`,
        },
      });
      clearTimeout(timeout);
      const latencyMs = Math.round(performance.now() - start);

      if (response.status === 401 || response.status === 403) {
        if (!hasCreds) {
          return {
            verified: false,
            healthStatus: StorageHealthStatus.AUTH_FAILED,
            latencyMs,
            message: `Storage endpoint reachable (${latencyMs}ms), but returned HTTP ${response.status} and server env credentials (${prefix || 'none'}) are missing.`,
          };
        }
      }

      if (response.status >= 500) {
        return {
          verified: false,
          healthStatus: StorageHealthStatus.UNREACHABLE,
          latencyMs,
          message: `Storage endpoint returned server error HTTP ${response.status}.`,
        };
      }

      return {
        verified: true,
        healthStatus: StorageHealthStatus.CONNECTED,
        latencyMs,
        message: `Verified ${this.type} endpoint connectivity (${latencyMs}ms) for bucket "${config.bucketOrVolume}".`,
      };
    } catch (err: unknown) {
      clearTimeout(timeout);
      const latencyMs = Math.round(performance.now() - start);
      return {
        verified: false,
        healthStatus: StorageHealthStatus.UNREACHABLE,
        latencyMs,
        message: `Connection test failed: ${err instanceof Error ? err.message : 'Network error'}`,
      };
    }
  }
}

class LocalVolumeStorageAdapter implements StorageProviderAdapter {
  public readonly type = StorageAdapterType.LOCAL_VOLUME;

  async testConnection(config: {
    endpointUrl: string;
    bucketOrVolume: string;
    region: string;
    envCredentialPrefix: string;
  }): Promise<StorageConnectionTestResult> {
    const start = performance.now();
    try {
      const safeSubdir = (config.bucketOrVolume || 'default-pool')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 64);
      const targetDir = path.join(uploadsDir, safeSubdir);
      await fs.promises.mkdir(targetDir, { recursive: true });
      await fs.promises.access(targetDir, fs.constants.R_OK | fs.constants.W_OK);
      const latencyMs = Math.max(1, Math.round(performance.now() - start));
      return {
        verified: true,
        healthStatus: StorageHealthStatus.CONNECTED,
        latencyMs,
        message: `Verified read/write access on local node volume "${safeSubdir}" (${latencyMs}ms).`,
      };
    } catch (err: unknown) {
      return {
        verified: false,
        healthStatus: StorageHealthStatus.UNREACHABLE,
        latencyMs: Math.round(performance.now() - start),
        message: `Local volume verification failed: ${
          err instanceof Error ? err.message : 'I/O permission error'
        }`,
      };
    }
  }
}

const adapterRegistry: Record<StorageAdapterType, StorageProviderAdapter> = {
  [StorageAdapterType.CLOUD_OBJECT_STORAGE]: new CloudHttpStorageAdapter(
    StorageAdapterType.CLOUD_OBJECT_STORAGE
  ),
  [StorageAdapterType.S3_COMPATIBLE]: new CloudHttpStorageAdapter(StorageAdapterType.S3_COMPATIBLE),
  [StorageAdapterType.GOOGLE_CLOUD_STORAGE]: new CloudHttpStorageAdapter(
    StorageAdapterType.GOOGLE_CLOUD_STORAGE
  ),
  [StorageAdapterType.CLOUDFLARE_R2]: new CloudHttpStorageAdapter(StorageAdapterType.CLOUDFLARE_R2),
  [StorageAdapterType.LOCAL_VOLUME]: new LocalVolumeStorageAdapter(),
};

export function getStorageAdapter(type: StorageAdapterType): StorageProviderAdapter {
  return adapterRegistry[type] || adapterRegistry[StorageAdapterType.S3_COMPATIBLE];
}

export function recalculateServerUsedCapacity(workspaceId: string, serverId: string): void {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(size_bytes), 0) AS total_bytes FROM assets WHERE workspace_id = ? AND storage_server_id = ? AND upload_status = 'STORED'`
    )
    .get(workspaceId, serverId) as { total_bytes: number };

  db.prepare(
    `UPDATE storage_servers SET used_capacity_bytes = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`
  ).run(row.total_bytes, new Date().toISOString(), serverId, workspaceId);
}

/**
 * Combines all configured workspace storage servers into one logical KURO NAMI Storage Pool:
 * Total capacity = Sum of configured storage capacities (for enabled servers)
 * Used capacity = Sum of actual used storage (for enabled servers)
 * Available capacity = Total capacity minus used capacity
 */
export function computeLogicalStoragePool(servers: StorageServerRecord[]): StoragePoolSummary {
  const activePoolServers = servers.filter((s) => s.enabled);
  const verifiedConnectedServers = activePoolServers.filter(
    (s) => s.isVerified && s.healthStatus === StorageHealthStatus.CONNECTED
  ).length;

  const totalCapacityBytes = activePoolServers.reduce(
    (sum, s) => sum + Math.max(0, Number(s.configuredCapacityBytes) || 0),
    0
  );
  const usedCapacityBytes = activePoolServers.reduce(
    (sum, s) => sum + Math.max(0, Number(s.usedCapacityBytes) || 0),
    0
  );
  const availableCapacityBytes = Math.max(0, totalCapacityBytes - usedCapacityBytes);
  const utilizationPercent =
    totalCapacityBytes > 0
      ? Math.min(100, Math.round((usedCapacityBytes / totalCapacityBytes) * 10000) / 100)
      : 0;
  const totalFailedUploads = servers.reduce(
    (sum, s) => sum + (Number(s.failedUploadsCount) || 0),
    0
  );

  return {
    totalServers: servers.length,
    enabledServers: activePoolServers.length,
    verifiedConnectedServers,
    totalCapacityBytes,
    usedCapacityBytes,
    availableCapacityBytes,
    utilizationPercent,
    totalFailedUploads,
  };
}

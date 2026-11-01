import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Edit3,
  HardDrive,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import {
  StorageAdapterType,
  StoragePoolSummary,
  StorageServerRecord,
} from '../../shared/types';
import { apiRequest, formatBytes, formatTimestamp } from '../api';
import {
  ConfirmDialog,
  Modal,
  StorageStatusLabel,
  TableSkeleton,
} from '../components/UiPrimitives';

const ADAPTER_LABELS: Record<StorageAdapterType, string> = {
  [StorageAdapterType.CLOUDFLARE_R2]: 'Cloudflare R2',
  [StorageAdapterType.S3_COMPATIBLE]: 'S3-Compatible Object Storage',
  [StorageAdapterType.GOOGLE_CLOUD_STORAGE]: 'Google Cloud Storage',
  [StorageAdapterType.CLOUD_OBJECT_STORAGE]: 'Cloud Object Storage',
  [StorageAdapterType.LOCAL_VOLUME]: 'Authorized Local Node Volume',
};

export function StorageServersView({
  notify,
}: {
  notify: (tone: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}) {
  const [pool, setPool] = useState<StoragePoolSummary | null>(null);
  const [servers, setServers] = useState<StorageServerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState<string | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<StorageServerRecord | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [adapterType, setAdapterType] = useState<StorageAdapterType>(
    StorageAdapterType.CLOUDFLARE_R2
  );
  const [endpointUrl, setEndpointUrl] = useState('');
  const [bucketOrVolume, setBucketOrVolume] = useState('');
  const [region, setRegion] = useState('auto');
  const [envCredentialPrefix, setEnvCredentialPrefix] = useState('');
  const [configuredCapacityGb, setConfiguredCapacityGb] = useState('500');
  const [backupDestinationId, setBackupDestinationId] = useState('');
  const [enabled, setEnabled] = useState(true);

  const [deletingTarget, setDeletingTarget] = useState<StorageServerRecord | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const loadStorage = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{
        pool: StoragePoolSummary;
        servers: StorageServerRecord[];
      }>('/api/v1/storage');
      setPool(res.pool);
      setServers(res.servers);
    } catch (err: unknown) {
      notify('error', 'Failed to load storage pool', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    loadStorage();
  }, [loadStorage]);

  const openAddServer = () => {
    setEditingServer(null);
    setName('');
    setAdapterType(StorageAdapterType.CLOUDFLARE_R2);
    setEndpointUrl('');
    setBucketOrVolume('');
    setRegion('auto');
    setEnvCredentialPrefix('');
    setConfiguredCapacityGb('500');
    setBackupDestinationId('');
    setEnabled(true);
    setModalOpen(true);
  };

  const openEditServer = (s: StorageServerRecord) => {
    setEditingServer(s);
    setName(s.name);
    setAdapterType(s.adapterType);
    setEndpointUrl(s.endpointUrl);
    setBucketOrVolume(s.bucketOrVolume);
    setRegion(s.region);
    setEnvCredentialPrefix(s.envCredentialPrefix);
    setConfiguredCapacityGb(
      String(Math.max(1, Math.round(s.configuredCapacityBytes / (1024 * 1024 * 1024))))
    );
    setBackupDestinationId(s.backupDestinationId || '');
    setEnabled(s.enabled);
    setModalOpen(true);
  };

  const handleSaveServer = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name,
        adapterType,
        endpointUrl,
        bucketOrVolume,
        region,
        envCredentialPrefix,
        configuredCapacityGb: Number(configuredCapacityGb) || 100,
        backupDestinationId: backupDestinationId || null,
        enabled,
      };

      if (editingServer) {
        await apiRequest(`/api/v1/storage/${editingServer.id}`, {
          method: 'PUT',
          body: payload,
        });
        notify('success', `Storage node "${name}" updated`);
      } else {
        await apiRequest('/api/v1/storage', {
          method: 'POST',
          body: payload,
        });
        notify(
          'success',
          `Storage node "${name}" added to pool`,
          'Run Test Connectivity to verify read/write reachability.'
        );
      }
      setModalOpen(false);
      await loadStorage();
    } catch (err: unknown) {
      notify('error', 'Failed to save storage server', err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const handleTestServer = async (s: StorageServerRecord) => {
    setTestingId(s.id);
    try {
      const res = await apiRequest<{
        result: { verified: boolean; latencyMs: number; message: string };
      }>(`/api/v1/storage/${s.id}/test`, { method: 'POST' });

      notify(
        res.result.verified ? 'success' : 'error',
        res.result.verified ? `Verified ${s.name}` : `Verification failed: ${s.name}`,
        res.result.message
      );
      await loadStorage();
    } catch (err: unknown) {
      notify('error', 'Connectivity probe failed', err instanceof Error ? err.message : undefined);
    } finally {
      setTestingId(null);
    }
  };

  const handleToggleEnabled = async (s: StorageServerRecord) => {
    try {
      await apiRequest(`/api/v1/storage/${s.id}`, {
        method: 'PUT',
        body: { enabled: !s.enabled },
      });
      notify('info', `${s.name} ${!s.enabled ? 'enabled in pool' : 'disabled from pool'}`);
      await loadStorage();
    } catch (err: unknown) {
      notify('error', 'Failed to toggle server', err instanceof Error ? err.message : undefined);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingTarget) return;
    setDeletingBusy(true);
    try {
      await apiRequest(`/api/v1/storage/${deletingTarget.id}`, { method: 'DELETE' });
      notify('success', 'Storage server removed from pool', deletingTarget.name);
      setDeletingTarget(null);
      await loadStorage();
    } catch (err: unknown) {
      notify('error', 'Cannot remove storage server', err instanceof Error ? err.message : undefined);
    } finally {
      setDeletingBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-100">
            Storage Server Pool Management
          </h1>
          <p className="mt-0.5 text-xs text-slate-400">
            All enabled storage servers aggregate into one unified KURO NAMI Logical Storage Pool.
            Nodes remain marked Untested until connectivity verification succeeds.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={loadStorage}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh Pool</span>
          </button>
          <button
            type="button"
            onClick={openAddServer}
            className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-500 whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            <span>Add Storage Server</span>
          </button>
        </div>
      </div>

      {/* Unified KURO NAMI Logical Storage Pool Summary */}
      {pool && (
        <section className="rounded-lg border border-slate-800 bg-[#111827] p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-100">
                Unified KURO NAMI Logical Storage Pool
              </h2>
              <p className="text-xs text-slate-400">
                Total Capacity = Sum(Configured) · Used Capacity = Sum(Actual Used) · Available =
                Total − Used
              </p>
            </div>
            <div className="font-mono text-xs text-slate-400 tabular-nums">
              {pool.verifiedConnectedServers} verified / {pool.enabledServers} enabled /{' '}
              {pool.totalServers} total nodes · {pool.totalFailedUploads} failed uploads
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-6 border-t border-b border-slate-800/80 py-4">
            <div>
              <div className="text-xs text-slate-400">Total Pool Capacity</div>
              <div className="mt-1 font-mono text-2xl font-semibold text-slate-100 tabular-nums">
                {formatBytes(pool.totalCapacityBytes)}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">
                Sum of enabled server capacities
              </div>
            </div>

            <div>
              <div className="text-xs text-slate-400">Used Pool Capacity</div>
              <div className="mt-1 font-mono text-2xl font-semibold text-sky-400 tabular-nums">
                {formatBytes(pool.usedCapacityBytes)}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">
                Sum of actual stored assets
              </div>
            </div>

            <div>
              <div className="text-xs text-slate-400">Available Pool Capacity</div>
              <div className="mt-1 font-mono text-2xl font-semibold text-emerald-400 tabular-nums">
                {formatBytes(pool.availableCapacityBytes)}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">Total minus used capacity</div>
            </div>

            <div>
              <div className="text-xs text-slate-400">Pool Utilization</div>
              <div className="mt-1 font-mono text-2xl font-semibold text-slate-100 tabular-nums">
                {pool.utilizationPercent}%
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded bg-slate-800">
                <div
                  className={`h-full transition-all ${
                    pool.utilizationPercent >= 85
                      ? 'bg-red-500'
                      : pool.utilizationPercent >= 65
                        ? 'bg-amber-500'
                        : 'bg-sky-500'
                  }`}
                  style={{ width: `${Math.min(100, pool.utilizationPercent)}%` }}
                />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Storage Servers Table */}
      <div className="rounded-lg border border-slate-800 bg-[#111827] overflow-hidden">
        {loading ? (
          <TableSkeleton rows={4} cols={5} />
        ) : servers.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <HardDrive className="mx-auto h-7 w-7 text-slate-600" />
            <h3 className="mt-3 font-display text-base font-semibold text-slate-200">
              No Storage Servers Configured in Pool
            </h3>
            <p className="mx-auto mt-1.5 max-w-lg text-xs leading-relaxed text-slate-400">
              Add Cloudflare R2, S3-compatible object storage, Google Cloud Storage, Cloud Object
              Storage, or an Authorized Local Node Volume to provision capacity for the unified
              KURO NAMI Storage Pool.
            </p>
            <button
              type="button"
              onClick={openAddServer}
              className="mt-5 inline-flex items-center gap-2 rounded-md bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-500"
            >
              <Plus className="h-4 w-4" />
              <span>Add First Storage Node</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs text-slate-400">
                  <th className="px-5 py-3 font-medium">Server & Adapter</th>
                  <th className="px-4 py-3 font-medium">Bucket / Endpoint / Backup</th>
                  <th className="px-4 py-3 font-medium">Health & Verification</th>
                  <th className="px-4 py-3 font-medium text-right">Used / Configured</th>
                  <th className="px-5 py-3 font-medium text-right">Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-sm">
                {servers.map((s) => {
                  const backupNode = servers.find((b) => b.id === s.backupDestinationId);
                  const nodeUtil =
                    s.configuredCapacityBytes > 0
                      ? Math.round((s.usedCapacityBytes / s.configuredCapacityBytes) * 10000) / 100
                      : 0;
                  return (
                    <tr key={s.id} className="hover:bg-slate-800/30">
                      <td className="px-5 py-3.5">
                        <div className="font-medium text-slate-100">{s.name}</div>
                        <div className="mt-0.5 text-xs text-slate-400">
                          {ADAPTER_LABELS[s.adapterType]} · {s.region}
                        </div>
                      </td>

                      <td className="px-4 py-3.5 text-xs">
                        <div className="font-mono text-slate-200">
                          Bucket/Vol: {s.bucketOrVolume}
                        </div>
                        <div className="mt-0.5 font-mono text-slate-500 truncate max-w-[240px]">
                          {s.endpointUrl || 'Local mounted filesystem'}
                        </div>
                        {backupNode && (
                          <div className="mt-0.5 text-[11px] text-sky-400">
                            Backup Target: {backupNode.name}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3.5">
                        <StorageStatusLabel status={s.healthStatus} isVerified={s.isVerified} />
                        <div className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
                          {s.lastTestedAt
                            ? `Tested ${formatTimestamp(s.lastTestedAt)} (${s.lastLatencyMs ?? 0}ms)`
                            : 'Never tested'}
                        </div>
                        {s.lastError && (
                          <div className="mt-0.5 max-w-[230px] truncate text-[11px] text-red-300">
                            {s.lastError}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3.5 text-right font-mono text-xs tabular-nums">
                        <div className="text-slate-200">
                          {formatBytes(s.usedCapacityBytes)} /{' '}
                          {formatBytes(s.configuredCapacityBytes)} ({nodeUtil}%)
                        </div>
                        <div className="mt-0.5 text-slate-500">
                          {s.assignedAssetsCount ?? 0} assets · {s.failedUploadsCount} failed
                          uploads
                        </div>
                      </td>

                      <td className="px-5 py-3.5 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={testingId === s.id}
                            onClick={() => handleTestServer(s)}
                            className="inline-flex items-center gap-1 rounded border border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
                          >
                            <Activity className="h-3.5 w-3.5" />
                            <span>
                              {testingId === s.id ? 'Testing...' : 'Test Connectivity'}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleEnabled(s)}
                            className="rounded border border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 whitespace-nowrap"
                          >
                            {s.enabled ? 'Disable' : 'Enable'}
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditServer(s)}
                            aria-label="Edit storage server"
                            className="rounded border border-slate-700 p-1.5 text-slate-300 hover:bg-slate-800"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingTarget(s)}
                            aria-label="Delete storage server"
                            className="rounded border border-slate-700 p-1.5 text-red-400 hover:bg-red-950/50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Storage Server Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={
          editingServer
            ? `Edit Storage Server: ${editingServer.name}`
            : 'Add Storage Server to Logical Pool'
        }
        subtitle="Credentials are resolved strictly on the backend via environment variable prefixes."
      >
        <form onSubmit={handleSaveServer} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300">Server Name *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. R2 Edge Tokyo-01"
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300">Storage Adapter *</label>
              <select
                value={adapterType}
                onChange={(e) => setAdapterType(e.target.value as StorageAdapterType)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
              >
                {Object.entries(ADAPTER_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {adapterType !== StorageAdapterType.LOCAL_VOLUME && (
            <div>
              <label className="block text-xs font-medium text-slate-300">
                Storage Endpoint URL
              </label>
              <input
                type="url"
                value={endpointUrl}
                onChange={(e) => setEndpointUrl(e.target.value)}
                placeholder="https://<account>.r2.cloudflarestorage.com"
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100"
              />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300">
                Bucket / Volume Name *
              </label>
              <input
                type="text"
                required
                value={bucketOrVolume}
                onChange={(e) => setBucketOrVolume(e.target.value)}
                placeholder="kuro-nami-media"
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300">Region</label>
              <input
                type="text"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="auto / ap-northeast-1"
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300">
                Configured Capacity (GB) *
              </label>
              <input
                type="number"
                min={1}
                max={1000000}
                required
                value={configuredCapacityGb}
                onChange={(e) => setConfiguredCapacityGb(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300">
                Server Env Credential Prefix
              </label>
              <input
                type="text"
                value={envCredentialPrefix}
                onChange={(e) => setEnvCredentialPrefix(e.target.value)}
                placeholder="e.g. R2_PRIMARY"
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Reads <code>PREFIX_ACCESS_KEY_ID</code> & <code>PREFIX_SECRET_ACCESS_KEY</code> on
                server.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300">
                Backup Destination Node
              </label>
              <select
                value={backupDestinationId}
                onChange={(e) => setBackupDestinationId(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
              >
                <option value="">None configured</option>
                {servers
                  .filter((s) => !editingServer || s.id !== editingServer.id)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.bucketOrVolume})
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2.5 pt-1 text-xs text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="rounded border-slate-700 bg-slate-900 text-sky-500"
            />
            <span>Include server capacity in active KURO NAMI Logical Storage Pool</span>
          </label>

          <div className="flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="rounded-md border border-slate-700 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {saving ? 'Saving...' : editingServer ? 'Update Server' : 'Add to Pool'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deletingTarget)}
        onCancel={() => setDeletingTarget(null)}
        onConfirm={handleConfirmDelete}
        title="Remove Storage Server"
        description={`Remove "${deletingTarget?.name}" from the KURO NAMI Storage Pool? Servers holding active assets cannot be deleted until reassigned.`}
        confirmLabel="Remove Server"
        destructive
        busy={deletingBusy}
      />
    </div>
  );
}

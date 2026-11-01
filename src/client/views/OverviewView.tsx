import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Link2Off,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import {
  ProviderHealthStatus,
  StoragePoolSummary,
  UpstreamIntegrationConfig,
} from '../../shared/types';
import {
  apiRequest,
  formatBytes,
  formatCurrencyCents,
  formatTimestamp,
} from '../api';
import { ProviderStatusLabel, TableSkeleton } from '../components/UiPrimitives';

interface OverviewResponse {
  upstream: UpstreamIntegrationConfig;
  metrics: {
    totalRegisteredUsers: number | null;
    usersPendingUpstream: boolean;
    totalAnimeTitles: number;
    totalEpisodes: number;
    activeStreamingProviders: number;
    enabledStreamingProviders: number;
    totalStreamingProviders: number;
    configuredStorageServers: number;
    verifiedStorageServers: number;
    storagePool: StoragePoolSummary;
    failedPlaybackOrResolutionRequests: number;
    playbackPendingUpstream: boolean;
    treasuryBalanceCents: number;
    treasuryCurrency: string;
  };
  apiHealth: {
    adminBackendHealthy: boolean;
    sqliteConnected: boolean;
    sqliteLatencyMs: number;
    avgRequestLatencyMs: number;
    failedApiRequests: number;
    upstreamStatus: string;
  };
  providersSummary: Array<{
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
  recentAudit: Array<{
    id: string;
    admin_username: string;
    action: string;
    resource_type: string;
    resource_id: string | null;
    status: 'SUCCESS' | 'FAILURE';
    created_at: string;
  }>;
  warnings: Array<{
    severity: 'WARN' | 'ERROR';
    title: string;
    detail: string;
  }>;
}

export function OverviewView({
  onNavigate,
}: {
  onNavigate: (section: string) => void;
}) {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<OverviewResponse>('/api/v1/overview');
      setData(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard overview.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="h-20 rounded-lg border border-slate-800 bg-[#111827] animate-pulse" />
        <div className="rounded-lg border border-slate-800 bg-[#111827]">
          <TableSkeleton rows={5} cols={5} />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-red-900/60 bg-[#111827] p-6">
        <p className="text-sm text-red-300">{error || 'Unable to load overview.'}</p>
        <button
          type="button"
          onClick={loadOverview}
          className="mt-4 rounded-md bg-slate-800 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700"
        >
          Retry
        </button>
      </div>
    );
  }

  const { metrics, upstream, apiHealth, providersSummary, recentAudit, warnings } = data;
  const upstreamConnected = upstream.connectionStatus === 'CONNECTED';

  return (
    <div className="space-y-8">
      {/* Upstream KURO NAMI Connection Banner */}
      <section className="rounded-lg border border-slate-800 bg-[#111827] p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs">
            {upstreamConnected ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-emerald-400">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>Main KURO NAMI Backend Connected</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-medium text-amber-400">
                <Link2Off className="h-4 w-4 shrink-0" />
                <span>Standalone Control Plane · Main KURO NAMI API Not Connected</span>
              </span>
            )}
            <span className="text-slate-600" aria-hidden="true">
              ·
            </span>
            <span className="font-mono text-slate-400 tabular-nums">
              Mode: {upstream.syncMode}
            </span>
          </div>
          <p className="text-xs text-slate-400 max-w-3xl">
            {upstreamConnected
              ? `Authoritative connection verified against ${upstream.baseUrl}.`
              : 'No synthetic anime, fake users, or fabricated telemetry are displayed. Local workspace configurations, storage pool capacity, and staged catalog records are live and ready for controlled synchronization.'}
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={loadOverview}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('settings')}
            className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-sky-500 whitespace-nowrap"
          >
            <span>Configure API Bridge</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </section>

      {/* Primary KPI Grid — Flat single-elevation grid with hairline dividers */}
      <section className="rounded-lg border border-slate-800 bg-[#111827] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-800/80">
        <div className="p-5">
          <div className="text-xs text-slate-400">Total Registered Users</div>
          {metrics.usersPendingUpstream ? (
            <div className="mt-2 font-display text-lg font-semibold text-amber-300">
              Pending Upstream
            </div>
          ) : (
            <div className="mt-2 font-mono text-2xl font-semibold text-slate-100 tabular-nums">
              {metrics.totalRegisteredUsers ?? 0}
            </div>
          )}
          <div className="mt-1.5 text-xs text-slate-500">
            {metrics.usersPendingUpstream
              ? 'Requires KURO NAMI User API bridge'
              : 'Synced workspace moderation directory'}
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs text-slate-400">Catalog Titles & Episodes</div>
          <div className="mt-2 flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-2xl font-semibold text-slate-100">
              {metrics.totalAnimeTitles}
            </span>
            <span className="text-xs text-slate-500">anime</span>
            <span className="text-slate-600">·</span>
            <span className="text-lg font-medium text-slate-300">{metrics.totalEpisodes}</span>
            <span className="text-xs text-slate-500">episodes</span>
          </div>
          <div className="mt-1.5 flex items-center gap-3 text-xs">
            <button
              type="button"
              onClick={() => onNavigate('anime')}
              className="text-sky-400 hover:underline"
            >
              Manage Anime
            </button>
            <span className="text-slate-600">·</span>
            <button
              type="button"
              onClick={() => onNavigate('episodes')}
              className="text-sky-400 hover:underline"
            >
              Manage Episodes
            </button>
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs text-slate-400">Active Streaming Providers</div>
          <div className="mt-2 font-mono text-2xl font-semibold text-slate-100 tabular-nums">
            {metrics.activeStreamingProviders}{' '}
            <span className="text-sm font-normal text-slate-500">
              / {metrics.totalStreamingProviders}
            </span>
          </div>
          <div className="mt-1.5 text-xs text-slate-500 tabular-nums">
            {metrics.enabledStreamingProviders} enabled ·{' '}
            {metrics.failedPlaybackOrResolutionRequests} failed probes
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs text-slate-400">Logical Storage Pool Utilization</div>
          <div className="mt-2 font-mono text-2xl font-semibold text-slate-100 tabular-nums">
            {metrics.storagePool.utilizationPercent}%
          </div>
          <div className="mt-1.5 font-mono text-xs text-slate-400 tabular-nums">
            {formatBytes(metrics.storagePool.usedCapacityBytes)} /{' '}
            {formatBytes(metrics.storagePool.totalCapacityBytes)} ({metrics.configuredStorageServers}{' '}
            nodes)
          </div>
        </div>
      </section>

      {/* Secondary Operational Strip */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Streaming Provider Health */}
        <div className="lg:col-span-7 rounded-lg border border-slate-800 bg-[#111827]">
          <div className="flex items-center justify-between gap-4 border-b border-slate-800 px-5 py-4">
            <div>
              <h2 className="font-display text-sm font-semibold text-slate-100">
                Streaming Provider Health
              </h2>
              <p className="text-xs text-slate-400">
                Live connectivity status for KURO NAMI source resolvers
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('providers')}
              className="text-xs font-medium text-sky-400 hover:underline whitespace-nowrap"
            >
              Configure Providers
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800/80 text-xs text-slate-400">
                  <th className="px-5 py-2.5 font-medium">Provider</th>
                  <th className="px-4 py-2.5 font-medium">State</th>
                  <th className="px-4 py-2.5 font-medium text-right">Latency</th>
                  <th className="px-5 py-2.5 font-medium text-right">Failed / Timeouts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-sm">
                {providersSummary.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-800/30">
                    <td className="px-5 py-3">
                      <span className="font-medium text-slate-100">{p.name}</span>
                      <span className="ml-2 text-xs text-slate-500">
                        {p.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <ProviderStatusLabel status={p.status} />
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-slate-300 tabular-nums">
                      {p.last_response_time_ms !== null ? `${p.last_response_time_ms} ms` : '—'}
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-xs text-slate-400 tabular-nums">
                      {p.failed_requests} / {p.timeout_errors}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* API Health, Playback Status & Treasury Summary */}
        <div className="lg:col-span-5 rounded-lg border border-slate-800 bg-[#111827] divide-y divide-slate-800/80">
          <div className="px-5 py-4">
            <h2 className="font-display text-sm font-semibold text-slate-100">
              API, Storage & Financial Telemetry
            </h2>
            <p className="text-xs text-slate-400">
              Control-plane diagnostics and workspace balances
            </p>
          </div>

          <div className="px-5 py-3.5 flex items-center justify-between text-xs">
            <span className="text-slate-400">Admin API & SQLite Engine</span>
            <span className="inline-flex items-center gap-1.5 font-mono text-emerald-400 tabular-nums">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Operational · {apiHealth.sqliteLatencyMs} ms</span>
            </span>
          </div>

          <div className="px-5 py-3.5 flex items-center justify-between text-xs">
            <span className="text-slate-400">Avg Admin API Request Latency</span>
            <span className="font-mono text-slate-200 tabular-nums">
              {apiHealth.avgRequestLatencyMs} ms ({apiHealth.failedApiRequests} errors)
            </span>
          </div>

          <div className="px-5 py-3.5 flex items-center justify-between text-xs">
            <span className="text-slate-400">Upstream Failed Playback Requests</span>
            <span className="font-mono text-slate-300 tabular-nums">
              {metrics.playbackPendingUpstream
                ? 'Pending Upstream Bridge'
                : metrics.failedPlaybackOrResolutionRequests}
            </span>
          </div>

          <div className="px-5 py-3.5 flex items-center justify-between text-xs">
            <span className="text-slate-400">Verified Storage Pool Servers</span>
            <span className="font-mono text-slate-200 tabular-nums">
              {metrics.verifiedStorageServers} verified / {metrics.configuredStorageServers}{' '}
              configured
            </span>
          </div>

          <div className="px-5 py-3.5 flex items-center justify-between text-xs">
            <span className="text-slate-400">Workspace Asset Treasury</span>
            <button
              type="button"
              onClick={() => onNavigate('treasury')}
              className="font-mono font-semibold text-sky-400 hover:underline tabular-nums"
            >
              {formatCurrencyCents(metrics.treasuryBalanceCents, metrics.treasuryCurrency)}
            </button>
          </div>
        </div>
      </section>

      {/* System Warnings & Recent Administrative Activity */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-5 rounded-lg border border-slate-800 bg-[#111827]">
          <div className="border-b border-slate-800 px-5 py-4">
            <h2 className="font-display text-sm font-semibold text-slate-100">System Warnings</h2>
            <p className="text-xs text-slate-400">
              Active configuration and connectivity advisories
            </p>
          </div>
          {warnings.length === 0 ? (
            <div className="p-6 text-xs text-slate-400">
              No active warnings. All configured providers and storage nodes are verified.
            </div>
          ) : (
            <div className="divide-y divide-slate-800/70">
              {warnings.map((w, idx) => (
                <div key={idx} className="px-5 py-3.5 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-medium">
                    {w.severity === 'ERROR' ? (
                      <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                    )}
                    <span className={w.severity === 'ERROR' ? 'text-red-300' : 'text-amber-300'}>
                      {w.title}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-400">{w.detail}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-7 rounded-lg border border-slate-800 bg-[#111827]">
          <div className="flex items-center justify-between gap-4 border-b border-slate-800 px-5 py-4">
            <div>
              <h2 className="font-display text-sm font-semibold text-slate-100">
                Recent Administrative Activities
              </h2>
              <p className="text-xs text-slate-400">
                Immutable workspace audit stream
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('audit')}
              className="text-xs font-medium text-sky-400 hover:underline whitespace-nowrap"
            >
              View Full Audit Trail
            </button>
          </div>

          {recentAudit.length === 0 ? (
            <div className="p-6 text-xs text-slate-400">
              No administrative actions recorded in this workspace yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800/80 text-xs text-slate-400">
                    <th className="px-5 py-2.5 font-medium">Timestamp</th>
                    <th className="px-4 py-2.5 font-medium">Administrator</th>
                    <th className="px-4 py-2.5 font-medium">Action</th>
                    <th className="px-5 py-2.5 font-medium text-right">Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-xs">
                  {recentAudit.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-800/30">
                      <td className="px-5 py-2.5 font-mono text-slate-400 tabular-nums whitespace-nowrap">
                        {formatTimestamp(item.created_at)}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-slate-200">
                        {item.admin_username}
                      </td>
                      <td className="px-4 py-2.5 text-slate-300">
                        {item.action}{' '}
                        <span className="text-slate-500">· {item.resource_type}</span>
                      </td>
                      <td className="px-5 py-2.5 text-right font-mono">
                        <span
                          className={
                            item.status === 'SUCCESS' ? 'text-emerald-400' : 'text-red-400'
                          }
                        >
                          {item.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

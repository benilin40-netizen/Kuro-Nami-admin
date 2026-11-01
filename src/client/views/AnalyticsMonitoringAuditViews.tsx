import React, { useCallback, useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  CheckCircle2,
  Download,
  Eye,
  Link2Off,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import {
  AuditLogRecord,
  LogSeverity,
  ProviderHealthStatus,
  StoragePoolSummary,
  SystemLogRecord,
} from '../../shared/types';
import {
  apiRequest,
  downloadTextFile,
  formatBytes,
  formatTimestamp,
} from '../api';
import { Modal, ProviderStatusLabel, TableSkeleton } from '../components/UiPrimitives';

// ============================================================================
// ANALYTICS & REPORTING VIEW (§11)
// ============================================================================

interface AnalyticsResponse {
  upstreamConnected: boolean;
  upstreamStatus: string;
  adminActivityByDay: Array<{ day: string; actions_count: number; failed_count: number }>;
  userRegistrationsByDay: Array<{ day: string; registrations: number }>;
  providerPerformance: Array<{
    name: string;
    slug: string;
    status: ProviderHealthStatus;
    last_response_time_ms: number | null;
    total_requests: number;
    failed_requests: number;
    timeout_errors: number;
    resolution_attempts: number;
    resolution_successes: number;
    availability_percent: number | null;
  }>;
  storageUsage: {
    pool: StoragePoolSummary;
    servers: Array<{
      name: string;
      adapterType: string;
      configuredBytes: number;
      usedBytes: number;
      enabled: boolean;
      isVerified: boolean;
    }>;
  };
  apiLatencySamples: Array<{
    timestamp: string;
    method: string;
    path: string;
    statusCode: number;
    latencyMs: number;
  }>;
  playbackTelemetry: {
    availableFromUpstream: boolean;
    note: string;
  };
}

export function AnalyticsView({
  notify,
}: {
  notify: (tone: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}) {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (fromDate && toDate) {
        qs.set('from', fromDate);
        qs.set('to', toDate);
      }
      const res = await apiRequest<AnalyticsResponse>(`/api/v1/analytics?${qs.toString()}`);
      setData(res);
    } catch (err: unknown) {
      notify('error', 'Failed to load analytics', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, notify]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  const handleExportJson = () => {
    if (!data) return;
    downloadTextFile(
      `kuro-nami-analytics-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(data, null, 2),
      'application/json'
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-100">
            Analytics & Reporting
          </h1>
          <p className="mt-0.5 text-xs text-slate-400">
            Real operational telemetry across administrative actions, provider performance, API
            response times, and storage pool usage. Upstream viewer playback metrics remain cleanly
            marked pending until connected.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="rounded-md border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 font-mono text-xs text-slate-200"
          />
          <span className="text-xs text-slate-500">to</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="rounded-md border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 font-mono text-xs text-slate-200"
          />
          <button
            type="button"
            onClick={loadAnalytics}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Apply</span>
          </button>
          <button
            type="button"
            disabled={!data}
            onClick={handleExportJson}
            className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-40 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export JSON Report</span>
          </button>
        </div>
      </div>

      {loading || !data ? (
        <div className="rounded-lg border border-slate-800 bg-[#111827]">
          <TableSkeleton rows={5} cols={5} />
        </div>
      ) : (
        <>
          {/* Upstream Playback & Most-Watched Notice */}
          <div className="rounded-lg border border-slate-800 bg-[#111827] p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-sm font-semibold text-slate-100">
                  Most-Watched Anime, Most-Watched Episodes & Playback Success Rates
                </h2>
                <p className="mt-1 text-xs text-slate-400">{data.playbackTelemetry.note}</p>
              </div>
              {!data.upstreamConnected && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 whitespace-nowrap">
                  <Link2Off className="h-3.5 w-3.5" />
                  <span>Pending Upstream Connection</span>
                </span>
              )}
            </div>
          </div>

          {/* Charts Row: Administrative Activity & API Response Latency */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-lg border border-slate-800 bg-[#111827] p-5">
              <h2 className="font-display text-sm font-semibold text-slate-100">
                Administrative Activity by Day
              </h2>
              <p className="text-xs text-slate-400">
                Actual workspace audit events recorded in SQLite
              </p>
              <div className="mt-4 h-60">
                {data.adminActivityByDay.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-xs text-slate-500">
                    No administrative events within selected date window.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.adminActivityByDay}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                      <XAxis dataKey="day" stroke="#64748B" fontSize={11} />
                      <YAxis stroke="#64748B" fontSize={11} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#0B0F17',
                          borderColor: '#1E293B',
                          fontSize: '12px',
                        }}
                      />
                      <Bar dataKey="actions_count" name="Total Actions" fill="#0284C7" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="failed_count" name="Failed Actions" fill="#DC2626" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-[#111827] p-5">
              <h2 className="font-display text-sm font-semibold text-slate-100">
                Admin API Request Latency (ms)
              </h2>
              <p className="text-xs text-slate-400">
                Live sampled HTTP execution durations on this server
              </p>
              <div className="mt-4 h-60">
                {data.apiLatencySamples.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-xs text-slate-500">
                    No request latency samples recorded yet.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={data.apiLatencySamples.map((s, idx) => ({
                        idx: idx + 1,
                        latencyMs: s.latencyMs,
                        path: s.path,
                      }))}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                      <XAxis dataKey="idx" stroke="#64748B" fontSize={11} />
                      <YAxis stroke="#64748B" fontSize={11} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#0B0F17',
                          borderColor: '#1E293B',
                          fontSize: '12px',
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="latencyMs"
                        name="Latency (ms)"
                        stroke="#38BDF8"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          {/* Provider Performance & Storage Node Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-lg border border-slate-800 bg-[#111827] overflow-hidden">
              <div className="border-b border-slate-800 px-5 py-4">
                <h2 className="font-display text-sm font-semibold text-slate-100">
                  Streaming Provider Performance
                </h2>
                <p className="text-xs text-slate-400">
                  Measured probe response times and source-resolution rates
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-xs text-slate-400">
                      <th className="px-5 py-2.5 font-medium">Provider</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="px-4 py-2.5 font-medium text-right">Latency</th>
                      <th className="px-5 py-2.5 font-medium text-right">Availability</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-xs">
                    {data.providerPerformance.map((p) => (
                      <tr key={p.slug}>
                        <td className="px-5 py-2.5 font-medium text-slate-200">{p.name}</td>
                        <td className="px-4 py-2.5">
                          <ProviderStatusLabel status={p.status} />
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-slate-300 tabular-nums">
                          {p.last_response_time_ms !== null ? `${p.last_response_time_ms} ms` : '—'}
                        </td>
                        <td className="px-5 py-2.5 text-right font-mono text-slate-300 tabular-nums">
                          {p.availability_percent !== null ? `${p.availability_percent}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-[#111827] p-5">
              <h2 className="font-display text-sm font-semibold text-slate-100">
                Storage Pool & User Registration Summary
              </h2>
              <div className="mt-3 space-y-3 text-xs">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                  <span className="text-slate-400">Logical Pool Total Capacity</span>
                  <span className="font-mono text-slate-100 tabular-nums">
                    {formatBytes(data.storageUsage.pool.totalCapacityBytes)}
                  </span>
                </div>
                <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                  <span className="text-slate-400">Logical Pool Used Capacity</span>
                  <span className="font-mono text-sky-400 tabular-nums">
                    {formatBytes(data.storageUsage.pool.usedCapacityBytes)} (
                    {data.storageUsage.pool.utilizationPercent}%)
                  </span>
                </div>
                <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                  <span className="text-slate-400">Logical Pool Available Capacity</span>
                  <span className="font-mono text-emerald-400 tabular-nums">
                    {formatBytes(data.storageUsage.pool.availableCapacityBytes)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Synced User Registration Days</span>
                  <span className="font-mono text-slate-300 tabular-nums">
                    {data.userRegistrationsByDay.length > 0
                      ? `${data.userRegistrationsByDay.length} day(s) recorded`
                      : 'Pending Upstream User Feed'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================================
// SYSTEM MONITORING VIEW (§12)
// ============================================================================

interface MonitoringResponse {
  runtime: {
    status: string;
    uptimeSeconds: number;
    nodeVersion: string;
    memoryRssBytes: number;
    sqliteConnected: boolean;
    sqliteLatencyMs: number;
  };
  telemetry: {
    totalSampledRequests: number;
    failedApiRequests: number;
    serverErrors: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
  };
  authFailuresCount: number;
  upstream: {
    connectionStatus: string;
    baseUrl: string;
  };
  logs: SystemLogRecord[];
}

export function SystemMonitoringView({
  notify,
}: {
  notify: (tone: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}) {
  const [data, setData] = useState<MonitoringResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [search, setSearch] = useState('');

  const loadMonitoring = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (severityFilter !== 'ALL') qs.set('severity', severityFilter);
      if (search.trim()) qs.set('search', search.trim());

      const res = await apiRequest<MonitoringResponse>(`/api/v1/monitoring?${qs.toString()}`);
      setData(res);
    } catch (err: unknown) {
      notify('error', 'Failed to load monitoring data', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [severityFilter, search, notify]);

  useEffect(() => {
    loadMonitoring();
  }, [loadMonitoring]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-100">System Monitoring</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            Real-time technical diagnostics for backend health, SQLite WAL latency, API errors,
            authentication failures, and secret-redacted system logs.
          </p>
        </div>

        <button
          type="button"
          onClick={loadMonitoring}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap self-start"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Refresh Telemetry</span>
        </button>
      </div>

      {data && (
        <div className="rounded-lg border border-slate-800 bg-[#111827] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-slate-800">
          <div className="p-4">
            <div className="text-xs text-slate-400">Backend & Database</div>
            <div className="mt-1.5 inline-flex items-center gap-1.5 font-mono text-sm font-semibold text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              <span>{data.runtime.status}</span>
            </div>
            <div className="mt-1 font-mono text-[11px] text-slate-500 tabular-nums">
              SQLite: {data.runtime.sqliteLatencyMs} ms · Up {data.runtime.uptimeSeconds}s
            </div>
          </div>

          <div className="p-4">
            <div className="text-xs text-slate-400">Avg / P95 API Latency</div>
            <div className="mt-1.5 font-mono text-lg font-semibold text-slate-100 tabular-nums">
              {data.telemetry.avgLatencyMs} ms{' '}
              <span className="text-xs font-normal text-slate-400">
                / {data.telemetry.p95LatencyMs} ms
              </span>
            </div>
            <div className="mt-1 font-mono text-[11px] text-slate-500 tabular-nums">
              {data.telemetry.totalSampledRequests} sampled reqs
            </div>
          </div>

          <div className="p-4">
            <div className="text-xs text-slate-400">Failed API Requests</div>
            <div className="mt-1.5 font-mono text-lg font-semibold text-slate-100 tabular-nums">
              {data.telemetry.failedApiRequests}
            </div>
            <div className="mt-1 font-mono text-[11px] text-slate-500 tabular-nums">
              {data.telemetry.serverErrors} HTTP 5xx errors
            </div>
          </div>

          <div className="p-4">
            <div className="text-xs text-slate-400">Authentication Failures</div>
            <div className="mt-1.5 font-mono text-lg font-semibold text-amber-300 tabular-nums">
              {data.authFailuresCount}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">Invalid login / lockout attempts</div>
          </div>

          <div className="p-4">
            <div className="text-xs text-slate-400">Runtime Memory (RSS)</div>
            <div className="mt-1.5 font-mono text-lg font-semibold text-slate-100 tabular-nums">
              {formatBytes(data.runtime.memoryRssBytes)}
            </div>
            <div className="mt-1 font-mono text-[11px] text-slate-500">
              Node {data.runtime.nodeVersion}
            </div>
          </div>
        </div>
      )}

      {/* Searchable Severity Logs */}
      <div className="rounded-lg border border-slate-800 bg-[#111827] overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-slate-800 p-4">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search component or log message..."
              className="w-full rounded-md border border-slate-700 bg-[#0B0F17] pl-9 pr-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 rounded-md bg-[#0B0F17] p-1 border border-slate-800">
            {['ALL', LogSeverity.INFO, LogSeverity.WARN, LogSeverity.ERROR, LogSeverity.CRITICAL].map(
              (sev) => (
                <button
                  key={sev}
                  type="button"
                  onClick={() => setSeverityFilter(sev)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                    severityFilter === sev
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {sev}
                </button>
              )
            )}
          </div>
        </div>

        {loading || !data ? (
          <TableSkeleton rows={5} cols={4} />
        ) : data.logs.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            No matching system log entries found.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[460px]">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs text-slate-400">
                  <th className="px-5 py-2.5 font-medium">Timestamp</th>
                  <th className="px-4 py-2.5 font-medium">Severity</th>
                  <th className="px-4 py-2.5 font-medium">Component</th>
                  <th className="px-5 py-2.5 font-medium">Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {data.logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-800/30">
                    <td className="px-5 py-2.5 font-mono text-slate-400 tabular-nums whitespace-nowrap">
                      {formatTimestamp(log.createdAt)}
                    </td>
                    <td className="px-4 py-2.5 font-mono font-semibold">
                      <span
                        className={
                          log.severity === LogSeverity.ERROR ||
                          log.severity === LogSeverity.CRITICAL
                            ? 'text-red-400'
                            : log.severity === LogSeverity.WARN
                              ? 'text-amber-300'
                              : 'text-sky-400'
                        }
                      >
                        {log.severity}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-300 whitespace-nowrap">
                      {log.component}
                    </td>
                    <td className="px-5 py-2.5 text-slate-200">{log.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// ADMINISTRATIVE AUDIT LOGS VIEW (§13)
// ============================================================================

export function AuditLogsView({
  notify,
}: {
  notify: (tone: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}) {
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedDiff, setSelectedDiff] = useState<AuditLogRecord | null>(null);

  const loadAuditLogs = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set('search', search.trim());
      if (statusFilter !== 'ALL') qs.set('status', statusFilter);

      const res = await apiRequest<{ items: AuditLogRecord[] }>(
        `/api/v1/audit-logs?${qs.toString()}`
      );
      setLogs(res.items);
    } catch (err: unknown) {
      notify('error', 'Failed to load audit logs', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, notify]);

  useEffect(() => {
    loadAuditLogs();
  }, [loadAuditLogs]);

  const handleExportAuditCsv = () => {
    const header =
      'id,timestamp,administrator,action,resource_type,resource_id,status,ip_address\n';
    const rows = logs
      .map(
        (l) =>
          `${l.id},${l.createdAt},"${l.adminUsername}",${l.action},${l.resourceType},${
            l.resourceId || ''
          },${l.status},${l.ipAddress}`
      )
      .join('\n');
    downloadTextFile(
      `kuro-nami-audit-logs-${new Date().toISOString().slice(0, 10)}.csv`,
      header + rows,
      'text/csv'
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-100">
            Administrative Audit Logs
          </h1>
          <p className="mt-0.5 text-xs text-slate-400">
            Tamper-protected record of every administrative action, before/after state mutation, and
            outcome within this workspace. Enforced by database triggers preventing UPDATE or
            DELETE.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={loadAuditLogs}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            disabled={logs.length === 0}
            onClick={handleExportAuditCsv}
            className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-40 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export Audit CSV</span>
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-[#111827] overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-800 p-4">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search administrator, action, resource ID, or IP..."
              className="w-full rounded-md border border-slate-700 bg-[#0B0F17] pl-9 pr-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden md:inline-flex items-center gap-1.5 text-xs text-emerald-400 mr-2">
              <ShieldCheck className="h-4 w-4" />
              <span>Append-Only Enforced</span>
            </div>
            <div className="flex items-center gap-1 rounded-md bg-[#0B0F17] p-1 border border-slate-800">
              {['ALL', 'SUCCESS', 'FAILURE'].map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                    statusFilter === st
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            No matching audit log entries found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs text-slate-400">
                  <th className="px-5 py-3 font-medium">Timestamp</th>
                  <th className="px-4 py-3 font-medium">Administrator & IP</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Affected Resource</th>
                  <th className="px-4 py-3 font-medium">Outcome</th>
                  <th className="px-5 py-3 font-medium text-right">Payload</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {logs.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-800/30">
                    <td className="px-5 py-3 font-mono text-slate-400 tabular-nums whitespace-nowrap">
                      {formatTimestamp(entry.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-200">{entry.adminUsername}</div>
                      <div className="font-mono text-[11px] text-slate-500">{entry.ipAddress}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-200">{entry.action}</td>
                    <td className="px-4 py-3 font-mono text-slate-300">
                      {entry.resourceType}
                      {entry.resourceId ? ` · ${entry.resourceId}` : ''}
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold">
                      <span
                        className={
                          entry.status === 'SUCCESS' ? 'text-emerald-400' : 'text-red-400'
                        }
                      >
                        {entry.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedDiff(entry)}
                        className="inline-flex items-center gap-1 rounded border border-slate-700 px-2.5 py-1 text-slate-200 hover:bg-slate-800 whitespace-nowrap"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>Inspect</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Audit Diff Inspector Modal */}
      <Modal
        open={Boolean(selectedDiff)}
        onClose={() => setSelectedDiff(null)}
        title={`Audit Record: ${selectedDiff?.action || ''}`}
        subtitle={`${selectedDiff?.id || ''} · ${formatTimestamp(selectedDiff?.createdAt)}`}
      >
        {selectedDiff && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3 rounded border border-slate-800 bg-[#0B0F17] p-3">
              <div>
                <span className="text-slate-400">Administrator:</span>{' '}
                <strong className="text-slate-100">{selectedDiff.adminUsername}</strong>
              </div>
              <div>
                <span className="text-slate-400">Outcome:</span>{' '}
                <strong className="font-mono text-slate-100">{selectedDiff.status}</strong>
              </div>
              <div>
                <span className="text-slate-400">Resource:</span>{' '}
                <span className="font-mono text-slate-200">
                  {selectedDiff.resourceType} ({selectedDiff.resourceId || 'n/a'})
                </span>
              </div>
              <div>
                <span className="text-slate-400">Client IP:</span>{' '}
                <span className="font-mono text-slate-200">{selectedDiff.ipAddress}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="font-semibold text-slate-300 mb-1.5">Previous Value</div>
                <pre className="rounded border border-slate-800 bg-[#0B0F17] p-3 font-mono text-[11px] text-slate-300 overflow-x-auto max-h-60">
                  {selectedDiff.previousValue
                    ? JSON.stringify(JSON.parse(selectedDiff.previousValue), null, 2)
                    : 'null'}
                </pre>
              </div>
              <div>
                <div className="font-semibold text-slate-300 mb-1.5">New Value</div>
                <pre className="rounded border border-slate-800 bg-[#0B0F17] p-3 font-mono text-[11px] text-emerald-300 overflow-x-auto max-h-60">
                  {selectedDiff.newValue
                    ? JSON.stringify(JSON.parse(selectedDiff.newValue), null, 2)
                    : 'null'}
                </pre>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

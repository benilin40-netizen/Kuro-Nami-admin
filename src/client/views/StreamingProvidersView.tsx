import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Edit3,
  Plus,
  RefreshCw,
  Search,
  Sliders,
} from 'lucide-react';
import { ProviderHealthStatus, StreamingProviderRecord } from '../../shared/types';
import { apiRequest, formatTimestamp } from '../api';
import { Modal, ProviderStatusLabel, TableSkeleton } from '../components/UiPrimitives';

interface ProviderLogItem {
  id: string;
  provider_id: string;
  provider_name: string;
  event_type: string;
  status_code: number | null;
  latency_ms: number | null;
  success: number;
  message: string;
  created_at: string;
}

export function StreamingProvidersView({
  notify,
}: {
  notify: (tone: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}) {
  const [providers, setProviders] = useState<StreamingProviderRecord[]>([]);
  const [logs, setLogs] = useState<ProviderLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [logSearch, setLogSearch] = useState('');

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<StreamingProviderRecord | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [healthEndpoint, setHealthEndpoint] = useState('/');
  const [envSecretVar, setEnvSecretVar] = useState('');
  const [timeoutMs, setTimeoutMs] = useState('8000');
  const [retryCount, setRetryCount] = useState('2');
  const [fallbackPriority, setFallbackPriority] = useState('1');
  const [enabled, setEnabled] = useState(false);

  const loadProviders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{
        providers: StreamingProviderRecord[];
        logs: ProviderLogItem[];
      }>('/api/v1/providers');
      setProviders(res.providers);
      setLogs(res.logs);
    } catch (err: unknown) {
      notify('error', 'Failed to load streaming providers', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  const openAddProvider = () => {
    setEditingProvider(null);
    setName('');
    setSlug('');
    setBaseUrl('');
    setHealthEndpoint('/');
    setEnvSecretVar('');
    setTimeoutMs('8000');
    setRetryCount('2');
    setFallbackPriority(String(providers.length + 1));
    setEnabled(false);
    setModalOpen(true);
  };

  const openEditProvider = (p: StreamingProviderRecord) => {
    setEditingProvider(p);
    setName(p.name);
    setSlug(p.slug);
    setBaseUrl(p.baseUrl);
    setHealthEndpoint(p.healthEndpoint || '/');
    setEnvSecretVar(p.envSecretVar);
    setTimeoutMs(String(p.timeoutMs));
    setRetryCount(String(p.retryCount));
    setFallbackPriority(String(p.fallbackPriority));
    setEnabled(p.enabled);
    setModalOpen(true);
  };

  const handleSaveProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name,
        slug: slug || undefined,
        baseUrl,
        healthEndpoint,
        envSecretVar,
        timeoutMs: Number(timeoutMs) || 8000,
        retryCount: Number(retryCount) || 0,
        fallbackPriority: Number(fallbackPriority) || 1,
        enabled,
      };

      if (editingProvider) {
        await apiRequest(`/api/v1/providers/${editingProvider.id}`, {
          method: 'PUT',
          body: payload,
        });
        notify('success', `Updated ${editingProvider.name} configuration`);
      } else {
        await apiRequest('/api/v1/providers', {
          method: 'POST',
          body: payload,
        });
        notify('success', `Added streaming provider ${name}`);
      }
      setModalOpen(false);
      await loadProviders();
    } catch (err: unknown) {
      notify('error', 'Failed to save provider', err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async (p: StreamingProviderRecord) => {
    try {
      await apiRequest(`/api/v1/providers/${p.id}`, {
        method: 'PUT',
        body: { enabled: !p.enabled },
      });
      notify('info', `${p.name} ${!p.enabled ? 'enabled' : 'disabled'}`);
      await loadProviders();
    } catch (err: unknown) {
      notify('error', 'Toggle failed', err instanceof Error ? err.message : undefined);
    }
  };

  const handleTestConnectivity = async (p: StreamingProviderRecord) => {
    setTestingId(p.id);
    try {
      const res = await apiRequest<{
        probe: { status: ProviderHealthStatus; latencyMs: number | null; message: string };
      }>(`/api/v1/providers/${p.id}/test`, { method: 'POST' });

      notify(
        res.probe.status === ProviderHealthStatus.CONNECTED ? 'success' : 'info',
        `${p.name}: ${res.probe.status}`,
        res.probe.message
      );
      await loadProviders();
    } catch (err: unknown) {
      notify('error', `Probe failed for ${p.name}`, err instanceof Error ? err.message : undefined);
    } finally {
      setTestingId(null);
    }
  };

  const filteredLogs = logs.filter((l) => {
    if (!logSearch.trim()) return true;
    return `${l.provider_name} ${l.message} ${l.event_type}`
      .toLowerCase()
      .includes(logSearch.trim().toLowerCase());
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-100">
            Streaming Provider Management
          </h1>
          <p className="mt-0.5 text-xs text-slate-400">
            Configure endpoints, fallback priorities, retry policies, and live connectivity for
            AnimePahe, VCDN, media.cm, CoorenLabs, and custom upstream resolvers. Private keys stay
            strictly in backend environment variables.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={loadProviders}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={openAddProvider}
            className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-500 whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            <span>Add Provider</span>
          </button>
        </div>
      </div>

      {/* Providers Matrix */}
      <div className="rounded-lg border border-slate-800 bg-[#111827] overflow-hidden">
        {loading ? (
          <TableSkeleton rows={4} cols={5} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs text-slate-400">
                  <th className="px-5 py-3 font-medium">Priority & Provider</th>
                  <th className="px-4 py-3 font-medium">Endpoint & Env Secret</th>
                  <th className="px-4 py-3 font-medium">Health State</th>
                  <th className="px-4 py-3 font-medium text-right">Response / Policy</th>
                  <th className="px-4 py-3 font-medium text-right">Availability & Resolution</th>
                  <th className="px-5 py-3 font-medium text-right">Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-sm">
                {providers.map((p) => {
                  const resRate =
                    p.resolutionAttempts > 0
                      ? `${Math.round((p.resolutionSuccesses / p.resolutionAttempts) * 100)}%`
                      : '—';
                  return (
                    <tr key={p.id} className="hover:bg-slate-800/30">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono text-xs text-slate-400 tabular-nums">
                            #{p.fallbackPriority}
                          </span>
                          <div>
                            <div className="font-medium text-slate-100">{p.name}</div>
                            <div className="text-xs text-slate-500 font-mono">
                              {p.slug} · {p.enabled ? 'Enabled' : 'Disabled'}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3.5 text-xs">
                        <div className="font-mono text-slate-200 truncate max-w-[230px]">
                          {p.baseUrl || 'Endpoint URL not set'}
                        </div>
                        <div className="mt-0.5 text-slate-400 font-mono">
                          Env: {p.envSecretVar || 'None'} ·{' '}
                          <span className={p.hasEnvSecret ? 'text-emerald-400' : 'text-slate-500'}>
                            {p.hasEnvSecret ? 'Key Loaded on Server' : 'No Env Key Set'}
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-3.5">
                        <ProviderStatusLabel status={p.status} />
                        {p.lastErrorMessage && (
                          <div className="mt-1 max-w-[220px] truncate text-[11px] text-red-300/90">
                            {p.lastErrorMessage}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3.5 text-right font-mono text-xs tabular-nums">
                        <div className="text-slate-200">
                          {p.lastResponseTimeMs !== null ? `${p.lastResponseTimeMs} ms` : '—'}
                        </div>
                        <div className="mt-0.5 text-slate-500">
                          {p.timeoutMs}ms · {p.retryCount} retries
                        </div>
                      </td>

                      <td className="px-4 py-3.5 text-right font-mono text-xs tabular-nums">
                        <div className="text-slate-200">
                          Avail:{' '}
                          {p.availabilityPercent !== null ? `${p.availabilityPercent}%` : '—'} ·
                          Res: {resRate}
                        </div>
                        <div className="mt-0.5 text-slate-500">
                          {p.failedRequests} failed · {p.timeoutErrors} timeouts
                        </div>
                      </td>

                      <td className="px-5 py-3.5 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={testingId === p.id}
                            onClick={() => handleTestConnectivity(p)}
                            className="inline-flex items-center gap-1 rounded border border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
                          >
                            <Activity className="h-3.5 w-3.5" />
                            <span>{testingId === p.id ? 'Testing...' : 'Test'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleEnabled(p)}
                            className="rounded border border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 whitespace-nowrap"
                          >
                            {p.enabled ? 'Disable' : 'Enable'}
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditProvider(p)}
                            aria-label={`Configure ${p.name}`}
                            className="rounded border border-slate-700 p-1.5 text-slate-300 hover:bg-slate-800"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
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

      {/* Provider Connectivity Logs */}
      <div className="rounded-lg border border-slate-800 bg-[#111827]">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-800 px-5 py-4">
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-100">
              Provider Connectivity & Probe Logs
            </h2>
            <p className="text-xs text-slate-400">
              Chronological response codes, timeouts, and resolution diagnostics (secrets redacted)
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
            <input
              type="text"
              value={logSearch}
              onChange={(e) => setLogSearch(e.target.value)}
              placeholder="Filter provider logs..."
              className="w-full rounded-md border border-slate-700 bg-[#0B0F17] pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
            />
          </div>
        </div>

        {filteredLogs.length === 0 ? (
          <div className="p-6 text-xs text-slate-400">
            No provider probe logs recorded yet. Run "Test" on any provider above to verify live
            connectivity.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-80">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs text-slate-400">
                  <th className="px-5 py-2.5 font-medium">Timestamp</th>
                  <th className="px-4 py-2.5 font-medium">Provider</th>
                  <th className="px-4 py-2.5 font-medium">HTTP / Latency</th>
                  <th className="px-5 py-2.5 font-medium">Diagnostic Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {filteredLogs.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-800/30">
                    <td className="px-5 py-2.5 font-mono text-slate-400 tabular-nums whitespace-nowrap">
                      {formatTimestamp(l.created_at)}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-slate-200">{l.provider_name}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-300 tabular-nums whitespace-nowrap">
                      {l.status_code ? `HTTP ${l.status_code}` : 'ERR'} ·{' '}
                      {l.latency_ms !== null ? `${l.latency_ms} ms` : '—'}
                    </td>
                    <td
                      className={`px-5 py-2.5 ${
                        l.success ? 'text-emerald-300' : 'text-amber-300'
                      }`}
                    >
                      {l.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Configure Provider Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={
          editingProvider
            ? `Configure Streaming Provider: ${editingProvider.name}`
            : 'Add Streaming Provider Configuration'
        }
        subtitle="Private API tokens are referenced by environment variable name on the backend and never transmitted to browser storage."
      >
        <form onSubmit={handleSaveProvider} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300">Provider Name *</label>
              <input
                type="text"
                required
                disabled={Boolean(editingProvider?.isBuiltIn)}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Custom CDN Edge"
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100 disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">Slug Identifier</label>
              <input
                type="text"
                disabled={Boolean(editingProvider)}
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="auto-generated"
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100 disabled:opacity-60"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-300">
                Provider Base URL
              </label>
              <input
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.provider-domain.tld"
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">Health Path</label>
              <input
                type="text"
                value={healthEndpoint}
                onChange={(e) => setHealthEndpoint(e.target.value)}
                placeholder="/health"
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300">
              Server-Side Environment Variable Name (for API Key)
            </label>
            <input
              type="text"
              value={envSecretVar}
              onChange={(e) => setEnvSecretVar(e.target.value)}
              placeholder="e.g. PROVIDER_ANIMEPAHE_API_KEY"
              className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Backend injects <code>process.env[ENV_VAR]</code> during outbound resolution and
              connectivity probes.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300">
                Request Timeout (ms)
              </label>
              <input
                type="number"
                min={1000}
                max={30000}
                step={500}
                value={timeoutMs}
                onChange={(e) => setTimeoutMs(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">Retry Count (0–5)</label>
              <input
                type="number"
                min={0}
                max={5}
                value={retryCount}
                onChange={(e) => setRetryCount(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">Fallback Priority</label>
              <input
                type="number"
                min={1}
                max={99}
                value={fallbackPriority}
                onChange={(e) => setFallbackPriority(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100"
              />
            </div>
          </div>

          <label className="flex items-center gap-2.5 pt-1 text-xs text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="rounded border-slate-700 bg-slate-900 text-sky-500"
            />
            <span>Enable provider in active streaming fallback chain</span>
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
              className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              <Sliders className="h-3.5 w-3.5" />
              <span>{saving ? 'Saving...' : 'Save Provider Configuration'}</span>
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

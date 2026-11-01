import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Database,
  Download,
  FileCheck,
  Film,
  Layers,
  RefreshCw,
  Server,
  ShieldAlert,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react';
import {
  DataImportCategorySummary,
  WebsiteImportJobSummary,
} from '../../shared/types';
import { apiRequest, formatTimestamp } from '../api';

export function WebsiteImportView({
  notify,
}: {
  notify: (tone: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}) {
  const [syncStatus, setSyncStatus] = useState<{
    lastSyncAt: string | null;
    overallStatus: string;
    categoriesSummary: DataImportCategorySummary[];
  } | null>(null);
  const [runningImport, setRunningImport] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const res = await apiRequest<{
        lastSyncAt: string | null;
        overallStatus: string;
        categoriesSummary: DataImportCategorySummary[];
      }>('/api/v1/sync/status');
      setSyncStatus(res);
    } catch (err) {
      notify('error', 'Failed to load sync status', err instanceof Error ? err.message : undefined);
    }
  }, [notify]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleRunFullImport = async () => {
    setRunningImport(true);
    try {
      const res = await apiRequest<WebsiteImportJobSummary>('/api/v1/sync/import', {
        method: 'POST',
      });
      setSyncStatus({
        lastSyncAt: res.completedAt,
        overallStatus: res.overallStatus,
        categoriesSummary: res.categories,
      });
      notify('success', 'Full Website Data Import Complete', `Imported ${res.categories.reduce((s, c) => s + c.recordsImported, 0)} total records.`);
    } catch (err) {
      notify('error', 'Import job failed', err instanceof Error ? err.message : undefined);
    } finally {
      setRunningImport(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-100 flex items-center gap-2">
            <span>Website Data Import & Synchronisation Engine</span>
          </h1>
          <p className="mt-0.5 text-xs text-slate-400">
            Import and organize all live records from KURO NAMI: Anime, Episodes, User Directory, Watch History, Website Settings, Payments, and Media Infrastructure.
          </p>
        </div>

        <button
          type="button"
          onClick={handleRunFullImport}
          disabled={runningImport}
          className="inline-flex items-center gap-2 rounded-md bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${runningImport ? 'animate-spin' : ''}`} />
          <span>{runningImport ? 'Importing Live Data...' : 'Run Full Data Import & Sync'}</span>
        </button>
      </div>

      {/* Sync State Card */}
      <div className="rounded-lg border border-slate-800 bg-[#111827] p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="text-xs text-slate-400">Last Synchronisation Timestamp</div>
          <div className="mt-1 font-mono text-sm font-semibold text-slate-100">
            {syncStatus?.lastSyncAt ? formatTimestamp(syncStatus.lastSyncAt) : 'Never Synchronized'}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Overall Status:</span>
          <span
            className={`rounded px-2.5 py-1 font-mono text-xs font-bold ${
              syncStatus?.overallStatus === 'COMPLETED'
                ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                : 'bg-amber-950 text-amber-300 border border-amber-800'
            }`}
          >
            {syncStatus?.overallStatus || 'IDLE'}
          </span>
        </div>
      </div>

      {/* Data Category Summaries Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {(syncStatus?.categoriesSummary || []).map((cat) => (
          <div key={cat.categoryKey} className="rounded-lg border border-slate-800 bg-[#111827] p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-display font-semibold text-slate-100 text-sm">{cat.categoryName}</span>
              <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-300">
                {cat.categoryKey}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-xs pt-1 border-t border-slate-800/80">
              <div className="rounded bg-[#0B0F17] p-2">
                <div className="text-[10px] text-slate-400">Found</div>
                <div className="font-mono font-bold text-slate-100 mt-0.5">{cat.recordsFound}</div>
              </div>
              <div className="rounded bg-[#0B0F17] p-2">
                <div className="text-[10px] text-slate-400">Imported</div>
                <div className="font-mono font-bold text-emerald-400 mt-0.5">{cat.recordsImported}</div>
              </div>
              <div className="rounded bg-[#0B0F17] p-2">
                <div className="text-[10px] text-slate-400">Failed</div>
                <div className="font-mono font-bold text-slate-400 mt-0.5">{cat.recordsFailed}</div>
              </div>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed pt-1">{cat.details}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

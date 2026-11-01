import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  Film,
  Filter,
  Play,
  RefreshCw,
  Search,
  UserPlus,
  Zap,
} from 'lucide-react';
import { UserActivityRecord } from '../../shared/types';
import { apiRequest, formatTimestamp } from '../api';

export function LiveActivityView({
  notify,
}: {
  notify: (tone: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}) {
  const [activities, setActivities] = useState<UserActivityRecord[]>([]);
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [refreshIntervalSec, setRefreshIntervalSec] = useState<number>(10);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>(new Date().toISOString());

  const loadActivity = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (typeFilter !== 'ALL') params.set('type', typeFilter);
      if (search) params.set('search', search);

      const res = await apiRequest<{ items: UserActivityRecord[] }>(
        `/api/v1/sync/activity?${params.toString()}`
      );
      setActivities(res.items);
      setLastRefreshedAt(new Date().toISOString());
    } catch (err) {
      notify('error', 'Failed to load live activity', err instanceof Error ? err.message : undefined);
    }
  }, [typeFilter, search, notify]);

  useEffect(() => {
    loadActivity();
  }, [loadActivity]);

  // Polling interval
  useEffect(() => {
    if (refreshIntervalSec <= 0) return;
    const timer = setInterval(() => {
      loadActivity();
    }, refreshIntervalSec * 1000);
    return () => clearInterval(timer);
  }, [refreshIntervalSec, loadActivity]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-100 flex items-center gap-2">
            <Activity className="h-5 w-5 text-sky-400" />
            <span>Live Website Activity Stream</span>
          </h1>
          <p className="mt-0.5 text-xs text-slate-400">
            Real-time feed of recorded website events: Registrations, Logins, Anime Views, Episode Streams, Searches, Watchlists & Payments.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5 rounded-md bg-[#111827] px-3 py-1.5 border border-slate-800 text-xs">
            <Clock className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-slate-400">Auto Refresh:</span>
            <select
              value={refreshIntervalSec}
              onChange={(e) => setRefreshIntervalSec(Number(e.target.value))}
              className="bg-transparent text-sky-400 font-mono font-semibold focus:outline-none"
            >
              <option value={0}>Off</option>
              <option value={5}>5s</option>
              <option value={10}>10s</option>
              <option value={30}>30s</option>
            </select>
          </div>

          <button
            type="button"
            onClick={loadActivity}
            className="rounded-md border border-slate-700 bg-[#111827] p-2 text-slate-200 hover:bg-slate-800"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="rounded-lg border border-slate-800 bg-[#111827] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
          <input
            type="text"
            placeholder="Search activity details, usernames..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-slate-700 bg-[#0B0F17] pl-9 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Filter Event:</span>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-1.5 text-xs text-slate-100"
          >
            <option value="ALL">All Event Types</option>
            <option value="ANIME_VIEW">Anime Views</option>
            <option value="EPISODE_STREAM">Episode Streams</option>
            <option value="SEARCH">Searches</option>
            <option value="WATCHLIST_ADD">Watchlist Additions</option>
            <option value="REGISTER">Registrations</option>
            <option value="LOGIN">Logins</option>
            <option value="PAYMENT">Payments</option>
            <option value="FAILED_API">Failed API Requests</option>
            <option value="BACKEND_ERROR">Backend Errors</option>
          </select>
        </div>
      </div>

      {/* Activity Event Feed */}
      <div className="rounded-lg border border-slate-800 bg-[#111827] overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <span>Recorded Website Events ({activities.length})</span>
          <span className="font-mono text-[11px]">Last Refreshed: {formatTimestamp(lastRefreshedAt)}</span>
        </div>

        <div className="divide-y divide-slate-800/70 text-xs">
          {activities.map((act) => (
            <div key={act.id} className="p-4 flex items-center justify-between gap-4 hover:bg-slate-800/30">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 rounded p-1.5 bg-slate-800 text-sky-400">
                  {act.activityType === 'EPISODE_STREAM' ? (
                    <Play className="h-3.5 w-3.5 text-emerald-400" />
                  ) : act.activityType === 'ANIME_VIEW' ? (
                    <Eye className="h-3.5 w-3.5 text-sky-400" />
                  ) : act.activityType === 'REGISTER' ? (
                    <UserPlus className="h-3.5 w-3.5 text-amber-400" />
                  ) : (
                    <Activity className="h-3.5 w-3.5 text-slate-300" />
                  )}
                </span>

                <div>
                  <div className="font-medium text-slate-100">{act.detail}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    User: <strong className="text-slate-200">{act.username}</strong> ({act.userId}) · IP {act.ipAddress}
                  </div>
                </div>
              </div>

              <div className="text-right shrink-0">
                <span className="rounded bg-[#0B0F17] px-2 py-0.5 font-mono text-[10px] text-slate-300 border border-slate-800">
                  {act.activityType}
                </span>
                <div className="font-mono text-[10px] text-slate-500 mt-1 tabular-nums">
                  {formatTimestamp(act.createdAt)}
                </div>
              </div>
            </div>
          ))}

          {activities.length === 0 && (
            <div className="p-8 text-center text-xs text-slate-400">
              No live website events recorded for selected filter.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

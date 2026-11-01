import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Link2Off,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  UserCheck,
  UserX,
  Wallet,
} from 'lucide-react';
import {
  ManagedUserRecord,
  TreasuryTransactionRecord,
} from '../../shared/types';
import {
  apiRequest,
  downloadTextFile,
  formatCurrencyCents,
  formatTimestamp,
} from '../api';
import { Modal, TableSkeleton } from '../components/UiPrimitives';

const RESTRICTION_OPTIONS = [
  'COMMENT_MUTED',
  'REPORT_SUBMISSION_HOLD',
  'CONCURRENT_STREAM_LIMITED',
  'PROFILE_EDIT_RESTRICTED',
];

// ============================================================================
// USER MANAGEMENT VIEW (§9)
// ============================================================================

export function UserManagementView({
  onOpenSettings,
  notify,
}: {
  onOpenSettings: () => void;
  notify: (tone: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}) {
  const [users, setUsers] = useState<ManagedUserRecord[]>([]);
  const [upstreamStatus, setUpstreamStatus] = useState<string>('NOT_CONNECTED');
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Register Synced Moderation Record Modal
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncUpstreamId, setSyncUpstreamId] = useState('');
  const [syncUsername, setSyncUsername] = useState('');
  const [syncEmail, setSyncEmail] = useState('');
  const [syncBusy, setSyncBusy] = useState(false);

  // User Detail & Moderation Modal
  const [selectedUser, setSelectedUser] = useState<ManagedUserRecord | null>(null);
  const [modStatus, setModStatus] = useState<'ACTIVE' | 'SUSPENDED' | 'RESTRICTED'>('ACTIVE');
  const [modReason, setModReason] = useState('');
  const [modRestrictions, setModRestrictions] = useState<string[]>([]);
  const [newReportCategory, setNewReportCategory] = useState('Playback / Conduct');
  const [newReportSummary, setNewReportSummary] = useState('');
  const [modBusy, setModBusy] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set('search', search.trim());
      if (statusFilter !== 'ALL') qs.set('status', statusFilter);

      const res = await apiRequest<{
        upstreamConnectionStatus: string;
        items: ManagedUserRecord[];
      }>(`/api/v1/users?${qs.toString()}`);

      setUpstreamStatus(res.upstreamConnectionStatus);
      setUsers(res.items);
    } catch (err: unknown) {
      notify('error', 'Failed to load user directory', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, notify]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleRegisterSyncRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    setSyncBusy(true);
    try {
      await apiRequest('/api/v1/users/sync-record', {
        method: 'POST',
        body: {
          upstreamUserId: syncUpstreamId,
          username: syncUsername,
          email: syncEmail,
        },
      });
      notify('success', 'User moderation record registered', syncUsername);
      setSyncModalOpen(false);
      setSyncUpstreamId('');
      setSyncUsername('');
      setSyncEmail('');
      await loadUsers();
    } catch (err: unknown) {
      notify('error', 'Failed to register user record', err instanceof Error ? err.message : undefined);
    } finally {
      setSyncBusy(false);
    }
  };

  const openModerationModal = (u: ManagedUserRecord) => {
    setSelectedUser(u);
    setModStatus(u.accountStatus);
    setModReason(u.suspensionReason || '');
    setModRestrictions(u.restrictions);
    setNewReportSummary('');
  };

  const handleSaveModeration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setModBusy(true);
    try {
      await apiRequest(`/api/v1/users/${selectedUser.id}/moderation`, {
        method: 'PATCH',
        body: {
          accountStatus: modStatus,
          suspensionReason: modStatus === 'SUSPENDED' ? modReason : null,
          restrictions: modRestrictions,
          addReport: newReportSummary.trim()
            ? { category: newReportCategory, summary: newReportSummary.trim() }
            : undefined,
        },
      });
      notify('success', `Updated moderation state for ${selectedUser.username}`);
      setSelectedUser(null);
      await loadUsers();
    } catch (err: unknown) {
      notify('error', 'Moderation update failed', err instanceof Error ? err.message : undefined);
    } finally {
      setModBusy(false);
    }
  };

  const handleResolveReport = async (userId: string, reportId: string) => {
    try {
      await apiRequest(`/api/v1/users/${userId}/moderation`, {
        method: 'PATCH',
        body: { resolveReportId: reportId },
      });
      notify('success', 'Problem report marked resolved');
      await loadUsers();
      setSelectedUser((prev) =>
        prev
          ? {
              ...prev,
              reports: prev.reports.map((r) => (r.id === reportId ? { ...r, resolved: true } : r)),
            }
          : null
      );
    } catch (err: unknown) {
      notify('error', 'Failed to resolve report', err instanceof Error ? err.message : undefined);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-100">User Management</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            Moderate registered KURO NAMI viewer accounts, review problem reports, and enforce
            account restrictions without exposing passwords or unnecessary private data. Ordinary
            website users can never be promoted to administrators.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={loadUsers}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={() => setSyncModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-sky-500 whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Import Upstream User ID</span>
          </button>
        </div>
      </div>

      {/* Upstream Connection Status Notice */}
      {upstreamStatus !== 'CONNECTED' && (
        <div className="rounded-lg border border-slate-800 bg-[#111827] px-5 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-amber-300">
            <Link2Off className="h-4 w-4 shrink-0" />
            <span>
              Main KURO NAMI User Directory API is currently disconnected ({upstreamStatus}). No
              synthetic user accounts are pre-populated.
            </span>
          </div>
          <button
            type="button"
            onClick={onOpenSettings}
            className="text-xs font-medium text-sky-400 hover:underline whitespace-nowrap self-start sm:self-auto"
          >
            Configure Upstream API Bridge
          </button>
        </div>
      )}

      {/* Search & Status Filter */}
      <div className="rounded-lg border border-slate-800 bg-[#111827] p-4 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search username, upstream user ID, or masked email..."
            className="w-full rounded-md border border-slate-700 bg-[#0B0F17] pl-9 pr-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1 rounded-md bg-[#0B0F17] p-1 border border-slate-800">
          {['ALL', 'ACTIVE', 'RESTRICTED', 'SUSPENDED'].map((st) => (
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
              {st === 'ALL' ? 'All Users' : st.charAt(0) + st.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Users Table */}
      <div className="rounded-lg border border-slate-800 bg-[#111827] overflow-hidden">
        {loading ? (
          <TableSkeleton rows={4} cols={5} />
        ) : users.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <h3 className="font-display text-base font-semibold text-slate-200">
              No Registered Platform Users Synced
            </h3>
            <p className="mx-auto mt-1.5 max-w-lg text-xs leading-relaxed text-slate-400">
              Once connected to <code>/admin-bridge/v1/users</code> on the main KURO NAMI backend,
              registered viewer accounts will synchronize here with masked PII. You may also import
              a specific upstream user ID to prepare account restrictions or review reported issues.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs text-slate-400">
                  <th className="px-5 py-3 font-medium">User & Masked Contact</th>
                  <th className="px-4 py-3 font-medium">Upstream ID</th>
                  <th className="px-4 py-3 font-medium">Account Status</th>
                  <th className="px-4 py-3 font-medium text-right">Registered / Reports</th>
                  <th className="px-5 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-sm">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-800/30">
                    <td className="px-5 py-3">
                      <div className="font-medium text-slate-100">{u.username}</div>
                      <div className="font-mono text-xs text-slate-500">{u.emailMasked}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-300">
                      {u.upstreamUserId}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {u.accountStatus === 'ACTIVE' && (
                        <span className="inline-flex items-center gap-1.5 text-emerald-400 font-medium">
                          <UserCheck className="h-3.5 w-3.5" />
                          <span>Active</span>
                        </span>
                      )}
                      {u.accountStatus === 'SUSPENDED' && (
                        <span className="inline-flex items-center gap-1.5 text-red-400 font-medium">
                          <UserX className="h-3.5 w-3.5" />
                          <span>Suspended</span>
                        </span>
                      )}
                      {u.accountStatus === 'RESTRICTED' && (
                        <span className="inline-flex items-center gap-1.5 text-amber-400 font-medium">
                          <ShieldAlert className="h-3.5 w-3.5" />
                          <span>Restricted ({u.restrictions.length})</span>
                        </span>
                      )}
                      {u.suspensionReason && (
                        <div className="mt-0.5 text-[11px] text-slate-400 truncate max-w-[200px]">
                          Reason: {u.suspensionReason}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                      <div className="text-slate-300">{formatTimestamp(u.registeredAt)}</div>
                      <div className="mt-0.5 text-slate-500">
                        {u.openReportsCount} open report(s) · {u.activityCount} events
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openModerationModal(u)}
                        className="rounded border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
                      >
                        Inspect & Moderate
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Import Upstream User Record Modal */}
      <Modal
        open={syncModalOpen}
        onClose={() => setSyncModalOpen(false)}
        title="Import Upstream User Moderation Record"
        subtitle="Register an authoritative KURO NAMI user ID into this isolated workspace for moderation or issue tracking. Passwords are never imported."
        maxWidthClass="max-w-md"
      >
        <form onSubmit={handleRegisterSyncRecord} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300">
              Upstream KURO NAMI User ID *
            </label>
            <input
              type="text"
              required
              value={syncUpstreamId}
              onChange={(e) => setSyncUpstreamId(e.target.value)}
              placeholder="e.g. kn_u_948120"
              className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-300">Account Username *</label>
            <input
              type="text"
              required
              value={syncUsername}
              onChange={(e) => setSyncUsername(e.target.value)}
              placeholder="Viewer handle"
              className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-300">
              Contact Email (automatically masked before storage)
            </label>
            <input
              type="email"
              value={syncEmail}
              onChange={(e) => setSyncEmail(e.target.value)}
              placeholder="viewer@example.com"
              className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
            />
          </div>
          <div className="flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
            <button
              type="button"
              onClick={() => setSyncModalOpen(false)}
              className="rounded-md border border-slate-700 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={syncBusy}
              className="rounded-md bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {syncBusy ? 'Registering...' : 'Register User Record'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Moderation Modal */}
      <Modal
        open={Boolean(selectedUser)}
        onClose={() => setSelectedUser(null)}
        title={`User Moderation: ${selectedUser?.username || ''}`}
        subtitle={`Upstream ID: ${selectedUser?.upstreamUserId || ''} · Masked Email: ${
          selectedUser?.emailMasked || ''
        }`}
      >
        {selectedUser && (
          <form onSubmit={handleSaveModeration} className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-300">Account Standing</label>
                <select
                  value={modStatus}
                  onChange={(e) =>
                    setModStatus(e.target.value as 'ACTIVE' | 'SUSPENDED' | 'RESTRICTED')
                  }
                  className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
                >
                  <option value="ACTIVE">Active (Good Standing)</option>
                  <option value="RESTRICTED">Restricted Access</option>
                  <option value="SUSPENDED">Suspended</option>
                </select>
              </div>

              {modStatus === 'SUSPENDED' && (
                <div>
                  <label className="block text-xs font-medium text-slate-300">
                    Suspension Reason *
                  </label>
                  <input
                    type="text"
                    required
                    value={modReason}
                    onChange={(e) => setModReason(e.target.value)}
                    placeholder="Document policy violation"
                    className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
                  />
                </div>
              )}
            </div>

            <div>
              <div className="text-xs font-medium text-slate-300">Account Restrictions</div>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {RESTRICTION_OPTIONS.map((opt) => {
                  const checked = modRestrictions.includes(opt);
                  return (
                    <label
                      key={opt}
                      className="flex items-center gap-2 rounded border border-slate-800 bg-[#0B0F17] px-3 py-2 text-xs text-slate-300 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setModRestrictions([...modRestrictions, opt]);
                          } else {
                            setModRestrictions(modRestrictions.filter((r) => r !== opt));
                          }
                        }}
                      />
                      <span className="font-mono text-[11px]">{opt}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Reported Problems */}
            <div className="border-t border-slate-800 pt-4 space-y-3">
              <div className="text-xs font-semibold text-slate-200">
                Reported Problems ({selectedUser.reports.length})
              </div>
              {selectedUser.reports.length === 0 ? (
                <p className="text-xs text-slate-500">No problem reports filed on this account.</p>
              ) : (
                <div className="divide-y divide-slate-800 rounded border border-slate-800 bg-[#0B0F17]">
                  {selectedUser.reports.map((rep) => (
                    <div
                      key={rep.id}
                      className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs"
                    >
                      <div>
                        <div className="text-slate-200">
                          <span className="font-medium">{rep.category}:</span> {rep.summary}
                        </div>
                        <div className="font-mono text-[11px] text-slate-500">
                          {formatTimestamp(rep.reportedAt)}
                        </div>
                      </div>
                      {rep.resolved ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400 whitespace-nowrap">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>Resolved</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleResolveReport(selectedUser.id, rep.id)}
                          className="rounded border border-slate-700 px-2.5 py-1 text-slate-200 hover:bg-slate-800 whitespace-nowrap"
                        >
                          Resolve
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                <select
                  value={newReportCategory}
                  onChange={(e) => setNewReportCategory(e.target.value)}
                  className="rounded border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 text-xs text-slate-200"
                >
                  <option value="Playback / Conduct">Playback / Conduct</option>
                  <option value="Broken Subtitle Report">Broken Subtitle Report</option>
                  <option value="Abuse / Spam">Abuse / Spam</option>
                </select>
                <input
                  type="text"
                  value={newReportSummary}
                  onChange={(e) => setNewReportSummary(e.target.value)}
                  placeholder="Optional: log reported issue note..."
                  className="sm:col-span-2 rounded border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 text-xs text-slate-100"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="rounded-md border border-slate-700 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={modBusy}
                className="rounded-md bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {modBusy ? 'Saving...' : 'Apply Moderation Changes'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

// ============================================================================
// ASSET TREASURY & FINANCIAL CONTROLS VIEW (§10)
// ============================================================================

export function TreasuryView({
  notify,
}: {
  notify: (tone: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}) {
  const [balanceCents, setBalanceCents] = useState<number>(0);
  const [currency, setCurrency] = useState<string>('USD');
  const [transactions, setTransactions] = useState<TreasuryTransactionRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [txModalOpen, setTxModalOpen] = useState(false);
  const [txType, setTxType] = useState<'DEPOSIT' | 'WITHDRAWAL'>('DEPOSIT');
  const [amountDollars, setAmountDollars] = useState('');
  const [referenceCode, setReferenceCode] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadTreasury = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{
        balanceCents: number;
        currency: string;
        transactions: TreasuryTransactionRecord[];
      }>('/api/v1/treasury');
      setBalanceCents(res.balanceCents);
      setCurrency(res.currency);
      setTransactions(res.transactions);
    } catch (err: unknown) {
      notify('error', 'Failed to load workspace treasury', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    loadTreasury();
  }, [loadTreasury]);

  const handleExecuteTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiRequest('/api/v1/treasury/transactions', {
        method: 'POST',
        body: {
          type: txType,
          amountDollars: Number(amountDollars),
          referenceCode: referenceCode || undefined,
          description,
        },
      });
      notify(
        'success',
        `Authorized ${txType.toLowerCase()} recorded`,
        `$${Number(amountDollars).toFixed(2)} — ${description}`
      );
      setTxModalOpen(false);
      setAmountDollars('');
      setReferenceCode('');
      setDescription('');
      await loadTreasury();
    } catch (err: unknown) {
      notify('error', 'Transaction rejected', err instanceof Error ? err.message : undefined);
    } finally {
      setSubmitting(false);
    }
  };

  const handleExportCsv = () => {
    const header =
      'id,created_at,type,amount_usd,balance_before_usd,balance_after_usd,reference_code,authorized_by,description\n';
    const rows = transactions
      .map(
        (t) =>
          `${t.id},${t.createdAt},${t.type},${(t.amountCents / 100).toFixed(2)},${(
            t.balanceBeforeCents / 100
          ).toFixed(2)},${(t.balanceAfterCents / 100).toFixed(2)},"${t.referenceCode.replace(
            /"/g,
            '""'
          )}","${t.authorizedByUsername}","${t.description.replace(/"/g, '""')}"`
      )
      .join('\n');
    downloadTextFile(
      `kuro-nami-treasury-ledger-${new Date().toISOString().slice(0, 10)}.csv`,
      header + rows,
      'text/csv'
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-100">
            Asset Treasury & Financial Controls
          </h1>
          <p className="mt-0.5 text-xs text-slate-400">
            Transactional administrative reserve ledger initialized strictly at $0.00. Every
            authorized deposit and withdrawal executes atomically and writes an immutable database
            audit record.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            disabled={transactions.length === 0}
            onClick={handleExportCsv}
            className="rounded-md border border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
          >
            Export Ledger CSV
          </button>
          <button
            type="button"
            onClick={() => {
              setTxType('DEPOSIT');
              setTxModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-emerald-500 whitespace-nowrap"
          >
            <ArrowDownLeft className="h-3.5 w-3.5" />
            <span>Authorized Deposit</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setTxType('WITHDRAWAL');
              setTxModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700 whitespace-nowrap"
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
            <span>Authorized Withdrawal</span>
          </button>
        </div>
      </div>

      {/* Balance Strip */}
      <div className="rounded-lg border border-slate-800 bg-[#111827] grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-800">
        <div className="p-6">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Wallet className="h-4 w-4 text-sky-400" />
            <span>Current Workspace Balance</span>
          </div>
          <div className="mt-2 font-mono text-3xl font-semibold text-slate-100 tabular-nums">
            {formatCurrencyCents(balanceCents, currency)}
          </div>
          <div className="mt-1 text-xs text-slate-500">Opening balance strictly $0.00</div>
        </div>

        <div className="p-6">
          <div className="text-xs text-slate-400">Cumulative Authorized Deposits</div>
          <div className="mt-2 font-mono text-2xl font-semibold text-emerald-400 tabular-nums">
            {formatCurrencyCents(
              transactions
                .filter((t) => t.type === 'DEPOSIT')
                .reduce((s, t) => s + t.amountCents, 0),
              currency
            )}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {transactions.filter((t) => t.type === 'DEPOSIT').length} deposit transaction(s)
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs text-slate-400">Cumulative Authorized Withdrawals</div>
          <div className="mt-2 font-mono text-2xl font-semibold text-slate-200 tabular-nums">
            {formatCurrencyCents(
              transactions
                .filter((t) => t.type === 'WITHDRAWAL')
                .reduce((s, t) => s + t.amountCents, 0),
              currency
            )}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {transactions.filter((t) => t.type === 'WITHDRAWAL').length} withdrawal transaction(s)
          </div>
        </div>
      </div>

      {/* Transaction History Table */}
      <div className="rounded-lg border border-slate-800 bg-[#111827] overflow-hidden">
        <div className="border-b border-slate-800 px-5 py-4">
          <h2 className="font-display text-sm font-semibold text-slate-100">
            Immutable Treasury Transaction History
          </h2>
          <p className="text-xs text-slate-400">
            Protected by SQLite BEFORE UPDATE / BEFORE DELETE abort triggers
          </p>
        </div>

        {loading ? (
          <TableSkeleton rows={4} cols={5} />
        ) : transactions.length === 0 ? (
          <div className="px-6 py-12 text-center text-xs text-slate-400">
            No treasury transactions recorded yet. Balance is $0.00.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs text-slate-400">
                  <th className="px-5 py-3 font-medium">Timestamp & Reference</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Description</th>
                  <th className="px-4 py-3 font-medium">Authorized By</th>
                  <th className="px-4 py-3 font-medium text-right">Amount</th>
                  <th className="px-5 py-3 font-medium text-right">Resulting Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-xs">
                {transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-800/30">
                    <td className="px-5 py-3 font-mono tabular-nums whitespace-nowrap">
                      <div className="text-slate-200">{formatTimestamp(tx.createdAt)}</div>
                      <div className="text-slate-500">{tx.referenceCode}</div>
                    </td>
                    <td className="px-4 py-3 font-mono font-medium">
                      <span
                        className={
                          tx.type === 'DEPOSIT' ? 'text-emerald-400' : 'text-amber-300'
                        }
                      >
                        {tx.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-200 max-w-xs">{tx.description}</td>
                    <td className="px-4 py-3 text-slate-300">{tx.authorizedByUsername}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                      <span
                        className={
                          tx.type === 'DEPOSIT' ? 'text-emerald-400' : 'text-slate-100'
                        }
                      >
                        {tx.type === 'DEPOSIT' ? '+' : '−'}
                        {formatCurrencyCents(tx.amountCents, tx.currency)}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-slate-200 tabular-nums">
                      {formatCurrencyCents(tx.balanceAfterCents, tx.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Deposit / Withdrawal Modal */}
      <Modal
        open={txModalOpen}
        onClose={() => setTxModalOpen(false)}
        title={
          txType === 'DEPOSIT'
            ? 'Record Authorized Treasury Deposit'
            : 'Record Authorized Treasury Withdrawal'
        }
        subtitle={`Current available balance: ${formatCurrencyCents(balanceCents, currency)}`}
        maxWidthClass="max-w-md"
      >
        <form onSubmit={handleExecuteTransaction} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300">Amount (USD) *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amountDollars}
                onChange={(e) => setAmountDollars(e.target.value)}
                placeholder="0.00"
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-sm text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300">Reference Code</label>
              <input
                type="text"
                value={referenceCode}
                onChange={(e) => setReferenceCode(e.target.value)}
                placeholder="INV-2026-001"
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300">
              Authorization Description *
            </label>
            <textarea
              rows={3}
              required
              minLength={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Monthly Cloudflare R2 storage & CDN bandwidth allocation"
              className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
            />
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
            <button
              type="button"
              onClick={() => setTxModalOpen(false)}
              className="rounded-md border border-slate-700 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {submitting ? 'Committing Transaction...' : `Commit ${txType}`}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  KeyRound,
  Lock,
  Plus,
  Shield,
  Sliders,
  XCircle,
} from 'lucide-react';
import {
  AdminRole,
  AuthenticatedAdmin,
  ProposedApiContract,
  UpstreamIntegrationConfig,
} from '../../shared/types';
import { apiRequest, formatTimestamp } from '../api';
import { Modal } from '../components/UiPrimitives';

interface SecurityDataResponse {
  loginHistory: Array<{
    id: string;
    username_attempted: string;
    event_type: string;
    success: number;
    ip_address: string;
    user_agent: string;
    detail: string | null;
    created_at: string;
  }>;
  activeSessions: Array<{
    id: string;
    admin_id: string;
    username: string;
    role: string;
    ip_address: string;
    user_agent: string;
    created_at: string;
    expires_at: string;
  }>;
  workspaceStaff: Array<{
    id: string;
    username: string;
    display_name: string;
    role: AdminRole;
    is_owner_slot: number;
    is_provisioned: number;
    is_locked: number;
    failed_login_attempts: number;
    last_login_at: string | null;
  }>;
  currentSessionId: string;
}

export function AdminSettingsView({
  admin,
  notify,
}: {
  admin: AuthenticatedAdmin;
  notify: (tone: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<
    'integration' | 'contracts' | 'security' | 'staff'
  >('integration');

  // Upstream Integration state
  const [config, setConfig] = useState<UpstreamIntegrationConfig | null>(null);
  const [contracts, setContracts] = useState<ProposedApiContract[]>([]);
  const [contractFilter, setContractFilter] = useState<
    'ALL' | 'PROPOSED_UPSTREAM_CONTRACT' | 'VERIFIED_ADMIN_LOCAL_ENDPOINT'
  >('ALL');

  const [baseUrl, setBaseUrl] = useState('');
  const [healthPath, setHealthPath] = useState('/api/v1/health');
  const [apiVersion, setApiVersion] = useState('v1');
  const [envApiKeyVar, setEnvApiKeyVar] = useState('KURO_NAMI_UPSTREAM_API_KEY');
  const [syncMode, setSyncMode] = useState<
    'DISCONNECTED' | 'READ_ONLY_VERIFY' | 'CONTROLLED_SYNC'
  >('DISCONNECTED');
  const [savingConfig, setSavingConfig] = useState(false);
  const [testingUpstream, setTestingUpstream] = useState(false);

  // Security & Staff state
  const [securityData, setSecurityData] = useState<SecurityDataResponse | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  // New Staff Modal
  const [staffModalOpen, setStaffModalOpen] = useState(false);
  const [staffUsername, setStaffUsername] = useState('');
  const [staffDisplayName, setStaffDisplayName] = useState('');
  const [staffRole, setStaffRole] = useState<AdminRole>(AdminRole.CONTENT_ADMIN);
  const [staffPassword, setStaffPassword] = useState('');
  const [staffBusy, setStaffBusy] = useState(false);
  const [createdStaffKey, setCreatedStaffKey] = useState<string | null>(null);

  const loadIntegration = useCallback(async () => {
    try {
      const res = await apiRequest<{
        config: UpstreamIntegrationConfig;
        contracts: ProposedApiContract[];
      }>('/api/v1/integration');
      setConfig(res.config);
      setContracts(res.contracts);
      setBaseUrl(res.config.baseUrl);
      setHealthPath(res.config.healthPath);
      setApiVersion(res.config.apiVersion);
      setEnvApiKeyVar(res.config.envApiKeyVar);
      setSyncMode(res.config.syncMode);
    } catch (err: unknown) {
      notify('error', 'Failed to load integration config', err instanceof Error ? err.message : undefined);
    }
  }, [notify]);

  const loadSecurity = useCallback(async () => {
    try {
      const res = await apiRequest<SecurityDataResponse>('/api/v1/auth/security');
      setSecurityData(res);
    } catch (err: unknown) {
      notify('error', 'Failed to load security telemetry', err instanceof Error ? err.message : undefined);
    }
  }, [notify]);

  useEffect(() => {
    loadIntegration();
    loadSecurity();
  }, [loadIntegration, loadSecurity]);

  const handleSaveIntegration = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    try {
      const res = await apiRequest<{ config: UpstreamIntegrationConfig }>('/api/v1/integration', {
        method: 'PUT',
        body: {
          baseUrl,
          healthPath,
          apiVersion,
          envApiKeyVar,
          syncMode,
        },
      });
      setConfig(res.config);
      notify('success', 'Upstream integration settings saved');
    } catch (err: unknown) {
      notify('error', 'Failed to save integration settings', err instanceof Error ? err.message : undefined);
    } finally {
      setSavingConfig(false);
    }
  };

  const handleTestUpstream = async () => {
    setTestingUpstream(true);
    try {
      const res = await apiRequest<{
        probe: { connectionStatus: string; statusMessage: string };
        config: UpstreamIntegrationConfig;
      }>('/api/v1/integration/test', { method: 'POST' });
      setConfig(res.config);
      notify(
        res.probe.connectionStatus === 'CONNECTED' ? 'success' : 'info',
        `Upstream Handshake: ${res.probe.connectionStatus}`,
        res.probe.statusMessage
      );
    } catch (err: unknown) {
      notify('error', 'Handshake probe failed', err instanceof Error ? err.message : undefined);
    } finally {
      setTestingUpstream(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwBusy(true);
    try {
      await apiRequest('/api/v1/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword, confirmPassword },
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      notify('success', 'Password updated and other sessions revoked');
      await loadSecurity();
    } catch (err: unknown) {
      notify('error', 'Password update failed', err instanceof Error ? err.message : undefined);
    } finally {
      setPwBusy(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    try {
      await apiRequest(`/api/v1/auth/sessions/${sessionId}/revoke`, { method: 'POST' });
      notify('info', 'Session revoked');
      await loadSecurity();
    } catch (err: unknown) {
      notify('error', 'Failed to revoke session', err instanceof Error ? err.message : undefined);
    }
  };

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setStaffBusy(true);
    try {
      const res = await apiRequest<{ recoveryKey: string }>('/api/v1/auth/staff', {
        method: 'POST',
        body: {
          username: staffUsername,
          displayName: staffDisplayName || staffUsername,
          role: staffRole,
          password: staffPassword,
        },
      });
      setCreatedStaffKey(res.recoveryKey);
      setStaffUsername('');
      setStaffDisplayName('');
      setStaffPassword('');
      notify('success', 'Workspace staff role created');
      await loadSecurity();
    } catch (err: unknown) {
      notify('error', 'Failed to create staff account', err instanceof Error ? err.message : undefined);
    } finally {
      setStaffBusy(false);
    }
  };

  const handleToggleLockStaff = async (staffId: string, currentlyLocked: boolean) => {
    try {
      await apiRequest(`/api/v1/auth/staff/${staffId}`, {
        method: 'PATCH',
        body: { isLocked: !currentlyLocked },
      });
      notify('info', `Staff account ${!currentlyLocked ? 'locked' : 'unlocked'}`);
      await loadSecurity();
    } catch (err: unknown) {
      notify('error', 'Failed to update staff account', err instanceof Error ? err.message : undefined);
    }
  };

  const filteredContracts = contracts.filter(
    (c) => contractFilter === 'ALL' || c.contractStatus === contractFilter
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-slate-100">
          Admin Settings & KURO NAMI API Integration
        </h1>
        <p className="mt-0.5 text-xs text-slate-400">
          Manage controlled upstream synchronization with the main KURO NAMI website, inspect
          versioned API contracts, monitor account security, and govern isolated workspace RBAC.
        </p>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="flex flex-wrap items-center gap-1 rounded-md border border-slate-800 bg-[#111827] p-1 w-fit">
        {[
          { id: 'integration', label: 'Upstream KURO NAMI Bridge' },
          { id: 'contracts', label: 'Versioned API Contracts (v1)' },
          { id: 'security', label: 'Account Security & Sessions' },
          { id: 'staff', label: 'Workspace Isolation & RBAC' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`rounded px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-slate-800 text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB 1: UPSTREAM INTEGRATION */}
      {activeTab === 'integration' && config && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleSaveIntegration}
            className="lg:col-span-7 rounded-lg border border-slate-800 bg-[#111827] p-6 space-y-4"
          >
            <div>
              <h2 className="font-display text-base font-semibold text-slate-100">
                Main KURO NAMI Platform Connection
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Configure the authoritative KURO NAMI backend base URL. Initial connection tests
                execute a strictly read-only handshake and never overwrite production records.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-300">
                  Upstream API Base URL
                </label>
                <input
                  type="url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.kuronami.example"
                  className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300">Health Path</label>
                <input
                  type="text"
                  value={healthPath}
                  onChange={(e) => setHealthPath(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-300">
                  Server Environment Variable for Upstream API Key
                </label>
                <input
                  type="text"
                  value={envApiKeyVar}
                  onChange={(e) => setEnvApiKeyVar(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100"
                />
                <div className="mt-1 text-[11px] font-mono">
                  Status:{' '}
                  <span className={config.hasEnvApiKey ? 'text-emerald-400' : 'text-amber-300'}>
                    {config.hasEnvApiKey ? 'Present in Server Env' : 'Not Set in Server Env'}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300">
                  Integration Synchronization Mode
                </label>
                <select
                  value={syncMode}
                  onChange={(e) => setSyncMode(e.target.value as typeof syncMode)}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
                >
                  <option value="DISCONNECTED">Disconnected (Standalone Staging)</option>
                  <option value="READ_ONLY_VERIFY">Read-Only Verification Mode</option>
                  <option value="CONTROLLED_SYNC">Controlled Authoritative Sync</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
              <button
                type="button"
                disabled={testingUpstream}
                onClick={handleTestUpstream}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
              >
                <Activity className="h-3.5 w-3.5" />
                <span>
                  {testingUpstream ? 'Testing Handshake...' : 'Run Read-Only Connection Test'}
                </span>
              </button>

              <button
                type="submit"
                disabled={savingConfig}
                className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50 whitespace-nowrap"
              >
                <Sliders className="h-3.5 w-3.5" />
                <span>{savingConfig ? 'Saving...' : 'Save Integration Settings'}</span>
              </button>
            </div>
          </form>

          <div className="lg:col-span-5 rounded-lg border border-slate-800 bg-[#111827] p-6 space-y-4">
            <h3 className="font-display text-sm font-semibold text-slate-100">
              Connection State & Safeguards
            </h3>
            <div className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-400">Handshake Status</span>
                <span className="inline-flex items-center gap-1.5 font-mono font-semibold">
                  {config.connectionStatus === 'CONNECTED' ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      <span className="text-emerald-400">CONNECTED</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-3.5 w-3.5 text-amber-400" />
                      <span className="text-amber-300">{config.connectionStatus}</span>
                    </>
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-400">Last Handshake Probe</span>
                <span className="font-mono text-slate-300 tabular-nums">
                  {formatTimestamp(config.lastTestedAt)}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-400">Probe Latency</span>
                <span className="font-mono text-slate-300 tabular-nums">
                  {config.lastLatencyMs !== null ? `${config.lastLatencyMs} ms` : '—'}
                </span>
              </div>
            </div>

            {config.lastStatusMessage && (
              <div className="rounded border border-slate-800 bg-[#0B0F17] p-3 text-xs text-slate-300">
                {config.lastStatusMessage}
              </div>
            )}

            <div className="text-xs leading-relaxed text-slate-400 space-y-1.5">
              <div className="font-semibold text-slate-200">Controlled Integration Guarantees:</div>
              <p>1. Authoritative main database records are never overwritten on handshake.</p>
              <p>2. External AniList/MAL IDs remain decoupled from internal KURO NAMI IDs.</p>
              <p>3. Existing streaming provider configs are preserved unless explicitly promoted.</p>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: VERSIONED API CONTRACTS */}
      {activeTab === 'contracts' && (
        <div className="rounded-lg border border-slate-800 bg-[#111827] overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-800 px-5 py-4">
            <div>
              <h2 className="font-display text-sm font-semibold text-slate-100">
                Documented Administrative API Contracts
              </h2>
              <p className="text-xs text-slate-400">
                Strictly separates active local admin endpoints from proposed upstream main-site
                bridge contracts.
              </p>
            </div>

            <div className="flex items-center gap-1 rounded-md bg-[#0B0F17] p-1 border border-slate-800">
              {[
                { id: 'ALL', label: 'All Contracts' },
                { id: 'VERIFIED_ADMIN_LOCAL_ENDPOINT', label: 'Verified Local' },
                { id: 'PROPOSED_UPSTREAM_CONTRACT', label: 'Proposed Upstream' },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setContractFilter(f.id as typeof contractFilter)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                    contractFilter === f.id
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs text-slate-400">
                  <th className="px-5 py-3 font-medium">Domain & Status</th>
                  <th className="px-4 py-3 font-medium">Method & Path</th>
                  <th className="px-4 py-3 font-medium">Contract Specification</th>
                  <th className="px-5 py-3 font-medium">Auth & Idempotency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-xs">
                {filteredContracts.map((c, idx) => (
                  <tr key={idx} className="hover:bg-slate-800/30">
                    <td className="px-5 py-3.5">
                      <div className="font-medium text-slate-100">{c.domain}</div>
                      <div
                        className={`mt-0.5 font-mono text-[11px] ${
                          c.contractStatus === 'VERIFIED_ADMIN_LOCAL_ENDPOINT'
                            ? 'text-emerald-400'
                            : 'text-amber-300'
                        }`}
                      >
                        {c.contractStatus === 'VERIFIED_ADMIN_LOCAL_ENDPOINT'
                          ? 'Verified Local Endpoint'
                          : 'Proposed Upstream Contract'}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 font-mono whitespace-nowrap">
                      <span className="font-semibold text-sky-400">{c.method}</span>{' '}
                      <span className="text-slate-200">{c.path}</span>
                    </td>
                    <td className="px-4 py-3.5 text-slate-300 max-w-sm">{c.description}</td>
                    <td className="px-5 py-3.5 text-slate-400 max-w-xs">
                      <div className="text-slate-300">{c.authRequirement}</div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        {c.idempotencyAndSyncNotes}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: ACCOUNT SECURITY & SESSIONS */}
      {activeTab === 'security' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleChangePassword}
            className="lg:col-span-5 rounded-lg border border-slate-800 bg-[#111827] p-6 space-y-4"
          >
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-sky-400" />
              <h2 className="font-display text-sm font-semibold text-slate-100">
                Change Administrator Password
              </h2>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">Current Password</label>
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">
                New Password
              </label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">
                Confirm New Password
              </label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
              />
            </div>
            <button
              type="submit"
              disabled={pwBusy}
              className="w-full rounded-md bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {pwBusy ? 'Updating...' : 'Update Password & Revoke Other Sessions'}
            </button>
          </form>

          <div className="lg:col-span-7 space-y-6">
            {/* Active Sessions */}
            <div className="rounded-lg border border-slate-800 bg-[#111827] overflow-hidden">
              <div className="border-b border-slate-800 px-5 py-3.5">
                <h3 className="font-display text-sm font-semibold text-slate-100">
                  Active Workspace Sessions
                </h3>
              </div>
              <div className="divide-y divide-slate-800/70 text-xs">
                {(securityData?.activeSessions || []).map((sess) => {
                  const isCurrent = sess.id === securityData?.currentSessionId;
                  return (
                    <div
                      key={sess.id}
                      className="flex items-center justify-between gap-4 px-5 py-3"
                    >
                      <div>
                        <div className="font-medium text-slate-200">
                          {sess.username} ({sess.role}){' '}
                          {isCurrent && (
                            <span className="ml-1.5 text-emerald-400">· Current Session</span>
                          )}
                        </div>
                        <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                          IP {sess.ip_address} · Expires {formatTimestamp(sess.expires_at)}
                        </div>
                      </div>
                      {!isCurrent && (
                        <button
                          type="button"
                          onClick={() => handleRevokeSession(sess.id)}
                          className="rounded border border-slate-700 px-2.5 py-1 text-red-400 hover:bg-red-950/50 whitespace-nowrap"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Login History */}
            <div className="rounded-lg border border-slate-800 bg-[#111827] overflow-hidden">
              <div className="border-b border-slate-800 px-5 py-3.5">
                <h3 className="font-display text-sm font-semibold text-slate-100">
                  Workspace Login & Security History
                </h3>
              </div>
              <div className="overflow-x-auto max-h-64">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-xs text-slate-400">
                      <th className="px-5 py-2 font-medium">Timestamp</th>
                      <th className="px-4 py-2 font-medium">Admin</th>
                      <th className="px-4 py-2 font-medium">Event</th>
                      <th className="px-5 py-2 font-medium text-right">IP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-xs">
                    {(securityData?.loginHistory || []).map((lh) => (
                      <tr key={lh.id}>
                        <td className="px-5 py-2 font-mono text-slate-400 tabular-nums whitespace-nowrap">
                          {formatTimestamp(lh.created_at)}
                        </td>
                        <td className="px-4 py-2 text-slate-200">{lh.username_attempted}</td>
                        <td className="px-4 py-2">
                          <span className={lh.success ? 'text-emerald-400' : 'text-red-400'}>
                            {lh.event_type}
                          </span>
                        </td>
                        <td className="px-5 py-2 text-right font-mono text-slate-400">
                          {lh.ip_address}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: WORKSPACE ISOLATION & DELEGATED RBAC */}
      {activeTab === 'staff' && (
        <div className="space-y-6">
          <div className="rounded-lg border border-slate-800 bg-[#111827] p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-sky-400">
                <Shield className="h-4 w-4" />
                <span>Active Workspace Boundary: {admin.workspaceName}</span>
              </div>
              <p className="text-xs text-slate-400 max-w-2xl">
                Owner accounts <strong>BeniLin</strong> and <strong>Shana Love</strong> operate in
                strictly isolated workspaces (<code>ws_benilin</code> and{' '}
                <code>ws_shana_love</code>). Queries across catalog, infrastructure, assets, users,
                treasury, and audit logs are partitioned by <code>workspace_id</code>.
              </p>
            </div>
            {admin.role === AdminRole.OWNER && (
              <button
                type="button"
                onClick={() => {
                  setCreatedStaffKey(null);
                  setStaffModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-sky-500 whitespace-nowrap shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Scoped Staff Role</span>
              </button>
            )}
          </div>

          <div className="rounded-lg border border-slate-800 bg-[#111827] overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs text-slate-400">
                  <th className="px-5 py-3 font-medium">Administrator</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Last Sign-In</th>
                  <th className="px-5 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-xs">
                {(securityData?.workspaceStaff || []).map((st) => (
                  <tr key={st.id}>
                    <td className="px-5 py-3 font-medium text-slate-100">
                      {st.username}{' '}
                      {Boolean(st.is_owner_slot) && (
                        <span className="ml-1.5 text-sky-400">· Designated Owner</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-300">{st.role}</td>
                    <td className="px-4 py-3">
                      {st.is_locked ? (
                        <span className="text-red-400">Locked</span>
                      ) : (
                        <span className="text-emerald-400">Active</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-400 tabular-nums">
                      {formatTimestamp(st.last_login_at)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {!st.is_owner_slot && admin.role === AdminRole.OWNER ? (
                        <button
                          type="button"
                          onClick={() => handleToggleLockStaff(st.id, Boolean(st.is_locked))}
                          className="inline-flex items-center gap-1 rounded border border-slate-700 px-2.5 py-1 text-slate-200 hover:bg-slate-800"
                        >
                          <Lock className="h-3 w-3" />
                          <span>{st.is_locked ? 'Unlock' : 'Lock'}</span>
                        </button>
                      ) : (
                        <span className="text-slate-600">Owner Protected</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Delegated Staff Modal */}
      <Modal
        open={staffModalOpen}
        onClose={() => setStaffModalOpen(false)}
        title="Provision Scoped Workspace Staff Role"
        subtitle={`Delegated account is confined strictly to ${admin.workspaceName}.`}
        maxWidthClass="max-w-md"
      >
        {createdStaffKey ? (
          <div className="space-y-4">
            <div className="rounded border border-emerald-800 bg-emerald-950/30 p-4 text-xs">
              <div className="font-semibold text-emerald-300">
                Staff Account Created — One-Time Recovery Key:
              </div>
              <div className="mt-1.5 font-mono text-slate-100 select-all break-all">
                {createdStaffKey}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setStaffModalOpen(false)}
              className="w-full rounded-md bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-500"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleCreateStaff} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300">Staff Username *</label>
              <input
                type="text"
                required
                value={staffUsername}
                onChange={(e) => setStaffUsername(e.target.value)}
                placeholder="e.g. catalog_editor_01"
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300">RBAC Role *</label>
              <select
                value={staffRole}
                onChange={(e) => setStaffRole(e.target.value as AdminRole)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
              >
                <option value={AdminRole.CONTENT_ADMIN}>
                  CONTENT_ADMIN (Anime, Episodes, Assets)
                </option>
                <option value={AdminRole.INFRA_ADMIN}>
                  INFRA_ADMIN (Streaming Providers, Storage Pool, Monitoring)
                </option>
                <option value={AdminRole.SUPPORT_MOD}>
                  SUPPORT_MOD (User Moderation & Reports)
                </option>
                <option value={AdminRole.AUDITOR}>
                  AUDITOR (Read-Only Audit, Treasury & Analytics)
                </option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300">Initial Password *</label>
              <input
                type="password"
                required
                value={staffPassword}
                onChange={(e) => setStaffPassword(e.target.value)}
                placeholder="Enter password"
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
              />
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
              <button
                type="button"
                onClick={() => setStaffModalOpen(false)}
                className="rounded-md border border-slate-700 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={staffBusy}
                className="rounded-md bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {staffBusy ? 'Creating...' : 'Create Staff Account'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

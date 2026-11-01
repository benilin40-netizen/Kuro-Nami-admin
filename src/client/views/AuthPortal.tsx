import React, { useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Download,
  KeyRound,
  Lock,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { AuthenticatedAdmin, OwnerProvisionSlot } from '../../shared/types';
import { apiRequest, downloadTextFile, setClientAuthTokens } from '../api';

interface AuthPortalProps {
  ownerSlots: OwnerProvisionSlot[];
  requiresProvisioningToken: boolean;
  onAuthenticated: (admin: AuthenticatedAdmin) => void;
  onRefreshStatus: () => Promise<void>;
}

export function AuthPortal({
  ownerSlots,
  requiresProvisioningToken,
  onAuthenticated,
  onRefreshStatus,
}: AuthPortalProps) {
  const unprovisionedSlots = ownerSlots.filter((s) => !s.isProvisioned);
  const [mode, setMode] = useState<'login' | 'provision' | 'reset'>(
    unprovisionedSlots.length === ownerSlots.length && ownerSlots.length > 0 ? 'provision' : 'login'
  );

  // Login state
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Provision state
  const [selectedOwnerId, setSelectedOwnerId] = useState<string>(
    unprovisionedSlots[0]?.id || ownerSlots[0]?.id || ''
  );
  const [provPassword, setProvPassword] = useState('');
  const [provConfirmPassword, setProvConfirmPassword] = useState('');
  const [provToken, setProvToken] = useState('');
  const [provisionedResult, setProvisionedResult] = useState<{
    admin: AuthenticatedAdmin;
    recoveryKey: string;
  } | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [acknowledgedKey, setAcknowledgedKey] = useState(false);

  // Password Reset state
  const [resetUsername, setResetUsername] = useState('');
  const [resetRecoveryKey, setResetRecoveryKey] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [rotatedRecoveryKey, setRotatedRecoveryKey] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await apiRequest<{
        admin: AuthenticatedAdmin;
        sessionToken: string;
      }>('/api/v1/auth/login', {
        method: 'POST',
        body: {
          username: loginUsername,
          password: loginPassword,
        },
      });
      setClientAuthTokens(res.sessionToken, res.admin.csrfToken);
      onAuthenticated(res.admin);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleProvision = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await apiRequest<{
        admin: AuthenticatedAdmin;
        sessionToken: string;
        oneTimeRecoveryKey: string;
      }>('/api/v1/auth/provision-owner', {
        method: 'POST',
        body: {
          ownerAccountId: selectedOwnerId,
          password: provPassword,
          confirmPassword: provConfirmPassword,
          provisioningToken: provToken || undefined,
        },
      });
      setClientAuthTokens(res.sessionToken, res.admin.csrfToken);
      await onRefreshStatus();
      setProvisionedResult({
        admin: res.admin,
        recoveryKey: res.oneTimeRecoveryKey,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Owner provisioning failed.');
    } finally {
      setBusy(false);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await apiRequest<{ ok: boolean; newRecoveryKey: string }>(
        '/api/v1/auth/reset-password',
        {
          method: 'POST',
          body: {
            username: resetUsername,
            recoveryKey: resetRecoveryKey,
            newPassword: resetNewPassword,
            confirmPassword: resetConfirmPassword,
          },
        }
      );
      setRotatedRecoveryKey(res.newRecoveryKey);
      setResetRecoveryKey('');
      setResetNewPassword('');
      setResetConfirmPassword('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Password recovery failed.');
    } finally {
      setBusy(false);
    }
  };

  if (provisionedResult) {
    return (
      <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-lg border border-slate-800 bg-[#111827] p-8">
          <div className="flex items-center gap-2.5 text-emerald-400">
            <ShieldCheck className="h-5 w-5 shrink-0" />
            <span className="text-xs font-semibold tracking-wide">
              Owner Provisioning Complete
            </span>
          </div>
          <h1 className="mt-2 font-display text-2xl font-semibold text-slate-100">
            Save Your One-Time Recovery Key
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            Owner workspace{' '}
            <strong className="font-medium text-slate-200">
              {provisionedResult.admin.workspaceName}
            </strong>{' '}
            for <strong className="font-medium text-slate-200">{provisionedResult.admin.username}</strong>{' '}
            is now active and isolated. Store this recovery key offline—it is hashed on the server
            and will never be displayed again.
          </p>

          <div className="mt-5 rounded-md border border-slate-800 bg-[#0B0F17] p-4">
            <div className="text-xs text-slate-400">Cryptographic Recovery Key</div>
            <div className="mt-1.5 font-mono text-sm font-semibold tracking-wider text-sky-300 select-all break-all">
              {provisionedResult.recoveryKey}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(provisionedResult.recoveryKey);
                  setCopiedKey(true);
                }}
                className="inline-flex items-center gap-1.5 rounded border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
              >
                <Copy className="h-3.5 w-3.5" />
                <span>{copiedKey ? 'Copied' : 'Copy Key'}</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  downloadTextFile(
                    `kuro-nami-recovery-${provisionedResult.admin.username
                      .toLowerCase()
                      .replace(/\s+/g, '-')}.txt`,
                    `KURO NAMI ADMIN — OWNER RECOVERY KEY\nOwner: ${provisionedResult.admin.username}\nWorkspace: ${provisionedResult.admin.workspaceName}\nRecovery Key: ${provisionedResult.recoveryKey}\nGenerated: ${new Date().toISOString()}\n`,
                    'text/plain'
                  )
                }
                className="inline-flex items-center gap-1.5 rounded border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Download Key File</span>
              </button>
            </div>
          </div>

          <label className="mt-5 flex items-start gap-2.5 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={acknowledgedKey}
              onChange={(e) => setAcknowledgedKey(e.target.checked)}
              className="mt-0.5 rounded border-slate-700 bg-slate-900 text-sky-500"
            />
            <span>
              I have stored this recovery key in a secure password vault and understand public
              registration and unverified resets are disabled.
            </span>
          </label>

          <button
            type="button"
            disabled={!acknowledgedKey}
            onClick={() => onAuthenticated(provisionedResult.admin)}
            className="mt-6 w-full rounded-md bg-sky-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-sky-500 disabled:opacity-40"
          >
            Enter {provisionedResult.admin.username} Administration Console
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col">
      <header className="flex items-center justify-between gap-8 border-b border-slate-800/80 px-6 py-4">
        <span className="font-display text-base font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0">
          KURO NAMI ADMIN
        </span>
        <div className="hidden sm:flex items-center gap-6 text-xs text-slate-400">
          <span className="whitespace-nowrap">Standalone Control Plane</span>
          <span aria-hidden="true">·</span>
          <span className="whitespace-nowrap">Isolated Owner Workspaces</span>
          <span aria-hidden="true">·</span>
          <span className="whitespace-nowrap">Public Registration Disabled</span>
        </div>
        <div className="shrink-0">
          <button
            type="button"
            onClick={() => {
              setError(null);
              setMode(mode === 'login' ? 'provision' : 'login');
            }}
            className="rounded-md border border-slate-700 px-3.5 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            {mode === 'login' ? 'Owner Provisioning' : 'Administrator Sign In'}
          </button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left architectural & owner provisioning status column */}
          <div className="lg:col-span-5 space-y-6">
            <div>
              <h1 className="font-display text-2xl font-semibold text-slate-100 text-balance">
                Platform Administration & Infrastructure Access
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                Dedicated administrative control system for KURO NAMI streaming providers, logical
                storage pools, catalog synchronization, and financial audit governance.
              </p>
            </div>

            <div className="rounded-lg border border-slate-800 bg-[#111827] p-5">
              <h2 className="font-display text-sm font-semibold text-slate-200">
                Designated Owner Workspaces
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                Each owner maintains an isolated workspace and independent access boundary.
              </p>
              <div className="mt-4 divide-y divide-slate-800/80">
                {ownerSlots.map((slot) => (
                  <div
                    key={slot.id}
                    className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div>
                      <div className="text-sm font-medium text-slate-100">{slot.username}</div>
                      <div className="text-xs text-slate-400">{slot.workspaceName}</div>
                    </div>
                    {slot.isProvisioned ? (
                      <button
                        type="button"
                        onClick={() => {
                          setMode('login');
                          setLoginUsername(slot.username);
                          setError(null);
                        }}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:underline whitespace-nowrap"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Provisioned · Sign In</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setMode('provision');
                          setSelectedOwnerId(slot.id);
                          setError(null);
                        }}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 hover:underline whitespace-nowrap"
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        <span>Setup Password</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="text-xs leading-relaxed text-slate-500">
              Security enforcement: Scrypt key derivation, HttpOnly + CSRF session validation,
              workspace-scoped SQLite queries, and append-only audit triggers. Ordinary website
              users cannot authenticate or escalate privileges here.
            </div>
          </div>

          {/* Right interactive authentication card */}
          <div className="lg:col-span-7 rounded-lg border border-slate-800 bg-[#111827] p-6 sm:p-8">
            <div className="flex items-center gap-1 rounded-md bg-[#0B0F17] p-1 border border-slate-800/80">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className={`flex-1 rounded px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                  mode === 'login'
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('provision');
                  setError(null);
                }}
                className={`flex-1 rounded px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                  mode === 'provision'
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Initial Owner Setup
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('reset');
                  setError(null);
                }}
                className={`flex-1 rounded px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                  mode === 'reset'
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Password Reset
              </button>
            </div>

            {error && (
              <div className="mt-5 rounded-md border border-red-900/70 bg-red-950/40 px-4 py-3 text-xs text-red-300">
                {error}
              </div>
            )}

            {mode === 'login' && (
              <form onSubmit={handleLogin} className="mt-6 space-y-4">
                <div>
                  <h2 className="font-display text-lg font-semibold text-slate-100">
                    Administrator Sign In
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Authenticate with a provisioned owner account (BeniLin or Shana Love) or
                    delegated workspace staff credentials.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300">
                    Administrator Username
                  </label>
                  <input
                    type="text"
                    required
                    autoComplete="username"
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.target.value)}
                    placeholder="BeniLin or Shana Love"
                    className="mt-1.5 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300">Password</label>
                  <input
                    type="password"
                    required
                    autoComplete="current-password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="Enter administrator password"
                    className="mt-1.5 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md bg-sky-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
                >
                  <Lock className="h-4 w-4" />
                  <span>{busy ? 'Verifying Credentials...' : 'Sign In to Workspace'}</span>
                </button>
              </form>
            )}

            {mode === 'provision' && (
              <div className="mt-6">
                <h2 className="font-display text-lg font-semibold text-slate-100">
                  Authorized Initial Owner Provisioning
                </h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  One-time password initialization exclusively for designated KURO NAMI owners. No
                  hardcoded or default passwords exist.
                </p>

                {unprovisionedSlots.length === 0 ? (
                  <div className="mt-6 rounded-md border border-slate-800 bg-[#0B0F17] p-5 text-sm text-slate-300">
                    All designated owner accounts (<strong>BeniLin</strong> and{' '}
                    <strong>Shana Love</strong>) have completed one-time initial provisioning.
                    One-time setup is permanently locked. Proceed to{' '}
                    <button
                      type="button"
                      onClick={() => setMode('login')}
                      className="text-sky-400 hover:underline font-medium"
                    >
                      Sign In
                    </button>
                    .
                  </div>
                ) : (
                  <form onSubmit={handleProvision} className="mt-5 space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-300">
                        Select Unprovisioned Owner Account
                      </label>
                      <select
                        value={
                          unprovisionedSlots.some((s) => s.id === selectedOwnerId)
                            ? selectedOwnerId
                            : unprovisionedSlots[0].id
                        }
                        onChange={(e) => setSelectedOwnerId(e.target.value)}
                        className="mt-1.5 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3.5 py-2.5 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                      >
                        {unprovisionedSlots.map((slot) => (
                          <option key={slot.id} value={slot.id}>
                            {slot.username} — {slot.workspaceName}
                          </option>
                        ))}
                      </select>
                    </div>

                    {requiresProvisioningToken && (
                      <div>
                        <label className="block text-xs font-medium text-slate-300">
                          Server Provisioning Authorization Token
                        </label>
                        <input
                          type="password"
                          required
                          value={provToken}
                          onChange={(e) => setProvToken(e.target.value)}
                          placeholder="Enter ADMIN_PROVISIONING_TOKEN"
                          className="mt-1.5 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3.5 py-2.5 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-medium text-slate-300">
                        Configure Owner Password
                      </label>
                      <input
                        type="password"
                        required
                        autoComplete="new-password"
                        value={provPassword}
                        onChange={(e) => setProvPassword(e.target.value)}
                        placeholder="Enter password"
                        className="mt-1.5 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-300">
                        Confirm Owner Password
                      </label>
                      <input
                        type="password"
                        required
                        autoComplete="new-password"
                        value={provConfirmPassword}
                        onChange={(e) => setProvConfirmPassword(e.target.value)}
                        placeholder="Re-enter owner password"
                        className="mt-1.5 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={busy}
                      className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md bg-sky-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
                    >
                      <UserCheck className="h-4 w-4" />
                      <span>
                        {busy ? 'Provisioning Isolated Workspace...' : 'Provision Owner Account'}
                      </span>
                    </button>
                  </form>
                )}
              </div>
            )}

            {mode === 'reset' && (
              <div className="mt-6">
                <h2 className="font-display text-lg font-semibold text-slate-100">
                  Cryptographic Password Reset
                </h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  Reset a provisioned administrator password using your offline Recovery Key. Active
                  sessions are revoked immediately upon reset.
                </p>

                {rotatedRecoveryKey && (
                  <div className="mt-4 rounded-md border border-emerald-800/80 bg-emerald-950/30 p-4">
                    <div className="text-xs font-semibold text-emerald-300">
                      Password Reset Complete — Store Your New Rotated Recovery Key:
                    </div>
                    <div className="mt-1.5 font-mono text-xs text-slate-100 select-all break-all">
                      {rotatedRecoveryKey}
                    </div>
                  </div>
                )}

                <form onSubmit={handlePasswordReset} className="mt-5 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300">
                      Administrator Username
                    </label>
                    <input
                      type="text"
                      required
                      value={resetUsername}
                      onChange={(e) => setResetUsername(e.target.value)}
                      placeholder="BeniLin or Shana Love"
                      className="mt-1.5 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3.5 py-2.5 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300">
                      One-Time Recovery Key
                    </label>
                    <input
                      type="text"
                      required
                      value={resetRecoveryKey}
                      onChange={(e) => setResetRecoveryKey(e.target.value)}
                      placeholder="KN-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX"
                      className="mt-1.5 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3.5 py-2.5 font-mono text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-300">
                        New Password
                      </label>
                      <input
                        type="password"
                        required
                        value={resetNewPassword}
                        onChange={(e) => setResetNewPassword(e.target.value)}
                        placeholder="Min 10 chars"
                        className="mt-1.5 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3.5 py-2.5 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-300">
                        Confirm Password
                      </label>
                      <input
                        type="password"
                        required
                        value={resetConfirmPassword}
                        onChange={(e) => setResetConfirmPassword(e.target.value)}
                        placeholder="Confirm password"
                        className="mt-1.5 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3.5 py-2.5 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={busy}
                    className="mt-2 w-full rounded-md bg-sky-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
                  >
                    {busy ? 'Rotating Credentials...' : 'Reset Password & Revoke Sessions'}
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

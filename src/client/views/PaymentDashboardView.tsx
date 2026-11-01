import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  DollarSign,
  Download,
  ExternalLink,
  FileText,
  Filter,
  Globe,
  Key,
  Layers,
  Lock,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Tag,
  XCircle,
} from 'lucide-react';
import {
  AuthenticatedAdmin,
  CouponRecord,
  CurrencySettingRecord,
  CustomerSubscriptionRecord,
  MembershipPlanRecord,
  PaymentGatewayRecord,
  PaymentOrderRecord,
  PaymentWebhookLogRecord,
  RevenueByCurrency,
  WebsiteIntegrationStatus,
} from '../../shared/types';
import { apiRequest, formatTimestamp } from '../api';
import { Modal } from '../components/UiPrimitives';

interface OverviewMetricsData {
  revenueByCurrency: RevenueByCurrency[];
  metrics: {
    totalOrdersCount: number;
    pendingCount: number;
    activeSubscriptionsCount: number;
    expiringCount: number;
  };
}

export function PaymentDashboardView({
  admin,
  notify,
}: {
  admin: AuthenticatedAdmin;
  notify: (tone: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<
    | 'overview'
    | 'transactions'
    | 'integration'
    | 'currencies'
    | 'plans'
    | 'gateways'
    | 'subscriptions'
    | 'coupons'
    | 'webhooks'
    | 'audit'
  >('overview');

  // Overview Data
  const [overview, setOverview] = useState<OverviewMetricsData | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);

  // Transactions Data
  const [transactions, setTransactions] = useState<PaymentOrderRecord[]>([]);
  const [txSearch, setTxSearch] = useState('');
  const [txStatusFilter, setTxStatusFilter] = useState('ALL');
  const [txCurrencyFilter, setTxCurrencyFilter] = useState('ALL');

  // Integration Data
  const [integrationStatus, setIntegrationStatus] = useState<WebsiteIntegrationStatus | null>(null);
  const [testingIntegration, setTestingIntegration] = useState(false);

  // Currencies Data
  const [currencySettings, setCurrencySettings] = useState<CurrencySettingRecord | null>(null);
  const [savingCurrency, setSavingCurrency] = useState(false);

  // Plans Data
  const [plans, setPlans] = useState<MembershipPlanRecord[]>([]);
  const [editingPlan, setEditingPlan] = useState<MembershipPlanRecord | null>(null);

  // Gateways Data
  const [gateways, setGateways] = useState<PaymentGatewayRecord[]>([]);

  // Subscriptions Data
  const [subscriptions, setSubscriptions] = useState<CustomerSubscriptionRecord[]>([]);

  // Coupons Data
  const [coupons, setCoupons] = useState<CouponRecord[]>([]);
  const [couponCode, setCouponCode] = useState('');
  const [couponDiscount, setCouponDiscount] = useState('10');
  const [creatingCoupon, setCreatingCoupon] = useState(false);

  // Webhooks & Audit Data
  const [webhooks, setWebhooks] = useState<PaymentWebhookLogRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<Array<Record<string, unknown>>>([]);

  // Refund Modal State
  const [refundOrder, setRefundOrder] = useState<PaymentOrderRecord | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const [refundBusy, setRefundBusy] = useState(false);

  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    try {
      const res = await apiRequest<OverviewMetricsData>('/api/v1/payments/overview');
      setOverview(res);
    } catch (err) {
      notify('error', 'Failed to load payment overview', err instanceof Error ? err.message : undefined);
    } finally {
      setLoadingOverview(false);
    }
  }, [notify]);

  const loadTransactions = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (txSearch) params.set('search', txSearch);
      if (txStatusFilter !== 'ALL') params.set('status', txStatusFilter);
      if (txCurrencyFilter !== 'ALL') params.set('currency', txCurrencyFilter);

      const res = await apiRequest<{ items: PaymentOrderRecord[] }>(
        `/api/v1/payments/transactions?${params.toString()}`
      );
      setTransactions(res.items);
    } catch (err) {
      notify('error', 'Failed to load transactions', err instanceof Error ? err.message : undefined);
    }
  }, [txSearch, txStatusFilter, txCurrencyFilter, notify]);

  const loadIntegration = useCallback(async () => {
    try {
      const res = await apiRequest<WebsiteIntegrationStatus>('/api/v1/integration/status');
      setIntegrationStatus(res);
    } catch (err) {
      notify('error', 'Failed to load website integration status', err instanceof Error ? err.message : undefined);
    }
  }, [notify]);

  const loadCurrencies = useCallback(async () => {
    try {
      const res = await apiRequest<CurrencySettingRecord>('/api/v1/payments/currencies');
      setCurrencySettings(res);
    } catch (err) {
      notify('error', 'Failed to load currency settings', err instanceof Error ? err.message : undefined);
    }
  }, [notify]);

  const loadPlans = useCallback(async () => {
    try {
      const res = await apiRequest<{ items: MembershipPlanRecord[] }>('/api/v1/payments/plans');
      setPlans(res.items);
    } catch (err) {
      notify('error', 'Failed to load plans', err instanceof Error ? err.message : undefined);
    }
  }, [notify]);

  const loadGateways = useCallback(async () => {
    try {
      const res = await apiRequest<{ items: PaymentGatewayRecord[] }>('/api/v1/payments/gateways');
      setGateways(res.items);
    } catch (err) {
      notify('error', 'Failed to load gateways', err instanceof Error ? err.message : undefined);
    }
  }, [notify]);

  const loadSubscriptions = useCallback(async () => {
    try {
      const res = await apiRequest<{ items: CustomerSubscriptionRecord[] }>('/api/v1/payments/subscriptions');
      setSubscriptions(res.items);
    } catch (err) {
      notify('error', 'Failed to load subscriptions', err instanceof Error ? err.message : undefined);
    }
  }, [notify]);

  const loadCoupons = useCallback(async () => {
    try {
      const res = await apiRequest<{ items: CouponRecord[] }>('/api/v1/payments/coupons');
      setCoupons(res.items);
    } catch (err) {
      notify('error', 'Failed to load coupons', err instanceof Error ? err.message : undefined);
    }
  }, [notify]);

  const loadWebhooks = useCallback(async () => {
    try {
      const res = await apiRequest<{ items: PaymentWebhookLogRecord[] }>('/api/v1/payments/webhooks-log');
      setWebhooks(res.items);
    } catch (err) {
      notify('error', 'Failed to load webhook logs', err instanceof Error ? err.message : undefined);
    }
  }, [notify]);

  const loadAudit = useCallback(async () => {
    try {
      const res = await apiRequest<{ items: Array<Record<string, unknown>> }>('/api/v1/payments/audit');
      setAuditLogs(res.items);
    } catch (err) {
      notify('error', 'Failed to load financial audit trail', err instanceof Error ? err.message : undefined);
    }
  }, [notify]);

  useEffect(() => {
    loadOverview();
    loadTransactions();
    loadIntegration();
    loadCurrencies();
    loadPlans();
    loadGateways();
    loadSubscriptions();
    loadCoupons();
    loadWebhooks();
    loadAudit();
  }, [
    loadOverview,
    loadTransactions,
    loadIntegration,
    loadCurrencies,
    loadPlans,
    loadGateways,
    loadSubscriptions,
    loadCoupons,
    loadWebhooks,
    loadAudit,
  ]);

  const handleTestIntegrationAll = async () => {
    setTestingIntegration(true);
    try {
      const res = await apiRequest<WebsiteIntegrationStatus>('/api/v1/integration/test-all', {
        method: 'POST',
      });
      setIntegrationStatus(res);
      notify(
        res.websiteStatus === 'CONNECTED' ? 'success' : 'info',
        'Website Integration Diagnostic Complete',
        `Live site status: ${res.websiteStatus}`
      );
    } catch (err) {
      notify('error', 'Integration test probe failed', err instanceof Error ? err.message : undefined);
    } finally {
      setTestingIntegration(false);
    }
  };

  const handleVerifyOrder = async (orderId: string) => {
    try {
      const res = await apiRequest<{ ok: boolean; message: string; receiptNumber?: string }>(
        `/api/v1/payments/transactions/${orderId}/verify`,
        { method: 'POST' }
      );
      notify('success', 'Transaction Reconciled & Verified', res.message);
      loadTransactions();
      loadOverview();
    } catch (err) {
      notify('error', 'Verification failed', err instanceof Error ? err.message : undefined);
    }
  };

  const handleExecuteRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refundOrder) return;
    setRefundBusy(true);
    try {
      await apiRequest(`/api/v1/payments/transactions/${refundOrder.id}/refund`, {
        method: 'POST',
        body: { reason: refundReason },
      });
      notify('success', 'Refund Processed', `Order ${refundOrder.orderRef} marked refunded.`);
      setRefundOrder(null);
      setRefundReason('');
      loadTransactions();
      loadOverview();
    } catch (err) {
      notify('error', 'Refund failed', err instanceof Error ? err.message : undefined);
    } finally {
      setRefundBusy(false);
    }
  };

  const handleSaveCurrencies = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currencySettings) return;
    setSavingCurrency(true);
    try {
      const res = await apiRequest<CurrencySettingRecord>('/api/v1/payments/currencies', {
        method: 'PUT',
        body: currencySettings,
      });
      setCurrencySettings(res);
      notify('success', 'Multi-currency configuration updated');
    } catch (err) {
      notify('error', 'Failed to save currency settings', err instanceof Error ? err.message : undefined);
    } finally {
      setSavingCurrency(false);
    }
  };

  const handleCreateCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingCoupon(true);
    try {
      await apiRequest('/api/v1/payments/coupons', {
        method: 'POST',
        body: { code: couponCode, discountPercent: Number(couponDiscount) },
      });
      notify('success', `Coupon ${couponCode.toUpperCase()} created`);
      setCouponCode('');
      loadCoupons();
    } catch (err) {
      notify('error', 'Failed to create coupon', err instanceof Error ? err.message : undefined);
    } finally {
      setCreatingCoupon(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-100 flex items-center gap-2">
            <span>Payment & Website Integration Control Center</span>
            <span className="rounded bg-sky-950 px-2 py-0.5 font-mono text-[11px] font-medium text-sky-400 border border-sky-800/60">
              UGX Base
            </span>
          </h1>
          <p className="mt-0.5 text-xs text-slate-400">
            Multi-currency financial hub, Flutterwave checkout gateway, live website (<code>https://kuro-name-v1.vercel.app/</code>) integration, and membership subscription governance.
          </p>
        </div>

        <button
          type="button"
          onClick={handleTestIntegrationAll}
          disabled={testingIntegration}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-[#111827] px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <Activity className="h-3.5 w-3.5 text-sky-400" />
          <span>{testingIntegration ? 'Testing Connection...' : 'Probe Live Website & Gateways'}</span>
        </button>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex flex-wrap items-center gap-1 rounded-md border border-slate-800 bg-[#111827] p-1">
        {[
          { id: 'overview', label: 'Revenue & Metrics' },
          { id: 'transactions', label: 'Transactions Ledger' },
          { id: 'integration', label: 'Live Website Status' },
          { id: 'currencies', label: 'Multi-Currency & Rates' },
          { id: 'plans', label: 'Membership Plans' },
          { id: 'gateways', label: 'Payment Gateways' },
          { id: 'subscriptions', label: 'Subscriptions' },
          { id: 'coupons', label: 'Coupons & Gifts' },
          { id: 'webhooks', label: 'Webhook Logs' },
          { id: 'audit', label: 'Financial Audit Trail' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === tab.id ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB 1: REVENUE OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-lg border border-slate-800 bg-[#111827] p-4">
              <div className="text-xs font-medium text-slate-400">Total Transaction Orders</div>
              <div className="mt-2 font-display text-2xl font-bold text-slate-100 tabular-nums">
                {overview?.metrics.totalOrdersCount ?? 0}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                Pending: {overview?.metrics.pendingCount ?? 0}
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-[#111827] p-4">
              <div className="text-xs font-medium text-slate-400">Active Premium Memberships</div>
              <div className="mt-2 font-display text-2xl font-bold text-emerald-400 tabular-nums">
                {overview?.metrics.activeSubscriptionsCount ?? 0}
              </div>
              <div className="mt-1 text-[11px] text-amber-300">
                Expiring soon: {overview?.metrics.expiringCount ?? 0}
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-[#111827] p-4">
              <div className="text-xs font-medium text-slate-400">Primary Payment Gateway</div>
              <div className="mt-2 font-display text-lg font-bold text-sky-400">
                Flutterwave
              </div>
              <div className="mt-1 text-[11px] text-emerald-400">UGX, Mobile Money & Cards</div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-[#111827] p-4">
              <div className="text-xs font-medium text-slate-400">Evaluated Backup Gateway</div>
              <div className="mt-2 font-display text-lg font-bold text-slate-300">
                Pesapal
              </div>
              <div className="mt-1 text-[11px] text-amber-400">Disabled until live credentials provided</div>
            </div>
          </div>

          {/* Revenue Separated By Currency (CRITICAL: Never summed together across different currencies!) */}
          <div className="rounded-lg border border-slate-800 bg-[#111827] p-6 space-y-4">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-100 flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-emerald-400" />
                <span>Verified Net Revenue Breakdown By Currency</span>
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Financial discipline rule enforced: Different currencies are strictly partitioned and calculated separately.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {(overview?.revenueByCurrency || []).map((rev) => (
                <div key={rev.currency} className="rounded-md border border-slate-800 bg-[#0B0F17] p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-sky-400">{rev.currency}</span>
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">
                      {rev.successfulCount} Paid Orders
                    </span>
                  </div>
                  <div className="font-display text-xl font-semibold text-slate-100 tabular-nums">
                    {rev.currency} {rev.netRevenue.toLocaleString()}
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-800">
                    <span>Gross: {rev.totalCharged.toLocaleString()}</span>
                    <span>Fees: {rev.totalFees.toLocaleString()}</span>
                  </div>
                </div>
              ))}
              {(!overview?.revenueByCurrency || overview.revenueByCurrency.length === 0) && (
                <div className="col-span-full rounded-md border border-slate-800/60 bg-[#0B0F17] p-6 text-center text-xs text-slate-400">
                  No successful payments recorded yet. Initiate test payments in Customer Website Preview tab.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: TRANSACTIONS LEDGER */}
      {activeTab === 'transactions' && (
        <div className="rounded-lg border border-slate-800 bg-[#111827] overflow-hidden space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-5 border-b border-slate-800">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-100">
                Payment Transactions Ledger
              </h2>
              <p className="text-xs text-slate-400">
                Search, inspect, re-verify server-to-server with Flutterwave or execute refunds.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search tx_ref, email, receipt..."
                  value={txSearch}
                  onChange={(e) => setTxSearch(e.target.value)}
                  className="rounded-md border border-slate-700 bg-[#0B0F17] pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500"
                />
              </div>

              <select
                value={txStatusFilter}
                onChange={(e) => setTxStatusFilter(e.target.value)}
                className="rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-1.5 text-xs text-slate-100"
              >
                <option value="ALL">All Statuses</option>
                <option value="SUCCESSFUL">SUCCESSFUL</option>
                <option value="PENDING">PENDING</option>
                <option value="FAILED">FAILED</option>
                <option value="REFUNDED">REFUNDED</option>
              </select>

              <select
                value={txCurrencyFilter}
                onChange={(e) => setTxCurrencyFilter(e.target.value)}
                className="rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-1.5 text-xs text-slate-100"
              >
                <option value="ALL">All Currencies</option>
                <option value="UGX">UGX</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="KES">KES</option>
                <option value="TZS">TZS</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs text-slate-400 bg-[#0B0F17]">
                  <th className="px-5 py-3 font-medium">Order Ref & Customer</th>
                  <th className="px-4 py-3 font-medium">Membership Plan</th>
                  <th className="px-4 py-3 font-medium">Charged Amount</th>
                  <th className="px-4 py-3 font-medium">Status & Receipt</th>
                  <th className="px-4 py-3 font-medium">Timestamp</th>
                  <th className="px-5 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-xs">
                {transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-800/30">
                    <td className="px-5 py-3.5">
                      <div className="font-mono font-semibold text-sky-400">{tx.orderRef}</div>
                      <div className="text-slate-200">{tx.customerEmail}</div>
                      <div className="text-[11px] text-slate-500">{tx.customerName}</div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="font-medium text-slate-100">{tx.planName}</div>
                      <div className="text-[11px] text-slate-400">{tx.durationDays} Days Duration</div>
                    </td>
                    <td className="px-4 py-3.5 font-mono">
                      <div className="font-bold text-slate-100">
                        {tx.paymentCurrency} {tx.totalAmount.toLocaleString()}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Base: UGX {tx.basePriceUgx.toLocaleString()} (Rate: {tx.exchangeRate})
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium ${
                          tx.paymentStatus === 'SUCCESSFUL'
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                            : tx.paymentStatus === 'PENDING'
                            ? 'bg-amber-950 text-amber-300 border border-amber-800/60'
                            : tx.paymentStatus === 'REFUNDED'
                            ? 'bg-purple-950 text-purple-300 border border-purple-800/60'
                            : 'bg-red-950 text-red-300 border border-red-800/60'
                        }`}
                      >
                        {tx.paymentStatus}
                      </span>
                      {tx.receiptNumber && (
                        <div className="mt-1 font-mono text-[10px] text-slate-400">
                          {tx.receiptNumber}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-slate-400 text-[11px] tabular-nums">
                      {formatTimestamp(tx.createdAt)}
                    </td>
                    <td className="px-5 py-3.5 text-right space-x-2">
                      {tx.paymentStatus === 'PENDING' && (
                        <button
                          type="button"
                          onClick={() => handleVerifyOrder(tx.id)}
                          className="rounded border border-sky-700 px-2.5 py-1 text-[11px] text-sky-400 hover:bg-sky-950"
                        >
                          Reconcile
                        </button>
                      )}
                      {tx.paymentStatus === 'SUCCESSFUL' && (
                        <button
                          type="button"
                          onClick={() => setRefundOrder(tx)}
                          className="rounded border border-purple-800 px-2.5 py-1 text-[11px] text-purple-300 hover:bg-purple-950"
                        >
                          Refund
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: LIVE WEBSITE INTEGRATION STATUS */}
      {activeTab === 'integration' && integrationStatus && (
        <div className="space-y-6">
          <div className="rounded-lg border border-slate-800 bg-[#111827] p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-100 flex items-center gap-2">
                  <Globe className="h-4 w-4 text-sky-400" />
                  <span>Live Website Origin Connection & Health</span>
                </h2>
                <p className="mt-0.5 text-xs font-mono text-slate-400">
                  Target Origin: {integrationStatus.websiteOrigin}
                </p>
              </div>

              <div className="flex items-center gap-2 font-mono text-xs font-bold">
                {integrationStatus.websiteStatus === 'CONNECTED' ? (
                  <span className="inline-flex items-center gap-1.5 rounded bg-emerald-950 px-3 py-1 text-emerald-400 border border-emerald-800">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>CONNECTED</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded bg-amber-950 px-3 py-1 text-amber-300 border border-amber-800">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span>{integrationStatus.websiteStatus}</span>
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div className="rounded border border-slate-800 bg-[#0B0F17] p-3">
                <div className="text-slate-400">Last Verified Test</div>
                <div className="mt-1 font-mono text-slate-200">
                  {formatTimestamp(integrationStatus.lastTestedAt)}
                </div>
              </div>
              <div className="rounded border border-slate-800 bg-[#0B0F17] p-3">
                <div className="text-slate-400">Probe Latency</div>
                <div className="mt-1 font-mono text-slate-200">{integrationStatus.latencyMs} ms</div>
              </div>
              <div className="rounded border border-slate-800 bg-[#0B0F17] p-3">
                <div className="text-slate-400">Authentication Layer</div>
                <div className="mt-1 font-mono text-emerald-400">OPERATIONAL</div>
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <h3 className="font-display text-xs font-semibold text-slate-300">
                Diagnostic Components & Safeguards Log
              </h3>
              <div className="divide-y divide-slate-800/80 rounded border border-slate-800 bg-[#0B0F17] text-xs">
                {integrationStatus.diagnostics.map((diag, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3">
                    <span className="font-medium text-slate-200">{diag.component}</span>
                    <span
                      className={`font-mono text-[11px] ${
                        diag.status === 'PASS'
                          ? 'text-emerald-400'
                          : diag.status === 'WARN'
                          ? 'text-amber-300'
                          : 'text-red-400'
                      }`}
                    >
                      {diag.detail}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: MULTI-CURRENCY & EXCHANGE RATES */}
      {activeTab === 'currencies' && currencySettings && (
        <form onSubmit={handleSaveCurrencies} className="rounded-lg border border-slate-800 bg-[#111827] p-6 space-y-6">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-100">
              Multi-Currency & Exchange Rates Configuration
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              UGX is locked as the default base pricing currency. Enable customer checkout currencies and adjust conversion rules.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-medium text-slate-300">Base Currency</label>
              <input
                type="text"
                disabled
                value="UGX (Ugandan Shilling - Default Base)"
                className="mt-1 w-full rounded-md border border-slate-800 bg-[#0B0F17] px-3.5 py-2 font-mono text-xs text-slate-400"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300">Transaction Fee Handling</label>
              <select
                value={currencySettings.feeMode}
                onChange={(e) =>
                  setCurrencySettings({
                    ...currencySettings,
                    feeMode: e.target.value as 'INCLUSIVE' | 'EXCLUSIVE',
                  })
                }
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3.5 py-2 text-xs text-slate-100"
              >
                <option value="INCLUSIVE">INCLUSIVE (Prices include all transaction fees)</option>
                <option value="EXCLUSIVE">EXCLUSIVE (Add 2.5% gateway fee at checkout)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-2">Supported Customer Currencies & Conversion Rates</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {['UGX', 'USD', 'EUR', 'GBP', 'KES', 'TZS'].map((curr) => {
                const isSupported = currencySettings.supportedCurrencies.includes(curr);
                const rate = currencySettings.exchangeRates[curr] ?? 1;

                return (
                  <div key={curr} className="rounded-md border border-slate-800 bg-[#0B0F17] p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold text-sky-400">{curr}</span>
                      <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isSupported}
                          disabled={curr === 'UGX'}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...currencySettings.supportedCurrencies, curr]
                              : currencySettings.supportedCurrencies.filter((c) => c !== curr);
                            setCurrencySettings({ ...currencySettings, supportedCurrencies: next });
                          }}
                          className="rounded border-slate-700 bg-slate-900 text-sky-500"
                        />
                        <span>Enabled</span>
                      </label>
                    </div>

                    <div>
                      <label className="block text-[11px] text-slate-400">Rate (1 UGX = X {curr})</label>
                      <input
                        type="number"
                        step="any"
                        disabled={curr === 'UGX'}
                        value={rate}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          setCurrencySettings({
                            ...currencySettings,
                            exchangeRates: {
                              ...currencySettings.exchangeRates,
                              [curr]: val,
                            },
                          });
                        }}
                        className="mt-1 w-full rounded border border-slate-700 bg-[#111827] px-2.5 py-1 font-mono text-xs text-slate-100"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-slate-800">
            <button
              type="submit"
              disabled={savingCurrency}
              className="rounded-md bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {savingCurrency ? 'Saving Settings...' : 'Save Currency Configuration'}
            </button>
          </div>
        </form>
      )}

      {/* TAB 5: MEMBERSHIP PLANS */}
      {activeTab === 'plans' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {plans.map((p) => (
              <div key={p.id} className="rounded-lg border border-slate-800 bg-[#111827] p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-display font-semibold text-slate-100 text-base">{p.name}</span>
                  <span className="rounded bg-sky-950 px-2 py-0.5 font-mono text-[10px] text-sky-400 border border-sky-800">
                    {p.durationType}
                  </span>
                </div>

                <div className="font-display text-2xl font-bold text-slate-100">
                  UGX {p.basePriceUgx.toLocaleString()}{' '}
                  <span className="text-xs font-normal text-slate-400">/ {p.durationDays} Days</span>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed">{p.description}</p>

                <div className="space-y-1 pt-2 border-t border-slate-800 text-xs text-slate-300">
                  <div className="font-semibold text-slate-400 text-[11px]">Included Benefits:</div>
                  {p.benefits.map((b, idx) => (
                    <div key={idx} className="flex items-start gap-1.5 text-[11px]">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                      <span>{b}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 6: PAYMENT GATEWAYS */}
      {activeTab === 'gateways' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {gateways.map((gw) => (
              <div key={gw.id} className="rounded-lg border border-slate-800 bg-[#111827] p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-display font-semibold text-slate-100 text-base">{gw.name}</h3>
                    <div className="font-mono text-[11px] text-slate-400">Slug: {gw.gatewaySlug}</div>
                  </div>
                  <span
                    className={`rounded px-2.5 py-1 font-mono text-[11px] font-semibold ${
                      gw.isEnabled
                        ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {gw.isEnabled ? 'ACTIVE' : 'DISABLED'}
                  </span>
                </div>

                <div className="rounded border border-slate-800 bg-[#0B0F17] p-3 text-xs space-y-1 text-slate-300">
                  <div>Environment: <span className="font-mono text-sky-400">{gw.environment}</span></div>
                  <div>Secret Key Env Var: <code className="text-amber-300">{gw.secretKeyVar}</code></div>
                  <div>Status: <span className="font-semibold text-emerald-400">{gw.hasSecretKey ? 'Secret Key Found' : 'Sandbox Ready'}</span></div>
                </div>

                {gw.diagnosticReport && (
                  <div className="rounded border border-slate-800 bg-[#0B0F17] p-3 text-xs text-slate-400 leading-relaxed">
                    <strong className="text-slate-300 block mb-1">Gateway Diagnostic Analysis:</strong>
                    {gw.diagnosticReport}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 7: SUBSCRIPTIONS */}
      {activeTab === 'subscriptions' && (
        <div className="rounded-lg border border-slate-800 bg-[#111827] overflow-hidden">
          <div className="p-5 border-b border-slate-800">
            <h2 className="font-display text-base font-semibold text-slate-100">
              Active & Expiring Customer Subscriptions
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs text-slate-400 bg-[#0B0F17]">
                  <th className="px-5 py-3 font-medium">Customer Email</th>
                  <th className="px-4 py-3 font-medium">Membership Plan</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Starts At</th>
                  <th className="px-5 py-3 font-medium text-right">Expires At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-xs">
                {subscriptions.map((sub) => (
                  <tr key={sub.id} className="hover:bg-slate-800/30">
                    <td className="px-5 py-3.5 font-medium text-slate-100">{sub.customerEmail}</td>
                    <td className="px-4 py-3.5 text-slate-200">{sub.planName}</td>
                    <td className="px-4 py-3.5">
                      <span className="rounded bg-emerald-950 px-2 py-0.5 text-emerald-400 font-medium">
                        {sub.status}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-slate-400 text-[11px] tabular-nums">
                      {formatTimestamp(sub.startsAt)}
                    </td>
                    <td className="px-5 py-3.5 text-right font-mono text-slate-300 text-[11px] tabular-nums">
                      {formatTimestamp(sub.expiresAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 8: COUPONS */}
      {activeTab === 'coupons' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form onSubmit={handleCreateCoupon} className="lg:col-span-5 rounded-lg border border-slate-800 bg-[#111827] p-6 space-y-4">
            <h3 className="font-display font-semibold text-slate-100 text-sm">Create Discount Coupon</h3>
            <div>
              <label className="block text-xs font-medium text-slate-300">Coupon Code</label>
              <input
                type="text"
                required
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                placeholder="e.g. ANIME20"
                className="mt-1 w-full rounded border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">Discount Percentage (%)</label>
              <input
                type="number"
                required
                value={couponDiscount}
                onChange={(e) => setCouponDiscount(e.target.value)}
                className="mt-1 w-full rounded border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
              />
            </div>
            <button
              type="submit"
              disabled={creatingCoupon}
              className="w-full rounded bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {creatingCoupon ? 'Creating...' : 'Create Coupon'}
            </button>
          </form>

          <div className="lg:col-span-7 rounded-lg border border-slate-800 bg-[#111827] overflow-hidden">
            <div className="p-4 border-b border-slate-800 font-display text-sm font-semibold text-slate-100">
              Active Coupons
            </div>
            <div className="divide-y divide-slate-800/70 text-xs">
              {coupons.map((c) => (
                <div key={c.id} className="flex items-center justify-between p-4">
                  <div>
                    <span className="font-mono font-bold text-sky-400">{c.code}</span>
                    <span className="ml-2 text-slate-400">{c.discountPercent}% OFF</span>
                  </div>
                  <div className="text-slate-400 text-[11px]">
                    Uses: {c.currentUses} / {c.maxUses}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 9: WEBHOOKS LOG */}
      {activeTab === 'webhooks' && (
        <div className="rounded-lg border border-slate-800 bg-[#111827] overflow-hidden">
          <div className="p-4 border-b border-slate-800 font-display text-sm font-semibold text-slate-100">
            Incoming Payment Webhook Log Inspector
          </div>
          <div className="divide-y divide-slate-800/70 text-xs">
            {webhooks.map((wh) => (
              <div key={wh.id} className="p-4 space-y-1.5 hover:bg-slate-800/30">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sky-400 font-semibold">{wh.txRef}</span>
                  <span className="font-mono text-slate-400 text-[11px]">{formatTimestamp(wh.createdAt)}</span>
                </div>
                <div className="font-mono text-[11px] text-slate-300 select-all overflow-x-auto bg-[#0B0F17] p-2 rounded border border-slate-800">
                  {wh.payloadJson}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 10: FINANCIAL AUDIT TRAIL */}
      {activeTab === 'audit' && (
        <div className="rounded-lg border border-slate-800 bg-[#111827] overflow-hidden">
          <div className="p-4 border-b border-slate-800 font-display text-sm font-semibold text-slate-100">
            Immutable Financial Audit Log
          </div>
          <div className="divide-y divide-slate-800/70 text-xs">
            {auditLogs.map((a, idx) => (
              <div key={idx} className="p-4 flex items-center justify-between">
                <div>
                  <span className="font-medium text-slate-200">{String(a.action)}</span>
                  <span className="ml-2 text-slate-400">by {String(a.admin_username)}</span>
                </div>
                <span className="font-mono text-slate-400 text-[11px]">{formatTimestamp(String(a.created_at))}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Refund Confirmation Modal */}
      <Modal
        open={Boolean(refundOrder)}
        onClose={() => setRefundOrder(null)}
        title="Authorize Refund Action"
        subtitle={`Order Ref: ${refundOrder?.orderRef}`}
        maxWidthClass="max-w-md"
      >
        <form onSubmit={handleExecuteRefund} className="space-y-4 text-xs">
          <div>
            <label className="block font-medium text-slate-300">Refund Reason *</label>
            <input
              type="text"
              required
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
              placeholder="e.g. Customer requested cancellation within 24 hours"
              className="mt-1 w-full rounded border border-slate-700 bg-[#0B0F17] px-3 py-2 text-slate-100"
            />
          </div>

          <div className="rounded border border-amber-900/60 bg-amber-950/30 p-3 text-amber-300 leading-relaxed">
            Warning: Executing a refund will revoke active customer subscription access and log an immutable record in the financial audit trail.
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setRefundOrder(null)}
              className="rounded border border-slate-700 px-3 py-1.5 text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={refundBusy}
              className="rounded bg-purple-600 px-3 py-1.5 text-white font-medium hover:bg-purple-500 disabled:opacity-50"
            >
              {refundBusy ? 'Processing...' : 'Confirm Refund'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

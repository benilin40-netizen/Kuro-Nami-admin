import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  CreditCard,
  Download,
  Globe,
  Lock,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import {
  CurrencyCalculation,
  CustomerSubscriptionRecord,
  MembershipPlanRecord,
  PaymentOrderRecord,
} from '../../shared/types';
import { apiRequest, downloadTextFile, formatTimestamp } from '../api';

interface StorefrontPlanItem extends MembershipPlanRecord {
  pricing: CurrencyCalculation;
}

export function CustomerStorefrontView({
  notify,
}: {
  notify: (tone: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}) {
  const [selectedCurrency, setSelectedCurrency] = useState('UGX');
  const [plans, setPlans] = useState<StorefrontPlanItem[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(false);

  // Customer session state
  const [customerEmail, setCustomerEmail] = useState('fan@kuronami.app');
  const [customerName, setCustomerName] = useState('Kuro Nami Anime Fan');
  const [customerUserId, setCustomerUserId] = useState('user_demo_01');

  // Active Customer Membership
  const [subscription, setSubscription] = useState<CustomerSubscriptionRecord | null>(null);
  const [customerOrders, setCustomerOrders] = useState<PaymentOrderRecord[]>([]);

  // Checkout Modal / Active Order State
  const [selectedPlan, setSelectedPlan] = useState<StorefrontPlanItem | null>(null);
  const [couponCode, setCouponCode] = useState('');
  const [checkoutResult, setCheckoutResult] = useState<{
    orderRef: string;
    totalAmount: number;
    paymentCurrency: string;
    checkoutUrl: string;
    isSandboxFallback: boolean;
  } | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);

  // Payment Verification Polling / Result
  const [verifyingOrder, setVerifyingOrder] = useState(false);
  const [completedReceipt, setCompletedReceipt] = useState<{
    orderRef: string;
    receiptNumber: string;
    totalAmount: number;
    paymentCurrency: string;
    planName: string;
  } | null>(null);

  const loadPlansForCurrency = useCallback(async (currency: string) => {
    setLoadingPlans(true);
    try {
      const res = await apiRequest<{
        items: StorefrontPlanItem[];
      }>(`/api/v1/public/plans?currency=${encodeURIComponent(currency)}`);
      setPlans(res.items);
    } catch (err) {
      notify('error', 'Failed to load membership plans', err instanceof Error ? err.message : undefined);
    } finally {
      setLoadingPlans(false);
    }
  }, [notify]);

  const loadCustomerMembership = useCallback(async (userId: string) => {
    try {
      const res = await apiRequest<{
        subscription: CustomerSubscriptionRecord;
        recentOrders: PaymentOrderRecord[];
      }>(`/api/v1/public/customer/membership/${encodeURIComponent(userId)}`);
      setSubscription(res.subscription);
      setCustomerOrders(res.recentOrders);
    } catch (err) {
      console.warn('Could not fetch customer membership portal:', err);
    }
  }, []);

  useEffect(() => {
    loadPlansForCurrency(selectedCurrency);
  }, [selectedCurrency, loadPlansForCurrency]);

  useEffect(() => {
    loadCustomerMembership(customerUserId);
  }, [customerUserId, loadCustomerMembership]);

  const handleInitiateCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlan) return;
    setCheckoutBusy(true);
    try {
      const res = await apiRequest<{
        orderRef: string;
        totalAmount: number;
        paymentCurrency: string;
        checkoutUrl: string;
        isSandboxFallback: boolean;
      }>('/api/v1/public/checkout/initiate', {
        method: 'POST',
        body: {
          planSlug: selectedPlan.slug,
          customerEmail,
          customerName,
          customerUserId,
          paymentCurrency: selectedCurrency,
          couponCode,
        },
      });

      setCheckoutResult(res);
      notify('info', 'Checkout Order Initialized', `Order Ref: ${res.orderRef}`);
    } catch (err) {
      notify('error', 'Checkout initiation failed', err instanceof Error ? err.message : undefined);
    } finally {
      setCheckoutBusy(false);
    }
  };

  const handleCompleteSandboxPayment = async () => {
    if (!checkoutResult) return;
    setVerifyingOrder(true);
    try {
      // Simulate incoming Flutterwave Webhook / Server Verification
      const res = await apiRequest<{ status: string; verified: boolean; receiptNumber: string }>(
        '/api/v1/webhooks/flutterwave',
        {
          method: 'POST',
          body: {
            event: 'charge.completed',
            tx_ref: checkoutResult.orderRef,
            status: 'successful',
            amount: checkoutResult.totalAmount,
            currency: checkoutResult.paymentCurrency,
            customer: { email: customerEmail, name: customerName },
          },
        }
      );

      if (res.verified) {
        setCompletedReceipt({
          orderRef: checkoutResult.orderRef,
          receiptNumber: res.receiptNumber,
          totalAmount: checkoutResult.totalAmount,
          paymentCurrency: checkoutResult.paymentCurrency,
          planName: selectedPlan?.name || 'KURO NAMI Membership',
        });

        notify('success', 'Payment Verified & Membership Activated!', `Receipt: ${res.receiptNumber}`);
        setCheckoutResult(null);
        setSelectedPlan(null);
        loadCustomerMembership(customerUserId);
      }
    } catch (err) {
      notify('error', 'Payment verification failed', err instanceof Error ? err.message : undefined);
    } finally {
      setVerifyingOrder(false);
    }
  };

  const handleCancelSubscription = async () => {
    try {
      await apiRequest('/api/v1/public/customer/cancel-subscription', {
        method: 'POST',
        body: { customerUserId },
      });
      notify('info', 'Subscription auto-renewal cancelled.');
      loadCustomerMembership(customerUserId);
    } catch (err) {
      notify('error', 'Failed to cancel subscription', err instanceof Error ? err.message : undefined);
    }
  };

  return (
    <div className="space-y-8">
      {/* Live KURO NAMI Customer Storefront Banner */}
      <div className="rounded-lg border border-slate-800 bg-[#111827] p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-display text-lg font-bold tracking-tight text-slate-100">
              KURO NAMI Live Website Storefront & Portal
            </span>
            <span className="rounded bg-emerald-950 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-400 border border-emerald-800">
              Target: https://kuro-name-v1.vercel.app/
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400 max-w-2xl leading-relaxed">
            Test the exact customer experience for membership selection, multi-currency pricing, hosted Flutterwave checkout, server verification, and digital receipt generation.
          </p>
        </div>

        {/* Currency Switcher Bar */}
        <div className="flex items-center gap-2 rounded-md bg-[#0B0F17] p-1.5 border border-slate-800 shrink-0">
          <Globe className="h-4 w-4 text-sky-400 ml-1.5" />
          <span className="text-xs text-slate-400 font-medium whitespace-nowrap">Currency:</span>
          {['UGX', 'USD', 'EUR', 'GBP', 'KES', 'TZS'].map((curr) => (
            <button
              key={curr}
              type="button"
              onClick={() => setSelectedCurrency(curr)}
              className={`rounded px-2.5 py-1 text-xs font-mono font-bold transition-colors whitespace-nowrap ${
                selectedCurrency === curr
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              {curr}
            </button>
          ))}
        </div>
      </div>

      {/* Customer Account Bar */}
      <div className="rounded-lg border border-slate-800 bg-[#111827] p-5 flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <span className="text-slate-400">Testing Customer Account:</span>
            <span className="ml-2 font-medium text-slate-100">{customerName}</span>
          </div>
          <div>
            <span className="text-slate-400">Email:</span>
            <span className="ml-2 font-mono text-sky-400">{customerEmail}</span>
          </div>
        </div>

        {subscription && (
          <div className="flex items-center gap-3">
            <span className="text-slate-400">Active Membership:</span>
            <span className="font-semibold text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-800">
              {subscription.planName} (Expires {formatTimestamp(subscription.expiresAt)})
            </span>
            {subscription.status === 'ACTIVE' && (
              <button
                type="button"
                onClick={handleCancelSubscription}
                className="text-amber-400 hover:underline text-[11px]"
              >
                Cancel Renewal
              </button>
            )}
          </div>
        )}
      </div>

      {/* Pricing Cards Grid */}
      <div>
        <div className="text-center mb-6">
          <h2 className="font-display text-2xl font-bold text-slate-100">
            Select Your KURO NAMI Membership Plan
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            All plans feature HD/4K ad-free streaming. Prices shown in <strong className="text-sky-400 font-mono">{selectedCurrency}</strong>.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {plans.map((p) => {
            const isSelected = selectedPlan?.id === p.id;
            const isCurrentSub = subscription?.planSlug === p.slug && subscription?.status === 'ACTIVE';

            return (
              <div
                key={p.id}
                className={`rounded-lg border p-5 flex flex-col justify-between transition-all ${
                  isSelected
                    ? 'border-sky-500 bg-[#111827] shadow-lg shadow-sky-950/50'
                    : isCurrentSub
                    ? 'border-emerald-600 bg-[#111827]'
                    : 'border-slate-800 bg-[#111827] hover:border-slate-700'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-display font-semibold text-slate-100 text-sm">{p.name}</span>
                    {isCurrentSub && (
                      <span className="rounded bg-emerald-950 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-800">
                        Current
                      </span>
                    )}
                  </div>

                  <div className="mt-3 font-display text-xl font-bold text-slate-100 font-mono">
                    {p.pricing.formattedDisplay}
                    {p.durationDays > 0 && (
                      <span className="text-xs font-normal text-slate-400"> / {p.durationDays} days</span>
                    )}
                  </div>

                  <p className="mt-2 text-[11px] text-slate-400 leading-relaxed min-h-[36px]">
                    {p.description}
                  </p>

                  <div className="mt-4 pt-3 border-t border-slate-800 space-y-1.5 text-[11px] text-slate-300">
                    {p.benefits.map((b, idx) => (
                      <div key={idx} className="flex items-start gap-1.5">
                        <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                        <span>{b}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-6 pt-3 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPlan(p);
                      setCheckoutResult(null);
                    }}
                    className={`w-full rounded-md py-2 text-xs font-medium transition-colors ${
                      isSelected
                        ? 'bg-sky-600 text-white font-semibold'
                        : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                    }`}
                  >
                    {isSelected ? 'Selected' : isCurrentSub ? 'Renew Plan' : 'Select Plan'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Checkout Drawer / Form if Plan Selected */}
      {selectedPlan && (
        <div className="rounded-lg border border-sky-800/80 bg-[#111827] p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <h3 className="font-display text-base font-semibold text-slate-100 flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-sky-400" />
                <span>Hosted Checkout Initialization — {selectedPlan.name}</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Amount locked: <strong className="text-slate-200 font-mono">{selectedPlan.pricing.formattedDisplay}</strong> ({selectedPlan.pricing.paymentCurrency}).
              </p>
            </div>

            <button
              type="button"
              onClick={() => setSelectedPlan(null)}
              className="text-xs text-slate-400 hover:text-slate-200"
            >
              Cancel
            </button>
          </div>

          {!checkoutResult ? (
            <form onSubmit={handleInitiateCheckout} className="space-y-4 max-w-xl text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-slate-300">Customer Name</label>
                  <input
                    type="text"
                    required
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-700 bg-[#0B0F17] px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-300">Customer Email</label>
                  <input
                    type="email"
                    required
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-700 bg-[#0B0F17] px-3 py-2 text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-300">Promo Code (Optional)</label>
                <input
                  type="text"
                  placeholder="Enter WELCOME10 for 10% discount"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-slate-100"
                />
              </div>

              <div className="rounded border border-slate-800 bg-[#0B0F17] p-3 text-slate-400 leading-relaxed">
                Payment Gateway: <strong className="text-sky-400">Flutterwave</strong> (Supports Uganda Mobile Money MTN/Airtel, Visa/Mastercard, M-Pesa).
              </div>

              <button
                type="submit"
                disabled={checkoutBusy}
                className="w-full rounded bg-sky-600 py-2.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {checkoutBusy ? 'Initiating Checkout Session...' : 'Proceed to Secure Payment'}
              </button>
            </form>
          ) : (
            <div className="space-y-4 rounded-md border border-slate-800 bg-[#0B0F17] p-5 text-xs">
              <div className="flex items-center gap-2 text-emerald-400 font-semibold">
                <ShieldCheck className="h-5 w-5" />
                <span>Order Lock Created — Ref: {checkoutResult.orderRef}</span>
              </div>

              <div className="space-y-1 text-slate-300">
                <div>Total Locked Amount: <strong className="font-mono text-slate-100">{checkoutResult.paymentCurrency} {checkoutResult.totalAmount.toLocaleString()}</strong></div>
                <div>Hosted Checkout Link: <a href={checkoutResult.checkoutUrl} target="_blank" rel="noreferrer" className="text-sky-400 underline">{checkoutResult.checkoutUrl}</a></div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center gap-3">
                <button
                  type="button"
                  disabled={verifyingOrder}
                  onClick={handleCompleteSandboxPayment}
                  className="rounded bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {verifyingOrder ? 'Verifying & Activating...' : 'Simulate Successful Payment & Server Verification'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Completed Receipt Receipt Card */}
      {completedReceipt && (
        <div className="rounded-lg border border-emerald-800/80 bg-[#111827] p-6 space-y-4 max-w-xl mx-auto">
          <div className="flex items-center gap-2 text-emerald-400 font-semibold">
            <CheckCircle2 className="h-5 w-5" />
            <span>Official Transaction Receipt</span>
          </div>

          <div className="rounded border border-slate-800 bg-[#0B0F17] p-4 space-y-2 text-xs text-slate-300">
            <div>Receipt Number: <strong className="font-mono text-slate-100">{completedReceipt.receiptNumber}</strong></div>
            <div>Order Reference: <strong className="font-mono text-sky-400">{completedReceipt.orderRef}</strong></div>
            <div>Plan Activated: <strong className="text-slate-100">{completedReceipt.planName}</strong></div>
            <div>Paid Amount: <strong className="font-mono text-emerald-400">{completedReceipt.paymentCurrency} {completedReceipt.totalAmount.toLocaleString()}</strong></div>
          </div>

          <button
            type="button"
            onClick={() =>
              downloadTextFile(
                `kuro-nami-receipt-${completedReceipt.receiptNumber}.txt`,
                `KURO NAMI STREAMING — OFFICIAL TRANSACTION RECEIPT\nReceipt No: ${completedReceipt.receiptNumber}\nOrder Ref: ${completedReceipt.orderRef}\nPlan: ${completedReceipt.planName}\nAmount Paid: ${completedReceipt.paymentCurrency} ${completedReceipt.totalAmount.toLocaleString()}\nStatus: VERIFIED_SUCCESSFUL\nDate: ${new Date().toISOString()}\nWebsite: https://kuro-name-v1.vercel.app/\n`,
                'text/plain'
              )
            }
            className="inline-flex items-center gap-1.5 rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Download Receipt File</span>
          </button>
        </div>
      )}
    </div>
  );
}

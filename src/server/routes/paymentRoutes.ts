import crypto from 'crypto';
import { Router } from 'express';
import { db } from '../db';
import {
  CouponRecord,
  CurrencySettingRecord,
  CustomerSubscriptionRecord,
  LogSeverity,
  MembershipPlanRecord,
  PaymentGatewayRecord,
  PaymentOrderRecord,
  PaymentWebhookLogRecord,
  RevenueByCurrency,
} from '../../shared/types';
import { getClientIp, requireAuth, requirePermission } from '../security';
import { recordAuditLog, recordSystemLog } from '../monitoring';
import {
  activateCustomerSubscriptionIdempotent,
  calculatePlanPriceForCurrency,
  getCurrencySettings,
  initiateFlutterwaveCheckout,
  LIVE_WEBSITE_ORIGIN,
  probeWebsiteIntegrationStatus,
  verifyFlutterwaveTxServerToServer,
} from '../adapters/paymentAdapter';

export const paymentRouter = Router();

function mapPlanRow(r: Record<string, unknown>): MembershipPlanRecord {
  let pricesOverride = {};
  let benefits: string[] = [];
  try {
    pricesOverride = JSON.parse(String(r.prices_override_json || '{}'));
  } catch {}
  try {
    benefits = JSON.parse(String(r.benefits_json || '[]'));
  } catch {}

  return {
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    slug: String(r.slug),
    name: String(r.name),
    description: String(r.description || ''),
    durationType: (r.duration_type as MembershipPlanRecord['durationType']) || 'MONTHLY',
    durationDays: Number(r.duration_days || 30),
    basePriceUgx: Number(r.base_price_ugx || 0),
    pricesOverride,
    benefits,
    isActive: Boolean(r.is_active),
    renewalAllowed: Boolean(r.renewal_allowed),
    promotionalPriceUgx:
      r.promotional_price_ugx !== null && r.promotional_price_ugx !== undefined
        ? Number(r.promotional_price_ugx)
        : null,
    promotionalEndsAt: r.promotional_ends_at ? String(r.promotional_ends_at) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function mapOrderRow(r: Record<string, unknown>): PaymentOrderRecord {
  return {
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    orderRef: String(r.order_ref),
    customerEmail: String(r.customer_email),
    customerName: String(r.customer_name),
    customerUserId: String(r.customer_user_id),
    planId: String(r.plan_id),
    planSlug: String(r.plan_slug),
    planName: String(r.plan_name),
    durationDays: Number(r.duration_days),
    basePriceUgx: Number(r.base_price_ugx),
    chargedAmount: Number(r.charged_amount),
    paymentCurrency: String(r.payment_currency),
    exchangeRate: Number(r.exchange_rate),
    feeAmount: Number(r.fee_amount || 0),
    totalAmount: Number(r.total_amount),
    paymentStatus: (r.payment_status as PaymentOrderRecord['paymentStatus']) || 'PENDING',
    gatewaySlug: (r.gateway_slug as PaymentOrderRecord['gatewaySlug']) || 'flutterwave',
    flutterwaveTxId: r.flutterwave_tx_id ? String(r.flutterwave_tx_id) : null,
    flutterwaveRef: r.flutterwave_ref ? String(r.flutterwave_ref) : null,
    checkoutUrl: r.checkout_url ? String(r.checkout_url) : null,
    webhookReceivedAt: r.webhook_received_at ? String(r.webhook_received_at) : null,
    verifiedAt: r.verified_at ? String(r.verified_at) : null,
    verifiedByServer: Boolean(r.verified_by_server),
    failureReason: r.failure_reason ? String(r.failure_reason) : null,
    receiptNumber: r.receipt_number ? String(r.receipt_number) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

// ============================================================================
// PUBLIC CUSTOMER WEBSITE API ROUTES (NO AUTH REQUIRED)
// ============================================================================

paymentRouter.get('/public/website-info', async (_req, res) => {
  const status = await probeWebsiteIntegrationStatus('ws_benilin');
  res.json({
    websiteOrigin: LIVE_WEBSITE_ORIGIN,
    status,
  });
});

paymentRouter.get('/public/plans', (req, res) => {
  const requestedCurrency = String(req.query.currency || 'UGX').toUpperCase();
  const workspaceId = 'ws_benilin'; // Default public store catalog
  const currencySettings = getCurrencySettings(workspaceId);

  const planRows = db
    .prepare(
      `SELECT * FROM membership_plans WHERE workspace_id = ? AND is_active = 1 ORDER BY base_price_ugx ASC`
    )
    .all(workspaceId) as Array<Record<string, unknown>>;

  const plans = planRows.map(mapPlanRow);

  const plansWithPrices = plans.map((p) => {
    const calc = calculatePlanPriceForCurrency(p, requestedCurrency, currencySettings);
    return {
      ...p,
      pricing: calc,
    };
  });

  res.json({
    selectedCurrency: requestedCurrency,
    baseCurrency: currencySettings.baseCurrency,
    exchangeRateSource: currencySettings.exchangeRateSource,
    items: plansWithPrices,
  });
});

paymentRouter.get('/public/currencies', (_req, res) => {
  const settings = getCurrencySettings('ws_benilin');
  res.json(settings);
});

paymentRouter.post('/public/checkout/initiate', async (req, res) => {
  const {
    planSlug,
    customerEmail,
    customerName,
    customerUserId,
    paymentCurrency,
    couponCode,
    redirectUrl,
  } = req.body || {};

  const cleanEmail = typeof customerEmail === 'string' ? customerEmail.trim().toLowerCase() : '';
  const cleanName = typeof customerName === 'string' ? customerName.trim() : 'KURO NAMI Fan';
  const cleanUserId = typeof customerUserId === 'string' ? customerUserId.trim() : `user_${crypto.randomUUID().slice(0, 8)}`;
  const targetCurrency = typeof paymentCurrency === 'string' ? paymentCurrency.trim().toUpperCase() : 'UGX';
  const workspaceId = 'ws_benilin';

  if (!cleanEmail || !cleanEmail.includes('@')) {
    res.status(400).json({ error: 'Valid customer email address is required.' });
    return;
  }

  const planRow = db
    .prepare(`SELECT * FROM membership_plans WHERE workspace_id = ? AND slug = ? AND is_active = 1`)
    .get(workspaceId, planSlug) as Record<string, unknown> | undefined;

  if (!planRow) {
    res.status(404).json({ error: 'Selected membership plan was not found or is inactive.' });
    return;
  }

  const plan = mapPlanRow(planRow);
  const currencySettings = getCurrencySettings(workspaceId);
  const calc = calculatePlanPriceForCurrency(plan, targetCurrency, currencySettings);

  let discountPercent = 0;
  if (couponCode && typeof couponCode === 'string') {
    const couponRow = db
      .prepare(`SELECT * FROM coupons_and_gifts WHERE workspace_id = ? AND UPPER(code) = UPPER(?) AND is_active = 1`)
      .get(workspaceId, couponCode.trim()) as Record<string, unknown> | undefined;

    if (couponRow && Number(couponRow.current_uses) < Number(couponRow.max_uses)) {
      discountPercent = Number(couponRow.discount_percent || 0);
    }
  }

  const finalCharged = discountPercent > 0 ? Math.round(calc.chargedAmount * (1 - discountPercent / 100) * 100) / 100 : calc.chargedAmount;
  const finalTotal = Math.round((finalCharged + calc.feeAmount) * 100) / 100;

  const orderRef = `tx_kn_${crypto.randomBytes(8).toString('hex')}`;
  const now = new Date().toISOString();
  const orderId = `ord_${crypto.randomUUID().slice(0, 12)}`;

  const returnRedirectUrl =
    typeof redirectUrl === 'string' && redirectUrl.startsWith('http')
      ? redirectUrl
      : `${LIVE_WEBSITE_ORIGIN}payment-result?orderRef=${orderRef}`;

  const { checkoutUrl, isSandboxFallback } = await initiateFlutterwaveCheckout({
    orderRef,
    amount: finalTotal,
    currency: targetCurrency,
    customerEmail: cleanEmail,
    customerName: cleanName,
    planName: plan.name,
    redirectUrl: returnRedirectUrl,
  });

  db.prepare(
    `
    INSERT INTO payment_orders (
      id, workspace_id, order_ref, customer_email, customer_name, customer_user_id,
      plan_id, plan_slug, plan_name, duration_days, base_price_ugx, charged_amount,
      payment_currency, exchange_rate, fee_amount, total_amount, payment_status,
      gateway_slug, checkout_url, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 'flutterwave', ?, ?, ?)
  `
  ).run(
    orderId,
    workspaceId,
    orderRef,
    cleanEmail,
    cleanName,
    cleanUserId,
    plan.id,
    plan.slug,
    plan.name,
    plan.durationDays,
    plan.basePriceUgx,
    finalCharged,
    targetCurrency,
    calc.exchangeRate,
    calc.feeAmount,
    finalTotal,
    checkoutUrl,
    now,
    now
  );

  res.status(201).json({
    orderId,
    orderRef,
    planName: plan.name,
    chargedAmount: finalCharged,
    paymentCurrency: targetCurrency,
    feeAmount: calc.feeAmount,
    totalAmount: finalTotal,
    checkoutUrl,
    isSandboxFallback,
  });
});

paymentRouter.get('/public/checkout/status/:orderRef', (req, res) => {
  const orderRef = req.params.orderRef;
  const row = db
    .prepare(`SELECT * FROM payment_orders WHERE order_ref = ?`)
    .get(orderRef) as Record<string, unknown> | undefined;

  if (!row) {
    res.status(404).json({ error: 'Payment order reference not found.' });
    return;
  }

  const order = mapOrderRow(row);

  const subRow = db
    .prepare(`SELECT * FROM customer_subscriptions WHERE workspace_id = ? AND customer_user_id = ?`)
    .get(order.workspaceId, order.customerUserId) as Record<string, unknown> | undefined;

  res.json({
    order,
    subscription: subRow
      ? {
          status: String(subRow.status),
          expiresAt: String(subRow.expires_at),
          planName: String(subRow.plan_name),
        }
      : null,
  });
});

paymentRouter.get('/public/customer/membership/:userId', (req, res) => {
  const userId = req.params.userId;
  const workspaceId = 'ws_benilin';

  const subRow = db
    .prepare(`SELECT * FROM customer_subscriptions WHERE workspace_id = ? AND customer_user_id = ?`)
    .get(workspaceId, userId) as Record<string, unknown> | undefined;

  const orders = db
    .prepare(
      `SELECT id, order_ref, plan_name, total_amount, payment_currency, payment_status, receipt_number, created_at FROM payment_orders WHERE workspace_id = ? AND customer_user_id = ? ORDER BY created_at DESC LIMIT 20`
    )
    .all(workspaceId, userId);

  res.json({
    subscription: subRow
      ? {
          id: String(subRow.id),
          planName: String(subRow.plan_name),
          planSlug: String(subRow.plan_slug),
          status: String(subRow.status),
          startsAt: String(subRow.starts_at),
          expiresAt: String(subRow.expires_at),
          autoRenew: Boolean(subRow.auto_renew),
        }
      : {
          planName: 'Free Membership',
          planSlug: 'free',
          status: 'ACTIVE',
          startsAt: new Date().toISOString(),
          expiresAt: '2099-12-31T23:59:59.000Z',
          autoRenew: false,
        },
    recentOrders: orders,
  });
});

paymentRouter.post('/public/customer/cancel-subscription', (req, res) => {
  const { customerUserId } = req.body || {};
  const workspaceId = 'ws_benilin';

  if (!customerUserId || typeof customerUserId !== 'string') {
    res.status(400).json({ error: 'Customer user ID is required.' });
    return;
  }

  db.prepare(
    `UPDATE customer_subscriptions SET auto_renew = 0, status = 'CANCELLED', updated_at = ? WHERE workspace_id = ? AND customer_user_id = ?`
  ).run(new Date().toISOString(), workspaceId, customerUserId);

  res.json({ ok: true, message: 'Auto-renewal cancelled successfully.' });
});

// ============================================================================
// PUBLIC WEBHOOK INGESTION (SIGNED FLUTTERWAVE PAYLOADS)
// ============================================================================

paymentRouter.post('/webhooks/flutterwave', async (req, res) => {
  const signature = String(req.headers['verif-hash'] || '');
  const expectedSecret = process.env.FLUTTERWAVE_WEBHOOK_SECRET?.trim() || '';
  const body = req.body || {};
  const workspaceId = 'ws_benilin';

  const txRef = String(body.data?.tx_ref || body.tx_ref || body.orderRef || '');
  const eventType = String(body.event || body['event.type'] || 'PAYMENT_COMPLETED');
  const flwTxId = String(body.data?.id || body.id || '');

  const logId = `wh_${crypto.randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();

  let isSignatureValid = false;
  if (expectedSecret && signature) {
    isSignatureValid = signature === expectedSecret;
  } else if (!expectedSecret) {
    isSignatureValid = true; // Sandbox mode fallback when secret env var is not set
  }

  try {
    db.prepare(
      `
      INSERT INTO payment_webhooks_log (
        id, workspace_id, gateway_slug, event_type, tx_ref, payload_json,
        signature_header, is_signature_valid, is_processed, created_at
      ) VALUES (?, ?, 'flutterwave', ?, ?, ?, ?, ?, 0, ?)
    `
    ).run(
      logId,
      workspaceId,
      eventType,
      txRef,
      JSON.stringify(body),
      signature || null,
      isSignatureValid ? 1 : 0,
      now
    );
  } catch (err) {
    console.warn('Webhook logging error:', err);
  }

  if (expectedSecret && !isSignatureValid) {
    recordSystemLog({
      workspaceId,
      severity: LogSeverity.WARN,
      component: 'FlutterwaveWebhook',
      message: `Rejected webhook payload with invalid signature header for tx_ref ${txRef}`,
    });
    res.status(401).json({ error: 'Invalid webhook signature.' });
    return;
  }

  if (!txRef) {
    res.status(400).json({ error: 'Missing tx_ref in webhook payload.' });
    return;
  }

  const orderRow = db
    .prepare(`SELECT * FROM payment_orders WHERE order_ref = ?`)
    .get(txRef) as Record<string, unknown> | undefined;

  if (!orderRow) {
    res.status(404).json({ error: 'Order reference not found in payment ledger.' });
    return;
  }

  const order = mapOrderRow(orderRow);

  // Idempotency: If already successful, acknowledge webhook without duplicate processing
  if (order.paymentStatus === 'SUCCESSFUL') {
    res.json({ status: 'success', message: 'Order already verified & active.' });
    return;
  }

  // Server-to-server independent verification
  const verification = await verifyFlutterwaveTxServerToServer({
    transactionId: flwTxId || undefined,
    txRef,
  });

  if (verification.verified && verification.status === 'successful') {
    const receiptNum = `KN-REC-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    db.transaction(() => {
      db.prepare(
        `
        UPDATE payment_orders
        SET payment_status = 'SUCCESSFUL',
            flutterwave_tx_id = ?,
            flutterwave_ref = ?,
            webhook_received_at = ?,
            verified_at = ?,
            verified_by_server = 1,
            receipt_number = ?,
            updated_at = ?
        WHERE id = ?
      `
      ).run(
        flwTxId || null,
        verification.flwRef || null,
        now,
        now,
        receiptNum,
        now,
        order.id
      );

      // Idempotent membership activation
      activateCustomerSubscriptionIdempotent({
        workspaceId: order.workspaceId,
        customerUserId: order.customerUserId,
        customerEmail: order.customerEmail,
        planId: order.planId,
        planSlug: order.planSlug,
        planName: order.planName,
        durationDays: order.durationDays,
        orderId: order.id,
      });

      db.prepare(`UPDATE payment_webhooks_log SET is_processed = 1 WHERE id = ?`).run(logId);
    })();

    recordAuditLog({
      workspaceId: order.workspaceId,
      adminId: 'system_webhook',
      adminUsername: 'Flutterwave Webhook',
      action: 'PAYMENT_VERIFIED_AND_ACTIVATED',
      resourceType: 'PAYMENT_ORDER',
      resourceId: order.id,
      newValue: { status: 'SUCCESSFUL', receiptNumber: receiptNum, amount: order.totalAmount, currency: order.paymentCurrency },
      status: 'SUCCESS',
      ipAddress: getClientIp(req),
    });

    res.json({ status: 'success', verified: true, receiptNumber: receiptNum });
    return;
  }

  db.prepare(
    `UPDATE payment_orders SET payment_status = 'FAILED', failure_reason = ?, updated_at = ? WHERE id = ?`
  ).run(verification.error || 'Gateway verification failed', now, order.id);

  res.status(400).json({ error: 'Payment verification failed.' });
});

// ============================================================================
// ADMIN PAYMENT & INTEGRATION CONTROL ROUTES (PROTECTED BY AUTH)
// ============================================================================

paymentRouter.get('/integration/status', requireAuth, async (req, res) => {
  const workspaceId = req.admin!.workspaceId;
  const status = await probeWebsiteIntegrationStatus(workspaceId);
  res.json(status);
});

paymentRouter.post('/integration/test-all', requireAuth, async (req, res) => {
  const workspaceId = req.admin!.workspaceId;
  const status = await probeWebsiteIntegrationStatus(workspaceId);

  recordAuditLog({
    workspaceId,
    adminId: req.admin!.id,
    adminUsername: req.admin!.username,
    action: 'WEBSITE_INTEGRATION_TESTED',
    resourceType: 'INTEGRATION_STATUS',
    status: status.websiteStatus === 'CONNECTED' ? 'SUCCESS' : 'FAILURE',
    ipAddress: getClientIp(req),
  });

  res.json(status);
});

paymentRouter.get('/payments/overview', requireAuth, requirePermission('treasury:read'), (req, res) => {
  const workspaceId = req.admin!.workspaceId;

  // Revenue grouped separately by currency (DO NOT sum across different currencies!)
  const revenueRows = db
    .prepare(
      `
      SELECT
        payment_currency AS currency,
        COUNT(*) AS successfulCount,
        SUM(charged_amount) AS totalCharged,
        SUM(fee_amount) AS totalFees,
        SUM(total_amount) AS netRevenue
      FROM payment_orders
      WHERE workspace_id = ? AND payment_status = 'SUCCESSFUL'
      GROUP BY payment_currency
    `
    )
    .all(workspaceId) as Array<{
    currency: string;
    successfulCount: number;
    totalCharged: number;
    totalFees: number;
    netRevenue: number;
  }>;

  const totalOrdersCount = (
    db
      .prepare(`SELECT COUNT(*) AS cnt FROM payment_orders WHERE workspace_id = ?`)
      .get(workspaceId) as { cnt: number }
  ).cnt;

  const pendingCount = (
    db
      .prepare(`SELECT COUNT(*) AS cnt FROM payment_orders WHERE workspace_id = ? AND payment_status = 'PENDING'`)
      .get(workspaceId) as { cnt: number }
  ).cnt;

  const activeSubscriptionsCount = (
    db
      .prepare(`SELECT COUNT(*) AS cnt FROM customer_subscriptions WHERE workspace_id = ? AND status = 'ACTIVE'`)
      .get(workspaceId) as { cnt: number }
  ).cnt;

  const expiringCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM customer_subscriptions WHERE workspace_id = ? AND status = 'ACTIVE' AND expires_at <= ?`
      )
      .get(workspaceId, new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()) as { cnt: number }
  ).cnt;

  res.json({
    revenueByCurrency: revenueRows,
    metrics: {
      totalOrdersCount,
      pendingCount,
      activeSubscriptionsCount,
      expiringCount,
    },
  });
});

paymentRouter.get('/payments/transactions', requireAuth, requirePermission('treasury:read'), (req, res) => {
  const workspaceId = req.admin!.workspaceId;
  const search = String(req.query.search || '').trim().toLowerCase();
  const statusFilter = String(req.query.status || '').trim();
  const currencyFilter = String(req.query.currency || '').trim().toUpperCase();

  const rows = db
    .prepare(`SELECT * FROM payment_orders WHERE workspace_id = ? ORDER BY created_at DESC`)
    .all(workspaceId) as Array<Record<string, unknown>>;

  let items = rows.map(mapOrderRow);

  if (search) {
    items = items.filter((o) =>
      [o.orderRef, o.customerEmail, o.customerName, o.planName, o.receiptNumber || '']
        .join(' ')
        .toLowerCase()
        .includes(search)
    );
  }
  if (statusFilter && statusFilter !== 'ALL') {
    items = items.filter((o) => o.paymentStatus === statusFilter);
  }
  if (currencyFilter && currencyFilter !== 'ALL') {
    items = items.filter((o) => o.paymentCurrency === currencyFilter);
  }

  res.json({ items });
});

paymentRouter.post('/payments/transactions/:id/verify', requireAuth, requirePermission('treasury:write'), async (req, res) => {
  const admin = req.admin!;
  const orderId = req.params.id;

  const row = db
    .prepare(`SELECT * FROM payment_orders WHERE id = ? AND workspace_id = ?`)
    .get(orderId, admin.workspaceId) as Record<string, unknown> | undefined;

  if (!row) {
    res.status(404).json({ error: 'Payment transaction order not found.' });
    return;
  }

  const order = mapOrderRow(row);
  const now = new Date().toISOString();

  const verification = await verifyFlutterwaveTxServerToServer({
    transactionId: order.flutterwaveTxId || undefined,
    txRef: order.orderRef,
  });

  if (verification.verified && verification.status === 'successful') {
    const receiptNum = order.receiptNumber || `KN-REC-${now.slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    db.transaction(() => {
      db.prepare(
        `
        UPDATE payment_orders
        SET payment_status = 'SUCCESSFUL',
            verified_at = ?,
            verified_by_server = 1,
            receipt_number = ?,
            updated_at = ?
        WHERE id = ? AND workspace_id = ?
      `
      ).run(now, receiptNum, now, order.id, admin.workspaceId);

      activateCustomerSubscriptionIdempotent({
        workspaceId: order.workspaceId,
        customerUserId: order.customerUserId,
        customerEmail: order.customerEmail,
        planId: order.planId,
        planSlug: order.planSlug,
        planName: order.planName,
        durationDays: order.durationDays,
        orderId: order.id,
      });
    })();

    recordAuditLog({
      workspaceId: admin.workspaceId,
      adminId: admin.id,
      adminUsername: admin.username,
      action: 'PAYMENT_MANUALLY_RECONCILED',
      resourceType: 'PAYMENT_ORDER',
      resourceId: order.id,
      newValue: { status: 'SUCCESSFUL', receiptNumber: receiptNum },
      status: 'SUCCESS',
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true, message: 'Transaction verified and customer membership activated.', receiptNumber: receiptNum });
    return;
  }

  res.status(400).json({ error: 'Gateway verification returned unsuccessful status.' });
});

paymentRouter.post('/payments/transactions/:id/refund', requireAuth, requirePermission('treasury:write'), (req, res) => {
  const admin = req.admin!;
  const orderId = req.params.id;
  const { reason } = req.body || {};

  const row = db
    .prepare(`SELECT * FROM payment_orders WHERE id = ? AND workspace_id = ?`)
    .get(orderId, admin.workspaceId) as Record<string, unknown> | undefined;

  if (!row) {
    res.status(404).json({ error: 'Payment transaction order not found.' });
    return;
  }

  const order = mapOrderRow(row);
  if (order.paymentStatus !== 'SUCCESSFUL') {
    res.status(400).json({ error: 'Only successful transactions can be refunded.' });
    return;
  }

  const now = new Date().toISOString();

  db.transaction(() => {
    db.prepare(
      `UPDATE payment_orders SET payment_status = 'REFUNDED', failure_reason = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`
    ).run(reason || 'Admin initiated refund', now, order.id, admin.workspaceId);

    db.prepare(
      `UPDATE customer_subscriptions SET status = 'EXPIRED', updated_at = ? WHERE workspace_id = ? AND customer_user_id = ?`
    ).run(now, admin.workspaceId, order.customerUserId);
  })();

  recordAuditLog({
    workspaceId: admin.workspaceId,
    adminId: admin.id,
    adminUsername: admin.username,
    action: 'PAYMENT_REFUND_ISSUED',
    resourceType: 'PAYMENT_ORDER',
    resourceId: order.id,
    previousValue: { status: 'SUCCESSFUL', amount: order.totalAmount },
    newValue: { status: 'REFUNDED', reason: reason || 'Admin initiated refund' },
    status: 'SUCCESS',
    ipAddress: getClientIp(req),
  });

  res.json({ ok: true, message: 'Transaction marked refunded and subscription revoked.' });
});

paymentRouter.get('/payments/currencies', requireAuth, requirePermission('treasury:read'), (req, res) => {
  const settings = getCurrencySettings(req.admin!.workspaceId);
  res.json(settings);
});

paymentRouter.put('/payments/currencies', requireAuth, requirePermission('treasury:write'), (req, res) => {
  const admin = req.admin!;
  const { supportedCurrencies, exchangeRates, feeMode, roundingRules } = req.body || {};

  const now = new Date().toISOString();
  const cleanSupported = Array.isArray(supportedCurrencies) ? supportedCurrencies : ['UGX', 'USD', 'EUR', 'GBP', 'KES', 'TZS'];
  const cleanRates = typeof exchangeRates === 'object' && exchangeRates !== null ? exchangeRates : { UGX: 1, USD: 0.00027, EUR: 0.00025, GBP: 0.00021, KES: 0.035, TZS: 0.71 };
  const cleanRounding = typeof roundingRules === 'object' && roundingRules !== null ? roundingRules : { UGX: '100', USD: '0.01', EUR: '0.01', GBP: '0.01', KES: '10', TZS: '10' };
  const cleanFeeMode = feeMode === 'EXCLUSIVE' ? 'EXCLUSIVE' : 'INCLUSIVE';

  db.prepare(
    `
    INSERT INTO currency_settings (
      workspace_id, base_currency, supported_currencies_json, exchange_rates_json,
      exchange_rate_source, exchange_rate_updated_at, rounding_rules_json, fee_mode, updated_at
    ) VALUES (?, 'UGX', ?, ?, 'Central Bank / Live Financial Feed', ?, ?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET
      supported_currencies_json = excluded.supported_currencies_json,
      exchange_rates_json = excluded.exchange_rates_json,
      exchange_rate_updated_at = excluded.exchange_rate_updated_at,
      rounding_rules_json = excluded.rounding_rules_json,
      fee_mode = excluded.fee_mode,
      updated_at = excluded.updated_at
  `
  ).run(
    admin.workspaceId,
    JSON.stringify(cleanSupported),
    JSON.stringify(cleanRates),
    now,
    JSON.stringify(cleanRounding),
    cleanFeeMode,
    now
  );

  recordAuditLog({
    workspaceId: admin.workspaceId,
    adminId: admin.id,
    adminUsername: admin.username,
    action: 'CURRENCY_SETTINGS_UPDATED',
    resourceType: 'CURRENCY_SETTINGS',
    newValue: { supportedCurrencies: cleanSupported, feeMode: cleanFeeMode },
    status: 'SUCCESS',
    ipAddress: getClientIp(req),
  });

  res.json(getCurrencySettings(admin.workspaceId));
});

paymentRouter.get('/payments/plans', requireAuth, requirePermission('treasury:read'), (req, res) => {
  const workspaceId = req.admin!.workspaceId;
  const rows = db
    .prepare(`SELECT * FROM membership_plans WHERE workspace_id = ? ORDER BY base_price_ugx ASC`)
    .all(workspaceId) as Array<Record<string, unknown>>;

  res.json({ items: rows.map(mapPlanRow) });
});

paymentRouter.post('/payments/plans', requireAuth, requirePermission('treasury:write'), (req, res) => {
  const admin = req.admin!;
  const { slug, name, description, durationType, durationDays, basePriceUgx, benefits } = req.body || {};

  const cleanSlug = typeof slug === 'string' ? slug.trim().toLowerCase() : '';
  const cleanName = typeof name === 'string' ? name.trim() : '';

  if (!cleanSlug || !cleanName) {
    res.status(400).json({ error: 'Plan slug and name are required.' });
    return;
  }

  const id = `plan_${admin.workspaceId.slice(3)}_${cleanSlug}`;
  const now = new Date().toISOString();

  try {
    db.prepare(
      `
      INSERT INTO membership_plans (
        id, workspace_id, slug, name, description, duration_type, duration_days,
        base_price_ugx, prices_override_json, benefits_json, is_active, renewal_allowed, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, 1, 1, ?, ?)
    `
    ).run(
      id,
      admin.workspaceId,
      cleanSlug,
      cleanName,
      description || '',
      durationType || 'MONTHLY',
      Number(durationDays || 30),
      Number(basePriceUgx || 0),
      JSON.stringify(Array.isArray(benefits) ? benefits : []),
      now,
      now
    );
  } catch {
    res.status(409).json({ error: 'Plan slug already exists.' });
    return;
  }

  res.status(201).json({ id, slug: cleanSlug });
});

paymentRouter.patch('/payments/plans/:id', requireAuth, requirePermission('treasury:write'), (req, res) => {
  const admin = req.admin!;
  const planId = req.params.id;
  const { isActive, basePriceUgx, name, description, benefits } = req.body || {};

  const existing = db
    .prepare(`SELECT * FROM membership_plans WHERE id = ? AND workspace_id = ?`)
    .get(planId, admin.workspaceId) as Record<string, unknown> | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Plan not found.' });
    return;
  }

  const now = new Date().toISOString();
  const nextActive = typeof isActive === 'boolean' ? (isActive ? 1 : 0) : Number(existing.is_active);
  const nextPrice = basePriceUgx !== undefined ? Number(basePriceUgx) : Number(existing.base_price_ugx);
  const nextName = typeof name === 'string' ? name : String(existing.name);
  const nextDesc = typeof description === 'string' ? description : String(existing.description);
  const nextBenefits = Array.isArray(benefits) ? JSON.stringify(benefits) : String(existing.benefits_json);

  db.prepare(
    `
    UPDATE membership_plans
    SET is_active = ?, base_price_ugx = ?, name = ?, description = ?, benefits_json = ?, updated_at = ?
    WHERE id = ? AND workspace_id = ?
  `
  ).run(nextActive, nextPrice, nextName, nextDesc, nextBenefits, now, planId, admin.workspaceId);

  res.json({ ok: true });
});

paymentRouter.get('/payments/gateways', requireAuth, requirePermission('treasury:read'), (req, res) => {
  const workspaceId = req.admin!.workspaceId;
  const rows = db
    .prepare(`SELECT * FROM payment_gateways WHERE workspace_id = ? ORDER BY is_enabled DESC`)
    .all(workspaceId) as Array<Record<string, unknown>>;

  const items = rows.map((r) => {
    let supportedCurrencies: string[] = [];
    let supportedPaymentMethods = {};
    try {
      supportedCurrencies = JSON.parse(String(r.supported_currencies_json));
    } catch {}
    try {
      supportedPaymentMethods = JSON.parse(String(r.supported_payment_methods_json));
    } catch {}

    const secretVar = String(r.secret_key_var || '');
    return {
      id: String(r.id),
      workspaceId: String(r.workspace_id),
      gatewaySlug: r.gateway_slug as PaymentGatewayRecord['gatewaySlug'],
      name: String(r.name),
      isEnabled: Boolean(r.is_enabled),
      environment: (r.environment as PaymentGatewayRecord['environment']) || 'sandbox',
      publicKeyVar: String(r.public_key_var || ''),
      secretKeyVar: secretVar,
      webhookSecretVar: String(r.webhook_secret_var || ''),
      hasSecretKey: Boolean(process.env[secretVar]?.trim()),
      supportedCurrencies,
      supportedPaymentMethods,
      lastHealthCheckAt: r.last_health_check_at ? String(r.last_health_check_at) : null,
      healthStatus: (r.health_status as PaymentGatewayRecord['healthStatus']) || 'SANDBOX_READY',
      diagnosticReport: r.diagnostic_report ? String(r.diagnostic_report) : null,
      updatedAt: String(r.updated_at),
    };
  });

  res.json({ items });
});

paymentRouter.get('/payments/subscriptions', requireAuth, requirePermission('treasury:read'), (req, res) => {
  const workspaceId = req.admin!.workspaceId;
  const rows = db
    .prepare(`SELECT * FROM customer_subscriptions WHERE workspace_id = ? ORDER BY created_at DESC`)
    .all(workspaceId) as Array<Record<string, unknown>>;

  const items = rows.map((r) => ({
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    customerUserId: String(r.customer_user_id),
    customerEmail: String(r.customer_email),
    planId: String(r.plan_id),
    planSlug: String(r.plan_slug),
    planName: String(r.plan_name),
    status: (r.status as CustomerSubscriptionRecord['status']) || 'ACTIVE',
    startsAt: String(r.starts_at),
    expiresAt: String(r.expires_at),
    autoRenew: Boolean(r.auto_renew),
    lastOrderId: r.last_order_id ? String(r.last_order_id) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));

  res.json({ items });
});

paymentRouter.get('/payments/coupons', requireAuth, requirePermission('treasury:read'), (req, res) => {
  const workspaceId = req.admin!.workspaceId;
  const rows = db
    .prepare(`SELECT * FROM coupons_and_gifts WHERE workspace_id = ? ORDER BY created_at DESC`)
    .all(workspaceId) as Array<Record<string, unknown>>;

  const items = rows.map((r) => ({
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    code: String(r.code),
    type: (r.type as CouponRecord['type']) || 'DISCOUNT_PERCENT',
    discountPercent: r.discount_percent !== null ? Number(r.discount_percent) : null,
    discountFixedUgx: r.discount_fixed_ugx !== null ? Number(r.discount_fixed_ugx) : null,
    planId: r.plan_id ? String(r.plan_id) : null,
    maxUses: Number(r.max_uses || 100),
    currentUses: Number(r.current_uses || 0),
    expiresAt: r.expires_at ? String(r.expires_at) : null,
    isActive: Boolean(r.is_active),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));

  res.json({ items });
});

paymentRouter.post('/payments/coupons', requireAuth, requirePermission('treasury:write'), (req, res) => {
  const admin = req.admin!;
  const { code, discountPercent, maxUses } = req.body || {};

  const cleanCode = typeof code === 'string' ? code.trim().toUpperCase() : '';
  if (!cleanCode) {
    res.status(400).json({ error: 'Coupon code is required.' });
    return;
  }

  const id = `cpn_${admin.workspaceId.slice(3)}_${cleanCode.toLowerCase()}`;
  const now = new Date().toISOString();

  try {
    db.prepare(
      `
      INSERT INTO coupons_and_gifts (
        id, workspace_id, code, type, discount_percent, max_uses, current_uses, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, 'DISCOUNT_PERCENT', ?, ?, 0, 1, ?, ?)
    `
    ).run(id, admin.workspaceId, cleanCode, Number(discountPercent || 10), Number(maxUses || 100), now, now);
  } catch {
    res.status(409).json({ error: 'Coupon code already exists.' });
    return;
  }

  res.status(201).json({ id, code: cleanCode });
});

paymentRouter.get('/payments/webhooks-log', requireAuth, requirePermission('treasury:read'), (req, res) => {
  const workspaceId = req.admin!.workspaceId;
  const rows = db
    .prepare(`SELECT * FROM payment_webhooks_log WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 50`)
    .all(workspaceId) as Array<Record<string, unknown>>;

  const items: PaymentWebhookLogRecord[] = rows.map((r) => ({
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    gatewaySlug: String(r.gateway_slug),
    eventType: String(r.event_type),
    txRef: String(r.tx_ref),
    payloadJson: String(r.payload_json),
    signatureHeader: r.signature_header ? String(r.signature_header) : null,
    isSignatureValid: Boolean(r.is_signature_valid),
    isProcessed: Boolean(r.is_processed),
    errorMessage: r.error_message ? String(r.error_message) : null,
    createdAt: String(r.created_at),
  }));

  res.json({ items });
});

paymentRouter.get('/payments/audit', requireAuth, requirePermission('treasury:read'), (req, res) => {
  const workspaceId = req.admin!.workspaceId;
  const rows = db
    .prepare(
      `SELECT * FROM audit_logs WHERE workspace_id = ? AND action LIKE '%PAYMENT%' OR action LIKE '%CURRENCY%' ORDER BY created_at DESC LIMIT 50`
    )
    .all(workspaceId);

  res.json({ items: rows });
});

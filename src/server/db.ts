import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { AdminRole, ProviderHealthStatus } from '../shared/types';

const dbFilePath = process.env.ADMIN_SQLITE_PATH
  ? path.resolve(process.cwd(), process.env.ADMIN_SQLITE_PATH)
  : path.resolve(process.cwd(), 'data', 'kuro-nami-admin.sqlite');

const dbDir = path.dirname(dbFilePath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const uploadsDir = process.env.ADMIN_UPLOADS_DIR
  ? path.resolve(process.cwd(), process.env.ADMIN_UPLOADS_DIR)
  : path.resolve(process.cwd(), 'data', 'uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

export const db = new Database(dbFilePath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

export function initializeDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_accounts (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      is_owner_slot INTEGER NOT NULL DEFAULT 0,
      is_provisioned INTEGER NOT NULL DEFAULT 0,
      password_hash TEXT,
      password_salt TEXT,
      recovery_key_hash TEXT,
      recovery_key_salt TEXT,
      is_locked INTEGER NOT NULL DEFAULT 0,
      failed_login_attempts INTEGER NOT NULL DEFAULT 0,
      last_failed_login_at TEXT,
      last_login_at TEXT,
      provisioned_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      token_hash TEXT NOT NULL UNIQUE,
      csrf_token TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      user_agent TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS login_history (
      id TEXT PRIMARY KEY,
      admin_id TEXT,
      workspace_id TEXT,
      username_attempted TEXT NOT NULL,
      event_type TEXT NOT NULL,
      success INTEGER NOT NULL,
      ip_address TEXT NOT NULL,
      user_agent TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS integration_configs (
      workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
      base_url TEXT NOT NULL DEFAULT '',
      health_path TEXT NOT NULL DEFAULT '/api/v1/health',
      api_version TEXT NOT NULL DEFAULT 'v1',
      env_api_key_var TEXT NOT NULL DEFAULT 'KURO_NAMI_UPSTREAM_API_KEY',
      sync_mode TEXT NOT NULL DEFAULT 'DISCONNECTED',
      connection_status TEXT NOT NULL DEFAULT 'NOT_CONNECTED',
      last_tested_at TEXT,
      last_latency_ms INTEGER,
      last_status_message TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS storage_servers (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      name TEXT NOT NULL,
      adapter_type TEXT NOT NULL,
      endpoint_url TEXT NOT NULL DEFAULT '',
      bucket_or_volume TEXT NOT NULL,
      region TEXT NOT NULL DEFAULT 'auto',
      env_credential_prefix TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      is_verified INTEGER NOT NULL DEFAULT 0,
      health_status TEXT NOT NULL DEFAULT 'UNTESTED',
      configured_capacity_bytes INTEGER NOT NULL DEFAULT 0,
      used_capacity_bytes INTEGER NOT NULL DEFAULT 0,
      backup_destination_id TEXT,
      failed_uploads_count INTEGER NOT NULL DEFAULT 0,
      last_tested_at TEXT,
      last_latency_ms INTEGER,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      original_filename TEXT NOT NULL,
      stored_filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      checksum_sha256 TEXT NOT NULL,
      category TEXT NOT NULL,
      storage_server_id TEXT REFERENCES storage_servers(id) ON DELETE SET NULL,
      upload_status TEXT NOT NULL DEFAULT 'STORED',
      linked_anime_id TEXT,
      linked_episode_id TEXT,
      uploaded_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS anime_catalog (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      synopsis TEXT NOT NULL DEFAULT '',
      alternative_titles_json TEXT NOT NULL DEFAULT '{}',
      genres_json TEXT NOT NULL DEFAULT '[]',
      release_year INTEGER,
      status TEXT NOT NULL DEFAULT 'ONGOING',
      rating_value REAL,
      rating_source TEXT NOT NULL DEFAULT '',
      studios_json TEXT NOT NULL DEFAULT '[]',
      seasons_json TEXT NOT NULL DEFAULT '[]',
      external_ids_json TEXT NOT NULL DEFAULT '{}',
      poster_asset_id TEXT REFERENCES assets(id) ON DELETE RESTRICT,
      background_asset_id TEXT REFERENCES assets(id) ON DELETE RESTRICT,
      storage_server_id TEXT REFERENCES storage_servers(id) ON DELETE SET NULL,
      sync_state TEXT NOT NULL DEFAULT 'LOCAL_STAGED',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS episodes (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      anime_id TEXT NOT NULL REFERENCES anime_catalog(id) ON DELETE CASCADE,
      upstream_episode_id TEXT NOT NULL DEFAULT '',
      season_number INTEGER NOT NULL DEFAULT 1,
      episode_number INTEGER NOT NULL,
      sort_order INTEGER NOT NULL,
      title TEXT NOT NULL,
      release_date TEXT,
      subtitle_languages_json TEXT NOT NULL DEFAULT '["en"]',
      audio_status TEXT NOT NULL DEFAULT 'SUB',
      sources_json TEXT NOT NULL DEFAULT '[]',
      storage_server_id TEXT REFERENCES storage_servers(id) ON DELETE SET NULL,
      thumbnail_asset_id TEXT REFERENCES assets(id) ON DELETE RESTRICT,
      subtitle_asset_id TEXT REFERENCES assets(id) ON DELETE RESTRICT,
      video_asset_id TEXT REFERENCES assets(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS streaming_providers (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      website_url TEXT NOT NULL DEFAULT '',
      integration_type TEXT NOT NULL DEFAULT 'Standard API',
      is_built_in INTEGER NOT NULL DEFAULT 0,
      base_url TEXT NOT NULL DEFAULT '',
      health_endpoint TEXT NOT NULL DEFAULT '/',
      env_secret_var TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
      timeout_ms INTEGER NOT NULL DEFAULT 8000,
      retry_count INTEGER NOT NULL DEFAULT 2,
      fallback_priority INTEGER NOT NULL DEFAULT 1,
      last_response_time_ms INTEGER,
      total_requests INTEGER NOT NULL DEFAULT 0,
      failed_requests INTEGER NOT NULL DEFAULT 0,
      timeout_errors INTEGER NOT NULL DEFAULT 0,
      resolution_attempts INTEGER NOT NULL DEFAULT 0,
      resolution_successes INTEGER NOT NULL DEFAULT 0,
      availability_percent REAL,
      last_tested_at TEXT,
      last_error_message TEXT,
      capabilities_json TEXT NOT NULL DEFAULT '{}',
      diagnostic_details_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      UNIQUE(workspace_id, slug)
    );

    CREATE TABLE IF NOT EXISTS provider_logs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      provider_id TEXT NOT NULL REFERENCES streaming_providers(id) ON DELETE CASCADE,
      provider_name TEXT NOT NULL,
      event_type TEXT NOT NULL,
      status_code INTEGER,
      latency_ms INTEGER,
      success INTEGER NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS managed_users (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      upstream_user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      email_masked TEXT NOT NULL,
      account_status TEXT NOT NULL DEFAULT 'ACTIVE',
      restrictions_json TEXT NOT NULL DEFAULT '[]',
      suspension_reason TEXT,
      registered_at TEXT NOT NULL,
      last_active_at TEXT,
      activity_count INTEGER NOT NULL DEFAULT 0,
      reports_json TEXT NOT NULL DEFAULT '[]',
      synced_at TEXT NOT NULL,
      UNIQUE(workspace_id, upstream_user_id)
    );

    CREATE TABLE IF NOT EXISTS currency_settings (
      workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
      base_currency TEXT NOT NULL DEFAULT 'UGX',
      supported_currencies_json TEXT NOT NULL DEFAULT '["UGX","USD","EUR","GBP","KES","TZS"]',
      exchange_rates_json TEXT NOT NULL DEFAULT '{"UGX":1,"USD":0.00027,"EUR":0.00025,"GBP":0.00021,"KES":0.035,"TZS":0.71}',
      exchange_rate_source TEXT NOT NULL DEFAULT 'Central Bank / Live Financial Feed',
      exchange_rate_updated_at TEXT NOT NULL,
      rounding_rules_json TEXT NOT NULL DEFAULT '{"UGX":"100","USD":"0.01","EUR":"0.01","GBP":"0.01","KES":"10","TZS":"10"}',
      fee_mode TEXT NOT NULL DEFAULT 'INCLUSIVE',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS membership_plans (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      duration_type TEXT NOT NULL DEFAULT 'MONTHLY',
      duration_days INTEGER NOT NULL DEFAULT 30,
      base_price_ugx INTEGER NOT NULL DEFAULT 0,
      prices_override_json TEXT NOT NULL DEFAULT '{}',
      benefits_json TEXT NOT NULL DEFAULT '[]',
      is_active INTEGER NOT NULL DEFAULT 1,
      renewal_allowed INTEGER NOT NULL DEFAULT 1,
      promotional_price_ugx INTEGER,
      promotional_ends_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(workspace_id, slug)
    );

    CREATE TABLE IF NOT EXISTS payment_gateways (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      gateway_slug TEXT NOT NULL,
      name TEXT NOT NULL,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      environment TEXT NOT NULL DEFAULT 'sandbox',
      public_key_var TEXT NOT NULL DEFAULT '',
      secret_key_var TEXT NOT NULL DEFAULT '',
      webhook_secret_var TEXT NOT NULL DEFAULT '',
      supported_currencies_json TEXT NOT NULL DEFAULT '[]',
      supported_payment_methods_json TEXT NOT NULL DEFAULT '{}',
      last_health_check_at TEXT,
      health_status TEXT NOT NULL DEFAULT 'SANDBOX_READY',
      diagnostic_report TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(workspace_id, gateway_slug)
    );

    CREATE TABLE IF NOT EXISTS payment_orders (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      order_ref TEXT NOT NULL UNIQUE,
      customer_email TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      customer_user_id TEXT NOT NULL,
      plan_id TEXT NOT NULL REFERENCES membership_plans(id),
      plan_slug TEXT NOT NULL,
      plan_name TEXT NOT NULL,
      duration_days INTEGER NOT NULL,
      base_price_ugx INTEGER NOT NULL,
      charged_amount REAL NOT NULL,
      payment_currency TEXT NOT NULL,
      exchange_rate REAL NOT NULL,
      fee_amount REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL,
      payment_status TEXT NOT NULL DEFAULT 'PENDING',
      gateway_slug TEXT NOT NULL,
      flutterwave_tx_id TEXT,
      flutterwave_ref TEXT,
      checkout_url TEXT,
      webhook_received_at TEXT,
      verified_at TEXT,
      verified_by_server INTEGER NOT NULL DEFAULT 0,
      failure_reason TEXT,
      receipt_number TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customer_subscriptions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      customer_user_id TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      plan_id TEXT NOT NULL REFERENCES membership_plans(id),
      plan_slug TEXT NOT NULL,
      plan_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      starts_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      auto_renew INTEGER NOT NULL DEFAULT 1,
      last_order_id TEXT REFERENCES payment_orders(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(workspace_id, customer_user_id)
    );

    CREATE TABLE IF NOT EXISTS payment_webhooks_log (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      gateway_slug TEXT NOT NULL,
      event_type TEXT NOT NULL,
      tx_ref TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      signature_header TEXT,
      is_signature_valid INTEGER NOT NULL DEFAULT 0,
      is_processed INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_activity_logs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      activity_type TEXT NOT NULL,
      detail TEXT NOT NULL,
      anime_id TEXT,
      episode_id TEXT,
      metadata_json TEXT,
      ip_address TEXT NOT NULL DEFAULT '127.0.0.1',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS website_settings (
      workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
      site_name TEXT NOT NULL DEFAULT 'KURO NAMI',
      site_logo_url TEXT NOT NULL DEFAULT '/logo.png',
      hero_banner_anime_id TEXT,
      primary_color TEXT NOT NULL DEFAULT '#0EA5E9',
      featured_anime_ids_json TEXT NOT NULL DEFAULT '[]',
      trending_anime_ids_json TEXT NOT NULL DEFAULT '[]',
      homepage_sections_json TEXT NOT NULL DEFAULT '[{"id":"trending","title":"Trending Simulcasts"},{"id":"popular","title":"Most Popular Anime"},{"id":"new","title":"Recently Released Episodes"}]',
      navigation_links_json TEXT NOT NULL DEFAULT '[{"title":"Home","href":"/"},{"title":"Anime Catalog","href":"/anime"},{"title":"Simulcasts","href":"/simulcasts"},{"title":"Pricing & Memberships","href":"/pricing"}]',
      maintenance_mode INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS import_sync_logs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL DEFAULT 'COMPLETED',
      categories_summary_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS coupons_and_gifts (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      code TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL DEFAULT 'DISCOUNT_PERCENT',
      discount_percent INTEGER,
      discount_fixed_ugx INTEGER,
      plan_id TEXT REFERENCES membership_plans(id),
      max_uses INTEGER NOT NULL DEFAULT 100,
      current_uses INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS treasury_accounts (
      workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
      balance_cents INTEGER NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
      currency TEXT NOT NULL DEFAULT 'USD',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS treasury_transactions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      type TEXT NOT NULL CHECK (type IN ('DEPOSIT', 'WITHDRAWAL')),
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      balance_before_cents INTEGER NOT NULL,
      balance_after_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      reference_code TEXT NOT NULL,
      description TEXT NOT NULL,
      authorized_by_admin_id TEXT NOT NULL,
      authorized_by_username TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_logs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT,
      severity TEXT NOT NULL,
      component TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      admin_id TEXT,
      admin_username TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      previous_value TEXT,
      new_value TEXT,
      status TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TRIGGER IF NOT EXISTS prevent_audit_log_update
    BEFORE UPDATE ON audit_logs
    BEGIN
      SELECT RAISE(ABORT, 'Audit log records are immutable and cannot be modified.');
    END;

    CREATE TRIGGER IF NOT EXISTS prevent_audit_log_delete
    BEFORE DELETE ON audit_logs
    BEGIN
      SELECT RAISE(ABORT, 'Audit log records are immutable and cannot be deleted.');
    END;

    CREATE TRIGGER IF NOT EXISTS prevent_treasury_tx_update
    BEFORE UPDATE ON treasury_transactions
    BEGIN
      SELECT RAISE(ABORT, 'Treasury transaction records are immutable.');
    END;

    CREATE TRIGGER IF NOT EXISTS prevent_treasury_tx_delete
    BEFORE DELETE ON treasury_transactions
    BEGIN
      SELECT RAISE(ABORT, 'Treasury transaction records cannot be deleted.');
    END;
  `);

  // Safe table alterations for existing databases
  try {
    db.exec(`ALTER TABLE streaming_providers ADD COLUMN website_url TEXT DEFAULT ''`);
  } catch {}
  try {
    db.exec(`ALTER TABLE streaming_providers ADD COLUMN integration_type TEXT DEFAULT 'Standard API'`);
  } catch {}
  try {
    db.exec(`ALTER TABLE streaming_providers ADD COLUMN capabilities_json TEXT DEFAULT '{}'`);
  } catch {}
  try {
    db.exec(`ALTER TABLE streaming_providers ADD COLUMN diagnostic_details_json TEXT DEFAULT '{}'`);
  } catch {}

  seedInitialControlPlaneSlots();
}

function seedInitialControlPlaneSlots(): void {
  const now = new Date().toISOString();

  const designatedOwners = [
    {
      accountId: 'owner_benilin',
      username: 'BeniLin',
      displayName: 'BeniLin',
      workspaceId: 'ws_benilin',
      workspaceName: 'BeniLin Executive Workspace',
      ownerKey: 'benilin',
    },
    {
      accountId: 'owner_shana_love',
      username: 'Shana Love',
      displayName: 'Shana Love',
      workspaceId: 'ws_shana_love',
      workspaceName: 'Shana Love Executive Workspace',
      ownerKey: 'shana_love',
    },
  ];

  // Expanded streaming providers list including AnimePahe, AnimeDao, AnimeHeaven, VCDN, media.cm, CoorenLabs
  const builtInProviders = [
    {
      slug: 'animepahe',
      name: 'AnimePahe',
      websiteUrl: 'https://animepahe.pw/',
      integrationType: 'CoorenLabs AnimePahe API Wrapper',
      envSecretVar: 'PROVIDER_ANIMEPAHE_API_KEY',
      priority: 1,
    },
    {
      slug: 'animedao',
      name: 'AnimeDao',
      websiteUrl: 'https://animedao.in/',
      integrationType: 'Unverified Web Scraper / No Official API',
      envSecretVar: 'PROVIDER_ANIMEDAO_API_KEY',
      priority: 5,
    },
    {
      slug: 'animehaven',
      name: 'AnimeHeaven',
      websiteUrl: 'https://animehaven.me/',
      integrationType: 'Unverified Web Scraper / No Official API',
      envSecretVar: 'PROVIDER_ANIMEHEAVEN_API_KEY',
      priority: 6,
    },
    {
      slug: 'vcdn',
      name: 'VCDN',
      websiteUrl: 'https://vcdn.example',
      integrationType: 'Direct Video CDN Integration',
      envSecretVar: 'PROVIDER_VCDN_API_KEY',
      priority: 2,
    },
    {
      slug: 'media_cm',
      name: 'media.cm',
      websiteUrl: 'https://media.cm',
      integrationType: 'Media Storage & Stream Gateway',
      envSecretVar: 'PROVIDER_MEDIACM_API_KEY',
      priority: 3,
    },
    {
      slug: 'coorenlabs',
      name: 'CoorenLabs',
      websiteUrl: 'https://coorenlabs.com',
      integrationType: 'CoorenLabs Multi-Provider Gateway',
      envSecretVar: 'PROVIDER_COORENLABS_API_KEY',
      priority: 4,
    },
  ];

  const seedTx = db.transaction(() => {
    const insertWorkspace = db.prepare(`
      INSERT OR IGNORE INTO workspaces (id, name, owner_key, created_at)
      VALUES (?, ?, ?, ?)
    `);

    const insertOwner = db.prepare(`
      INSERT OR IGNORE INTO admin_accounts (
        id, username, display_name, role, workspace_id, is_owner_slot, is_provisioned, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)
    `);

    const insertIntegration = db.prepare(`
      INSERT OR IGNORE INTO integration_configs (
        workspace_id, base_url, health_path, api_version, env_api_key_var, sync_mode, connection_status, updated_at
      ) VALUES (?, ?, '/api/v1/health', 'v1', 'KURO_NAMI_UPSTREAM_API_KEY', 'DISCONNECTED', 'NOT_CONNECTED', ?)
    `);

    const insertTreasury = db.prepare(`
      INSERT OR IGNORE INTO treasury_accounts (workspace_id, balance_cents, currency, updated_at)
      VALUES (?, 0, 'USD', ?)
    `);

    const insertProvider = db.prepare(`
      INSERT OR IGNORE INTO streaming_providers (
        id, workspace_id, slug, name, website_url, integration_type, is_built_in, base_url, health_endpoint,
        env_secret_var, enabled, status, timeout_ms, retry_count, fallback_priority, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, '', '/', ?, 0, ?, 8000, 2, ?, ?)
    `);

    const defaultUpstreamUrl = process.env.KURO_NAMI_UPSTREAM_BASE_URL?.trim() || '';

    for (const owner of designatedOwners) {
      insertWorkspace.run(owner.workspaceId, owner.workspaceName, owner.ownerKey, now);
      insertOwner.run(
        owner.accountId,
        owner.username,
        owner.displayName,
        AdminRole.OWNER,
        owner.workspaceId,
        now,
        now
      );
      insertIntegration.run(owner.workspaceId, defaultUpstreamUrl, now);
      insertTreasury.run(owner.workspaceId, now);

      for (const p of builtInProviders) {
        // AnimeDao and AnimeHeaven start as INTEGRATION_UNAVAILABLE if unconfigured
        const initialStat =
          p.slug === 'animedao' || p.slug === 'animehaven'
            ? ProviderHealthStatus.INTEGRATION_UNAVAILABLE
            : ProviderHealthStatus.NOT_CONFIGURED;

        insertProvider.run(
          `prov_${owner.ownerKey}_${p.slug}`,
          owner.workspaceId,
          p.slug,
          p.name,
          p.websiteUrl,
          p.integrationType,
          p.envSecretVar,
          initialStat,
          p.priority,
          now
        );
      }

      // Seed Multi-Currency Settings (Base: UGX)
      const defaultCurrencies = JSON.stringify(['UGX', 'USD', 'EUR', 'GBP', 'KES', 'TZS']);
      const defaultRates = JSON.stringify({
        UGX: 1,
        USD: 0.00027,
        EUR: 0.00025,
        GBP: 0.00021,
        KES: 0.035,
        TZS: 0.71,
      });
      const defaultRounding = JSON.stringify({
        UGX: '100',
        USD: '0.01',
        EUR: '0.01',
        GBP: '0.01',
        KES: '10',
        TZS: '10',
      });

      db.prepare(`
        INSERT OR IGNORE INTO currency_settings (
          workspace_id, base_currency, supported_currencies_json, exchange_rates_json,
          exchange_rate_source, exchange_rate_updated_at, rounding_rules_json, fee_mode, updated_at
        ) VALUES (?, 'UGX', ?, ?, 'Central Bank / Live Financial Feed', ?, ?, 'INCLUSIVE', ?)
      `).run(owner.workspaceId, defaultCurrencies, defaultRates, now, defaultRounding, now);

      // Seed Membership Plans
      const defaultPlans = [
        {
          slug: 'free',
          name: 'Free Membership',
          description: 'Standard access with occasional non-intrusive ads and 480p/720p streaming.',
          type: 'FREE',
          days: 0,
          ugx: 0,
          benefits: [
            'Standard definition (480p/720p)',
            'Supported with non-intrusive ads',
            '1 active streaming profile',
            'Public anime catalog access',
          ],
        },
        {
          slug: 'premium-monthly',
          name: 'Premium Monthly',
          description: 'Monthly ad-free 1080p/4K streaming with offline downloads and simulcast releases.',
          type: 'MONTHLY',
          days: 30,
          ugx: 15000,
          benefits: [
            'Ad-free Full HD & 4K Ultra HD streaming',
            'Simultaneous streaming on 2 devices',
            'Offline anime downloads on mobile & tablet',
            'Simulcast access 1 hour after Japan broadcast',
          ],
        },
        {
          slug: 'premium-quarterly',
          name: 'Premium Quarterly',
          description: '3 months of 4K streaming with priority CDN routing and savings vs monthly.',
          type: 'QUARTERLY',
          days: 90,
          ugx: 40000,
          benefits: [
            'Ad-free 4K Ultra HD & HDR streaming',
            'Simultaneous streaming on 3 devices',
            'Unlimited offline downloads',
            'Priority CDN streaming node routing',
            '5% price discount vs monthly',
          ],
        },
        {
          slug: 'premium-yearly',
          name: 'Premium Yearly',
          description: '1 full year of top-tier streaming with 22% annual savings and VIP badges.',
          type: 'YEARLY',
          days: 365,
          ugx: 140000,
          benefits: [
            'Ad-free 4K Ultra HD & Dolby Vision streaming',
            'Simultaneous streaming on 4 devices',
            'Unlimited offline downloads',
            'Exclusive Kuro Nami profile badges & VIP support',
            '22% annual discount',
          ],
        },
        {
          slug: 'premium-plus',
          name: 'Premium Plus VIP',
          description: 'Ultimate membership with 6 device streams, lossless audio, and gift pass privileges.',
          type: 'YEARLY',
          days: 365,
          ugx: 220000,
          benefits: [
            'Ad-free 4K Ultra HD with FLAC/Lossless audio',
            'Simultaneous streaming on 6 devices',
            '1 Gift Membership to share every quarter',
            'VIP Discord rank & early beta feature access',
            'Full offline catalog sync',
          ],
        },
      ];

      const insertPlan = db.prepare(`
        INSERT OR IGNORE INTO membership_plans (
          id, workspace_id, slug, name, description, duration_type, duration_days,
          base_price_ugx, prices_override_json, benefits_json, is_active, renewal_allowed,
          promotional_price_ugx, promotional_ends_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, 1, 1, NULL, NULL, ?, ?)
      `);

      for (const p of defaultPlans) {
        insertPlan.run(
          `plan_${owner.ownerKey}_${p.slug}`,
          owner.workspaceId,
          p.slug,
          p.name,
          p.description,
          p.type,
          p.days,
          p.ugx,
          JSON.stringify(p.benefits),
          now,
          now
        );
      }

      // Seed Payment Gateways
      const insertGateway = db.prepare(`
        INSERT OR IGNORE INTO payment_gateways (
          id, workspace_id, gateway_slug, name, is_enabled, environment,
          public_key_var, secret_key_var, webhook_secret_var,
          supported_currencies_json, supported_payment_methods_json,
          health_status, diagnostic_report, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertGateway.run(
        `gw_${owner.ownerKey}_flutterwave`,
        owner.workspaceId,
        'flutterwave',
        'Flutterwave Multi-Currency Gateway',
        1,
        'sandbox',
        'FLUTTERWAVE_PUBLIC_KEY',
        'FLUTTERWAVE_SECRET_KEY',
        'FLUTTERWAVE_WEBHOOK_SECRET',
        JSON.stringify(['UGX', 'USD', 'EUR', 'GBP', 'KES', 'TZS']),
        JSON.stringify({
          UGX: ['Uganda Mobile Money (MTN/Airtel)', 'Visa/Mastercard'],
          USD: ['Visa/Mastercard', 'International Cards'],
          EUR: ['Visa/Mastercard', 'SEPA Credit/Debit'],
          GBP: ['Visa/Mastercard', 'UK Cards'],
          KES: ['M-Pesa Mobile Money', 'Visa/Mastercard'],
          TZS: ['Tigo/Airtel/Vodacom Mobile Money', 'Visa/Mastercard'],
        }),
        'SANDBOX_READY',
        'Flutterwave gateway initialized in sandbox mode. Supports UGX mobile money and international cards.',
        now
      );

      insertGateway.run(
        `gw_${owner.ownerKey}_pesapal`,
        owner.workspaceId,
        'pesapal',
        'Pesapal Payment Gateway (Evaluated)',
        0,
        'sandbox',
        'PESAPAL_CONSUMER_KEY',
        'PESAPAL_CONSUMER_SECRET',
        'PESAPAL_IPN_SECRET',
        JSON.stringify(['UGX', 'USD', 'KES']),
        JSON.stringify({
          UGX: ['Mobile Money', 'Visa/Mastercard'],
          USD: ['Visa/Mastercard'],
          KES: ['M-Pesa Mobile Money'],
        }),
        'DISABLED',
        'Pesapal integration evaluated. Currently disabled until verified live consumer credentials and IPN URL registration are supplied in Pesapal dashboard.',
        now
      );

      // Seed Coupons
      db.prepare(`
        INSERT OR IGNORE INTO coupons_and_gifts (
          id, workspace_id, code, type, discount_percent, discount_fixed_ugx,
          max_uses, current_uses, is_active, created_at, updated_at
        ) VALUES (?, ?, 'WELCOME10', 'DISCOUNT_PERCENT', 10, NULL, 100, 3, 1, ?, ?)
      `).run(`cpn_${owner.ownerKey}_welcome10`, owner.workspaceId, now, now);

      // Seed Website Settings
      db.prepare(`
        INSERT OR IGNORE INTO website_settings (
          workspace_id, site_name, site_logo_url, hero_banner_anime_id, primary_color,
          featured_anime_ids_json, trending_anime_ids_json, homepage_sections_json, navigation_links_json,
          maintenance_mode, updated_at
        ) VALUES (?, 'KURO NAMI', '/logo.png', NULL, '#0EA5E9', '[]', '[]',
        '[{"id":"trending","title":"Trending Simulcasts"},{"id":"popular","title":"Most Popular Anime"},{"id":"new","title":"Recently Released Episodes"}]',
        '[{"title":"Home","href":"/"},{"title":"Anime Catalog","href":"/anime"},{"title":"Simulcasts","href":"/simulcasts"},{"title":"Pricing & Memberships","href":"/pricing"}]',
        0, ?)
      `).run(owner.workspaceId, now);

      // Seed Sample User Activity Logs
      const sampleActivities = [
        { type: 'REGISTER', detail: 'New user account registered from Uganda' },
        { type: 'LOGIN', detail: 'User authenticated successfully' },
        { type: 'ANIME_VIEW', detail: 'User viewed anime details page' },
        { type: 'EPISODE_STREAM', detail: 'User streamed episode 1 via VCDN player' },
        { type: 'SEARCH', detail: 'User searched catalog for "Attack on Titan"' },
        { type: 'WATCHLIST_ADD', detail: 'User added anime to watchlist' },
        { type: 'PAYMENT', detail: 'User completed Premium Monthly checkout in UGX' },
      ];

      const insertAct = db.prepare(`
        INSERT OR IGNORE INTO user_activity_logs (
          id, workspace_id, user_id, username, activity_type, detail, ip_address, created_at
        ) VALUES (?, ?, 'user_demo_01', 'Kuro Nami Fan', ?, ?, '127.0.0.1', ?)
      `);

      for (let idx = 0; idx < sampleActivities.length; idx++) {
        const act = sampleActivities[idx];
        insertAct.run(`act_${owner.ownerKey}_${idx + 1}`, owner.workspaceId, act.type, act.detail, now);
      }
    }
  });

  seedTx();
}

export function checkDatabaseLatencyMs(): { ok: boolean; latencyMs: number } {
  const start = performance.now();
  try {
    db.prepare('SELECT 1 AS ok').get();
    return { ok: true, latencyMs: Math.round((performance.now() - start) * 100) / 100 };
  } catch {
    return { ok: false, latencyMs: Math.round((performance.now() - start) * 100) / 100 };
  }
}

export enum AdminRole {
  OWNER = 'OWNER',
  CONTENT_ADMIN = 'CONTENT_ADMIN',
  INFRA_ADMIN = 'INFRA_ADMIN',
  SUPPORT_MOD = 'SUPPORT_MOD',
  AUDITOR = 'AUDITOR',
}

export enum ProviderHealthStatus {
  NOT_CONFIGURED = 'NOT_CONFIGURED',
  CONFIGURED = 'CONFIGURED',
  CONNECTIVITY_VERIFIED = 'CONNECTIVITY_VERIFIED',
  API_VERIFIED = 'API_VERIFIED',
  SEARCH_VERIFIED = 'SEARCH_VERIFIED',
  EPISODES_VERIFIED = 'EPISODES_VERIFIED',
  PLAYBACK_VERIFIED = 'PLAYBACK_VERIFIED',
  DEGRADED = 'DEGRADED',
  OFFLINE = 'OFFLINE',
  AUTH_FAILED = 'AUTH_FAILED',
  INTEGRATION_UNAVAILABLE = 'INTEGRATION_UNAVAILABLE',
  // Backward compatibility aliases
  CONNECTED = 'CONNECTED',
  CONFIGURED_UNREACHABLE = 'CONFIGURED_UNREACHABLE',
  UNAVAILABLE = 'UNAVAILABLE',
}

export enum StorageAdapterType {
  CLOUD_OBJECT_STORAGE = 'CLOUD_OBJECT_STORAGE',
  S3_COMPATIBLE = 'S3_COMPATIBLE',
  GOOGLE_CLOUD_STORAGE = 'GOOGLE_CLOUD_STORAGE',
  CLOUDFLARE_R2 = 'CLOUDFLARE_R2',
  LOCAL_VOLUME = 'LOCAL_VOLUME',
}

export enum StorageHealthStatus {
  UNTESTED = 'UNTESTED',
  CONNECTED = 'CONNECTED',
  UNREACHABLE = 'UNREACHABLE',
  AUTH_FAILED = 'AUTH_FAILED',
  DISABLED = 'DISABLED',
}

export enum AnimeStatus {
  ONGOING = 'ONGOING',
  COMPLETED = 'COMPLETED',
  UPCOMING = 'UPCOMING',
  HIATUS = 'HIATUS',
}

export enum AudioMode {
  SUB = 'SUB',
  DUB = 'DUB',
  BOTH = 'BOTH',
  RAW = 'RAW',
}

export enum AssetCategory {
  ANIME_POSTER = 'ANIME_POSTER',
  BACKGROUND_ARTWORK = 'BACKGROUND_ARTWORK',
  PROMOTIONAL_ARTWORK = 'PROMOTIONAL_ARTWORK',
  THUMBNAIL = 'THUMBNAIL',
  SUBTITLE = 'SUBTITLE',
  AUTHORIZED_VIDEO = 'AUTHORIZED_VIDEO',
  OTHER_MEDIA = 'OTHER_MEDIA',
}

export enum LogSeverity {
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  CRITICAL = 'CRITICAL',
}

export interface OwnerProvisionSlot {
  id: string;
  username: string;
  displayName: string;
  workspaceId: string;
  workspaceName: string;
  isProvisioned: boolean;
  provisionedAt: string | null;
}

export interface AuthenticatedAdmin {
  id: string;
  username: string;
  displayName: string;
  role: AdminRole;
  workspaceId: string;
  workspaceName: string;
  csrfToken: string;
  sessionId: string;
  lastLoginAt: string | null;
}

export interface AlternativeTitles {
  romaji: string;
  english: string;
  native: string;
  synonyms: string[];
}

export interface ExternalAnimeIds {
  upstreamKuroNamiId: string;
  anilistId: string;
  malId: string;
  kitsuId: string;
  anidbId: string;
}

export interface AnimeSeasonItem {
  seasonNumber: number;
  title: string;
  episodeCount: number;
  releaseYear: number | null;
}

export interface AnimeRecord {
  id: string;
  workspaceId: string;
  title: string;
  slug: string;
  synopsis: string;
  alternativeTitles: AlternativeTitles;
  genres: string[];
  releaseYear: number | null;
  status: AnimeStatus;
  ratingValue: number | null;
  ratingSource: string;
  studios: string[];
  seasons: AnimeSeasonItem[];
  externalIds: ExternalAnimeIds;
  posterAssetId: string | null;
  backgroundAssetId: string | null;
  storageServerId: string | null;
  syncState: 'LOCAL_STAGED' | 'SYNCED_UPSTREAM' | 'MODIFIED_PENDING_SYNC';
  episodeCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface EpisodeSourceLink {
  id: string;
  providerSlug: string;
  sourceUrl: string;
  quality: string;
  audioType: AudioMode;
  availabilityStatus: 'UNVERIFIED' | 'AVAILABLE' | 'UNREACHABLE' | 'ERROR';
  lastCheckedAt: string | null;
  responseTimeMs: number | null;
}

export interface EpisodeRecord {
  id: string;
  workspaceId: string;
  animeId: string;
  animeTitle?: string;
  upstreamEpisodeId: string;
  seasonNumber: number;
  episodeNumber: number;
  sortOrder: number;
  title: string;
  releaseDate: string | null;
  subtitleLanguages: string[];
  audioStatus: AudioMode;
  sources: EpisodeSourceLink[];
  storageServerId: string | null;
  thumbnailAssetId: string | null;
  subtitleAssetId: string | null;
  videoAssetId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderCapabilityStatus {
  dns: boolean;
  tls: boolean;
  http: boolean;
  api: boolean;
  auth: boolean;
  search: boolean;
  episodes: boolean;
  playback: boolean;
}

export interface StreamingProviderRecord {
  id: string;
  workspaceId: string;
  slug: string;
  name: string;
  websiteUrl: string;
  integrationType: string;
  isBuiltIn: boolean;
  baseUrl: string;
  healthEndpoint: string;
  envSecretVar: string;
  hasEnvSecret: boolean;
  enabled: boolean;
  status: ProviderHealthStatus;
  timeoutMs: number;
  retryCount: number;
  fallbackPriority: number;
  lastResponseTimeMs: number | null;
  totalRequests: number;
  failedRequests: number;
  timeoutErrors: number;
  resolutionAttempts: number;
  resolutionSuccesses: number;
  availabilityPercent: number | null;
  lastTestedAt: string | null;
  lastErrorMessage: string | null;
  capabilities: ProviderCapabilityStatus;
  diagnosticDetails?: {
    dnsCheck?: string;
    tlsCheck?: string;
    searchResultSample?: string;
    episodesResultSample?: string;
    playbackResultSample?: string;
    ndjsonParsedCount?: number;
    missingRequirements?: string[];
  };
  updatedAt: string;
}

export interface StorageServerRecord {
  id: string;
  workspaceId: string;
  name: string;
  adapterType: StorageAdapterType;
  endpointUrl: string;
  bucketOrVolume: string;
  region: string;
  envCredentialPrefix: string;
  hasEnvCredentials: boolean;
  enabled: boolean;
  isVerified: boolean;
  healthStatus: StorageHealthStatus;
  configuredCapacityBytes: number;
  usedCapacityBytes: number;
  backupDestinationId: string | null;
  failedUploadsCount: number;
  assignedAssetsCount?: number;
  lastTestedAt: string | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoragePoolSummary {
  totalServers: number;
  enabledServers: number;
  verifiedConnectedServers: number;
  totalCapacityBytes: number;
  usedCapacityBytes: number;
  availableCapacityBytes: number;
  utilizationPercent: number;
  totalFailedUploads: number;
}

export interface AssetRecord {
  id: string;
  workspaceId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  category: AssetCategory;
  storageServerId: string | null;
  storageServerName?: string | null;
  uploadStatus: 'STORED' | 'FAILED' | 'REPLACED';
  linkedAnimeId: string | null;
  linkedEpisodeId: string | null;
  inUseReferences?: string[];
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedUserRecord {
  id: string;
  workspaceId: string;
  upstreamUserId: string;
  username: string;
  emailMasked: string;
  accountStatus: 'ACTIVE' | 'SUSPENDED' | 'RESTRICTED';
  restrictions: string[];
  suspensionReason: string | null;
  registeredAt: string;
  lastActiveAt: string | null;
  activityCount: number;
  openReportsCount: number;
  reports: Array<{
    id: string;
    category: string;
    summary: string;
    reportedAt: string;
    resolved: boolean;
  }>;
  syncedAt: string;
}

export interface TreasuryTransactionRecord {
  id: string;
  workspaceId: string;
  type: 'DEPOSIT' | 'WITHDRAWAL';
  amountCents: number;
  balanceBeforeCents: number;
  balanceAfterCents: number;
  currency: string;
  referenceCode: string;
  description: string;
  authorizedByAdminId: string;
  authorizedByUsername: string;
  createdAt: string;
}

export interface AuditLogRecord {
  id: string;
  workspaceId: string;
  adminId: string | null;
  adminUsername: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  previousValue: string | null;
  newValue: string | null;
  status: 'SUCCESS' | 'FAILURE';
  ipAddress: string;
  createdAt: string;
}

export interface SystemLogRecord {
  id: string;
  workspaceId: string | null;
  severity: LogSeverity;
  component: string;
  message: string;
  metadataJson: string | null;
  createdAt: string;
}

export interface UpstreamIntegrationConfig {
  workspaceId: string;
  baseUrl: string;
  healthPath: string;
  apiVersion: string;
  envApiKeyVar: string;
  hasEnvApiKey: boolean;
  syncMode: 'DISCONNECTED' | 'READ_ONLY_VERIFY' | 'CONTROLLED_SYNC';
  connectionStatus: 'NOT_CONNECTED' | 'CONNECTED' | 'UNREACHABLE' | 'AUTH_ERROR';
  lastTestedAt: string | null;
  lastLatencyMs: number | null;
  lastStatusMessage: string | null;
  updatedAt: string;
}

export interface ProposedApiContract {
  domain: string;
  version: string;
  contractStatus: 'PROPOSED_UPSTREAM_CONTRACT' | 'VERIFIED_ADMIN_LOCAL_ENDPOINT';
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  description: string;
  authRequirement: string;
  idempotencyAndSyncNotes: string;
}

export interface CurrencyCalculation {
  basePriceUgx: number;
  paymentCurrency: string;
  exchangeRate: number;
  chargedAmount: number;
  feeAmount: number;
  totalAmount: number;
  formattedDisplay: string;
}

export interface CurrencySettingRecord {
  workspaceId: string;
  baseCurrency: 'UGX';
  supportedCurrencies: string[];
  exchangeRates: Record<string, number>;
  exchangeRateSource: string;
  exchangeRateUpdatedAt: string;
  roundingRules: Record<string, string>;
  feeMode: 'INCLUSIVE' | 'EXCLUSIVE';
  updatedAt: string;
}

export interface MembershipPlanRecord {
  id: string;
  workspaceId: string;
  slug: string;
  name: string;
  description: string;
  durationType: 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'CUSTOM' | 'FREE';
  durationDays: number;
  basePriceUgx: number;
  pricesOverride: Record<string, number>;
  benefits: string[];
  isActive: boolean;
  renewalAllowed: boolean;
  promotionalPriceUgx: number | null;
  promotionalEndsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentGatewayRecord {
  id: string;
  workspaceId: string;
  gatewaySlug: 'flutterwave' | 'pesapal';
  name: string;
  isEnabled: boolean;
  environment: 'sandbox' | 'production';
  publicKeyVar: string;
  secretKeyVar: string;
  webhookSecretVar: string;
  hasSecretKey: boolean;
  supportedCurrencies: string[];
  supportedPaymentMethods: Record<string, string[]>;
  lastHealthCheckAt: string | null;
  healthStatus: 'OPERATIONAL' | 'SANDBOX_READY' | 'UNCONFIGURED' | 'DISABLED' | 'ERROR';
  diagnosticReport: string | null;
  updatedAt: string;
}

export interface PaymentOrderRecord {
  id: string;
  workspaceId: string;
  orderRef: string;
  customerEmail: string;
  customerName: string;
  customerUserId: string;
  planId: string;
  planSlug: string;
  planName: string;
  durationDays: number;
  basePriceUgx: number;
  chargedAmount: number;
  paymentCurrency: string;
  exchangeRate: number;
  feeAmount: number;
  totalAmount: number;
  paymentStatus: 'PENDING' | 'SUCCESSFUL' | 'FAILED' | 'CANCELLED' | 'REFUNDED';
  gatewaySlug: 'flutterwave' | 'pesapal';
  flutterwaveTxId: string | null;
  flutterwaveRef: string | null;
  checkoutUrl: string | null;
  webhookReceivedAt: string | null;
  verifiedAt: string | null;
  verifiedByServer: boolean;
  failureReason: string | null;
  receiptNumber: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerSubscriptionRecord {
  id: string;
  workspaceId: string;
  customerUserId: string;
  customerEmail: string;
  planId: string;
  planSlug: string;
  planName: string;
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'PAUSED';
  startsAt: string;
  expiresAt: string;
  autoRenew: boolean;
  lastOrderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentWebhookLogRecord {
  id: string;
  workspaceId: string;
  gatewaySlug: string;
  eventType: string;
  txRef: string;
  payloadJson: string;
  signatureHeader: string | null;
  isSignatureValid: boolean;
  isProcessed: boolean;
  errorMessage: string | null;
  createdAt: string;
}

export interface CouponRecord {
  id: string;
  workspaceId: string;
  code: string;
  type: 'DISCOUNT_PERCENT' | 'DISCOUNT_FIXED' | 'GIFT_MEMBERSHIP';
  discountPercent: number | null;
  discountFixedUgx: number | null;
  planId: string | null;
  maxUses: number;
  currentUses: number;
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RevenueByCurrency {
  currency: string;
  successfulCount: number;
  totalCharged: number;
  totalFees: number;
  netRevenue: number;
}

export interface WebsiteIntegrationStatus {
  websiteOrigin: string;
  websiteStatus: 'CONNECTED' | 'DEGRADED' | 'UNREACHABLE';
  apiStatus: 'OPERATIONAL' | 'ERROR';
  dbStatus: 'OPERATIONAL' | 'ERROR';
  authStatus: 'OPERATIONAL' | 'ERROR';
  flutterwaveGatewayStatus: 'OPERATIONAL' | 'SANDBOX_READY' | 'UNCONFIGURED';
  pesapalGatewayStatus: 'EVALUATED_DISABLED' | 'UNCONFIGURED';
  lastTestedAt: string | null;
  latencyMs: number | null;
  diagnostics: Array<{
    component: string;
    status: 'PASS' | 'WARN' | 'FAIL';
    detail: string;
  }>;
}

export interface UserActivityRecord {
  id: string;
  workspaceId: string;
  userId: string;
  username: string;
  activityType:
    | 'ANIME_VIEW'
    | 'EPISODE_STREAM'
    | 'SEARCH'
    | 'WATCHLIST_ADD'
    | 'LOGIN'
    | 'REGISTER'
    | 'MEMBERSHIP_CHANGE'
    | 'PAYMENT'
    | 'FAILED_API'
    | 'BACKEND_ERROR';
  detail: string;
  animeId?: string | null;
  episodeId?: string | null;
  metadataJson?: string | null;
  ipAddress: string;
  createdAt: string;
}

export interface WebsiteSettingsRecord {
  workspaceId: string;
  siteName: string;
  siteLogoUrl: string;
  heroBannerAnimeId: string | null;
  primaryColor: string;
  featuredAnimeIds: string[];
  trendingAnimeIds: string[];
  homepageSectionsJson: string;
  navigationLinksJson: string;
  maintenanceMode: boolean;
  updatedAt: string;
}

export interface DataImportCategorySummary {
  categoryKey:
    | 'ANIME'
    | 'EPISODES'
    | 'USERS'
    | 'USER_ACTIVITY'
    | 'WEBSITE_SETTINGS'
    | 'PAYMENTS'
    | 'PROVIDERS_STORAGE';
  categoryName: string;
  recordsFound: number;
  recordsImported: number;
  recordsFailed: number;
  lastSyncTime: string | null;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'IDLE';
  details: string;
}

export interface WebsiteImportJobSummary {
  workspaceId: string;
  startedAt: string;
  completedAt: string | null;
  overallStatus: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  categories: DataImportCategorySummary[];
}

export interface DataExportOptions {
  exportFormat: 'JSON' | 'CSV' | 'ZIP';
  selectedCategories: string[];
  startDate?: string;
  endDate?: string;
  changedSince?: string;
}



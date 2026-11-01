import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  Clapperboard,
  CreditCard,
  FileCheck2,
  Film,
  FolderKanban,
  Globe,
  HardDrive,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  Settings,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import {
  AdminRole,
  AuthenticatedAdmin,
  OwnerProvisionSlot,
} from './shared/types';
import {
  apiRequest,
  setClientAuthTokens,
  updateClientCsrfToken,
} from './client/api';
import { ToastMessage } from './client/components/UiPrimitives';
import { AuthPortal } from './client/views/AuthPortal';
import { OverviewView } from './client/views/OverviewView';
import { AnimeManagementView } from './client/views/AnimeManagementView';
import { EpisodeManagementView } from './client/views/EpisodeManagementView';
import { StreamingProvidersView } from './client/views/StreamingProvidersView';
import { StorageServersView } from './client/views/StorageServersView';
import { AssetManagementView } from './client/views/AssetManagementView';
import { TreasuryView, UserManagementView } from './client/views/UsersAndTreasuryViews';
import {
  AnalyticsView,
  AuditLogsView,
  SystemMonitoringView,
} from './client/views/AnalyticsMonitoringAuditViews';
import { AdminSettingsView } from './client/views/AdminSettingsView';
import { PaymentDashboardView } from './client/views/PaymentDashboardView';
import { CustomerStorefrontView } from './client/views/CustomerStorefrontView';
import { WebsiteImportView } from './client/views/WebsiteImportView';
import { LiveActivityView } from './client/views/LiveActivityView';
import { ExportCentreView } from './client/views/ExportCentreView';
import { WebsiteSettingsView } from './client/views/WebsiteSettingsView';
import { Download, RefreshCw, Sliders } from 'lucide-react';

type NavSectionId =
  | 'overview'
  | 'activity'
  | 'import'
  | 'payments'
  | 'storefront'
  | 'anime'
  | 'episodes'
  | 'providers'
  | 'storage'
  | 'assets'
  | 'treasury'
  | 'users'
  | 'websettings'
  | 'export'
  | 'analytics'
  | 'monitoring'
  | 'audit'
  | 'settings';

interface NavItemConfig {
  id: NavSectionId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  allowedRoles?: AdminRole[];
}

const SIDEBAR_ITEMS: NavItemConfig[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'activity', label: 'Live Activity Stream', icon: Activity },
  { id: 'import', label: 'Website Data Import', icon: RefreshCw },
  {
    id: 'payments',
    label: 'Payment & Revenue',
    icon: CreditCard,
    allowedRoles: [AdminRole.OWNER, AdminRole.AUDITOR],
  },
  {
    id: 'storefront',
    label: 'Website Storefront',
    icon: Globe,
  },
  {
    id: 'anime',
    label: 'Anime Management',
    icon: Clapperboard,
    allowedRoles: [AdminRole.OWNER, AdminRole.CONTENT_ADMIN, AdminRole.SUPPORT_MOD, AdminRole.AUDITOR],
  },
  {
    id: 'episodes',
    label: 'Episodes',
    icon: Film,
    allowedRoles: [AdminRole.OWNER, AdminRole.CONTENT_ADMIN, AdminRole.SUPPORT_MOD, AdminRole.AUDITOR],
  },
  {
    id: 'providers',
    label: 'Streaming Providers',
    icon: Radio,
    allowedRoles: [AdminRole.OWNER, AdminRole.INFRA_ADMIN, AdminRole.AUDITOR],
  },
  {
    id: 'storage',
    label: 'Storage Servers',
    icon: HardDrive,
    allowedRoles: [AdminRole.OWNER, AdminRole.INFRA_ADMIN, AdminRole.AUDITOR],
  },
  {
    id: 'assets',
    label: 'Asset Management',
    icon: FolderKanban,
    allowedRoles: [AdminRole.OWNER, AdminRole.CONTENT_ADMIN, AdminRole.INFRA_ADMIN, AdminRole.AUDITOR],
  },
  {
    id: 'users',
    label: 'User Management',
    icon: Users,
    allowedRoles: [AdminRole.OWNER, AdminRole.SUPPORT_MOD, AdminRole.AUDITOR],
  },
  {
    id: 'websettings',
    label: 'Website Settings',
    icon: Sliders,
    allowedRoles: [AdminRole.OWNER, AdminRole.CONTENT_ADMIN],
  },
  {
    id: 'export',
    label: 'Export Centre',
    icon: Download,
  },
  {
    id: 'treasury',
    label: 'Asset Treasury',
    icon: Wallet,
    allowedRoles: [AdminRole.OWNER, AdminRole.AUDITOR],
  },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  {
    id: 'monitoring',
    label: 'System Monitoring',
    icon: Activity,
    allowedRoles: [AdminRole.OWNER, AdminRole.INFRA_ADMIN, AdminRole.AUDITOR],
  },
  {
    id: 'audit',
    label: 'Audit Logs',
    icon: FileCheck2,
    allowedRoles: [AdminRole.OWNER, AdminRole.AUDITOR],
  },
  { id: 'settings', label: 'Admin Settings', icon: Settings },
];

export default function App() {
  const [bootstrapping, setBootstrapping] = useState(true);
  const [ownerSlots, setOwnerSlots] = useState<OwnerProvisionSlot[]>([]);
  const [requiresProvisioningToken, setRequiresProvisioningToken] = useState(false);
  const [admin, setAdmin] = useState<AuthenticatedAdmin | null>(null);

  const [activeSection, setActiveSection] = useState<NavSectionId>('overview');
  const [episodeTargetAnimeId, setEpisodeTargetAnimeId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const notify = useCallback(
    (tone: 'success' | 'error' | 'info', title: string, detail?: string) => {
      const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setToasts((prev) => [...prev.slice(-3), { id, tone, title, detail }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4500);
    },
    []
  );

  const loadAuthStatus = useCallback(async () => {
    try {
      const res = await apiRequest<{
        ownerSlots: OwnerProvisionSlot[];
        requiresProvisioningToken: boolean;
        currentAdmin: AuthenticatedAdmin | null;
      }>('/api/v1/auth/status');

      setOwnerSlots(res.ownerSlots);
      setRequiresProvisioningToken(res.requiresProvisioningToken);
      if (res.currentAdmin) {
        updateClientCsrfToken(res.currentAdmin.csrfToken);
        setAdmin(res.currentAdmin);
      } else {
        setAdmin(null);
      }
    } catch {
      setAdmin(null);
    } finally {
      setBootstrapping(false);
    }
  }, []);

  useEffect(() => {
    loadAuthStatus();
  }, [loadAuthStatus]);

  const handleLogout = async () => {
    try {
      await apiRequest('/api/v1/auth/logout', { method: 'POST' });
    } catch {
      // Proceed to clear local session even if already expired
    } finally {
      setClientAuthTokens(null, null);
      setAdmin(null);
      setActiveSection('overview');
      await loadAuthStatus();
    }
  };

  if (bootstrapping) {
    return (
      <div className="min-h-screen bg-[#0B0F17] flex items-center justify-center text-slate-400 text-xs font-mono">
        Initializing KURO NAMI ADMIN Control Plane...
      </div>
    );
  }

  if (!admin) {
    return (
      <AuthPortal
        ownerSlots={ownerSlots}
        requiresProvisioningToken={requiresProvisioningToken}
        onAuthenticated={(authenticated) => {
          setAdmin(authenticated);
          setActiveSection('overview');
        }}
        onRefreshStatus={loadAuthStatus}
      />
    );
  }

  const visibleNavItems = SIDEBAR_ITEMS.filter(
    (item) => !item.allowedRoles || item.allowedRoles.includes(admin.role)
  );

  const currentNavLabel =
    SIDEBAR_ITEMS.find((i) => i.id === activeSection)?.label || 'Overview';

  const navigateTo = (section: string) => {
    setActiveSection(section as NavSectionId);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          onClick={() => setMobileMenuOpen(false)}
          className="fixed inset-0 z-40 bg-black/70 lg:hidden"
        />
      )}

      {/* Collapsible Sidebar Navigation */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r border-slate-800/80 bg-[#0E1420] transition-transform duration-150 lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        } ${sidebarCollapsed ? 'lg:w-[68px]' : 'w-64'}`}
      >
        <div className="flex h-14 items-center justify-between border-b border-slate-800/80 px-4">
          {!sidebarCollapsed && (
            <span className="font-display text-sm font-bold tracking-tight text-slate-100 whitespace-nowrap truncate">
              KURO NAMI ADMIN
            </span>
          )}
          <button
            type="button"
            onClick={() => setSidebarCollapsed((c) => !c)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden lg:inline-flex rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close navigation menu"
            className="lg:hidden rounded p-1.5 text-slate-400 hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2.5 py-4 space-y-1">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                title={sidebarCollapsed ? item.label : undefined}
                onClick={() => navigateTo(item.id)}
                className={`w-full flex items-center gap-3 rounded-md px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-sky-600/15 text-sky-300 border border-sky-500/30'
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100 border border-transparent'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {!sidebarCollapsed && (
          <div className="border-t border-slate-800/80 px-4 py-3 text-[11px] text-slate-400">
            <div className="font-medium text-slate-200 truncate">{admin.workspaceName}</div>
            <div className="mt-0.5 font-mono text-slate-500 truncate">
              {admin.username} · {admin.role}
            </div>
          </div>
        )}
      </aside>

      {/* Main Content Workspace */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Clean SaaS Top Bar Contract: Breadcrumb Left — Sign Out Action Right */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-8 border-b border-slate-800/80 bg-[#0B0F17]/95 px-4 sm:px-6 backdrop-blur">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden rounded p-1.5 text-slate-300 hover:bg-slate-800"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2 text-xs text-slate-400 truncate">
              <span className="hidden sm:inline font-medium text-slate-300 whitespace-nowrap">
                {admin.workspaceName}
              </span>
              <span className="hidden sm:inline text-slate-600" aria-hidden="true">
                /
              </span>
              <span className="font-semibold text-slate-100 whitespace-nowrap">
                {currentNavLabel}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <span className="hidden md:inline text-xs text-slate-400 whitespace-nowrap">
              {admin.username} · {admin.role}
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </header>

        {/* Active View Viewport */}
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-[1440px] w-full mx-auto">
          {activeSection === 'overview' && <OverviewView onNavigate={navigateTo} />}
          {activeSection === 'activity' && <LiveActivityView notify={notify} />}
          {activeSection === 'import' && <WebsiteImportView notify={notify} />}
          {activeSection === 'payments' && <PaymentDashboardView admin={admin} notify={notify} />}
          {activeSection === 'storefront' && <CustomerStorefrontView notify={notify} />}
          {activeSection === 'anime' && (
            <AnimeManagementView
              notify={notify}
              onOpenEpisodesForAnime={(animeId) => {
                setEpisodeTargetAnimeId(animeId);
                setActiveSection('episodes');
              }}
            />
          )}
          {activeSection === 'episodes' && (
            <EpisodeManagementView initialAnimeId={episodeTargetAnimeId} notify={notify} />
          )}
          {activeSection === 'providers' && <StreamingProvidersView notify={notify} />}
          {activeSection === 'storage' && <StorageServersView notify={notify} />}
          {activeSection === 'assets' && <AssetManagementView notify={notify} />}
          {activeSection === 'users' && (
            <UserManagementView
              notify={notify}
              onOpenSettings={() => setActiveSection('settings')}
            />
          )}
          {activeSection === 'websettings' && <WebsiteSettingsView notify={notify} />}
          {activeSection === 'export' && <ExportCentreView notify={notify} />}
          {activeSection === 'treasury' && <TreasuryView notify={notify} />}
          {activeSection === 'analytics' && <AnalyticsView notify={notify} />}
          {activeSection === 'monitoring' && <SystemMonitoringView notify={notify} />}
          {activeSection === 'audit' && <AuditLogsView notify={notify} />}
          {activeSection === 'settings' && <AdminSettingsView admin={admin} notify={notify} />}
        </main>
      </div>

      {/* Non-blocking Toast Feedback Stack */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`pointer-events-auto rounded-md border px-4 py-3 text-xs shadow-xl transition-opacity duration-150 ${
                t.tone === 'error'
                  ? 'border-red-800 bg-[#1A0E12] text-red-200'
                  : t.tone === 'success'
                    ? 'border-emerald-800 bg-[#0D1915] text-emerald-200'
                    : 'border-slate-700 bg-[#111827] text-slate-200'
              }`}
            >
              <div className="font-semibold">{t.title}</div>
              {t.detail && <div className="mt-0.5 text-[11px] opacity-90">{t.detail}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

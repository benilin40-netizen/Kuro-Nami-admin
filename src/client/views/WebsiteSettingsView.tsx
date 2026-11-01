import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Globe,
  Layout,
  Link,
  Lock,
  Palette,
  Save,
  Sliders,
} from 'lucide-react';
import { WebsiteSettingsRecord } from '../../shared/types';
import { apiRequest } from '../api';

export function WebsiteSettingsView({
  notify,
}: {
  notify: (tone: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}) {
  const [settings, setSettings] = useState<WebsiteSettingsRecord | null>(null);
  const [saving, setSaving] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      const res = await apiRequest<WebsiteSettingsRecord>('/api/v1/sync/settings');
      setSettings(res);
    } catch (err) {
      notify('error', 'Failed to load website settings', err instanceof Error ? err.message : undefined);
    }
  }, [notify]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    try {
      const res = await apiRequest<WebsiteSettingsRecord>('/api/v1/sync/settings', {
        method: 'PUT',
        body: settings,
      });
      setSettings(res);
      notify('success', 'Website settings updated successfully');
    } catch (err) {
      notify('error', 'Failed to save website settings', err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return <div className="text-xs text-slate-400 p-6">Loading website settings...</div>;
  }

  return (
    <form onSubmit={handleSaveSettings} className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-100 flex items-center gap-2">
            <Globe className="h-5 w-5 text-sky-400" />
            <span>Website Branding & Content Display Settings</span>
          </h1>
          <p className="mt-0.5 text-xs text-slate-400">
            Manage site name, logo, primary branding color, homepage sections, navigation links, and maintenance mode without touching code.
          </p>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <Save className="h-3.5 w-3.5" />
          <span>{saving ? 'Saving...' : 'Save Website Settings'}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 rounded-lg border border-slate-800 bg-[#111827] p-6 space-y-4">
          <h2 className="font-display text-sm font-semibold text-slate-200">Site Identity & Branding</h2>

          <div>
            <label className="block text-xs font-medium text-slate-300">Website Name</label>
            <input
              type="text"
              required
              value={settings.siteName}
              onChange={(e) => setSettings({ ...settings, siteName: e.target.value })}
              className="mt-1 w-full rounded border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300">Site Logo URL</label>
            <input
              type="text"
              required
              value={settings.siteLogoUrl}
              onChange={(e) => setSettings({ ...settings, siteLogoUrl: e.target.value })}
              className="mt-1 w-full rounded border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300">Primary Branding Color</label>
            <div className="flex items-center gap-3 mt-1">
              <input
                type="color"
                value={settings.primaryColor}
                onChange={(e) => setSettings({ ...settings, primaryColor: e.target.value })}
                className="h-8 w-12 rounded border border-slate-700 bg-[#0B0F17] cursor-pointer"
              />
              <input
                type="text"
                value={settings.primaryColor}
                onChange={(e) => setSettings({ ...settings, primaryColor: e.target.value })}
                className="rounded border border-slate-700 bg-[#0B0F17] px-3 py-1.5 font-mono text-xs text-slate-100 w-32"
              />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800">
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.maintenanceMode}
                onChange={(e) => setSettings({ ...settings, maintenanceMode: e.target.checked })}
                className="rounded border-slate-700 bg-slate-900 text-sky-500"
              />
              <span>Enable Website Maintenance Mode</span>
            </label>
          </div>
        </div>

        <div className="lg:col-span-5 rounded-lg border border-slate-800 bg-[#111827] p-6 space-y-4">
          <h2 className="font-display text-sm font-semibold text-slate-200">Homepage Sections Configuration</h2>

          <div>
            <label className="block text-xs font-medium text-slate-300">Homepage Layout JSON</label>
            <textarea
              rows={8}
              value={settings.homepageSectionsJson}
              onChange={(e) => setSettings({ ...settings, homepageSectionsJson: e.target.value })}
              className="mt-1 w-full rounded border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100 focus:outline-none"
            />
          </div>
        </div>
      </div>
    </form>
  );
}

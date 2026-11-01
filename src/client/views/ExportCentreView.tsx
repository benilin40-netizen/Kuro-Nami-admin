import React, { useState } from 'react';
import {
  Archive,
  CheckSquare,
  Clock,
  Download,
  FileCode,
  FileSpreadsheet,
  FileText,
  Filter,
  ShieldCheck,
  Square,
} from 'lucide-react';
import { apiRequest, downloadTextFile } from '../api';

export function ExportCentreView({
  notify,
}: {
  notify: (tone: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}) {
  const [format, setFormat] = useState<'JSON' | 'CSV' | 'ZIP'>('JSON');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([
    'ANIME',
    'EPISODES',
    'USERS',
    'WEBSITE_SETTINGS',
    'PAYMENTS',
  ]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [exporting, setExporting] = useState(false);

  const ALL_CATEGORIES = [
    { id: 'ANIME', label: 'Anime Catalog & Metadata' },
    { id: 'EPISODES', label: 'Episodes & Provider Streams' },
    { id: 'USERS', label: 'User Directory (Passwords Redacted)' },
    { id: 'USER_ACTIVITY', label: 'Live Activity & Watch History' },
    { id: 'WEBSITE_SETTINGS', label: 'Website Settings & Branding' },
    { id: 'PROVIDERS_STORAGE', label: 'Streaming Providers & Storage' },
    { id: 'PAYMENTS', label: 'Memberships & Multi-Currency Ledger' },
    { id: 'AUDIT', label: 'Financial Audit Logs' },
  ];

  const toggleCategory = (id: string) => {
    if (selectedCategories.includes(id)) {
      setSelectedCategories(selectedCategories.filter((c) => c !== id));
    } else {
      setSelectedCategories([...selectedCategories, id]);
    }
  };

  const selectAllCategories = () => {
    setSelectedCategories(ALL_CATEGORIES.map((c) => c.id));
  };

  const handleExecuteExport = async (e: React.FormEvent) => {
    e.preventDefault();
    setExporting(true);
    try {
      const res = await fetch('/api/v1/sync/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': (window as unknown as { __CSRF_TOKEN__?: string }).__CSRF_TOKEN__ || '',
        },
        body: JSON.stringify({
          exportFormat: format,
          selectedCategories,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
        }),
      });

      if (!res.ok) {
        throw new Error(`Export failed with HTTP status ${res.status}`);
      }

      const text = await res.text();
      const filename = `kuro-nami-backup-${format.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.${
        format === 'CSV' ? 'csv' : 'json'
      }`;

      downloadTextFile(
        filename,
        text,
        format === 'CSV' ? 'text/csv' : 'application/json'
      );

      notify('success', 'Website Data Export Complete', `Generated ${filename} successfully.`);
    } catch (err) {
      notify('error', 'Export failed', err instanceof Error ? err.message : undefined);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-slate-100 flex items-center gap-2">
          <Download className="h-5 w-5 text-sky-400" />
          <span>KURO NAMI Central Export Centre</span>
        </h1>
        <p className="mt-0.5 text-xs text-slate-400">
          Generate complete website backups, anime catalog exports, episode datasets, user directory reports, and financial audit archives.
        </p>
      </div>

      <form onSubmit={handleExecuteExport} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Format & Category Selector */}
        <div className="lg:col-span-8 rounded-lg border border-slate-800 bg-[#111827] p-6 space-y-6">
          {/* Format Selection */}
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-200 mb-3">1. Select Export Format</h2>
            <div className="grid grid-cols-3 gap-3">
              {[
                { id: 'JSON', label: 'JSON Dataset / Backup', icon: FileCode, desc: 'Full structured JSON backup' },
                { id: 'CSV', label: 'CSV Spreadsheet', icon: FileSpreadsheet, desc: 'Tabular data for Excel / Sheets' },
                { id: 'ZIP', label: 'ZIP Archive', icon: Archive, desc: 'Multi-file compressed package' },
              ].map((fmt) => {
                const Icon = fmt.icon;
                const active = format === fmt.id;

                return (
                  <button
                    key={fmt.id}
                    type="button"
                    onClick={() => setFormat(fmt.id as typeof format)}
                    className={`rounded-lg border p-4 text-left transition-all ${
                      active
                        ? 'border-sky-500 bg-sky-950/30 text-slate-100'
                        : 'border-slate-800 bg-[#0B0F17] text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Icon className="h-5 w-5 text-sky-400 mb-2" />
                    <div className="font-semibold text-xs text-slate-100">{fmt.label}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{fmt.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Categories Selection */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display text-sm font-semibold text-slate-200">2. Select Data Categories to Include</h2>
              <button
                type="button"
                onClick={selectAllCategories}
                className="text-xs text-sky-400 hover:underline"
              >
                Select All
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {ALL_CATEGORIES.map((cat) => {
                const checked = selectedCategories.includes(cat.id);

                return (
                  <label
                    key={cat.id}
                    onClick={() => toggleCategory(cat.id)}
                    className={`flex items-center gap-3 rounded-md border p-3 cursor-pointer text-xs transition-colors ${
                      checked ? 'border-sky-800 bg-sky-950/20 text-slate-100' : 'border-slate-800 bg-[#0B0F17] text-slate-400'
                    }`}
                  >
                    {checked ? (
                      <CheckSquare className="h-4 w-4 text-sky-400 shrink-0" />
                    ) : (
                      <Square className="h-4 w-4 text-slate-600 shrink-0" />
                    )}
                    <span>{cat.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Date Range Filters */}
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-200 mb-3">3. Optional Date Range Filter</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Execution & Security Guarantees */}
        <div className="lg:col-span-4 space-y-6">
          <div className="rounded-lg border border-slate-800 bg-[#111827] p-6 space-y-4">
            <h3 className="font-display text-sm font-semibold text-slate-100">Export Security Guarantee</h3>

            <div className="space-y-2 text-xs text-slate-400 leading-relaxed">
              <div className="flex items-start gap-2 text-emerald-400">
                <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
                <span>Password hashes & authentication secrets strictly excluded from exports.</span>
              </div>
              <div className="flex items-start gap-2 text-emerald-400">
                <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
                <span>Payment gateway private keys & raw credit card credentials never exported.</span>
              </div>
              <div className="flex items-start gap-2 text-slate-300">
                <Clock className="h-4 w-4 shrink-0 mt-0.5 text-sky-400" />
                <span>Generated server-side with pagination streaming to handle large datasets.</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={exporting || selectedCategories.length === 0}
              className="w-full rounded-md bg-sky-600 py-3 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Download className="h-4 w-4" />
              <span>{exporting ? 'Generating Export Bundle...' : 'Download Export Bundle'}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Edit3,
  Layers,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {
  AnimeRecord,
  AssetRecord,
  AudioMode,
  EpisodeRecord,
  EpisodeSourceLink,
  StorageServerRecord,
  StreamingProviderRecord,
} from '../../shared/types';
import { apiRequest } from '../api';
import { ConfirmDialog, Modal, TableSkeleton } from '../components/UiPrimitives';

export function EpisodeManagementView({
  initialAnimeId,
  notify,
}: {
  initialAnimeId: string | null;
  notify: (tone: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}) {
  const [animeList, setAnimeList] = useState<AnimeRecord[]>([]);
  const [selectedAnimeId, setSelectedAnimeId] = useState<string>(initialAnimeId || '');
  const [seasonFilter, setSeasonFilter] = useState<string>('');
  const [search, setSearch] = useState('');

  const [episodes, setEpisodes] = useState<EpisodeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [verifyingEpId, setVerifyingEpId] = useState<string | null>(null);

  const [providers, setProviders] = useState<StreamingProviderRecord[]>([]);
  const [storageServers, setStorageServers] = useState<StorageServerRecord[]>([]);
  const [assets, setAssets] = useState<AssetRecord[]>([]);

  // Single Episode Modal
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingEp, setEditingEp] = useState<EpisodeRecord | null>(null);
  const [saving, setSaving] = useState(false);

  const [epAnimeId, setEpAnimeId] = useState('');
  const [seasonNumber, setSeasonNumber] = useState('1');
  const [episodeNumber, setEpisodeNumber] = useState('1');
  const [title, setTitle] = useState('');
  const [upstreamEpisodeId, setUpstreamEpisodeId] = useState('');
  const [releaseDate, setReleaseDate] = useState('');
  const [subtitleLangsInput, setSubtitleLangsInput] = useState('en');
  const [audioStatus, setAudioStatus] = useState<AudioMode>(AudioMode.SUB);
  const [storageServerId, setStorageServerId] = useState('');
  const [thumbnailAssetId, setThumbnailAssetId] = useState('');
  const [subtitleAssetId, setSubtitleAssetId] = useState('');
  const [videoAssetId, setVideoAssetId] = useState('');
  const [sources, setSources] = useState<EpisodeSourceLink[]>([]);

  // Bulk Modal
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkAnimeId, setBulkAnimeId] = useState('');
  const [bulkSeason, setBulkSeason] = useState('1');
  const [bulkStartEp, setBulkStartEp] = useState('1');
  const [bulkEndEp, setBulkEndEp] = useState('12');
  const [bulkAudio, setBulkAudio] = useState<AudioMode>(AudioMode.SUB);
  const [bulkSubs, setBulkSubs] = useState('en');
  const [bulkPrefix, setBulkPrefix] = useState('Episode');
  const [bulkBusy, setBulkBusy] = useState(false);

  // Delete dialog
  const [deletingTarget, setDeletingTarget] = useState<EpisodeRecord | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  useEffect(() => {
    if (initialAnimeId) {
      setSelectedAnimeId(initialAnimeId);
    }
  }, [initialAnimeId]);

  const loadMetadata = useCallback(async () => {
    try {
      const [animeRes, provRes, stgRes, astRes] = await Promise.all([
        apiRequest<{ items: AnimeRecord[] }>('/api/v1/anime?pageSize=100'),
        apiRequest<{ providers: StreamingProviderRecord[] }>('/api/v1/providers'),
        apiRequest<{ servers: StorageServerRecord[] }>('/api/v1/storage'),
        apiRequest<{ items: AssetRecord[] }>('/api/v1/assets'),
      ]);
      setAnimeList(animeRes.items);
      setProviders(provRes.providers);
      setStorageServers(stgRes.servers);
      setAssets(astRes.items);
    } catch {
      // Ignore partial scope limitations
    }
  }, []);

  const loadEpisodes = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (selectedAnimeId) qs.set('animeId', selectedAnimeId);
      if (seasonFilter) qs.set('season', seasonFilter);
      if (search.trim()) qs.set('search', search.trim());

      const res = await apiRequest<{ items: EpisodeRecord[] }>(
        `/api/v1/episodes?${qs.toString()}`
      );
      setEpisodes(res.items);
    } catch (err: unknown) {
      notify('error', 'Failed to load episodes', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [selectedAnimeId, seasonFilter, search, notify]);

  useEffect(() => {
    loadMetadata();
  }, [loadMetadata]);

  useEffect(() => {
    loadEpisodes();
  }, [loadEpisodes]);

  const openCreateEpisode = () => {
    const defaultAnime = selectedAnimeId || animeList[0]?.id || '';
    setEditingEp(null);
    setEpAnimeId(defaultAnime);
    setSeasonNumber(seasonFilter || '1');
    setEpisodeNumber(String(episodes.length + 1));
    setTitle(`Episode ${episodes.length + 1}`);
    setUpstreamEpisodeId('');
    setReleaseDate('');
    setSubtitleLangsInput('en');
    setAudioStatus(AudioMode.SUB);
    setStorageServerId('');
    setThumbnailAssetId('');
    setSubtitleAssetId('');
    setVideoAssetId('');
    setSources([]);
    setEditorOpen(true);
  };

  const openEditEpisode = (ep: EpisodeRecord) => {
    setEditingEp(ep);
    setEpAnimeId(ep.animeId);
    setSeasonNumber(String(ep.seasonNumber));
    setEpisodeNumber(String(ep.episodeNumber));
    setTitle(ep.title);
    setUpstreamEpisodeId(ep.upstreamEpisodeId);
    setReleaseDate(ep.releaseDate || '');
    setSubtitleLangsInput(ep.subtitleLanguages.join(', '));
    setAudioStatus(ep.audioStatus);
    setStorageServerId(ep.storageServerId || '');
    setThumbnailAssetId(ep.thumbnailAssetId || '');
    setSubtitleAssetId(ep.subtitleAssetId || '');
    setVideoAssetId(ep.videoAssetId || '');
    setSources(ep.sources);
    setEditorOpen(true);
  };

  const handleSaveEpisode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!epAnimeId) {
      notify('error', 'Select a parent anime title first');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        animeId: epAnimeId,
        seasonNumber: Number(seasonNumber) || 1,
        episodeNumber: Number(episodeNumber) || 1,
        title,
        upstreamEpisodeId: upstreamEpisodeId.trim() || undefined,
        releaseDate: releaseDate || null,
        subtitleLanguages: subtitleLangsInput
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        audioStatus,
        sources,
        storageServerId: storageServerId || null,
        thumbnailAssetId: thumbnailAssetId || null,
        subtitleAssetId: subtitleAssetId || null,
        videoAssetId: videoAssetId || null,
      };

      if (editingEp) {
        await apiRequest(`/api/v1/episodes/${editingEp.id}`, {
          method: 'PUT',
          body: payload,
        });
        notify('success', 'Episode updated', title);
      } else {
        await apiRequest('/api/v1/episodes', {
          method: 'POST',
          body: payload,
        });
        notify('success', 'Episode created', title);
      }
      setEditorOpen(false);
      await loadEpisodes();
    } catch (err: unknown) {
      notify('error', 'Failed to save episode', err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const handleBulkGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkAnimeId) {
      notify('error', 'Select a target anime title');
      return;
    }
    setBulkBusy(true);
    try {
      const res = await apiRequest<{ createdCount: number }>('/api/v1/episodes/bulk', {
        method: 'POST',
        body: {
          animeId: bulkAnimeId,
          seasonNumber: Number(bulkSeason) || 1,
          startEpisode: Number(bulkStartEp) || 1,
          endEpisode: Number(bulkEndEp) || 1,
          audioStatus: bulkAudio,
          subtitleLanguages: bulkSubs
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          titlePrefix: bulkPrefix,
        },
      });
      notify('success', `Bulk created ${res.createdCount} episodes`);
      setBulkOpen(false);
      await loadEpisodes();
    } catch (err: unknown) {
      notify('error', 'Bulk episode creation failed', err instanceof Error ? err.message : undefined);
    } finally {
      setBulkBusy(false);
    }
  };

  const handleMoveEpisode = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= episodes.length) return;
    const reordered = [...episodes];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
    setEpisodes(reordered);

    try {
      await apiRequest('/api/v1/episodes/reorder', {
        method: 'POST',
        body: { orderedEpisodeIds: reordered.map((e) => e.id) },
      });
      notify('info', 'Episode sequence saved');
    } catch (err: unknown) {
      notify('error', 'Reorder failed', err instanceof Error ? err.message : undefined);
      await loadEpisodes();
    }
  };

  const handleVerifySources = async (epId: string) => {
    setVerifyingEpId(epId);
    try {
      const res = await apiRequest<{ sources: EpisodeSourceLink[] }>(
        `/api/v1/episodes/${epId}/verify-sources`,
        { method: 'POST' }
      );
      const okCount = res.sources.filter((s) => s.availabilityStatus === 'AVAILABLE').length;
      notify(
        okCount === res.sources.length && res.sources.length > 0 ? 'success' : 'info',
        'Source verification complete',
        `${okCount} of ${res.sources.length} source(s) responded available.`
      );
      await loadEpisodes();
    } catch (err: unknown) {
      notify('error', 'Source verification failed', err instanceof Error ? err.message : undefined);
    } finally {
      setVerifyingEpId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingTarget) return;
    setDeletingBusy(true);
    try {
      await apiRequest(`/api/v1/episodes/${deletingTarget.id}`, { method: 'DELETE' });
      notify('success', 'Episode deleted', deletingTarget.title);
      setDeletingTarget(null);
      await loadEpisodes();
    } catch (err: unknown) {
      notify('error', 'Delete failed', err instanceof Error ? err.message : undefined);
    } finally {
      setDeletingBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-100">Episode Management</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            Organize episodes by season, manage sub/dub tracks, verify linked streaming sources,
            and preserve upstream KURO NAMI episode identifiers.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            disabled={animeList.length === 0}
            onClick={() => {
              setBulkAnimeId(selectedAnimeId || animeList[0]?.id || '');
              setBulkOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Bulk Add Range</span>
          </button>
          <button
            type="button"
            disabled={animeList.length === 0}
            onClick={openCreateEpisode}
            className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-40 whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            <span>Add Episode</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="rounded-lg border border-slate-800 bg-[#111827] p-4 flex flex-wrap items-center gap-3">
        <select
          value={selectedAnimeId}
          onChange={(e) => setSelectedAnimeId(e.target.value)}
          className="rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100 focus:border-sky-500 focus:outline-none min-w-[220px]"
        >
          <option value="">All Anime Titles ({animeList.length})</option>
          {animeList.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title} ({a.id})
            </option>
          ))}
        </select>

        <input
          type="number"
          min={1}
          value={seasonFilter}
          onChange={(e) => setSeasonFilter(e.target.value)}
          placeholder="Season #"
          className="w-28 rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
        />

        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search episode title or upstream episode ID..."
            className="w-full rounded-md border border-slate-700 bg-[#0B0F17] pl-9 pr-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Episodes Table */}
      <div className="rounded-lg border border-slate-800 bg-[#111827] overflow-hidden">
        {loading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : animeList.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <h3 className="font-display text-base font-semibold text-slate-200">
              No Anime Titles Available Yet
            </h3>
            <p className="mx-auto mt-1.5 max-w-md text-xs text-slate-400">
              Create or synchronize an anime title in Anime Management first, then attach episodes,
              seasons, and streaming sources here.
            </p>
          </div>
        ) : episodes.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <h3 className="font-display text-base font-semibold text-slate-200">
              No Episodes Found
            </h3>
            <p className="mx-auto mt-1.5 max-w-md text-xs text-slate-400">
              Add individual episodes or use Bulk Add Range to initialize an entire season with
              consistent KURO NAMI episode identifiers.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs text-slate-400">
                  <th className="px-4 py-3 font-medium">Order</th>
                  <th className="px-4 py-3 font-medium">Season / Ep</th>
                  <th className="px-4 py-3 font-medium">Episode & Anime</th>
                  <th className="px-4 py-3 font-medium">Audio & Subtitles</th>
                  <th className="px-4 py-3 font-medium">Linked Sources</th>
                  <th className="px-5 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-sm">
                {episodes.map((ep, idx) => {
                  const availCount = ep.sources.filter(
                    (s) => s.availabilityStatus === 'AVAILABLE'
                  ).length;
                  return (
                    <tr key={ep.id} className="hover:bg-slate-800/30">
                      <td className="px-4 py-3">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => handleMoveEpisode(idx, -1)}
                            title="Move earlier"
                            className="rounded border border-slate-800 p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-30"
                          >
                            <ArrowUp className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === episodes.length - 1}
                            onClick={() => handleMoveEpisode(idx, 1)}
                            title="Move later"
                            className="rounded border border-slate-800 p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-30"
                          >
                            <ArrowDown className="h-3 w-3" />
                          </button>
                        </div>
                      </td>

                      <td className="px-4 py-3 font-mono text-xs text-slate-200 tabular-nums whitespace-nowrap">
                        S{String(ep.seasonNumber).padStart(2, '0')} · E
                        {String(ep.episodeNumber).padStart(2, '0')}
                      </td>

                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-100">{ep.title}</div>
                        <div className="mt-0.5 text-xs text-slate-400">
                          {ep.animeTitle} ·{' '}
                          <span className="font-mono text-slate-500">{ep.upstreamEpisodeId}</span>
                        </div>
                      </td>

                      <td className="px-4 py-3 text-xs text-slate-300">
                        <span>{ep.audioStatus}</span>
                        <span className="mx-1.5 text-slate-600">·</span>
                        <span>Subs: {ep.subtitleLanguages.join(', ') || 'None'}</span>
                        {ep.releaseDate && (
                          <div className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
                            Air: {ep.releaseDate}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3 text-xs">
                        {ep.sources.length === 0 ? (
                          <span className="text-slate-500">0 sources linked</span>
                        ) : (
                          <div className="space-y-0.5">
                            <div className="font-mono text-slate-200 tabular-nums">
                              {ep.sources.length} source(s) · {availCount} verified
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {ep.sources.map((s) => s.providerSlug).join(', ')}
                            </div>
                          </div>
                        )}
                      </td>

                      <td className="px-5 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={ep.sources.length === 0 || verifyingEpId === ep.id}
                            onClick={() => handleVerifySources(ep.id)}
                            className="inline-flex items-center gap-1 rounded border border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
                          >
                            <ShieldCheck className="h-3.5 w-3.5" />
                            <span>
                              {verifyingEpId === ep.id ? 'Probing...' : 'Verify Sources'}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditEpisode(ep)}
                            aria-label="Edit episode"
                            className="rounded border border-slate-700 p-1.5 text-slate-300 hover:bg-slate-800"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingTarget(ep)}
                            aria-label="Delete episode"
                            className="rounded border border-slate-700 p-1.5 text-red-400 hover:bg-red-950/50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Episode Modal */}
      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editingEp ? `Edit Episode: ${editingEp.title}` : 'Add Episode'}
        subtitle="Configure season, episode numbering, audio/subtitle flags, storage routing, and streaming sources."
        maxWidthClass="max-w-3xl"
      >
        <form onSubmit={handleSaveEpisode} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-300">Parent Anime *</label>
              <select
                required
                disabled={Boolean(editingEp)}
                value={epAnimeId}
                onChange={(e) => setEpAnimeId(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100 disabled:opacity-60"
              >
                {animeList.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title} ({a.id})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">Release Date</label>
              <input
                type="date"
                value={releaseDate}
                onChange={(e) => setReleaseDate(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300">Season #</label>
              <input
                type="number"
                min={1}
                required
                value={seasonNumber}
                onChange={(e) => setSeasonNumber(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">Episode #</label>
              <input
                type="number"
                min={1}
                required
                value={episodeNumber}
                onChange={(e) => setEpisodeNumber(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">Sub / Dub Status</label>
              <select
                value={audioStatus}
                onChange={(e) => setAudioStatus(e.target.value as AudioMode)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
              >
                <option value={AudioMode.SUB}>Subbed (SUB)</option>
                <option value={AudioMode.DUB}>Dubbed (DUB)</option>
                <option value={AudioMode.BOTH}>Dual Audio (SUB + DUB)</option>
                <option value={AudioMode.RAW}>Raw</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">Subtitle Languages</label>
              <input
                type="text"
                value={subtitleLangsInput}
                onChange={(e) => setSubtitleLangsInput(e.target.value)}
                placeholder="en, es, ja"
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300">Episode Title *</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">
                Upstream KURO NAMI Episode ID
              </label>
              <input
                type="text"
                value={upstreamEpisodeId}
                onChange={(e) => setUpstreamEpisodeId(e.target.value)}
                placeholder="Auto-derived if left blank"
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100"
              />
            </div>
          </div>

          {/* Storage & Asset Links */}
          <div className="border-t border-slate-800 pt-4 grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] text-slate-400">Storage Destination</label>
              <select
                value={storageServerId}
                onChange={(e) => setStorageServerId(e.target.value)}
                className="mt-1 w-full rounded border border-slate-700 bg-[#0B0F17] px-2 py-1.5 text-xs text-slate-100"
              >
                <option value="">Default Pool</option>
                {storageServers
                  .filter((s) => s.enabled)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-400">Thumbnail Asset</label>
              <select
                value={thumbnailAssetId}
                onChange={(e) => setThumbnailAssetId(e.target.value)}
                className="mt-1 w-full rounded border border-slate-700 bg-[#0B0F17] px-2 py-1.5 text-xs text-slate-100"
              >
                <option value="">None</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.originalFilename}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-400">Subtitle File Asset</label>
              <select
                value={subtitleAssetId}
                onChange={(e) => setSubtitleAssetId(e.target.value)}
                className="mt-1 w-full rounded border border-slate-700 bg-[#0B0F17] px-2 py-1.5 text-xs text-slate-100"
              >
                <option value="">None</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.originalFilename}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-400">Authorized Video Asset</label>
              <select
                value={videoAssetId}
                onChange={(e) => setVideoAssetId(e.target.value)}
                className="mt-1 w-full rounded border border-slate-700 bg-[#0B0F17] px-2 py-1.5 text-xs text-slate-100"
              >
                <option value="">None</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.originalFilename}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Episode Streaming Sources */}
          <div className="border-t border-slate-800 pt-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200">
                Linked Streaming Sources
              </span>
              <button
                type="button"
                onClick={() =>
                  setSources((prev) => [
                    ...prev,
                    {
                      id: `src_${Date.now()}`,
                      providerSlug: providers[0]?.slug || 'animepahe',
                      sourceUrl: '',
                      quality: '1080p',
                      audioType: AudioMode.SUB,
                      availabilityStatus: 'UNVERIFIED',
                      lastCheckedAt: null,
                      responseTimeMs: null,
                    },
                  ])
                }
                className="text-xs font-medium text-sky-400 hover:underline"
              >
                + Link Source URL
              </button>
            </div>

            {sources.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">
                No streaming sources linked yet. Add provider manifest/stream URLs above.
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {sources.map((src, sIdx) => (
                  <div key={src.id} className="grid grid-cols-12 gap-2 items-center">
                    <select
                      value={src.providerSlug}
                      onChange={(e) => {
                        const next = [...sources];
                        next[sIdx] = { ...next[sIdx], providerSlug: e.target.value };
                        setSources(next);
                      }}
                      className="col-span-3 rounded border border-slate-700 bg-[#0B0F17] px-2 py-1.5 text-xs text-slate-100"
                    >
                      {providers.map((p) => (
                        <option key={p.slug} value={p.slug}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="url"
                      required
                      value={src.sourceUrl}
                      onChange={(e) => {
                        const next = [...sources];
                        next[sIdx] = {
                          ...next[sIdx],
                          sourceUrl: e.target.value,
                          availabilityStatus: 'UNVERIFIED',
                        };
                        setSources(next);
                      }}
                      placeholder="https://..."
                      className="col-span-6 rounded border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 font-mono text-xs text-slate-100"
                    />
                    <select
                      value={src.quality}
                      onChange={(e) => {
                        const next = [...sources];
                        next[sIdx] = { ...next[sIdx], quality: e.target.value };
                        setSources(next);
                      }}
                      className="col-span-2 rounded border border-slate-700 bg-[#0B0F17] px-2 py-1.5 font-mono text-xs text-slate-100"
                    >
                      <option value="1080p">1080p</option>
                      <option value="720p">720p</option>
                      <option value="480p">480p</option>
                      <option value="4K">4K</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => setSources(sources.filter((_, i) => i !== sIdx))}
                      className="col-span-1 text-center text-xs text-red-400 hover:text-red-300"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
            <button
              type="button"
              onClick={() => setEditorOpen(false)}
              className="rounded-md border border-slate-700 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-sky-600 px-5 py-2 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {saving ? 'Saving...' : editingEp ? 'Save Episode' : 'Create Episode'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Bulk Episode Range Generator Modal */}
      <Modal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title="Bulk Episode Range Generator"
        subtitle="Generate sequential episode placeholders with deterministic KURO NAMI upstream IDs."
        maxWidthClass="max-w-lg"
      >
        <form onSubmit={handleBulkGenerate} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300">Target Anime *</label>
            <select
              required
              value={bulkAnimeId}
              onChange={(e) => setBulkAnimeId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
            >
              {animeList.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300">Season #</label>
              <input
                type="number"
                min={1}
                required
                value={bulkSeason}
                onChange={(e) => setBulkSeason(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">Start Ep #</label>
              <input
                type="number"
                min={1}
                required
                value={bulkStartEp}
                onChange={(e) => setBulkStartEp(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">End Ep #</label>
              <input
                type="number"
                min={1}
                required
                value={bulkEndEp}
                onChange={(e) => setBulkEndEp(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300">Audio Mode</label>
              <select
                value={bulkAudio}
                onChange={(e) => setBulkAudio(e.target.value as AudioMode)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
              >
                <option value={AudioMode.SUB}>SUB</option>
                <option value={AudioMode.DUB}>DUB</option>
                <option value={AudioMode.BOTH}>SUB + DUB</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">Title Prefix</label>
              <input
                type="text"
                value={bulkPrefix}
                onChange={(e) => setBulkPrefix(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300">Subtitle Languages</label>
            <input
              type="text"
              value={bulkSubs}
              onChange={(e) => setBulkSubs(e.target.value)}
              placeholder="en"
              className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
            />
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
            <button
              type="button"
              onClick={() => setBulkOpen(false)}
              className="rounded-md border border-slate-700 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={bulkBusy}
              className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>{bulkBusy ? 'Generating...' : 'Generate Episodes'}</span>
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deletingTarget)}
        onCancel={() => setDeletingTarget(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Episode"
        description={`Delete Episode ${deletingTarget?.episodeNumber} ("${deletingTarget?.title}")?`}
        confirmLabel="Delete Episode"
        destructive
        busy={deletingBusy}
      />
    </div>
  );
}

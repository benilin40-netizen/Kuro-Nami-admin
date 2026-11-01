import React, { useCallback, useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Edit3,
  Film,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  AnimeRecord,
  AnimeSeasonItem,
  AnimeStatus,
  AssetCategory,
  AssetRecord,
  StorageServerRecord,
} from '../../shared/types';
import { apiRequest } from '../api';
import {
  AuthenticatedAssetThumb,
  ConfirmDialog,
  Modal,
  TableSkeleton,
} from '../components/UiPrimitives';

interface AnimeListResponse {
  items: AnimeRecord[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export function AnimeManagementView({
  onOpenEpisodesForAnime,
  notify,
}: {
  onOpenEpisodesForAnime: (animeId: string) => void;
  notify: (tone: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}) {
  const [items, setItems] = useState<AnimeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [yearFilter, setYearFilter] = useState('');
  const [genreFilter, setGenreFilter] = useState('');
  const [sortBy, setSortBy] = useState('updated_at');

  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [storageServers, setStorageServers] = useState<StorageServerRecord[]>([]);

  // Modal state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingAnime, setEditingAnime] = useState<AnimeRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingField, setUploadingField] = useState<'poster' | 'background' | null>(null);

  // Form fields
  const [title, setTitle] = useState('');
  const [synopsis, setSynopsis] = useState('');
  const [romajiTitle, setRomajiTitle] = useState('');
  const [englishTitle, setEnglishTitle] = useState('');
  const [nativeTitle, setNativeTitle] = useState('');
  const [synonymsInput, setSynonymsInput] = useState('');
  const [genresInput, setGenresInput] = useState('');
  const [studiosInput, setStudiosInput] = useState('');
  const [releaseYear, setReleaseYear] = useState('');
  const [status, setStatus] = useState<AnimeStatus>(AnimeStatus.ONGOING);
  const [ratingValue, setRatingValue] = useState('');
  const [ratingSource, setRatingSource] = useState('');
  const [seasons, setSeasons] = useState<AnimeSeasonItem[]>([
    { seasonNumber: 1, title: 'Season 1', episodeCount: 12, releaseYear: null },
  ]);
  const [upstreamKuroNamiId, setUpstreamKuroNamiId] = useState('');
  const [anilistId, setAnilistId] = useState('');
  const [malId, setMalId] = useState('');
  const [kitsuId, setKitsuId] = useState('');
  const [anidbId, setAnidbId] = useState('');
  const [posterAssetId, setPosterAssetId] = useState('');
  const [backgroundAssetId, setBackgroundAssetId] = useState('');
  const [storageServerId, setStorageServerId] = useState('');

  // Delete confirmation
  const [deletingTarget, setDeletingTarget] = useState<AnimeRecord | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const loadAnime = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        pageSize: '15',
        sortBy,
        sortDir: sortBy === 'title' ? 'asc' : 'desc',
      });
      if (search.trim()) qs.set('search', search.trim());
      if (statusFilter !== 'ALL') qs.set('status', statusFilter);
      if (yearFilter.trim()) qs.set('year', yearFilter.trim());
      if (genreFilter.trim()) qs.set('genre', genreFilter.trim());

      const res = await apiRequest<AnimeListResponse>(`/api/v1/anime?${qs.toString()}`);
      setItems(res.items);
      setTotalPages(res.pagination.totalPages);
      setTotalCount(res.pagination.total);
    } catch (err: unknown) {
      notify('error', 'Failed to load anime catalog', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [page, sortBy, search, statusFilter, yearFilter, genreFilter, notify]);

  const loadSupportingLists = useCallback(async () => {
    try {
      const [assetsRes, storageRes] = await Promise.all([
        apiRequest<{ items: AssetRecord[] }>('/api/v1/assets'),
        apiRequest<{ servers: StorageServerRecord[] }>('/api/v1/storage'),
      ]);
      setAssets(assetsRes.items);
      setStorageServers(storageRes.servers);
    } catch {
      // Non-fatal if user lacks infra/assets scope
    }
  }, []);

  useEffect(() => {
    loadAnime();
  }, [loadAnime]);

  useEffect(() => {
    loadSupportingLists();
  }, [loadSupportingLists]);

  const openCreateModal = () => {
    setEditingAnime(null);
    setTitle('');
    setSynopsis('');
    setRomajiTitle('');
    setEnglishTitle('');
    setNativeTitle('');
    setSynonymsInput('');
    setGenresInput('');
    setStudiosInput('');
    setReleaseYear('');
    setStatus(AnimeStatus.ONGOING);
    setRatingValue('');
    setRatingSource('');
    setSeasons([{ seasonNumber: 1, title: 'Season 1', episodeCount: 0, releaseYear: null }]);
    setUpstreamKuroNamiId('');
    setAnilistId('');
    setMalId('');
    setKitsuId('');
    setAnidbId('');
    setPosterAssetId('');
    setBackgroundAssetId('');
    setStorageServerId('');
    setEditorOpen(true);
  };

  const openEditModal = (record: AnimeRecord) => {
    setEditingAnime(record);
    setTitle(record.title);
    setSynopsis(record.synopsis);
    setRomajiTitle(record.alternativeTitles.romaji);
    setEnglishTitle(record.alternativeTitles.english);
    setNativeTitle(record.alternativeTitles.native);
    setSynonymsInput(record.alternativeTitles.synonyms.join(', '));
    setGenresInput(record.genres.join(', '));
    setStudiosInput(record.studios.join(', '));
    setReleaseYear(record.releaseYear ? String(record.releaseYear) : '');
    setStatus(record.status);
    setRatingValue(record.ratingValue !== null ? String(record.ratingValue) : '');
    setRatingSource(record.ratingSource);
    setSeasons(
      record.seasons.length > 0
        ? record.seasons
        : [{ seasonNumber: 1, title: 'Season 1', episodeCount: 0, releaseYear: record.releaseYear }]
    );
    setUpstreamKuroNamiId(record.externalIds.upstreamKuroNamiId);
    setAnilistId(record.externalIds.anilistId);
    setMalId(record.externalIds.malId);
    setKitsuId(record.externalIds.kitsuId);
    setAnidbId(record.externalIds.anidbId);
    setPosterAssetId(record.posterAssetId || '');
    setBackgroundAssetId(record.backgroundAssetId || '');
    setStorageServerId(record.storageServerId || '');
    setEditorOpen(true);
  };

  const handleDirectImageUpload = async (
    file: File,
    target: 'poster' | 'background'
  ) => {
    setUploadingField(target);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append(
        'category',
        target === 'poster' ? AssetCategory.ANIME_POSTER : AssetCategory.BACKGROUND_ARTWORK
      );
      if (storageServerId) {
        fd.append('storageServerId', storageServerId);
      }

      const uploaded = await apiRequest<{ id: string; originalFilename: string }>(
        '/api/v1/assets/upload',
        {
          method: 'POST',
          body: fd,
          isFormData: true,
        }
      );

      await loadSupportingLists();
      if (target === 'poster') {
        setPosterAssetId(uploaded.id);
      } else {
        setBackgroundAssetId(uploaded.id);
      }
      notify('success', 'Artwork uploaded', uploaded.originalFilename);
    } catch (err: unknown) {
      notify('error', 'Artwork upload failed', err instanceof Error ? err.message : undefined);
    } finally {
      setUploadingField(null);
    }
  };

  const handleSaveAnime = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        title,
        synopsis,
        alternativeTitles: {
          romaji: romajiTitle,
          english: englishTitle,
          native: nativeTitle,
          synonyms: synonymsInput
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        },
        genres: genresInput
          .split(',')
          .map((g) => g.trim())
          .filter(Boolean),
        studios: studiosInput
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        releaseYear: releaseYear ? Number(releaseYear) : null,
        status,
        ratingValue: ratingValue !== '' ? Number(ratingValue) : null,
        ratingSource,
        seasons,
        externalIds: {
          upstreamKuroNamiId,
          anilistId,
          malId,
          kitsuId,
          anidbId,
        },
        posterAssetId: posterAssetId || null,
        backgroundAssetId: backgroundAssetId || null,
        storageServerId: storageServerId || null,
      };

      if (editingAnime) {
        await apiRequest(`/api/v1/anime/${editingAnime.id}`, {
          method: 'PUT',
          body: payload,
        });
        notify('success', 'Anime metadata updated', title);
      } else {
        await apiRequest('/api/v1/anime', {
          method: 'POST',
          body: payload,
        });
        notify('success', 'Anime added to workspace catalog', title);
      }
      setEditorOpen(false);
      await loadAnime();
    } catch (err: unknown) {
      notify('error', 'Unable to save anime', err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingTarget) return;
    setDeletingBusy(true);
    try {
      await apiRequest(`/api/v1/anime/${deletingTarget.id}`, { method: 'DELETE' });
      notify('success', 'Anime deleted', deletingTarget.title);
      setDeletingTarget(null);
      await loadAnime();
    } catch (err: unknown) {
      notify('error', 'Failed to delete anime', err instanceof Error ? err.message : undefined);
    } finally {
      setDeletingBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-100">Anime Management</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            Manage authoritative metadata, external provider identifiers (AniList, MAL, Kitsu),
            artwork assets, and seasons without conflating internal KURO NAMI IDs.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 rounded-md bg-sky-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-sky-500 whitespace-nowrap shrink-0 self-start"
        >
          <Plus className="h-4 w-4" />
          <span>Add Anime Title</span>
        </button>
      </div>

      {/* Search, Filter & Sort Toolbar */}
      <div className="rounded-lg border border-slate-800 bg-[#111827] p-4 flex flex-col xl:flex-row gap-3 xl:items-center xl:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search title, internal ID, AniList ID, studio..."
              className="w-full rounded-md border border-slate-700 bg-[#0B0F17] pl-9 pr-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <input
            type="number"
            value={yearFilter}
            onChange={(e) => {
              setYearFilter(e.target.value);
              setPage(1);
            }}
            placeholder="Year"
            className="w-24 rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs font-mono text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
          />

          <input
            type="text"
            value={genreFilter}
            onChange={(e) => {
              setGenreFilter(e.target.value);
              setPage(1);
            }}
            placeholder="Filter genre"
            className="w-32 rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-md bg-[#0B0F17] p-1 border border-slate-800">
            {['ALL', 'ONGOING', 'COMPLETED', 'UPCOMING', 'HIATUS'].map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => {
                  setStatusFilter(st);
                  setPage(1);
                }}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                  statusFilter === st
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {st === 'ALL' ? 'All' : st.charAt(0) + st.slice(1).toLowerCase()}
              </button>
            ))}
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
          >
            <option value="updated_at">Sort: Recently Updated</option>
            <option value="title">Sort: Title (A–Z)</option>
            <option value="release_year">Sort: Release Year</option>
            <option value="rating_value">Sort: Rating</option>
          </select>
        </div>
      </div>

      {/* Catalog Table */}
      <div className="rounded-lg border border-slate-800 bg-[#111827] overflow-hidden">
        {loading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : items.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <h3 className="font-display text-base font-semibold text-slate-200">
              No Anime Titles in Workspace Catalog
            </h3>
            <p className="mx-auto mt-1.5 max-w-lg text-xs leading-relaxed text-slate-400">
              KURO NAMI ADMIN does not pre-populate fabricated anime titles. Connect the main KURO
              NAMI backend in Admin Settings to synchronize authoritative titles, or stage a new
              anime record directly.
            </p>
            <button
              type="button"
              onClick={openCreateModal}
              className="mt-5 inline-flex items-center gap-2 rounded-md bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-500"
            >
              <Plus className="h-4 w-4" />
              <span>Add First Anime Title</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs text-slate-400">
                  <th className="px-5 py-3 font-medium">Title & Studios</th>
                  <th className="px-4 py-3 font-medium">Identifiers</th>
                  <th className="px-4 py-3 font-medium">Metadata</th>
                  <th className="px-4 py-3 font-medium text-right">Seasons / Eps</th>
                  <th className="px-4 py-3 font-medium text-right">Rating</th>
                  <th className="px-5 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-sm">
                {items.map((anime) => (
                  <tr key={anime.id} className="hover:bg-slate-800/30">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <AuthenticatedAssetThumb
                          assetId={anime.posterAssetId}
                          alt={anime.title}
                          className="h-12 w-9"
                        />
                        <div className="min-w-0">
                          <div className="font-medium text-slate-100 truncate max-w-xs">
                            {anime.title}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-400 truncate max-w-xs">
                            {anime.studios.length > 0 ? anime.studios.join(', ') : 'No studio set'}
                            {anime.genres.length > 0 && ` · ${anime.genres.slice(0, 3).join(', ')}`}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3 font-mono text-xs tabular-nums">
                      <div className="text-slate-200">ID: {anime.id}</div>
                      <div className="mt-0.5 text-slate-400">
                        {anime.externalIds.anilistId
                          ? `AniList: ${anime.externalIds.anilistId}`
                          : 'AniList: —'}
                        {anime.externalIds.upstreamKuroNamiId
                          ? ` · KN: ${anime.externalIds.upstreamKuroNamiId}`
                          : ''}
                      </div>
                    </td>

                    <td className="px-4 py-3 text-xs text-slate-300">
                      <span>{anime.status}</span>
                      <span className="mx-1.5 text-slate-600">·</span>
                      <span className="font-mono tabular-nums">
                        {anime.releaseYear || 'Year TBD'}
                      </span>
                      <div className="mt-0.5 text-slate-500">{anime.syncState}</div>
                    </td>

                    <td className="px-4 py-3 text-right font-mono text-xs text-slate-300 tabular-nums">
                      {anime.seasons.length}S · {anime.episodeCount ?? 0} EP
                    </td>

                    <td className="px-4 py-3 text-right font-mono text-xs text-slate-300 tabular-nums">
                      {anime.ratingValue !== null ? (
                        <div>
                          <span className="font-semibold text-slate-100">
                            {anime.ratingValue.toFixed(1)}
                          </span>
                          {anime.ratingSource && (
                            <div className="text-[11px] font-sans text-slate-500">
                              {anime.ratingSource}
                            </div>
                          )}
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>

                    <td className="px-5 py-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onOpenEpisodesForAnime(anime.id)}
                          title="Manage Episodes"
                          className="inline-flex items-center gap-1 rounded border border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
                        >
                          <Film className="h-3.5 w-3.5" />
                          <span>Episodes</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditModal(anime)}
                          aria-label={`Edit ${anime.title}`}
                          className="rounded border border-slate-700 p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingTarget(anime)}
                          aria-label={`Delete ${anime.title}`}
                          className="rounded border border-slate-700 p-1.5 text-red-400 hover:bg-red-950/50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {totalCount > 0 && (
          <div className="flex items-center justify-between border-t border-slate-800 px-5 py-3 text-xs text-slate-400">
            <span className="font-mono tabular-nums">
              Total records: {totalCount} · Page {page} of {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="inline-flex items-center gap-1 rounded border border-slate-700 px-2.5 py-1 text-slate-200 hover:bg-slate-800 disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                <span>Prev</span>
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="inline-flex items-center gap-1 rounded border border-slate-700 px-2.5 py-1 text-slate-200 hover:bg-slate-800 disabled:opacity-40"
              >
                <span>Next</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add / Edit Anime Modal */}
      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editingAnime ? `Edit Anime: ${editingAnime.title}` : 'Add Anime Title'}
        subtitle={
          editingAnime
            ? `Internal Admin ID: ${editingAnime.id} (kept strictly separate from AniList & upstream IDs)`
            : 'Configure metadata, external identifiers, seasons, and storage assignments.'
        }
        maxWidthClass="max-w-3xl"
      >
        <form onSubmit={handleSaveAnime} className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-300">Primary Title *</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Sousou no Frieren"
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as AnimeStatus)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              >
                <option value={AnimeStatus.ONGOING}>Ongoing</option>
                <option value={AnimeStatus.COMPLETED}>Completed</option>
                <option value={AnimeStatus.UPCOMING}>Upcoming</option>
                <option value={AnimeStatus.HIATUS}>Hiatus</option>
              </select>
            </div>
          </div>

          {/* Alternative Titles */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300">Romaji Title</label>
              <input
                type="text"
                value={romajiTitle}
                onChange={(e) => setRomajiTitle(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">English Title</label>
              <input
                type="text"
                value={englishTitle}
                onChange={(e) => setEnglishTitle(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">Native Title</label>
              <input
                type="text"
                value={nativeTitle}
                onChange={(e) => setNativeTitle(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300">
              Synonyms (comma-separated)
            </label>
            <input
              type="text"
              value={synonymsInput}
              onChange={(e) => setSynonymsInput(e.target.value)}
              placeholder="Alt title 1, Alt title 2"
              className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300">Synopsis</label>
            <textarea
              rows={3}
              value={synopsis}
              onChange={(e) => setSynopsis(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
            />
          </div>

          {/* Genres, Studios, Year, Sourced Rating */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300">
                Genres (comma-separated)
              </label>
              <input
                type="text"
                value={genresInput}
                onChange={(e) => setGenresInput(e.target.value)}
                placeholder="Action, Fantasy, Drama"
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">
                Animation Studios (comma-separated)
              </label>
              <input
                type="text"
                value={studiosInput}
                onChange={(e) => setStudiosInput(e.target.value)}
                placeholder="Madhouse, MAPPA"
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300">Release Year</label>
              <input
                type="number"
                min={1960}
                max={2035}
                value={releaseYear}
                onChange={(e) => setReleaseYear(e.target.value)}
                placeholder="2026"
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs font-mono text-slate-100 focus:border-sky-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">
                Rating (0–10, if sourced)
              </label>
              <input
                type="number"
                step="0.1"
                min={0}
                max={10}
                value={ratingValue}
                onChange={(e) => setRatingValue(e.target.value)}
                placeholder="8.7"
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs font-mono text-slate-100 focus:border-sky-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">Rating Source</label>
              <input
                type="text"
                value={ratingSource}
                onChange={(e) => setRatingSource(e.target.value)}
                placeholder="AniList / MAL / Upstream"
                className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
              />
            </div>
          </div>

          {/* External Identifiers (Distinct from internal ID) */}
          <div className="border-t border-slate-800 pt-4">
            <div className="text-xs font-semibold text-slate-200">
              External & Authoritative Identifiers
            </div>
            <p className="text-[11px] text-slate-400">
              Stored separately from internal KURO NAMI ADMIN record IDs to guarantee clean upstream
              synchronization.
            </p>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div>
                <label className="block text-[11px] text-slate-400">Main KURO NAMI ID</label>
                <input
                  type="text"
                  value={upstreamKuroNamiId}
                  onChange={(e) => setUpstreamKuroNamiId(e.target.value)}
                  placeholder="Upstream ID"
                  className="mt-1 w-full rounded border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 font-mono text-xs text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400">AniList ID</label>
                <input
                  type="text"
                  value={anilistId}
                  onChange={(e) => setAnilistId(e.target.value)}
                  placeholder="e.g. 154587"
                  className="mt-1 w-full rounded border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 font-mono text-xs text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400">MyAnimeList ID</label>
                <input
                  type="text"
                  value={malId}
                  onChange={(e) => setMalId(e.target.value)}
                  placeholder="e.g. 52991"
                  className="mt-1 w-full rounded border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 font-mono text-xs text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400">Kitsu ID</label>
                <input
                  type="text"
                  value={kitsuId}
                  onChange={(e) => setKitsuId(e.target.value)}
                  placeholder="Kitsu ID"
                  className="mt-1 w-full rounded border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 font-mono text-xs text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400">AniDB ID</label>
                <input
                  type="text"
                  value={anidbId}
                  onChange={(e) => setAnidbId(e.target.value)}
                  placeholder="AniDB ID"
                  className="mt-1 w-full rounded border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 font-mono text-xs text-slate-100"
                />
              </div>
            </div>
          </div>

          {/* Poster, Background Artwork & Storage Server Assignment */}
          <div className="border-t border-slate-800 pt-4 space-y-3">
            <div className="text-xs font-semibold text-slate-200">
              Artwork Assets & Storage Pool Assignment
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-[11px] text-slate-400">
                  Target Storage Pool Server
                </label>
                <select
                  value={storageServerId}
                  onChange={(e) => setStorageServerId(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-700 bg-[#0B0F17] px-2.5 py-2 text-xs text-slate-100"
                >
                  <option value="">Default Local Staging Buffer</option>
                  {storageServers
                    .filter((s) => s.enabled)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.adapterType})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400">Poster Artwork</label>
                <div className="mt-1 flex items-center gap-2">
                  <select
                    value={posterAssetId}
                    onChange={(e) => setPosterAssetId(e.target.value)}
                    className="flex-1 rounded border border-slate-700 bg-[#0B0F17] px-2 py-2 text-xs text-slate-100 truncate"
                  >
                    <option value="">None</option>
                    {assets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.originalFilename}
                      </option>
                    ))}
                  </select>
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-slate-700 px-2.5 py-2 text-xs text-slate-200 hover:bg-slate-800 shrink-0">
                    <Upload className="h-3.5 w-3.5" />
                    <span>{uploadingField === 'poster' ? '...' : 'Upload'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleDirectImageUpload(f, 'poster');
                      }}
                    />
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400">Background Artwork</label>
                <div className="mt-1 flex items-center gap-2">
                  <select
                    value={backgroundAssetId}
                    onChange={(e) => setBackgroundAssetId(e.target.value)}
                    className="flex-1 rounded border border-slate-700 bg-[#0B0F17] px-2 py-2 text-xs text-slate-100 truncate"
                  >
                    <option value="">None</option>
                    {assets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.originalFilename}
                      </option>
                    ))}
                  </select>
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-slate-700 px-2.5 py-2 text-xs text-slate-200 hover:bg-slate-800 shrink-0">
                    <Upload className="h-3.5 w-3.5" />
                    <span>{uploadingField === 'background' ? '...' : 'Upload'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleDirectImageUpload(f, 'background');
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Seasons Management */}
          <div className="border-t border-slate-800 pt-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200">Anime Seasons</span>
              <button
                type="button"
                onClick={() =>
                  setSeasons((prev) => [
                    ...prev,
                    {
                      seasonNumber: prev.length + 1,
                      title: `Season ${prev.length + 1}`,
                      episodeCount: 0,
                      releaseYear: releaseYear ? Number(releaseYear) : null,
                    },
                  ])
                }
                className="text-xs font-medium text-sky-400 hover:underline"
              >
                + Add Season
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {seasons.map((s, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <input
                    type="number"
                    min={1}
                    value={s.seasonNumber}
                    onChange={(e) => {
                      const next = [...seasons];
                      next[idx] = { ...next[idx], seasonNumber: Number(e.target.value) || 1 };
                      setSeasons(next);
                    }}
                    className="col-span-2 rounded border border-slate-700 bg-[#0B0F17] px-2 py-1.5 font-mono text-xs text-slate-100"
                    placeholder="S#"
                  />
                  <input
                    type="text"
                    value={s.title}
                    onChange={(e) => {
                      const next = [...seasons];
                      next[idx] = { ...next[idx], title: e.target.value };
                      setSeasons(next);
                    }}
                    className="col-span-6 rounded border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 text-xs text-slate-100"
                    placeholder="Season title"
                  />
                  <input
                    type="number"
                    min={0}
                    value={s.episodeCount}
                    onChange={(e) => {
                      const next = [...seasons];
                      next[idx] = { ...next[idx], episodeCount: Number(e.target.value) || 0 };
                      setSeasons(next);
                    }}
                    className="col-span-3 rounded border border-slate-700 bg-[#0B0F17] px-2 py-1.5 font-mono text-xs text-slate-100"
                    placeholder="Planned Eps"
                  />
                  <button
                    type="button"
                    disabled={seasons.length <= 1}
                    onClick={() => setSeasons(seasons.filter((_, i) => i !== idx))}
                    className="col-span-1 text-center text-xs text-red-400 hover:text-red-300 disabled:opacity-30"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
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
              {saving ? 'Saving...' : editingAnime ? 'Update Anime' : 'Create Anime'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deletingTarget)}
        onCancel={() => setDeletingTarget(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Anime Title"
        description={`Delete "${deletingTarget?.title}" and all associated episodes from this workspace? This action will be recorded in the immutable audit log.`}
        confirmLabel="Delete Anime"
        destructive
        busy={deletingBusy}
      />
    </div>
  );
}

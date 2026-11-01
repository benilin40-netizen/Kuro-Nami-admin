import React, { useCallback, useEffect, useState } from 'react';
import {
  Download,
  FolderOpen,
  Lock,
  RefreshCw,
  Replace,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  AssetCategory,
  AssetRecord,
  StorageServerRecord,
} from '../../shared/types';
import {
  apiRequest,
  fetchAuthenticatedAssetObjectUrl,
  formatBytes,
  formatTimestamp,
} from '../api';
import {
  AuthenticatedAssetThumb,
  ConfirmDialog,
  Modal,
  TableSkeleton,
} from '../components/UiPrimitives';

const CATEGORY_LABELS: Record<AssetCategory, string> = {
  [AssetCategory.ANIME_POSTER]: 'Anime Poster',
  [AssetCategory.BACKGROUND_ARTWORK]: 'Background Artwork',
  [AssetCategory.PROMOTIONAL_ARTWORK]: 'Promotional Artwork',
  [AssetCategory.THUMBNAIL]: 'Episode Thumbnail',
  [AssetCategory.SUBTITLE]: 'Subtitle Track',
  [AssetCategory.AUTHORIZED_VIDEO]: 'Authorized Video',
  [AssetCategory.OTHER_MEDIA]: 'Other Media',
};

export function AssetManagementView({
  notify,
}: {
  notify: (tone: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}) {
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [storageServers, setStorageServers] = useState<StorageServerRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');

  // Upload modal
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadCategory, setUploadCategory] = useState<AssetCategory>(AssetCategory.ANIME_POSTER);
  const [uploadStorageId, setUploadStorageId] = useState('');
  const [uploading, setUploading] = useState(false);

  // Organize / Reassign modal
  const [organizingAsset, setOrganizingAsset] = useState<AssetRecord | null>(null);
  const [orgCategory, setOrgCategory] = useState<AssetCategory>(AssetCategory.OTHER_MEDIA);
  const [orgStorageId, setOrgStorageId] = useState('');
  const [orgBusy, setOrgBusy] = useState(false);

  // Replace file state
  const [replacingId, setReplacingId] = useState<string | null>(null);

  // Delete dialog
  const [deletingTarget, setDeletingTarget] = useState<AssetRecord | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const loadAssets = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (categoryFilter !== 'ALL') qs.set('category', categoryFilter);
      if (search.trim()) qs.set('search', search.trim());

      const [astRes, stgRes] = await Promise.all([
        apiRequest<{ items: AssetRecord[] }>(`/api/v1/assets?${qs.toString()}`),
        apiRequest<{ servers: StorageServerRecord[] }>('/api/v1/storage'),
      ]);
      setAssets(astRes.items);
      setStorageServers(stgRes.servers);
    } catch (err: unknown) {
      notify('error', 'Failed to load assets', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, search, notify]);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      notify('error', 'Choose a file to upload');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', selectedFile);
      fd.append('category', uploadCategory);
      if (uploadStorageId) {
        fd.append('storageServerId', uploadStorageId);
      }

      await apiRequest('/api/v1/assets/upload', {
        method: 'POST',
        body: fd,
        isFormData: true,
      });

      notify('success', 'Asset uploaded and indexed', selectedFile.name);
      setUploadOpen(false);
      setSelectedFile(null);
      await loadAssets();
    } catch (err: unknown) {
      notify('error', 'Upload failed', err instanceof Error ? err.message : undefined);
    } finally {
      setUploading(false);
    }
  };

  const handleReplaceFile = async (assetId: string, file: File) => {
    setReplacingId(assetId);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await apiRequest(`/api/v1/assets/${assetId}/replace`, {
        method: 'POST',
        body: fd,
        isFormData: true,
      });
      notify('success', 'Asset binary replaced', file.name);
      await loadAssets();
    } catch (err: unknown) {
      notify('error', 'Replacement failed', err instanceof Error ? err.message : undefined);
    } finally {
      setReplacingId(null);
    }
  };

  const handleSaveOrganize = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organizingAsset) return;
    setOrgBusy(true);
    try {
      await apiRequest(`/api/v1/assets/${organizingAsset.id}`, {
        method: 'PATCH',
        body: {
          category: orgCategory,
          storageServerId: orgStorageId || null,
        },
      });
      notify('success', 'Asset destination & category updated');
      setOrganizingAsset(null);
      await loadAssets();
    } catch (err: unknown) {
      notify('error', 'Failed to organize asset', err instanceof Error ? err.message : undefined);
    } finally {
      setOrgBusy(false);
    }
  };

  const handleDownloadAsset = async (asset: AssetRecord) => {
    const blobUrl = await fetchAuthenticatedAssetObjectUrl(asset.id);
    if (!blobUrl) {
      notify('error', 'Unable to retrieve stored asset binary');
      return;
    }
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = asset.originalFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
  };

  const handleConfirmDelete = async () => {
    if (!deletingTarget) return;
    setDeletingBusy(true);
    try {
      await apiRequest(`/api/v1/assets/${deletingTarget.id}`, { method: 'DELETE' });
      notify('success', 'Asset deleted', deletingTarget.originalFilename);
      setDeletingTarget(null);
      await loadAssets();
    } catch (err: unknown) {
      notify('error', 'Deletion blocked', err instanceof Error ? err.message : undefined);
      setDeletingTarget(null);
    } finally {
      setDeletingBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-100">Asset Management</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            Centralized repository for anime posters, background artwork, promotional banners,
            episode thumbnails, subtitles, and authorized video assets. Assets referenced by active
            catalog items are protected from deletion.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={loadAssets}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-500 whitespace-nowrap"
          >
            <Upload className="h-4 w-4" />
            <span>Upload Asset</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="rounded-lg border border-slate-800 bg-[#111827] p-4 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search filename, MIME type, storage server, or asset ID..."
            className="w-full rounded-md border border-slate-700 bg-[#0B0F17] pl-9 pr-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
          />
        </div>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
        >
          <option value="ALL">All Asset Categories</option>
          {Object.entries(CATEGORY_LABELS).map(([val, label]) => (
            <option key={val} value={val}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* Assets Table */}
      <div className="rounded-lg border border-slate-800 bg-[#111827] overflow-hidden">
        {loading ? (
          <TableSkeleton rows={4} cols={5} />
        ) : assets.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <FolderOpen className="mx-auto h-7 w-7 text-slate-600" />
            <h3 className="mt-3 font-display text-base font-semibold text-slate-200">
              No Media Assets Uploaded Yet
            </h3>
            <p className="mx-auto mt-1.5 max-w-md text-xs text-slate-400">
              Upload posters, background artwork, thumbnails, subtitle tracks (.vtt/.srt), or
              authorized video files and route them to any enabled Storage Pool node.
            </p>
            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              className="mt-5 inline-flex items-center gap-2 rounded-md bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-500"
            >
              <Upload className="h-4 w-4" />
              <span>Upload First Asset</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs text-slate-400">
                  <th className="px-5 py-3 font-medium">Asset & Preview</th>
                  <th className="px-4 py-3 font-medium">Category & MIME</th>
                  <th className="px-4 py-3 font-medium">Storage Destination</th>
                  <th className="px-4 py-3 font-medium">Status & References</th>
                  <th className="px-4 py-3 font-medium text-right">Size & Uploaded</th>
                  <th className="px-5 py-3 font-medium text-right">Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-sm">
                {assets.map((asset) => {
                  const isImage = asset.mimeType.startsWith('image/');
                  const inUse = (asset.inUseReferences?.length || 0) > 0;
                  return (
                    <tr key={asset.id} className="hover:bg-slate-800/30">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          {isImage ? (
                            <AuthenticatedAssetThumb
                              assetId={asset.id}
                              alt={asset.originalFilename}
                              className="h-10 w-10"
                            />
                          ) : (
                            <div className="flex h-10 w-10 items-center justify-center rounded border border-slate-800 bg-slate-900 font-mono text-[10px] text-slate-400 shrink-0">
                              FILE
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="font-medium text-slate-100 truncate max-w-[210px]">
                              {asset.originalFilename}
                            </div>
                            <div className="font-mono text-[11px] text-slate-500 truncate max-w-[210px]">
                              {asset.id} · sha256:{asset.checksumSha256.slice(0, 10)}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3 text-xs">
                        <div className="text-slate-200">{CATEGORY_LABELS[asset.category]}</div>
                        <div className="mt-0.5 font-mono text-slate-500">{asset.mimeType}</div>
                      </td>

                      <td className="px-4 py-3 text-xs text-slate-300">
                        {asset.storageServerName || 'Local Staging Buffer'}
                      </td>

                      <td className="px-4 py-3 text-xs">
                        <div className="text-emerald-400 font-medium">{asset.uploadStatus}</div>
                        {inUse ? (
                          <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-amber-300">
                            <Lock className="h-3 w-3 shrink-0" />
                            <span className="truncate max-w-[180px]">
                              In use ({asset.inUseReferences!.length})
                            </span>
                          </div>
                        ) : (
                          <div className="mt-0.5 text-[11px] text-slate-500">Unattached</div>
                        )}
                      </td>

                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                        <div className="text-slate-200">{formatBytes(asset.sizeBytes)}</div>
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          {formatTimestamp(asset.createdAt)}
                        </div>
                      </td>

                      <td className="px-5 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setOrganizingAsset(asset);
                              setOrgCategory(asset.category);
                              setOrgStorageId(asset.storageServerId || '');
                            }}
                            className="rounded border border-slate-700 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800 whitespace-nowrap"
                          >
                            Organize
                          </button>

                          <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-slate-700 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800 whitespace-nowrap">
                            <Replace className="h-3.5 w-3.5" />
                            <span>{replacingId === asset.id ? '...' : 'Replace'}</span>
                            <input
                              type="file"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) handleReplaceFile(asset.id, f);
                              }}
                            />
                          </label>

                          <button
                            type="button"
                            onClick={() => handleDownloadAsset(asset)}
                            title="Download asset"
                            className="rounded border border-slate-700 p-1.5 text-slate-300 hover:bg-slate-800"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            disabled={inUse}
                            onClick={() => setDeletingTarget(asset)}
                            title={
                              inUse
                                ? `Protected: referenced by ${asset.inUseReferences?.join(', ')}`
                                : 'Delete asset'
                            }
                            className="rounded border border-slate-700 p-1.5 text-red-400 hover:bg-red-950/50 disabled:opacity-30 disabled:cursor-not-allowed"
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

      {/* Upload Asset Modal */}
      <Modal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Upload Media Asset"
        subtitle="Supported formats: JPEG, PNG, WebP, AVIF, GIF, VTT/SRT subtitles, MP4/WebM video (max 50 MB)."
        maxWidthClass="max-w-lg"
      >
        <form onSubmit={handleUploadSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300">Select File *</label>
            <input
              type="file"
              required
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              className="mt-1.5 block w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-200 file:mr-3 file:rounded file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300">Asset Category</label>
            <select
              value={uploadCategory}
              onChange={(e) => setUploadCategory(e.target.value as AssetCategory)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
            >
              {Object.entries(CATEGORY_LABELS).map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300">
              Destination Storage Pool Node
            </label>
            <select
              value={uploadStorageId}
              onChange={(e) => setUploadStorageId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
            >
              <option value="">Local Staging Buffer</option>
              {storageServers
                .filter((s) => s.enabled)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.bucketOrVolume})
                  </option>
                ))}
            </select>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
            <button
              type="button"
              onClick={() => setUploadOpen(false)}
              className="rounded-md border border-slate-700 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={uploading || !selectedFile}
              className="rounded-md bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {uploading ? 'Uploading...' : 'Upload & Store Asset'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Organize Asset Modal */}
      <Modal
        open={Boolean(organizingAsset)}
        onClose={() => setOrganizingAsset(null)}
        title={`Organize Asset: ${organizingAsset?.originalFilename || ''}`}
        maxWidthClass="max-w-md"
      >
        <form onSubmit={handleSaveOrganize} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300">Category</label>
            <select
              value={orgCategory}
              onChange={(e) => setOrgCategory(e.target.value as AssetCategory)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
            >
              {Object.entries(CATEGORY_LABELS).map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300">
              Assigned Storage Destination
            </label>
            <select
              value={orgStorageId}
              onChange={(e) => setOrgStorageId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-100"
            >
              <option value="">Local Staging Buffer</option>
              {storageServers
                .filter((s) => s.enabled)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.bucketOrVolume})
                  </option>
                ))}
            </select>
          </div>

          {organizingAsset &&
            organizingAsset.inUseReferences &&
            organizingAsset.inUseReferences.length > 0 && (
              <div className="rounded border border-slate-800 bg-[#0B0F17] p-3 text-xs text-slate-300">
                <div className="font-semibold text-amber-300">Active Catalog References:</div>
                <ul className="mt-1 list-disc pl-4 space-y-0.5 text-slate-400">
                  {organizingAsset.inUseReferences.map((ref, idx) => (
                    <li key={idx}>{ref}</li>
                  ))}
                </ul>
              </div>
            )}

          <div className="flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
            <button
              type="button"
              onClick={() => setOrganizingAsset(null)}
              className="rounded-md border border-slate-700 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={orgBusy}
              className="rounded-md bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {orgBusy ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deletingTarget)}
        onCancel={() => setDeletingTarget(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Media Asset"
        description={`Permanently delete "${deletingTarget?.originalFilename}" and reclaim its storage pool allocation?`}
        confirmLabel="Delete Asset"
        destructive
        busy={deletingBusy}
      />
    </div>
  );
}

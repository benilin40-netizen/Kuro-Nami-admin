import crypto from 'crypto';
import { Router } from 'express';
import { db } from '../db';
import {
  AlternativeTitles,
  AnimeRecord,
  AnimeSeasonItem,
  AnimeStatus,
  AudioMode,
  EpisodeRecord,
  EpisodeSourceLink,
  ExternalAnimeIds,
} from '../../shared/types';
import { getClientIp, requireAuth, requirePermission } from '../security';
import { recordAuditLog } from '../monitoring';
import { verifyEpisodeSourceUrl } from '../adapters/providerAdapter';

export const catalogRouter = Router();

function slugifyTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'untitled-anime'
  );
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function mapAnimeRow(row: Record<string, unknown>): AnimeRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    title: String(row.title),
    slug: String(row.slug),
    synopsis: String(row.synopsis || ''),
    alternativeTitles: safeJsonParse<AlternativeTitles>(String(row.alternative_titles_json), {
      romaji: '',
      english: '',
      native: '',
      synonyms: [],
    }),
    genres: safeJsonParse<string[]>(String(row.genres_json), []),
    releaseYear: row.release_year !== null && row.release_year !== undefined ? Number(row.release_year) : null,
    status: (row.status as AnimeStatus) || AnimeStatus.ONGOING,
    ratingValue: row.rating_value !== null && row.rating_value !== undefined ? Number(row.rating_value) : null,
    ratingSource: String(row.rating_source || ''),
    studios: safeJsonParse<string[]>(String(row.studios_json), []),
    seasons: safeJsonParse<AnimeSeasonItem[]>(String(row.seasons_json), []),
    externalIds: safeJsonParse<ExternalAnimeIds>(String(row.external_ids_json), {
      upstreamKuroNamiId: '',
      anilistId: '',
      malId: '',
      kitsuId: '',
      anidbId: '',
    }),
    posterAssetId: row.poster_asset_id ? String(row.poster_asset_id) : null,
    backgroundAssetId: row.background_asset_id ? String(row.background_asset_id) : null,
    storageServerId: row.storage_server_id ? String(row.storage_server_id) : null,
    syncState: (row.sync_state as AnimeRecord['syncState']) || 'LOCAL_STAGED',
    episodeCount: Number(row.episode_count || 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapEpisodeRow(row: Record<string, unknown>): EpisodeRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    animeId: String(row.anime_id),
    animeTitle: row.anime_title ? String(row.anime_title) : undefined,
    upstreamEpisodeId: String(row.upstream_episode_id || ''),
    seasonNumber: Number(row.season_number || 1),
    episodeNumber: Number(row.episode_number || 1),
    sortOrder: Number(row.sort_order || 1),
    title: String(row.title),
    releaseDate: row.release_date ? String(row.release_date) : null,
    subtitleLanguages: safeJsonParse<string[]>(String(row.subtitle_languages_json), ['en']),
    audioStatus: (row.audio_status as AudioMode) || AudioMode.SUB,
    sources: safeJsonParse<EpisodeSourceLink[]>(String(row.sources_json), []),
    storageServerId: row.storage_server_id ? String(row.storage_server_id) : null,
    thumbnailAssetId: row.thumbnail_asset_id ? String(row.thumbnail_asset_id) : null,
    subtitleAssetId: row.subtitle_asset_id ? String(row.subtitle_asset_id) : null,
    videoAssetId: row.video_asset_id ? String(row.video_asset_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

// ============================================================================
// ANIME MANAGEMENT ROUTES
// ============================================================================

catalogRouter.get('/anime', requireAuth, requirePermission('catalog:read'), (req, res) => {
  const workspaceId = req.admin!.workspaceId;
  const search = String(req.query.search || '').trim().toLowerCase();
  const statusFilter = String(req.query.status || '').trim();
  const yearFilter = req.query.year ? Number(req.query.year) : null;
  const genreFilter = String(req.query.genre || '').trim().toLowerCase();
  const sortBy = String(req.query.sortBy || 'updated_at');
  const sortDir = String(req.query.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(5, Number(req.query.pageSize) || 20));

  const allowedSorts: Record<string, string> = {
    updated_at: 'a.updated_at',
    created_at: 'a.created_at',
    title: 'a.title',
    release_year: 'a.release_year',
    rating_value: 'a.rating_value',
  };
  const orderCol = allowedSorts[sortBy] || 'a.updated_at';

  const rows = db
    .prepare(
      `
      SELECT a.*,
             (SELECT COUNT(*) FROM episodes e WHERE e.anime_id = a.id AND e.workspace_id = a.workspace_id) AS episode_count
      FROM anime_catalog a
      WHERE a.workspace_id = ?
      ORDER BY ${orderCol} ${sortDir}
    `
    )
    .all(workspaceId) as Array<Record<string, unknown>>;

  let mapped = rows.map(mapAnimeRow);

  if (search) {
    mapped = mapped.filter((item) => {
      const hay = [
        item.title,
        item.id,
        item.alternativeTitles.romaji,
        item.alternativeTitles.english,
        item.alternativeTitles.native,
        ...item.alternativeTitles.synonyms,
        item.externalIds.anilistId,
        item.externalIds.malId,
        item.externalIds.upstreamKuroNamiId,
        ...item.studios,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(search);
    });
  }

  if (statusFilter && statusFilter !== 'ALL') {
    mapped = mapped.filter((item) => item.status === statusFilter);
  }

  if (yearFilter && !Number.isNaN(yearFilter)) {
    mapped = mapped.filter((item) => item.releaseYear === yearFilter);
  }

  if (genreFilter) {
    mapped = mapped.filter((item) => item.genres.some((g) => g.toLowerCase() === genreFilter));
  }

  const total = mapped.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const items = mapped.slice((page - 1) * pageSize, page * pageSize);

  res.json({
    items,
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
    },
  });
});

catalogRouter.post('/anime', requireAuth, requirePermission('catalog:write'), (req, res) => {
  const admin = req.admin!;
  const ip = getClientIp(req);
  const body = req.body || {};

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) {
    res.status(400).json({ error: 'Anime primary title is required.' });
    return;
  }

  const id = `kn_anime_${crypto.randomUUID().slice(0, 12)}`;
  const slug = typeof body.slug === 'string' && body.slug.trim() ? slugifyTitle(body.slug) : slugifyTitle(title);
  const synopsis = typeof body.synopsis === 'string' ? body.synopsis.trim() : '';
  const status = Object.values(AnimeStatus).includes(body.status) ? body.status : AnimeStatus.ONGOING;
  const releaseYear = body.releaseYear ? Number(body.releaseYear) : null;
  const ratingValue =
    body.ratingValue !== undefined && body.ratingValue !== null && body.ratingValue !== ''
      ? Math.min(10, Math.max(0, Number(body.ratingValue)))
      : null;
  const ratingSource = typeof body.ratingSource === 'string' ? body.ratingSource.trim() : '';

  const alternativeTitles: AlternativeTitles = {
    romaji: String(body.alternativeTitles?.romaji || '').trim(),
    english: String(body.alternativeTitles?.english || '').trim(),
    native: String(body.alternativeTitles?.native || '').trim(),
    synonyms: Array.isArray(body.alternativeTitles?.synonyms)
      ? body.alternativeTitles.synonyms.map((s: unknown) => String(s).trim()).filter(Boolean)
      : [],
  };

  const genres: string[] = Array.isArray(body.genres)
    ? body.genres.map((g: unknown) => String(g).trim()).filter(Boolean)
    : [];

  const studios: string[] = Array.isArray(body.studios)
    ? body.studios.map((s: unknown) => String(s).trim()).filter(Boolean)
    : [];

  const seasons: AnimeSeasonItem[] = Array.isArray(body.seasons)
    ? body.seasons.map((s: Record<string, unknown>, idx: number) => ({
        seasonNumber: Number(s.seasonNumber) || idx + 1,
        title: String(s.title || `Season ${idx + 1}`).trim(),
        episodeCount: Math.max(0, Number(s.episodeCount) || 0),
        releaseYear: s.releaseYear ? Number(s.releaseYear) : releaseYear,
      }))
    : [{ seasonNumber: 1, title: 'Season 1', episodeCount: 0, releaseYear }];

  const externalIds: ExternalAnimeIds = {
    upstreamKuroNamiId: String(body.externalIds?.upstreamKuroNamiId || '').trim(),
    anilistId: String(body.externalIds?.anilistId || '').trim(),
    malId: String(body.externalIds?.malId || '').trim(),
    kitsuId: String(body.externalIds?.kitsuId || '').trim(),
    anidbId: String(body.externalIds?.anidbId || '').trim(),
  };

  const posterAssetId = body.posterAssetId || null;
  const backgroundAssetId = body.backgroundAssetId || null;
  const storageServerId = body.storageServerId || null;
  const now = new Date().toISOString();

  db.prepare(
    `
    INSERT INTO anime_catalog (
      id, workspace_id, title, slug, synopsis, alternative_titles_json, genres_json,
      release_year, status, rating_value, rating_source, studios_json, seasons_json,
      external_ids_json, poster_asset_id, background_asset_id, storage_server_id,
      sync_state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'LOCAL_STAGED', ?, ?)
  `
  ).run(
    id,
    admin.workspaceId,
    title,
    slug,
    synopsis,
    JSON.stringify(alternativeTitles),
    JSON.stringify(genres),
    releaseYear,
    status,
    ratingValue,
    ratingSource,
    JSON.stringify(studios),
    JSON.stringify(seasons),
    JSON.stringify(externalIds),
    posterAssetId,
    backgroundAssetId,
    storageServerId,
    now,
    now
  );

  const createdRow = db
    .prepare(`SELECT *, 0 AS episode_count FROM anime_catalog WHERE id = ? AND workspace_id = ?`)
    .get(id, admin.workspaceId) as Record<string, unknown>;
  const created = mapAnimeRow(createdRow);

  recordAuditLog({
    workspaceId: admin.workspaceId,
    adminId: admin.id,
    adminUsername: admin.username,
    action: 'ANIME_CREATED',
    resourceType: 'ANIME',
    resourceId: id,
    newValue: { title, status, releaseYear, externalIds },
    status: 'SUCCESS',
    ipAddress: ip,
  });

  res.status(201).json(created);
});

catalogRouter.put('/anime/:id', requireAuth, requirePermission('catalog:write'), (req, res) => {
  const admin = req.admin!;
  const ip = getClientIp(req);
  const animeId = req.params.id;
  const body = req.body || {};

  const existingRow = db
    .prepare(`SELECT *, 0 AS episode_count FROM anime_catalog WHERE id = ? AND workspace_id = ?`)
    .get(animeId, admin.workspaceId) as Record<string, unknown> | undefined;

  if (!existingRow) {
    res.status(404).json({ error: 'Anime record not found in your workspace.' });
    return;
  }

  const prev = mapAnimeRow(existingRow);
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : prev.title;
  const slug = typeof body.slug === 'string' && body.slug.trim() ? slugifyTitle(body.slug) : prev.slug;
  const synopsis = typeof body.synopsis === 'string' ? body.synopsis.trim() : prev.synopsis;
  const status = Object.values(AnimeStatus).includes(body.status) ? body.status : prev.status;
  const releaseYear =
    body.releaseYear !== undefined
      ? body.releaseYear
        ? Number(body.releaseYear)
        : null
      : prev.releaseYear;
  const ratingValue =
    body.ratingValue !== undefined
      ? body.ratingValue === null || body.ratingValue === ''
        ? null
        : Math.min(10, Math.max(0, Number(body.ratingValue)))
      : prev.ratingValue;
  const ratingSource =
    typeof body.ratingSource === 'string' ? body.ratingSource.trim() : prev.ratingSource;

  const alternativeTitles: AlternativeTitles = body.alternativeTitles
    ? {
        romaji: String(body.alternativeTitles.romaji || '').trim(),
        english: String(body.alternativeTitles.english || '').trim(),
        native: String(body.alternativeTitles.native || '').trim(),
        synonyms: Array.isArray(body.alternativeTitles.synonyms)
          ? body.alternativeTitles.synonyms.map((s: unknown) => String(s).trim()).filter(Boolean)
          : [],
      }
    : prev.alternativeTitles;

  const genres: string[] = Array.isArray(body.genres)
    ? body.genres.map((g: unknown) => String(g).trim()).filter(Boolean)
    : prev.genres;

  const studios: string[] = Array.isArray(body.studios)
    ? body.studios.map((s: unknown) => String(s).trim()).filter(Boolean)
    : prev.studios;

  const seasons: AnimeSeasonItem[] = Array.isArray(body.seasons)
    ? body.seasons.map((s: Record<string, unknown>, idx: number) => ({
        seasonNumber: Number(s.seasonNumber) || idx + 1,
        title: String(s.title || `Season ${idx + 1}`).trim(),
        episodeCount: Math.max(0, Number(s.episodeCount) || 0),
        releaseYear: s.releaseYear ? Number(s.releaseYear) : null,
      }))
    : prev.seasons;

  const externalIds: ExternalAnimeIds = body.externalIds
    ? {
        upstreamKuroNamiId: String(body.externalIds.upstreamKuroNamiId || '').trim(),
        anilistId: String(body.externalIds.anilistId || '').trim(),
        malId: String(body.externalIds.malId || '').trim(),
        kitsuId: String(body.externalIds.kitsuId || '').trim(),
        anidbId: String(body.externalIds.anidbId || '').trim(),
      }
    : prev.externalIds;

  const posterAssetId = body.posterAssetId !== undefined ? body.posterAssetId || null : prev.posterAssetId;
  const backgroundAssetId =
    body.backgroundAssetId !== undefined ? body.backgroundAssetId || null : prev.backgroundAssetId;
  const storageServerId =
    body.storageServerId !== undefined ? body.storageServerId || null : prev.storageServerId;

  const nextSyncState =
    prev.syncState === 'SYNCED_UPSTREAM' ? 'MODIFIED_PENDING_SYNC' : prev.syncState;
  const now = new Date().toISOString();

  db.prepare(
    `
    UPDATE anime_catalog
    SET title = ?, slug = ?, synopsis = ?, alternative_titles_json = ?, genres_json = ?,
        release_year = ?, status = ?, rating_value = ?, rating_source = ?, studios_json = ?,
        seasons_json = ?, external_ids_json = ?, poster_asset_id = ?, background_asset_id = ?,
        storage_server_id = ?, sync_state = ?, updated_at = ?
    WHERE id = ? AND workspace_id = ?
  `
  ).run(
    title,
    slug,
    synopsis,
    JSON.stringify(alternativeTitles),
    JSON.stringify(genres),
    releaseYear,
    status,
    ratingValue,
    ratingSource,
    JSON.stringify(studios),
    JSON.stringify(seasons),
    JSON.stringify(externalIds),
    posterAssetId,
    backgroundAssetId,
    storageServerId,
    nextSyncState,
    now,
    animeId,
    admin.workspaceId
  );

  const updatedRow = db
    .prepare(
      `
      SELECT a.*,
             (SELECT COUNT(*) FROM episodes e WHERE e.anime_id = a.id AND e.workspace_id = a.workspace_id) AS episode_count
      FROM anime_catalog a
      WHERE a.id = ? AND a.workspace_id = ?
    `
    )
    .get(animeId, admin.workspaceId) as Record<string, unknown>;
  const updated = mapAnimeRow(updatedRow);

  recordAuditLog({
    workspaceId: admin.workspaceId,
    adminId: admin.id,
    adminUsername: admin.username,
    action: 'ANIME_UPDATED',
    resourceType: 'ANIME',
    resourceId: animeId,
    previousValue: { title: prev.title, status: prev.status, externalIds: prev.externalIds },
    newValue: { title: updated.title, status: updated.status, externalIds: updated.externalIds },
    status: 'SUCCESS',
    ipAddress: ip,
  });

  res.json(updated);
});

catalogRouter.delete('/anime/:id', requireAuth, requirePermission('catalog:write'), (req, res) => {
  const admin = req.admin!;
  const ip = getClientIp(req);
  const animeId = req.params.id;

  const existing = db
    .prepare(`SELECT id, title FROM anime_catalog WHERE id = ? AND workspace_id = ?`)
    .get(animeId, admin.workspaceId) as { id: string; title: string } | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Anime record not found.' });
    return;
  }

  db.prepare(`DELETE FROM anime_catalog WHERE id = ? AND workspace_id = ?`).run(
    animeId,
    admin.workspaceId
  );

  recordAuditLog({
    workspaceId: admin.workspaceId,
    adminId: admin.id,
    adminUsername: admin.username,
    action: 'ANIME_DELETED',
    resourceType: 'ANIME',
    resourceId: animeId,
    previousValue: { title: existing.title },
    status: 'SUCCESS',
    ipAddress: ip,
  });

  res.json({ ok: true });
});

// ============================================================================
// EPISODE MANAGEMENT ROUTES
// ============================================================================

catalogRouter.get('/episodes', requireAuth, requirePermission('catalog:read'), (req, res) => {
  const workspaceId = req.admin!.workspaceId;
  const animeId = String(req.query.animeId || '').trim();
  const seasonNumber = req.query.season ? Number(req.query.season) : null;
  const search = String(req.query.search || '').trim().toLowerCase();

  let query = `
    SELECT e.*, a.title AS anime_title
    FROM episodes e
    JOIN anime_catalog a ON a.id = e.anime_id
    WHERE e.workspace_id = ?
  `;
  const params: unknown[] = [workspaceId];

  if (animeId) {
    query += ` AND e.anime_id = ?`;
    params.push(animeId);
  }
  if (seasonNumber !== null && !Number.isNaN(seasonNumber)) {
    query += ` AND e.season_number = ?`;
    params.push(seasonNumber);
  }

  query += ` ORDER BY e.season_number ASC, e.sort_order ASC, e.episode_number ASC`;

  const rows = db.prepare(query).all(...params) as Array<Record<string, unknown>>;
  let items = rows.map(mapEpisodeRow);

  if (search) {
    items = items.filter((ep) =>
      [ep.title, ep.id, ep.upstreamEpisodeId, ep.animeTitle || '', `ep ${ep.episodeNumber}`]
        .join(' ')
        .toLowerCase()
        .includes(search)
    );
  }

  res.json({ items });
});

catalogRouter.post('/episodes', requireAuth, requirePermission('catalog:write'), (req, res) => {
  const admin = req.admin!;
  const ip = getClientIp(req);
  const body = req.body || {};

  const animeId = String(body.animeId || '').trim();
  const anime = db
    .prepare(`SELECT id, title FROM anime_catalog WHERE id = ? AND workspace_id = ?`)
    .get(animeId, admin.workspaceId) as { id: string; title: string } | undefined;

  if (!anime) {
    res.status(404).json({ error: 'Parent anime record not found in your workspace.' });
    return;
  }

  const seasonNumber = Math.max(1, Number(body.seasonNumber) || 1);
  const episodeNumber = Math.max(1, Number(body.episodeNumber) || 1);
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : `Episode ${episodeNumber}`;
  const id = `kn_ep_${crypto.randomUUID().slice(0, 12)}`;
  const upstreamEpisodeId = String(
    body.upstreamEpisodeId || `${anime.id}:s${seasonNumber}:e${episodeNumber}`
  ).trim();

  const maxSortRow = db
    .prepare(
      `SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM episodes WHERE workspace_id = ? AND anime_id = ? AND season_number = ?`
    )
    .get(admin.workspaceId, animeId, seasonNumber) as { max_sort: number };

  const sortOrder = body.sortOrder !== undefined ? Number(body.sortOrder) : maxSortRow.max_sort + 1;
  const releaseDate = body.releaseDate ? String(body.releaseDate) : null;
  const subtitleLanguages: string[] = Array.isArray(body.subtitleLanguages)
    ? body.subtitleLanguages.map((l: unknown) => String(l).trim()).filter(Boolean)
    : ['en'];
  const audioStatus = Object.values(AudioMode).includes(body.audioStatus) ? body.audioStatus : AudioMode.SUB;

  const sources: EpisodeSourceLink[] = Array.isArray(body.sources)
    ? body.sources.map((s: Record<string, unknown>) => ({
        id: String(s.id || `src_${crypto.randomUUID().slice(0, 8)}`),
        providerSlug: String(s.providerSlug || 'animepahe'),
        sourceUrl: String(s.sourceUrl || '').trim(),
        quality: String(s.quality || '1080p'),
        audioType: Object.values(AudioMode).includes(s.audioType as AudioMode)
          ? (s.audioType as AudioMode)
          : AudioMode.SUB,
        availabilityStatus: 'UNVERIFIED',
        lastCheckedAt: null,
        responseTimeMs: null,
      }))
    : [];

  const now = new Date().toISOString();

  db.prepare(
    `
    INSERT INTO episodes (
      id, workspace_id, anime_id, upstream_episode_id, season_number, episode_number,
      sort_order, title, release_date, subtitle_languages_json, audio_status, sources_json,
      storage_server_id, thumbnail_asset_id, subtitle_asset_id, video_asset_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    id,
    admin.workspaceId,
    animeId,
    upstreamEpisodeId,
    seasonNumber,
    episodeNumber,
    sortOrder,
    title,
    releaseDate,
    JSON.stringify(subtitleLanguages),
    audioStatus,
    JSON.stringify(sources),
    body.storageServerId || null,
    body.thumbnailAssetId || null,
    body.subtitleAssetId || null,
    body.videoAssetId || null,
    now,
    now
  );

  recordAuditLog({
    workspaceId: admin.workspaceId,
    adminId: admin.id,
    adminUsername: admin.username,
    action: 'EPISODE_CREATED',
    resourceType: 'EPISODE',
    resourceId: id,
    newValue: { animeId, seasonNumber, episodeNumber, title, upstreamEpisodeId },
    status: 'SUCCESS',
    ipAddress: ip,
  });

  const createdRow = db
    .prepare(
      `SELECT e.*, a.title AS anime_title FROM episodes e JOIN anime_catalog a ON a.id = e.anime_id WHERE e.id = ?`
    )
    .get(id) as Record<string, unknown>;

  res.status(201).json(mapEpisodeRow(createdRow));
});

catalogRouter.post('/episodes/bulk', requireAuth, requirePermission('catalog:write'), (req, res) => {
  const admin = req.admin!;
  const ip = getClientIp(req);
  const { animeId, seasonNumber, startEpisode, endEpisode, audioStatus, subtitleLanguages, titlePrefix } =
    req.body || {};

  const anime = db
    .prepare(`SELECT id, title FROM anime_catalog WHERE id = ? AND workspace_id = ?`)
    .get(String(animeId || ''), admin.workspaceId) as { id: string; title: string } | undefined;

  if (!anime) {
    res.status(404).json({ error: 'Target anime not found in workspace.' });
    return;
  }

  const season = Math.max(1, Number(seasonNumber) || 1);
  const startEp = Math.max(1, Number(startEpisode) || 1);
  const endEp = Math.max(startEp, Number(endEpisode) || startEp);

  if (endEp - startEp + 1 > 100) {
    res.status(400).json({ error: 'Bulk episode batch cannot exceed 100 episodes per operation.' });
    return;
  }

  const audio = Object.values(AudioMode).includes(audioStatus) ? audioStatus : AudioMode.SUB;
  const subs = Array.isArray(subtitleLanguages) && subtitleLanguages.length > 0 ? subtitleLanguages : ['en'];
  const prefix = typeof titlePrefix === 'string' && titlePrefix.trim() ? titlePrefix.trim() : 'Episode';
  const now = new Date().toISOString();

  const createdIds: string[] = [];

  db.transaction(() => {
    const insertStmt = db.prepare(
      `
      INSERT INTO episodes (
        id, workspace_id, anime_id, upstream_episode_id, season_number, episode_number,
        sort_order, title, subtitle_languages_json, audio_status, sources_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)
    `
    );

    for (let epNum = startEp; epNum <= endEp; epNum++) {
      const id = `kn_ep_${crypto.randomUUID().slice(0, 12)}`;
      const upstreamId = `${anime.id}:s${season}:e${epNum}`;
      insertStmt.run(
        id,
        admin.workspaceId,
        anime.id,
        upstreamId,
        season,
        epNum,
        epNum,
        `${prefix} ${epNum}`,
        JSON.stringify(subs),
        audio,
        now,
        now
      );
      createdIds.push(id);
    }
  })();

  recordAuditLog({
    workspaceId: admin.workspaceId,
    adminId: admin.id,
    adminUsername: admin.username,
    action: 'EPISODES_BULK_CREATED',
    resourceType: 'EPISODE_BATCH',
    resourceId: anime.id,
    newValue: { season, startEp, endEp, count: createdIds.length },
    status: 'SUCCESS',
    ipAddress: ip,
  });

  res.status(201).json({ createdCount: createdIds.length, createdIds });
});

catalogRouter.put('/episodes/:id', requireAuth, requirePermission('catalog:write'), (req, res) => {
  const admin = req.admin!;
  const ip = getClientIp(req);
  const epId = req.params.id;
  const body = req.body || {};

  const existingRow = db
    .prepare(`SELECT * FROM episodes WHERE id = ? AND workspace_id = ?`)
    .get(epId, admin.workspaceId) as Record<string, unknown> | undefined;

  if (!existingRow) {
    res.status(404).json({ error: 'Episode not found in workspace.' });
    return;
  }

  const prev = mapEpisodeRow(existingRow);
  const seasonNumber = body.seasonNumber !== undefined ? Math.max(1, Number(body.seasonNumber)) : prev.seasonNumber;
  const episodeNumber = body.episodeNumber !== undefined ? Math.max(1, Number(body.episodeNumber)) : prev.episodeNumber;
  const sortOrder = body.sortOrder !== undefined ? Number(body.sortOrder) : prev.sortOrder;
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : prev.title;
  const upstreamEpisodeId =
    typeof body.upstreamEpisodeId === 'string' && body.upstreamEpisodeId.trim()
      ? body.upstreamEpisodeId.trim()
      : prev.upstreamEpisodeId;
  const releaseDate = body.releaseDate !== undefined ? body.releaseDate || null : prev.releaseDate;
  const subtitleLanguages = Array.isArray(body.subtitleLanguages)
    ? body.subtitleLanguages.map((s: unknown) => String(s).trim()).filter(Boolean)
    : prev.subtitleLanguages;
  const audioStatus = Object.values(AudioMode).includes(body.audioStatus) ? body.audioStatus : prev.audioStatus;
  const sources: EpisodeSourceLink[] = Array.isArray(body.sources)
    ? body.sources.map((s: Record<string, unknown>) => ({
        id: String(s.id || `src_${crypto.randomUUID().slice(0, 8)}`),
        providerSlug: String(s.providerSlug || 'animepahe'),
        sourceUrl: String(s.sourceUrl || '').trim(),
        quality: String(s.quality || '1080p'),
        audioType: Object.values(AudioMode).includes(s.audioType as AudioMode)
          ? (s.audioType as AudioMode)
          : AudioMode.SUB,
        availabilityStatus: (s.availabilityStatus as EpisodeSourceLink['availabilityStatus']) || 'UNVERIFIED',
        lastCheckedAt: s.lastCheckedAt ? String(s.lastCheckedAt) : null,
        responseTimeMs: s.responseTimeMs !== undefined && s.responseTimeMs !== null ? Number(s.responseTimeMs) : null,
      }))
    : prev.sources;

  const storageServerId =
    body.storageServerId !== undefined ? body.storageServerId || null : prev.storageServerId;
  const thumbnailAssetId =
    body.thumbnailAssetId !== undefined ? body.thumbnailAssetId || null : prev.thumbnailAssetId;
  const subtitleAssetId =
    body.subtitleAssetId !== undefined ? body.subtitleAssetId || null : prev.subtitleAssetId;
  const videoAssetId =
    body.videoAssetId !== undefined ? body.videoAssetId || null : prev.videoAssetId;
  const now = new Date().toISOString();

  db.prepare(
    `
    UPDATE episodes
    SET upstream_episode_id = ?, season_number = ?, episode_number = ?, sort_order = ?, title = ?,
        release_date = ?, subtitle_languages_json = ?, audio_status = ?, sources_json = ?,
        storage_server_id = ?, thumbnail_asset_id = ?, subtitle_asset_id = ?, video_asset_id = ?, updated_at = ?
    WHERE id = ? AND workspace_id = ?
  `
  ).run(
    upstreamEpisodeId,
    seasonNumber,
    episodeNumber,
    sortOrder,
    title,
    releaseDate,
    JSON.stringify(subtitleLanguages),
    audioStatus,
    JSON.stringify(sources),
    storageServerId,
    thumbnailAssetId,
    subtitleAssetId,
    videoAssetId,
    now,
    epId,
    admin.workspaceId
  );

  recordAuditLog({
    workspaceId: admin.workspaceId,
    adminId: admin.id,
    adminUsername: admin.username,
    action: 'EPISODE_UPDATED',
    resourceType: 'EPISODE',
    resourceId: epId,
    previousValue: { title: prev.title, episodeNumber: prev.episodeNumber, sourcesCount: prev.sources.length },
    newValue: { title, episodeNumber, sourcesCount: sources.length },
    status: 'SUCCESS',
    ipAddress: ip,
  });

  const updatedRow = db
    .prepare(
      `SELECT e.*, a.title AS anime_title FROM episodes e JOIN anime_catalog a ON a.id = e.anime_id WHERE e.id = ?`
    )
    .get(epId) as Record<string, unknown>;

  res.json(mapEpisodeRow(updatedRow));
});

catalogRouter.post('/episodes/reorder', requireAuth, requirePermission('catalog:write'), (req, res) => {
  const admin = req.admin!;
  const ip = getClientIp(req);
  const { orderedEpisodeIds } = req.body || {};

  if (!Array.isArray(orderedEpisodeIds) || orderedEpisodeIds.length === 0) {
    res.status(400).json({ error: 'orderedEpisodeIds array is required.' });
    return;
  }

  const now = new Date().toISOString();
  db.transaction(() => {
    const stmt = db.prepare(
      `UPDATE episodes SET sort_order = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`
    );
    orderedEpisodeIds.forEach((epId: unknown, idx: number) => {
      stmt.run(idx + 1, now, String(epId), admin.workspaceId);
    });
  })();

  recordAuditLog({
    workspaceId: admin.workspaceId,
    adminId: admin.id,
    adminUsername: admin.username,
    action: 'EPISODES_REORDERED',
    resourceType: 'EPISODE_BATCH',
    newValue: { count: orderedEpisodeIds.length },
    status: 'SUCCESS',
    ipAddress: ip,
  });

  res.json({ ok: true });
});

catalogRouter.post(
  '/episodes/:id/verify-sources',
  requireAuth,
  requirePermission('catalog:write'),
  async (req, res) => {
    const admin = req.admin!;
    const ip = getClientIp(req);
    const epId = req.params.id;

    const existingRow = db
      .prepare(`SELECT * FROM episodes WHERE id = ? AND workspace_id = ?`)
      .get(epId, admin.workspaceId) as Record<string, unknown> | undefined;

    if (!existingRow) {
      res.status(404).json({ error: 'Episode not found.' });
      return;
    }

    const ep = mapEpisodeRow(existingRow);
    const now = new Date().toISOString();

    const verifiedSources: EpisodeSourceLink[] = [];
    for (const src of ep.sources) {
      if (!src.sourceUrl) {
        verifiedSources.push({
          ...src,
          availabilityStatus: 'ERROR',
          lastCheckedAt: now,
          responseTimeMs: null,
        });
        continue;
      }
      const probe = await verifyEpisodeSourceUrl(src.sourceUrl);
      verifiedSources.push({
        ...src,
        availabilityStatus: probe.status,
        lastCheckedAt: now,
        responseTimeMs: probe.responseTimeMs,
      });

      // Also update provider source-resolution stats if provider exists in workspace
      const isOk = probe.status === 'AVAILABLE' ? 1 : 0;
      db.prepare(
        `
        UPDATE streaming_providers
        SET resolution_attempts = resolution_attempts + 1,
            resolution_successes = resolution_successes + ?,
            updated_at = ?
        WHERE workspace_id = ? AND slug = ?
      `
      ).run(isOk, now, admin.workspaceId, src.providerSlug);
    }

    db.prepare(`UPDATE episodes SET sources_json = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`).run(
      JSON.stringify(verifiedSources),
      now,
      epId,
      admin.workspaceId
    );

    recordAuditLog({
      workspaceId: admin.workspaceId,
      adminId: admin.id,
      adminUsername: admin.username,
      action: 'EPISODE_SOURCES_VERIFIED',
      resourceType: 'EPISODE',
      resourceId: epId,
      newValue: {
        checkedCount: verifiedSources.length,
        availableCount: verifiedSources.filter((s) => s.availabilityStatus === 'AVAILABLE').length,
      },
      status: 'SUCCESS',
      ipAddress: ip,
    });

    res.json({ sources: verifiedSources });
  }
);

catalogRouter.delete('/episodes/:id', requireAuth, requirePermission('catalog:write'), (req, res) => {
  const admin = req.admin!;
  const ip = getClientIp(req);
  const epId = req.params.id;

  const existing = db
    .prepare(`SELECT id, title, episode_number FROM episodes WHERE id = ? AND workspace_id = ?`)
    .get(epId, admin.workspaceId) as { id: string; title: string; episode_number: number } | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Episode not found.' });
    return;
  }

  db.prepare(`DELETE FROM episodes WHERE id = ? AND workspace_id = ?`).run(epId, admin.workspaceId);

  recordAuditLog({
    workspaceId: admin.workspaceId,
    adminId: admin.id,
    adminUsername: admin.username,
    action: 'EPISODE_DELETED',
    resourceType: 'EPISODE',
    resourceId: epId,
    previousValue: { title: existing.title, episodeNumber: existing.episode_number },
    status: 'SUCCESS',
    ipAddress: ip,
  });

  res.json({ ok: true });
});

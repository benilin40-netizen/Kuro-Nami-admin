import { Router } from 'express';
import { db } from '../db';
import {
  DataExportOptions,
  LogSeverity,
  UserActivityRecord,
  WebsiteSettingsRecord,
} from '../../shared/types';
import { getClientIp, requireAuth, requirePermission } from '../security';
import { recordAuditLog, recordSystemLog } from '../monitoring';
import {
  generateExportData,
  getWebsiteSettings,
  runFullWebsiteDataImport,
  updateWebsiteSettings,
} from '../adapters/syncAdapter';

export const syncRouter = Router();

// ============================================================================
// DATA IMPORT & SYNCHRONISATION
// ============================================================================

syncRouter.get('/sync/status', requireAuth, (req, res) => {
  const workspaceId = req.admin!.workspaceId;
  const lastJob = db
    .prepare(`SELECT * FROM import_sync_logs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(workspaceId) as Record<string, unknown> | undefined;

  let categoriesSummary = [];
  if (lastJob?.categories_summary_json) {
    try {
      categoriesSummary = JSON.parse(String(lastJob.categories_summary_json));
    } catch {}
  }

  res.json({
    lastSyncAt: lastJob?.created_at ? String(lastJob.created_at) : null,
    overallStatus: lastJob?.status ? String(lastJob.status) : 'IDLE',
    categoriesSummary,
  });
});

syncRouter.post('/sync/import', requireAuth, requirePermission('catalog:write'), async (req, res) => {
  const admin = req.admin!;
  const summary = await runFullWebsiteDataImport(admin.workspaceId);

  recordAuditLog({
    workspaceId: admin.workspaceId,
    adminId: admin.id,
    adminUsername: admin.username,
    action: 'WEBSITE_DATA_IMPORTED',
    resourceType: 'WEBSITE_SYNC',
    status: 'SUCCESS',
    ipAddress: getClientIp(req),
  });

  res.json(summary);
});

// ============================================================================
// LIVE WEBSITE ACTIVITY & EVENTS
// ============================================================================

syncRouter.get('/sync/activity', requireAuth, (req, res) => {
  const workspaceId = req.admin!.workspaceId;
  const typeFilter = String(req.query.type || '').trim();
  const search = String(req.query.search || '').trim().toLowerCase();

  const rows = db
    .prepare(`SELECT * FROM user_activity_logs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 100`)
    .all(workspaceId) as Array<Record<string, unknown>>;

  let items: UserActivityRecord[] = rows.map((r) => ({
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    userId: String(r.user_id),
    username: String(r.username),
    activityType: r.activity_type as UserActivityRecord['activityType'],
    detail: String(r.detail),
    animeId: r.anime_id ? String(r.anime_id) : null,
    episodeId: r.episode_id ? String(r.episode_id) : null,
    metadataJson: r.metadata_json ? String(r.metadata_json) : null,
    ipAddress: String(r.ip_address || '127.0.0.1'),
    createdAt: String(r.created_at),
  }));

  if (typeFilter && typeFilter !== 'ALL') {
    items = items.filter((a) => a.activityType === typeFilter);
  }
  if (search) {
    items = items.filter((a) =>
      [a.username, a.detail, a.activityType].join(' ').toLowerCase().includes(search)
    );
  }

  res.json({ items });
});

// Public / Internal API to record user website activity
syncRouter.post('/sync/activity', (req, res) => {
  const { userId, username, activityType, detail, animeId, episodeId } = req.body || {};
  const workspaceId = 'ws_benilin';
  const cleanUser = typeof username === 'string' ? username.trim() : 'Guest Fan';
  const cleanId = typeof userId === 'string' ? userId.trim() : `usr_${crypto.randomUUID().slice(0, 8)}`;
  const cleanType = typeof activityType === 'string' ? activityType : 'ANIME_VIEW';
  const cleanDetail = typeof detail === 'string' ? detail.slice(0, 255) : 'User activity recorded';

  const actId = `act_${crypto.randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();

  db.prepare(
    `
    INSERT INTO user_activity_logs (
      id, workspace_id, user_id, username, activity_type, detail, anime_id, episode_id, ip_address, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    actId,
    workspaceId,
    cleanId,
    cleanUser,
    cleanType,
    cleanDetail,
    animeId || null,
    episodeId || null,
    getClientIp(req),
    now
  );

  res.status(201).json({ id: actId, ok: true });
});

// ============================================================================
// WEBSITE SETTINGS MANAGEMENT
// ============================================================================

syncRouter.get('/sync/settings', requireAuth, (req, res) => {
  const settings = getWebsiteSettings(req.admin!.workspaceId);
  res.json(settings);
});

syncRouter.put('/sync/settings', requireAuth, requirePermission('settings:manage'), (req, res) => {
  const admin = req.admin!;
  const updated = updateWebsiteSettings(admin.workspaceId, req.body || {});

  recordAuditLog({
    workspaceId: admin.workspaceId,
    adminId: admin.id,
    adminUsername: admin.username,
    action: 'WEBSITE_SETTINGS_UPDATED',
    resourceType: 'WEBSITE_SETTINGS',
    newValue: { siteName: updated.siteName, maintenanceMode: updated.maintenanceMode },
    status: 'SUCCESS',
    ipAddress: getClientIp(req),
  });

  res.json(updated);
});

// ============================================================================
// DEDICATED EXPORT CENTRE API
// ============================================================================

syncRouter.post('/sync/export', requireAuth, (req, res) => {
  const admin = req.admin!;
  const options: DataExportOptions = {
    exportFormat: req.body?.exportFormat === 'CSV' ? 'CSV' : 'JSON',
    selectedCategories: Array.isArray(req.body?.selectedCategories) ? req.body.selectedCategories : ['ALL'],
    startDate: req.body?.startDate,
    endDate: req.body?.endDate,
  };

  const exportResult = generateExportData(admin.workspaceId, options);

  recordAuditLog({
    workspaceId: admin.workspaceId,
    adminId: admin.id,
    adminUsername: admin.username,
    action: 'WEBSITE_DATA_EXPORTED',
    resourceType: 'DATA_EXPORT',
    newValue: { format: options.exportFormat, categories: options.selectedCategories },
    status: 'SUCCESS',
    ipAddress: getClientIp(req),
  });

  res.setHeader('Content-Type', exportResult.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${exportResult.filename}"`);
  res.send(exportResult.content);
});

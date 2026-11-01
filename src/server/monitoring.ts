import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { db } from './db';
import { LogSeverity } from '../shared/types';

export interface RequestMetricSample {
  timestamp: string;
  method: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  workspaceId: string | null;
}

const MAX_LATENCY_SAMPLES = 300;
const recentRequestSamples: RequestMetricSample[] = [];

const SENSITIVE_KEY_PATTERN = /(password|secret|token|apikey|api_key|authorization|cookie|credential|private_key)/i;

export function redactSensitiveData(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (value.length > 24 && /^(Bearer\s+|KN-)/i.test(value)) {
      return '[REDACTED]';
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(redactSensitiveData);
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactSensitiveData(v);
      }
    }
    return out;
  }
  return value;
}

export function recordSystemLog(params: {
  workspaceId?: string | null;
  severity: LogSeverity;
  component: string;
  message: string;
  metadata?: Record<string, unknown>;
}): void {
  try {
    const id = `syslog_${crypto.randomUUID()}`;
    const safeMetadata = params.metadata ? JSON.stringify(redactSensitiveData(params.metadata)) : null;
    db.prepare(
      `
      INSERT INTO system_logs (id, workspace_id, severity, component, message, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      id,
      params.workspaceId || null,
      params.severity,
      params.component,
      params.message.slice(0, 1000),
      safeMetadata,
      new Date().toISOString()
    );
  } catch (err) {
    console.error('[SystemLogWriteError]', err);
  }
}

export function recordAuditLog(params: {
  workspaceId: string;
  adminId?: string | null;
  adminUsername: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  previousValue?: unknown;
  newValue?: unknown;
  status: 'SUCCESS' | 'FAILURE';
  ipAddress: string;
}): void {
  try {
    const id = `audit_${crypto.randomUUID()}`;
    const prevStr =
      params.previousValue !== undefined
        ? JSON.stringify(redactSensitiveData(params.previousValue))
        : null;
    const nextStr =
      params.newValue !== undefined
        ? JSON.stringify(redactSensitiveData(params.newValue))
        : null;

    db.prepare(
      `
      INSERT INTO audit_logs (
        id, workspace_id, admin_id, admin_username, action,
        resource_type, resource_id, previous_value, new_value, status, ip_address, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      id,
      params.workspaceId,
      params.adminId || null,
      params.adminUsername,
      params.action,
      params.resourceType,
      params.resourceId || null,
      prevStr,
      nextStr,
      params.status,
      params.ipAddress,
      new Date().toISOString()
    );
  } catch (err) {
    console.error('[AuditLogWriteError]', err);
  }
}

export function requestTelemetryMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!req.path.startsWith('/api/')) {
    next();
    return;
  }

  const start = performance.now();
  res.on('finish', () => {
    const latencyMs = Math.round((performance.now() - start) * 100) / 100;
    const sample: RequestMetricSample = {
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      latencyMs,
      workspaceId: req.admin?.workspaceId || null,
    };

    recentRequestSamples.push(sample);
    if (recentRequestSamples.length > MAX_LATENCY_SAMPLES) {
      recentRequestSamples.shift();
    }

    if (res.statusCode >= 500) {
      recordSystemLog({
        workspaceId: req.admin?.workspaceId || null,
        severity: LogSeverity.ERROR,
        component: 'APIGateway',
        message: `HTTP ${res.statusCode} on ${req.method} ${req.path} (${latencyMs}ms)`,
      });
    }
  });

  next();
}

export function getTelemetrySummary(workspaceId: string) {
  const scoped = recentRequestSamples.filter(
    (s) => s.workspaceId === null || s.workspaceId === workspaceId
  );
  const totalRequests = scoped.length;
  const failedRequests = scoped.filter((s) => s.statusCode >= 400).length;
  const serverErrors = scoped.filter((s) => s.statusCode >= 500).length;
  const avgLatencyMs =
    totalRequests > 0
      ? Math.round((scoped.reduce((acc, s) => acc + s.latencyMs, 0) / totalRequests) * 100) / 100
      : 0;
  const p95LatencyMs =
    totalRequests > 0
      ? [...scoped].sort((a, b) => a.latencyMs - b.latencyMs)[
          Math.min(totalRequests - 1, Math.floor(totalRequests * 0.95))
        ].latencyMs
      : 0;

  return {
    totalSampledRequests: totalRequests,
    failedApiRequests: failedRequests,
    serverErrors,
    avgLatencyMs,
    p95LatencyMs,
    recentSamples: scoped.slice(-40),
  };
}

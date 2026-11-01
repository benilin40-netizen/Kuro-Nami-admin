const SESSION_STORAGE_TOKEN_KEY = 'kn_admin_bearer_token';
const SESSION_STORAGE_CSRF_KEY = 'kn_admin_csrf_token';

export function setClientAuthTokens(sessionToken: string | null, csrfToken: string | null): void {
  try {
    if (sessionToken) {
      sessionStorage.setItem(SESSION_STORAGE_TOKEN_KEY, sessionToken);
    } else {
      sessionStorage.removeItem(SESSION_STORAGE_TOKEN_KEY);
    }
    if (csrfToken) {
      sessionStorage.setItem(SESSION_STORAGE_CSRF_KEY, csrfToken);
    } else {
      sessionStorage.removeItem(SESSION_STORAGE_CSRF_KEY);
    }
  } catch {
    // Ignore storage quota/sandbox errors
  }
}

export function updateClientCsrfToken(csrfToken: string): void {
  try {
    sessionStorage.setItem(SESSION_STORAGE_CSRF_KEY, csrfToken);
  } catch {
    // Ignore
  }
}

export function getStoredBearerToken(): string | null {
  try {
    return sessionStorage.getItem(SESSION_STORAGE_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getStoredCsrfToken(): string | null {
  try {
    return sessionStorage.getItem(SESSION_STORAGE_CSRF_KEY);
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    isFormData?: boolean;
  } = {}
): Promise<T> {
  const method = options.method || 'GET';
  const headers: Record<string, string> = {};

  const bearer = getStoredBearerToken();
  if (bearer) {
    headers['Authorization'] = `Bearer ${bearer}`;
  }

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const csrf = getStoredCsrfToken();
    if (csrf) {
      headers['X-CSRF-Token'] = csrf;
    }
  }

  let fetchBody: BodyInit | undefined;
  if (options.isFormData && options.body instanceof FormData) {
    fetchBody = options.body;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(options.body);
  }

  const response = await fetch(path, {
    method,
    headers,
    body: fetchBody,
    credentials: 'include',
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : null;

  if (!response.ok) {
    const errMsg =
      (data && typeof data.error === 'string' && data.error) ||
      `Request failed with status ${response.status}`;
    throw new ApiError(errMsg, response.status, data);
  }

  return data as T;
}

export async function fetchAuthenticatedAssetObjectUrl(assetId: string): Promise<string | null> {
  try {
    const headers: Record<string, string> = {};
    const bearer = getStoredBearerToken();
    if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
    const res = await fetch(`/api/v1/assets/${encodeURIComponent(assetId)}/file`, {
      headers,
      credentials: 'include',
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const exp = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, exp);
  return `${value >= 100 || exp === 0 ? Math.round(value) : value.toFixed(2)} ${units[exp]}`;
}

export function formatCurrencyCents(cents: number, currency = 'USD'): string {
  const value = (Number(cents) || 0) / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return iso;
  }
}

export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

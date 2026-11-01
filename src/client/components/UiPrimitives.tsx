import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  HelpCircle,
  Image as ImageIcon,
  ShieldAlert,
  Slash,
  X,
  XCircle,
} from 'lucide-react';
import { ProviderHealthStatus, StorageHealthStatus } from '../../shared/types';
import { fetchAuthenticatedAssetObjectUrl } from '../api';

export interface ToastMessage {
  id: string;
  tone: 'success' | 'error' | 'info';
  title: string;
  detail?: string;
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  maxWidthClass = 'max-w-2xl',
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  maxWidthClass?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`w-full ${maxWidthClass} max-h-[90vh] flex flex-col rounded-lg border border-slate-800 bg-[#111827] text-slate-100 shadow-2xl`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-6 py-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-100">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive = false,
  busy = false,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  busy?: boolean;
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title} maxWidthClass="max-w-md">
      <p className="text-sm leading-relaxed text-slate-300">{description}</p>
      <div className="mt-6 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-slate-700 px-4 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className={`rounded-md px-4 py-2 text-xs font-medium text-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 ${
            destructive ? 'bg-red-600 hover:bg-red-500' : 'bg-sky-600 hover:bg-sky-500'
          }`}
        >
          {busy ? 'Processing...' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Clean unboxed status label with explicit icon + text (never relies on hue alone, zero pill enclosure).
 */
export function ProviderStatusLabel({ status }: { status: ProviderHealthStatus }) {
  switch (status) {
    case ProviderHealthStatus.CONNECTED:
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 whitespace-nowrap">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>Provider Connected</span>
        </span>
      );
    case ProviderHealthStatus.CONFIGURED_UNREACHABLE:
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 whitespace-nowrap">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>Configured · Unreachable</span>
        </span>
      );
    case ProviderHealthStatus.UNAVAILABLE:
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-400 whitespace-nowrap">
          <XCircle className="h-3.5 w-3.5 shrink-0" />
          <span>Provider Unavailable</span>
        </span>
      );
    case ProviderHealthStatus.AUTH_FAILED:
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-400 whitespace-nowrap">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
          <span>Authentication Failed</span>
        </span>
      );
    case ProviderHealthStatus.NOT_CONFIGURED:
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 whitespace-nowrap">
          <HelpCircle className="h-3.5 w-3.5 shrink-0" />
          <span>Not Configured</span>
        </span>
      );
  }
}

export function StorageStatusLabel({
  status,
  isVerified,
}: {
  status: StorageHealthStatus;
  isVerified: boolean;
}) {
  if (status === StorageHealthStatus.DISABLED) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 whitespace-nowrap">
        <Slash className="h-3.5 w-3.5 shrink-0" />
        <span>Disabled</span>
      </span>
    );
  }
  if (!isVerified || status === StorageHealthStatus.UNTESTED) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 whitespace-nowrap">
        <Clock className="h-3.5 w-3.5 shrink-0" />
        <span>Untested · Pending Probe</span>
      </span>
    );
  }
  if (status === StorageHealthStatus.CONNECTED) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 whitespace-nowrap">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        <span>Verified Connected</span>
      </span>
    );
  }
  if (status === StorageHealthStatus.AUTH_FAILED) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-400 whitespace-nowrap">
        <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
        <span>Auth Rejected</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-400 whitespace-nowrap">
      <XCircle className="h-3.5 w-3.5 shrink-0" />
      <span>Unreachable</span>
    </span>
  );
}

export function AuthenticatedAssetThumb({
  assetId,
  alt,
  className = 'h-12 w-9',
}: {
  assetId: string | null | undefined;
  alt: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let currentUrl: string | null = null;

    if (!assetId) {
      setSrc(null);
      return;
    }

    fetchAuthenticatedAssetObjectUrl(assetId).then((url) => {
      if (active) {
        currentUrl = url;
        setSrc(url);
      } else if (url) {
        URL.revokeObjectURL(url);
      }
    });

    return () => {
      active = false;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [assetId]);

  if (!src) {
    return (
      <div
        className={`${className} flex items-center justify-center rounded border border-slate-800 bg-slate-900/90 text-slate-600 shrink-0`}
      >
        <ImageIcon className="h-4 w-4" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setSrc(null)}
      className={`${className} rounded border border-slate-800 object-cover shrink-0`}
    />
  );
}

export function TableSkeleton({ rows = 4, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-slate-800/70">
      {Array.from({ length: rows }).map((_, rIdx) => (
        <div key={rIdx} className="grid grid-cols-5 gap-4 px-4 py-3 animate-pulse">
          {Array.from({ length: cols }).map((__, cIdx) => (
            <div key={cIdx} className="h-4 rounded bg-slate-800/70" />
          ))}
        </div>
      ))}
    </div>
  );
}

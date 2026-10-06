import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  GitMerge,
  Loader2,
  RefreshCw,
  Wifi,
  WifiOff,
} from 'lucide-react';

import { retryAll } from '@/services/offline/syncEngine';
import { applyServiceWorkerUpdate, subscribeToUpdate } from '@/lib/pwa';
import { useSyncStatus } from '@/hooks/useSyncStatus';

/**
 * Connection & synchronization indicator.
 *
 * Rendered once in the authenticated app shell so every role sees the same,
 * consistent offline state: connection, last successful sync, pending change
 * count, live progress, failed operations with reasons, conflicts needing
 * review, and a manual retry action. Styling follows the KALUSAGAP blue design
 * system and stays responsive (icon-only on narrow screens).
 */

const formatRelative = (timestamp) => {
  if (!timestamp) return 'Never';
  const diff = Date.now() - timestamp;
  if (diff < 45_000) return 'Just now';
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Date(timestamp).toLocaleDateString();
};

const Stat = ({ label, value, tone = 'default' }) => {
  const tones = {
    default: 'text-slate-700 dark:text-slate-200',
    warn: 'text-amber-700',
    danger: 'text-brand-danger',
    success: 'text-brand-green',
  };
  return (
    <div className="rounded-lg border border-slate-200 dark:border-border bg-brand-bg/50 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold ${tones[tone] || tones.default}`}>{value}</p>
    </div>
  );
};

const OfflineStatusIndicator = () => {
  const status = useSyncStatus();
  const [open, setOpen] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const ref = useRef(null);

  useEffect(() => subscribeToUpdate(() => setUpdateReady(true)), []);

  useEffect(() => {
    const handler = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const { counts = {}, failed = [], conflicts = [], syncing, progress, online, lastSyncedAt } = status;
  const attention = (counts.pending || 0) + (counts.failed || 0) + (counts.conflict || 0);
  const hasProblems = (counts.failed || 0) + (counts.conflict || 0) > 0;

  const connectionLabel = online ? 'Online' : 'Offline';
  const summary = useMemo(() => {
    if (syncing) {
      const total = progress?.total || 0;
      return total ? `Syncing ${progress?.processed || 0}/${total}` : 'Synchronizing…';
    }
    if (!online) return 'Working offline';
    if (attention > 0) return `${attention} change${attention === 1 ? '' : 's'} pending`;
    return 'All changes synchronized';
  }, [syncing, progress, online, attention]);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await retryAll();
    } finally {
      setRetrying(false);
    }
  };

  const progressPct =
    progress && progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Connection status: ${connectionLabel}. ${summary}`}
        aria-expanded={open}
        className="relative flex h-10 items-center gap-2 rounded-xl px-2.5 text-sm transition-colors hover:bg-slate-50 dark:hover:bg-hover"
      >
        {online ? (
          <Wifi className="h-5 w-5 text-brand-green" strokeWidth={1.8} />
        ) : (
          <WifiOff className="h-5 w-5 text-amber-600" strokeWidth={1.8} />
        )}
        {syncing && <Loader2 className="h-4 w-4 animate-spin text-brand-blue" />}
        <span className="hidden text-xs font-medium text-slate-600 dark:text-slate-300 lg:inline">
          {connectionLabel}
        </span>
        {attention > 0 && (
          <span
            className={`absolute -right-0.5 -top-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[11px] font-semibold text-white ${
              hasProblems ? 'bg-brand-danger' : 'bg-brand-blue'
            }`}
          >
            {attention > 9 ? '9+' : attention}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Connection and synchronization status"
          className="absolute right-0 top-full z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-soft dark:border-border dark:bg-popover"
        >
          <div className="border-b border-slate-200 bg-brand-bg/60 px-4 py-3 dark:border-border">
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${online ? 'bg-brand-green' : 'bg-amber-500'}`}
                aria-hidden="true"
              />
              <p className="text-sm font-semibold text-brand-ink dark:text-foreground">
                {connectionLabel}
              </p>
              <span className="ml-auto text-xs text-slate-500">{summary}</span>
            </div>
            {syncing && (
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-brand-blue transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            )}
          </div>

          {updateReady && (
            <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
              <RefreshCw className="h-4 w-4 shrink-0" />
              <span className="flex-1">A new version of KALUSAGAP is available.</span>
              <button
                type="button"
                onClick={() => applyServiceWorkerUpdate()}
                className="font-semibold text-brand-blue hover:underline"
              >
                Refresh
              </button>
            </div>
          )}

          <div className="space-y-3 p-4">
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Pending" value={counts.pending || 0} tone={counts.pending ? 'warn' : 'success'} />
              <Stat label="Failed" value={counts.failed || 0} tone={counts.failed ? 'danger' : 'success'} />
              <Stat label="Conflicts" value={counts.conflict || 0} tone={counts.conflict ? 'danger' : 'success'} />
            </div>

            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <CheckCircle2 className="h-3.5 w-3.5 text-brand-green" />
              Last successful synchronization: <span className="font-medium">{formatRelative(lastSyncedAt)}</span>
            </p>

            {counts.pending > 0 && (
              <p className="rounded-lg border border-brand-blue/20 bg-brand-light px-3 py-2 text-xs text-brand-dark">
                {counts.pending} change{counts.pending === 1 ? '' : 's'} saved on this device only,
                awaiting server confirmation.
              </p>
            )}

            {failed.length > 0 && (
              <div className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-brand-danger">
                  <AlertTriangle className="h-3.5 w-3.5" /> Failed operations
                </p>
                <ul className="max-h-32 space-y-1 overflow-y-auto">
                  {failed.map((item) => (
                    <li key={item.opId} className="rounded-md border border-red-100 bg-red-50/60 px-2.5 py-1.5 text-xs">
                      <span className="font-medium capitalize">{item.entity}</span>{' '}
                      <span className="text-slate-500">({item.opType} · attempt {item.attempts})</span>
                      <p className="mt-0.5 text-slate-600">{item.message}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {conflicts.length > 0 && (
              <div className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                  <GitMerge className="h-3.5 w-3.5" /> Conflicts needing review
                </p>
                <ul className="max-h-32 space-y-1 overflow-y-auto">
                  {conflicts.map((item) => (
                    <li key={item.opId} className="rounded-md border border-amber-100 bg-amber-50/60 px-2.5 py-1.5 text-xs">
                      <span className="font-medium capitalize">{item.entity}</span>
                      <p className="mt-0.5 text-slate-600">{item.message}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!hasProblems && attention === 0 && (
              <p className="flex items-center gap-1.5 text-xs text-slate-500">
                <CloudOff className="h-3.5 w-3.5" />
                No changes are waiting to synchronize.
              </p>
            )}

            <button
              type="button"
              onClick={handleRetry}
              disabled={retrying || syncing || !online}
              className="inline-flex w-full items-center justify-center gap-2 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {retrying || syncing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {online ? 'Retry synchronization' : 'Offline — retry when connected'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default OfflineStatusIndicator;

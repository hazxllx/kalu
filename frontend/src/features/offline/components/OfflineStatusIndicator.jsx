import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Loader2,
  Wifi,
  WifiOff,
} from 'lucide-react';

import { retryAll, retryOperation } from '@/services/offline/syncEngine';
import {
  OFFLINE_DB_READY_EVENT,
  OFFLINE_DB_UPGRADE_BLOCKED_EVENT,
  isOfflineDbUpgradeBlocked,
} from '@/services/offline/db';
import { applyServiceWorkerUpdate, subscribeToUpdate } from '@/lib/pwa';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { useAuth } from '@/context/AuthContext';
import { usePermissions } from '@/context/PermissionsContext';
import { useNavigate } from 'react-router-dom';

/**
 * Connection & synchronization indicator.
 *
 * Rendered once in the authenticated app shell so every role sees the same,
 * consistent offline state: connection, last successful sync, pending change
 * count, live progress, failed operations with reasons, conflicts needing
 * review, and a manual retry action. Styling follows the KALUSAGAP blue design
 * system and stays responsive.
 */

const formatTimestamp = (timestamp, initialized) => {
  if (!initialized) return 'Loading...';
  if (timestamp == null) return 'Not recorded';
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleString();
};

const formatCount = (value, initialized) =>
  initialized && Number.isFinite(value) ? value : '—';

const Stat = ({ label, value, tone = 'default' }) => {
  const tones = {
    neutral: 'text-[#475569] dark:text-slate-300',
    info: 'text-[#2563EB] dark:text-blue-400',
    warning: 'text-[#B45309] dark:text-amber-400',
    danger: 'text-[#DC2626] dark:text-red-400',
    success: 'text-[#059669] dark:text-emerald-400',
  };
  return (
    <div className="flex min-w-0 flex-col items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-center dark:border-border dark:bg-brand-bg/50">
      <p className="whitespace-nowrap text-xs font-medium text-slate-600">{label}</p>
      <p className={`mt-1 text-xl font-semibold leading-none tabular-nums ${tones[tone] || tones.neutral}`}>{value}</p>
    </div>
  );
};

const OfflineStatusIndicator = () => {
  const status = useSyncStatus();
  const { user } = useAuth();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [upgradeBlocked, setUpgradeBlocked] = useState(isOfflineDbUpgradeBlocked);
  const ref = useRef(null);

  useEffect(() => subscribeToUpdate(() => setUpdateReady(true)), []);

  useEffect(() => {
    const onBlocked = () => setUpgradeBlocked(true);
    const onReady = () => setUpgradeBlocked(false);
    window.addEventListener(OFFLINE_DB_UPGRADE_BLOCKED_EVENT, onBlocked);
    window.addEventListener(OFFLINE_DB_READY_EVENT, onReady);
    return () => {
      window.removeEventListener(OFFLINE_DB_UPGRADE_BLOCKED_EVENT, onBlocked);
      window.removeEventListener(OFFLINE_DB_READY_EVENT, onReady);
    };
  }, []);

  useEffect(() => {
    const handler = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const {
    counts = {},
    failed = [],
    conflicts = [],
    awaitingConfirmation = [],
    syncing,
    progress,
    online,
    lastSyncedAt,
    serverAvailable,
    lastError,
    initialized,
  } = status;
  const attention = (counts.pending || 0) + (counts.awaiting_confirmation || 0) + (counts.failed || 0) + (counts.conflict || 0) + (counts.offlineDraft || 0);
  const hasProblems = (counts.failed || 0) + (counts.conflict || 0) > 0;
  const canRetry = (counts.pending || 0) > 0 || (counts.awaiting_confirmation || 0) > 0 || failed.some((item) => item.retryable);
  const waitingCount = (counts.pending || 0) + (counts.awaiting_confirmation || 0) + (counts.syncing || 0) + (counts.offlineDraft || 0);
  const metricsAvailable = initialized && !(lastError && !lastError.code) && [
    counts.synced,
    counts.pending,
    counts.awaiting_confirmation,
    counts.syncing,
    counts.failed,
    counts.conflict,
    counts.offlineDraft,
  ].every(Number.isFinite);
  const noPendingChanges = metricsAvailable && waitingCount === 0 && !hasProblems && !lastError && serverAvailable !== false;

  const connectionLabel = online ? 'Online' : 'Offline';
  const summary = useMemo(() => {
    if (!initialized) return 'Loading synchronization status...';
    if (!metricsAvailable) return 'Synchronization status unavailable';
    if (upgradeBlocked) return 'Close other tabs to finish device storage upgrade';
    if (syncing) {
      const total = progress?.total || 0;
      return total
        ? `Automatically synchronizing pending changes... (${progress?.processed || 0}/${total})`
        : 'Automatically synchronizing pending changes...';
    }
    if (counts.failed > 0) return 'Synchronization failed';
    if (lastError?.code === 'auth') return 'Sign in again to synchronize';
    if (serverAvailable === false) return 'Your device is online, but the server is currently unreachable.';
    if (lastError) return 'Synchronization failed';
    if (counts.conflict > 0) return 'Changes need review';
    if (waitingCount > 0) return 'Pending changes will synchronize automatically.';
    if (!online) return 'Working offline';
    return 'All changes are synchronized.';
  }, [initialized, metricsAvailable, syncing, progress, counts.failed, counts.conflict, waitingCount, online, upgradeBlocked, serverAvailable, lastError]);

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
        className="relative flex h-10 items-center gap-2 rounded-md px-2.5 text-sm transition-colors hover:bg-slate-50 dark:hover:bg-hover"
      >
        {online ? (
          <Wifi className="h-5 w-5 text-brand-green" strokeWidth={1.8} />
        ) : (
          <WifiOff className="h-5 w-5 text-amber-600" strokeWidth={1.8} />
        )}
        {syncing && <Loader2 className="h-4 w-4 animate-spin text-brand-blue" />}
        {upgradeBlocked && <AlertTriangle className="h-4 w-4 text-amber-600" />}
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
          className="absolute right-0 top-full z-50 mt-2 max-h-[calc(100vh-5rem)] w-[min(24rem,calc(100vw-1.5rem))] overflow-y-auto rounded-md border border-slate-200 bg-white shadow-soft dark:border-border dark:bg-popover"
        >
          <div className="border-b border-slate-200 px-4 py-3 dark:border-border">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-brand-ink dark:text-foreground">
                Synchronization
              </p>
              <span className="ml-auto max-w-[65%] text-right text-xs text-slate-500">
                {noPendingChanges ? 'All changes are synchronized.' : summary}
              </span>
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

          {serverAvailable === false && (
            <p className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
              Your device is online, but the server is currently unreachable. Saved changes will
              synchronize automatically when the server becomes available.
            </p>
          )}
          {lastError?.code === 'auth' && (
            <p className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
              {lastError.message}
            </p>
          )}

          {upgradeBlocked && (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
              <p>
                Device storage is waiting for another KALUSAGAP tab to close before it can
                finish the upgrade. Close the other tab; your saved offline data will be kept.
              </p>
            </div>
          )}

          {updateReady && (
            <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
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

          <div className="space-y-3 p-3">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Successful" value={formatCount(counts.synced, initialized)} tone="success" />
              <Stat label="Pending" value={formatCount(counts.pending, initialized)} tone="info" />
              <Stat label="Awaiting confirmation" value={formatCount(counts.awaiting_confirmation, initialized)} tone="warning" />
              <Stat label="Failed" value={formatCount(counts.failed, initialized)} tone="danger" />
              <Stat label="Conflicts" value={formatCount(counts.conflict, initialized)} tone="warning" />
            </div>

            {counts.pending > 0 && (
              <p className="rounded-lg border border-brand-blue/20 bg-brand-light px-3 py-2 text-xs text-brand-dark">
                {counts.pending} change{counts.pending === 1 ? '' : 's'} pending. Pending changes will synchronize automatically.
              </p>
            )}
            {counts.offlineDraft > 0 && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {counts.offlineDraft} draft{counts.offlineDraft === 1 ? '' : 's'} saved offline — requires online confirmation.
              </p>
            )}

            {(counts.awaiting_confirmation || 0) > 0 && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {counts.awaiting_confirmation} operation{counts.awaiting_confirmation === 1 ? '' : 's'} awaiting confirmation.
                The server will be reconciled using the original operation UUID before retrying.
              </p>
            )}

            {failed.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-[#DC2626]">
                  Failed operations
                </p>
                <ul className="max-h-32 space-y-1 overflow-y-auto">
                  {failed.map((item) => (
                    <li key={item.opId} className="rounded-md border border-red-100 bg-red-50/60 px-2.5 py-1.5 text-xs">
                      <span className="font-medium capitalize">{item.entity}</span>{' '}
                      <span className="text-slate-500">({item.opType} · attempt {item.attempts})</span>
                      <p className="mt-0.5 text-slate-600">{item.message}</p>
                      {item.retryable && (
                        <button
                          type="button"
                          disabled={!online || retrying}
                          onClick={() => void retryOperation(item.opId)}
                          className="mt-1 text-brand-blue underline disabled:opacity-50"
                        >
                          Retry operation
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {conflicts.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Conflicts needing review
                </p>
                <ul className="max-h-32 space-y-1 overflow-y-auto">
                  {conflicts.map((item) => (
                    <li key={item.opId} className="rounded-md border border-amber-100 bg-amber-50/60 px-2.5 py-1.5 text-xs">
                      <span className="font-medium capitalize">{item.entity}</span>
                      <p className="mt-0.5 text-slate-600">{item.message}</p>
                      {item.entity === 'resident' && item.opType === 'update' && user?.role && can('residents.edit') && (
                        <button type="button" disabled={!online} className="mt-1 text-brand-blue underline disabled:opacity-50" onClick={() => { setOpen(false); navigate(`/app/${user.role}/residents`); }}>
                          Review Resident Changes
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {syncing ? (
              <button type="button" disabled className="inline-flex w-full items-center justify-center rounded-btn bg-brand-blue/70 px-4 py-2 text-sm font-medium text-white">
                Automatically synchronizing pending changes...
              </button>
            ) : canRetry ? (
              <button
                type="button"
                onClick={handleRetry}
                disabled={retrying || !online}
                className="inline-flex w-full items-center justify-center rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                {retrying ? 'Synchronizing...' : online ? 'Sync Now' : 'Offline — retry when connected'}
              </button>
            ) : hasProblems ? (
              (counts.conflict || 0) > 0
                ? null
                : <p className="text-xs text-slate-500">A retry may be available automatically.</p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-slate-200 bg-slate-50/70 px-3 py-2.5 text-xs dark:border-border dark:bg-brand-bg/40">
            <p className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-200">
              <span className={`h-2 w-2 rounded-full ${online ? 'bg-brand-green' : 'bg-amber-500'}`} aria-hidden="true" />
              {connectionLabel}
              <span className="font-normal text-slate-500">· Pending: {formatCount(counts.pending, initialized)}</span>
            </p>
            <p className="w-full text-slate-500">
              Last synchronized:{' '}
              <span className="font-medium text-slate-700 dark:text-slate-200">
                {formatTimestamp(lastSyncedAt, initialized)}
              </span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default OfflineStatusIndicator;

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { reviewResidentConflict, resolveResidentConflict } from '@/services/offline/residentConflictService';

const displayValue = (value) => value === null || value === undefined || value === '' ? '(empty)' : String(value);
const fieldLabel = (field) => field.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase());

export default function ResidentConflictReview({ onResolved }) {
  const { user } = useAuth();
  const sync = useSyncStatus();
  const conflicts = (sync.conflicts || []).filter((item) => item.entity === 'resident' && item.opType === 'update');
  const [review, setReview] = useState(null);
  const [selectedFields, setSelectedFields] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ownerRef = useRef(user?.id);
  ownerRef.current = user?.id;

  useEffect(() => { setReview(null); setSelectedFields([]); setError(''); }, [user?.id]);

  const open = async (opId) => {
    const ownerId = user?.id;
    setBusy(true);
    setError('');
    try {
      const comparison = await reviewResidentConflict({ ownerId, opId });
      if (ownerRef.current !== ownerId) return;
      setReview(comparison);
      setSelectedFields([]);
    } catch (err) {
      if (ownerRef.current === ownerId) setError(err?.message || 'Could not load the current resident version.');
    } finally {
      setBusy(false);
    }
  };

  const resolve = async (useServer) => {
    if (!review) return;
    const ownerId = user?.id;
    setBusy(true);
    setError('');
    try {
      const result = await resolveResidentConflict({ ownerId, opId: review.opId, reviewedRevision: review.revision, selectedFields, useServer });
      if (ownerRef.current !== ownerId) return;
      setReview(null);
      setSelectedFields([]);
      await onResolved?.(result);
    } catch (err) {
      if (ownerRef.current === ownerId) setError(err?.message || 'Could not resolve the conflict. Your local changes remain saved.');
    } finally {
      setBusy(false);
    }
  };

  if (!conflicts.length && !review && !error) return null;
  return (
    <section className="mb-4 rounded-card border border-amber-200 bg-amber-50 p-4" aria-label="Resident synchronization conflicts">
      <div className="flex flex-wrap items-center gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-700" />
        <p className="flex-1 text-sm text-amber-900">Saved resident changes need review. They have not overwritten the newer server record.</p>
        {conflicts.map((item, index) => (
          <button key={item.opId} type="button" onClick={() => open(item.opId)} disabled={busy || !sync.online} className="rounded-btn border border-amber-300 bg-white px-3 py-2 text-sm disabled:opacity-50">
            Review Change {index + 1}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-brand-danger">{error}</p>}
      {review && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="resident-conflict-title" className="w-full max-w-3xl rounded-card bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="resident-conflict-title" className="text-lg font-semibold text-brand-ink">Review Resident Changes</h2>
                <p className="mt-1 text-sm text-brand-gray">Server revision {review.revision}. Select only local values you intend to apply; unselected values remain unchanged.</p>
              </div>
              <button aria-label="Close conflict review" type="button" disabled={busy} onClick={() => setReview(null)}><X className="h-5 w-5" /></button>
            </div>
            <div className="mt-4 max-h-[55vh] overflow-auto">
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b border-brand-border"><th className="p-2">Apply</th><th className="p-2">Field</th><th className="p-2">Current Server</th><th className="p-2">Saved Local Change</th></tr></thead>
                <tbody>{review.fields.map((item) => (
                  <tr key={item.field} className="border-b border-brand-border">
                    <td className="p-2"><input type="checkbox" aria-label={`Apply local ${fieldLabel(item.field)}`} checked={selectedFields.includes(item.field)} onChange={(event) => setSelectedFields((fields) => event.target.checked ? [...fields, item.field] : fields.filter((field) => field !== item.field))} disabled={busy} /></td>
                    <th className="p-2 font-medium">{fieldLabel(item.field)}</th>
                    <td className="max-w-56 break-words p-2">{displayValue(item.serverValue)}</td>
                    <td className="max-w-56 break-words p-2">{displayValue(item.localValue)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {error && <p role="alert" className="mt-3 text-sm text-brand-danger">{error}</p>}
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button type="button" disabled={busy} onClick={() => open(review.opId)} className="rounded-btn border border-brand-border px-4 py-2 text-sm">Reload Comparison</button>
              <button type="button" disabled={busy} onClick={() => resolve(true)} className="rounded-btn border border-brand-border px-4 py-2 text-sm">Keep Server Version</button>
              <button type="button" disabled={busy || !selectedFields.length} onClick={() => resolve(false)} className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2 text-sm text-white disabled:opacity-50">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Apply Selected Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

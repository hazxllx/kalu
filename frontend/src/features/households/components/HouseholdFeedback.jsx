// frontend/src/features/households/components/HouseholdFeedback.jsx
import React, { useEffect } from 'react';
import { CheckCircle2, X } from 'lucide-react';

// Renders or manages HouseholdFeedback logic.
export default function HouseholdFeedback({ message, tone = 'success', onDismiss }) {
  useEffect(() => {
    if (!message || tone !== 'success' || !onDismiss) return undefined;
    const timer = setTimeout(onDismiss, 4500);
    return () => clearTimeout(timer);
  }, [message, tone, onDismiss]);
  if (!message) return null;
  const color = tone === 'error' ? 'border-red-200 bg-red-50 text-red-800' : tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-800';
  return <div role={tone === 'error' ? 'alert' : 'status'} className={`flex w-fit max-w-full items-start gap-2 rounded border px-3 py-2 text-xs leading-5 ${color}`}>
    {tone === 'success' && <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />}
    <span>{message}</span>
    {onDismiss && <button type="button" onClick={onDismiss} aria-label="Dismiss notification" className="-my-1 ml-1 grid min-h-7 min-w-7 place-items-center rounded hover:bg-black/5"><X className="h-3.5 w-3.5" /></button>}
  </div>;
}

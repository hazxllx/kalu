import React from "react";
import { AlertTriangle, ShieldCheck, Undo2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Confirmation step for consequential access changes.
 *
 * Driven entirely by a descriptor object, so the page can reuse it for a single
 * sensitive toggle, a whole-module change, a reset, or discarding edits:
 *
 *   { tone, title, description, confirmLabel, meta: [{ label, value }], onConfirm }
 */
const TONES = {
  grant: {
    icon: ShieldCheck,
    chip: "bg-brand-light text-brand-blue",
    rule: "bg-brand-blue",
    action: "bg-brand-blue text-white hover:bg-brand-dark",
  },
  revoke: {
    icon: AlertTriangle,
    chip: "bg-brand-danger/10 text-brand-danger",
    rule: "bg-brand-danger",
    action: "bg-brand-danger text-white hover:bg-[#8E1A23]",
  },
  reset: {
    icon: Undo2,
    chip: "bg-brand-goldpale text-brand-amber",
    rule: "bg-brand-gold",
    action: "bg-brand-gold text-white hover:bg-brand-amber",
  },
};

export default function ConfirmPermissionDialog({ request, onCancel, onConfirm }) {
  const tone = TONES[request?.tone] || TONES.grant;
  const ToneIcon = tone.icon;

  return (
    <AlertDialog open={Boolean(request)} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <AlertDialogContent className="max-w-md gap-0 overflow-hidden rounded-2xl border-slate-200 p-0 shadow-float sm:rounded-2xl">
        <div className={`h-1 w-full ${tone.rule}`} />

        <div className="px-6 pt-6">
          <div className="flex items-start gap-4">
            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tone.chip}`}>
              <ToneIcon className="h-5 w-5" strokeWidth={1.9} />
            </div>
            <div className="min-w-0">
              <p className="gov-kicker text-brand-gray">Confirm change</p>
              <AlertDialogTitle className="mt-1.5 font-heading text-base font-semibold leading-snug text-slate-900">
                {request?.title}
              </AlertDialogTitle>
            </div>
          </div>

          <AlertDialogDescription className="mt-4 text-sm leading-relaxed text-slate-600">
            {request?.description}
          </AlertDialogDescription>

          {request?.meta?.length > 0 && (
            <dl className="mt-4 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-slate-50/70">
              {request.meta.map((item) => (
                <div key={item.label} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    {item.label}
                  </dt>
                  <dd className="text-right text-sm font-medium text-slate-800">{item.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {request?.note && (
            <p className="mt-4 rounded-xl border border-brand-goldlight/60 bg-brand-goldpale px-4 py-3 text-xs leading-relaxed text-brand-amber">
              {request.note}
            </p>
          )}
        </div>

        <AlertDialogFooter className="mt-6 gap-2 border-t border-slate-200 bg-slate-50/70 px-6 py-4">
          <AlertDialogCancel className="mt-0 rounded-btn border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-100">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={`rounded-btn text-sm font-semibold ${tone.action}`}
          >
            {request?.confirmLabel || "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

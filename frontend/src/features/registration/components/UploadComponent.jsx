import React, { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { UploadCloud, FileText, X, CheckCircle2, ImageIcon, AlertTriangle, XCircle, Loader2, RotateCcw } from "lucide-react";
import { labelCls } from "@/features/registration/components/RegistrationDesign";
import { SLOT_STATUS, slotStatusLabel } from "@/features/registration/documentScreening";

const ACCEPTED = ".png,.jpg,.jpeg,.pdf";
const DEFAULT_EXTS = ["png", "jpg", "jpeg", "pdf"];
const MAX_SIZE = 10 * 1024 * 1024;

// Status presentation for the automated document check. Neutral until the
// backend result arrives; a rejected/error result is never shown as accepted.
const STATUS_META = {
  [SLOT_STATUS.CHECKING]: { tone: "text-brand-blue", bg: "bg-brand-blue/5 border-brand-blue/20", Icon: Loader2, spin: true },
  [SLOT_STATUS.PASSED]: { tone: "text-emerald-700", bg: "bg-emerald-50/70 border-emerald-200", Icon: CheckCircle2 },
  [SLOT_STATUS.FLAGGED]: { tone: "text-amber-700", bg: "bg-amber-50/70 border-amber-200", Icon: AlertTriangle },
  [SLOT_STATUS.REJECTED]: { tone: "text-brand-danger", bg: "bg-brand-danger/5 border-brand-danger/25", Icon: XCircle },
  [SLOT_STATUS.ERROR]: { tone: "text-brand-danger", bg: "bg-brand-danger/5 border-brand-danger/25", Icon: XCircle },
  [SLOT_STATUS.NOT_CHECKED]: { tone: "text-slate-500", bg: "bg-slate-50 border-slate-200", Icon: FileText },
};

export default function UploadComponent({
  label,
  optional = false,
  file,
  onFile,
  onRemove,
  accept = ACCEPTED,
  allowedExts = DEFAULT_EXTS,
  hint = "",
  screening = null,
}) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(file ? 100 : 0);
  const inputRef = useRef(null);
  const formatsHint = hint || `${allowedExts.map((e) => e.toUpperCase()).join(", ")} — up to 10 MB`;

  const handleFile = useCallback((f) => {
    setError("");
    if (!f) return;
    const ext = f.name.split(".").pop()?.toLowerCase();
    if (!allowedExts.includes(ext)) {
      setError(`Unsupported format. Please use ${allowedExts.map((e) => e.toUpperCase()).join(", ")}.`);
      return;
    }
    if (f.size > MAX_SIZE) {
      setError("File exceeds 10 MB limit.");
      return;
    }
    // Simulate upload progress, then hand the file to the parent which runs the
    // real automated screen. A newly selected file always starts as "checking".
    setProgress(0);
    const interval = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) { clearInterval(interval); return 100; }
        return p + 15;
      });
    }, 80);
    onFile(f);
  }, [onFile, allowedExts]);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const isImage = file?.type?.startsWith("image/");
  const status = screening?.status || SLOT_STATUS.NOT_CHECKED;
  const meta = STATUS_META[status] || STATUS_META[SLOT_STATUS.NOT_CHECKED];
  const StatusIcon = meta.Icon;

  // Replace = clear the current file + its screening result, then reopen the
  // picker. The old result is removed first so a stale result can never attach
  // to the replacement file.
  const handleReplace = (e) => {
    e.stopPropagation();
    setProgress(0);
    setError("");
    onRemove();
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.click();
    }
  };

  return (
    <div>
      <label className={`${labelCls} mb-0 block`}>
        {label}
        {!optional && <span className="ml-0.5 font-medium text-brand-danger">*</span>}
        {optional && (
          <span className="ml-1.5 font-normal normal-case tracking-normal text-slate-400">(Optional)</span>
        )}
      </label>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => handleFile(e.target.files[0])}
      />
      <AnimatePresence mode="wait">
        {!file ? (
          <motion.div
            key="dropzone"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={`group mt-1.5 cursor-pointer rounded-xl border border-dashed px-4 py-7 text-center transition-all duration-200 sm:py-8 ${
              dragging
                ? "border-brand-blue bg-brand-light/40"
                : "border-slate-300 bg-slate-50/70 hover:border-brand-blue hover:bg-brand-light/40"
            }`}
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-brand-blue/25 bg-white transition-colors group-hover:border-brand-blue/50">
              <UploadCloud className="h-6 w-6 text-brand-blue" strokeWidth={1.8} />
            </div>
            <p className="mt-3.5 text-[13px] font-semibold text-brand-ink">
              Drag & drop or{" "}
              <span className="text-brand-blue underline decoration-brand-blue/30 underline-offset-2">browse files</span>
            </p>
            <p className="mt-1.5 text-[11.5px] text-slate-400">{formatsHint}</p>
          </motion.div>
        ) : (
          <motion.div
            key="preview"
            initial={{ opacity: 0, scale: 0.99 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="mt-1.5 overflow-hidden rounded-xl border border-slate-200 bg-white"
          >
            {progress < 100 ? (
              <div className="p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-brand-blue/20 bg-brand-light">
                    <FileText className="h-5 w-5 text-brand-blue" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-brand-ink">{file.name}</p>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
                      <motion.div animate={{ width: `${progress}%` }} className="h-full rounded-full bg-brand-blue" />
                    </div>
                  </div>
                  <span className="font-stat text-[12px] font-bold text-slate-500">{progress}%</span>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 p-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                    {isImage ? (
                      <ImageIcon className="h-5 w-5 text-slate-400" />
                    ) : (
                      <FileText className="h-5 w-5 text-brand-blue" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-brand-ink">{file.name}</p>
                    <p className="text-[12px] text-slate-400">{(file.size / 1024).toFixed(0)} KB</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleReplace}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11.5px] font-semibold text-brand-ink transition-colors hover:border-brand-blue hover:text-brand-blue"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Replace
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onRemove(); setProgress(0); }}
                    aria-label="Remove file"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-brand-danger/10 hover:text-brand-danger"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {/* Automated document check result — the resident must never
                    have to guess whether the file was accepted. */}
                <div className={`flex items-start gap-2 border-t px-3 py-2.5 text-[11.5px] leading-relaxed ${meta.bg}`}>
                  <StatusIcon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${meta.tone} ${meta.spin ? "animate-spin" : ""}`} strokeWidth={2} />
                  <div className="min-w-0">
                    <span className={`font-semibold ${meta.tone}`}>
                      Automated check: {slotStatusLabel(screening)}
                    </span>
                    {status === SLOT_STATUS.REJECTED && screening?.message && (
                      <p className="mt-0.5 text-brand-ink">{screening.message}</p>
                    )}
                  </div>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {error && <p className="mt-1.5 text-[11.5px] font-medium text-brand-danger">{error}</p>}
    </div>
  );
}

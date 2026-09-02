import React, { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { UploadCloud, FileText, X, CheckCircle2, ImageIcon } from "lucide-react";

const ACCEPTED = ".png,.jpg,.jpeg,.pdf";
const MAX_SIZE = 10 * 1024 * 1024;

export default function UploadComponent({ label, optional = false, file, onFile, onRemove }) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(file ? 100 : 0);
  const inputRef = useRef(null);

  const handleFile = useCallback((f) => {
    setError("");
    if (!f) return;
    const ext = f.name.split(".").pop()?.toLowerCase();
    if (!["png", "jpg", "jpeg", "pdf"].includes(ext)) {
      setError("Unsupported format. Please use PNG, JPG, or PDF.");
      return;
    }
    if (f.size > MAX_SIZE) {
      setError("File exceeds 10 MB limit.");
      return;
    }
    // Simulate upload progress
    setProgress(0);
    const interval = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) { clearInterval(interval); return 100; }
        return p + 15;
      });
    }, 80);
    onFile(f);
  }, [onFile]);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const isImage = file?.type?.startsWith("image/");
  const isPdf = file?.name?.toLowerCase().endsWith(".pdf");

  return (
    <div>
      <label className="flex items-center gap-1 text-[12.5px] font-bold text-brand-ink">
        {label}
        {optional && <span className="font-normal text-brand-gray/70">(Optional)</span>}
      </label>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
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
            className={`mt-1.5 cursor-pointer border-2 border-dashed p-8 text-center transition-colors ${
              dragging ? "border-brand-blue bg-brand-light" : "border-brand-rule bg-brand-paper hover:border-brand-blue/50 hover:bg-brand-light/60"
            }`}
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center border border-brand-blue/25 bg-white">
              <UploadCloud className="h-6 w-6 text-brand-blue" strokeWidth={1.8} />
            </div>
            <p className="mt-3.5 text-[13px] font-bold text-brand-ink">
              Drag & drop or <span className="text-brand-blue underline decoration-brand-rule underline-offset-2">browse files</span>
            </p>
            <p className="mt-1.5 text-[11.5px] text-brand-gray">PNG, JPG, JPEG, PDF — up to 10 MB</p>
          </motion.div>
        ) : (
          <motion.div
            key="preview"
            initial={{ opacity: 0, scale: 0.99 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="mt-1.5 border border-brand-border bg-white"
          >
            {progress < 100 ? (
              <div className="p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center border border-brand-blue/20 bg-brand-light">
                    <FileText className="h-5 w-5 text-brand-blue" />
                  </div>
                  <div className="flex-1">
                    <p className="truncate text-[13px] font-medium text-brand-ink">{file.name}</p>
                    <div className="mt-1.5 h-1.5 bg-brand-border">
                      <motion.div animate={{ width: `${progress}%` }} className="h-full bg-brand-blue" />
                    </div>
                  </div>
                  <span className="font-stat text-[12px] font-bold text-brand-gray">{progress}%</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 p-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center border border-brand-border bg-brand-paper overflow-hidden">
                  {isImage ? (
                    <ImageIcon className="h-5 w-5 text-brand-gray" />
                  ) : (
                    <FileText className="h-5 w-5 text-brand-blue" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-brand-ink">{file.name}</p>
                  <p className="text-[12px] text-brand-gray">{(file.size / 1024).toFixed(0)} KB</p>
                </div>
                <CheckCircle2 className="h-4 w-4 shrink-0 text-brand-green" />
                <button
                  onClick={(e) => { e.stopPropagation(); onRemove(); setProgress(0); }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-none text-brand-gray transition-colors hover:bg-brand-danger/10 hover:text-brand-danger"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {error && <p className="mt-1 text-[11.5px] text-brand-danger">{error}</p>}
    </div>
  );
}
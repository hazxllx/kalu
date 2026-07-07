import React, { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { UploadCloud, FileText, X, CheckCircle2, ImageIcon } from "lucide-react";

const ACCEPTED = ".png,.jpg,.jpeg,.pdf";
const MAX_SIZE = 10 * 1024 * 1024;

export default function UploadComponent({ label, optional, file, onFile, onRemove }) {
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
      <label className="text-sm font-medium text-brand-ink">
        {label}
        {optional && <span className="text-brand-gray font-normal"> (Optional)</span>}
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
            className={`mt-1.5 cursor-pointer border-2 border-dashed rounded-card p-6 text-center transition-colors ${
              dragging ? "border-brand-blue bg-brand-light" : "border-brand-border hover:border-brand-blue/40 hover:bg-brand-bg"
            }`}
          >
            <div className="w-12 h-12 rounded-full bg-brand-blue/10 flex items-center justify-center mx-auto">
              <UploadCloud className="w-6 h-6 text-brand-blue" strokeWidth={1.8} />
            </div>
            <p className="mt-3 text-sm font-medium text-brand-ink">
              Drag & drop or <span className="text-brand-blue">browse files</span>
            </p>
            <p className="mt-1 text-xs text-brand-gray">PNG, JPG, JPEG, PDF — up to 10 MB</p>
          </motion.div>
        ) : (
          <motion.div
            key="preview"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="mt-1.5 border border-brand-border rounded-card overflow-hidden bg-white"
          >
            {progress < 100 ? (
              <div className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-brand-blue/10 flex items-center justify-center">
                    <FileText className="w-5 h-5 text-brand-blue" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-brand-ink truncate">{file.name}</p>
                    <div className="mt-1.5 h-1.5 bg-brand-border rounded-full overflow-hidden">
                      <motion.div animate={{ width: `${progress}%` }} className="h-full bg-brand-blue rounded-full" />
                    </div>
                  </div>
                  <span className="text-xs font-stat font-bold text-brand-gray">{progress}%</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 p-3">
                <div className="w-12 h-12 rounded-lg bg-brand-bg border border-brand-border flex items-center justify-center overflow-hidden shrink-0">
                  {isImage ? (
                    <ImageIcon className="w-5 h-5 text-brand-gray" />
                  ) : (
                    <FileText className="w-5 h-5 text-brand-blue" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-brand-ink truncate">{file.name}</p>
                  <p className="text-xs text-brand-gray">{(file.size / 1024).toFixed(0)} KB</p>
                </div>
                <CheckCircle2 className="w-4 h-4 text-brand-green shrink-0" />
                <button
                  onClick={(e) => { e.stopPropagation(); onRemove(); setProgress(0); }}
                  className="w-8 h-8 rounded-lg hover:bg-brand-danger/10 flex items-center justify-center text-brand-gray hover:text-brand-danger transition-colors shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {error && <p className="mt-1 text-xs text-brand-danger">{error}</p>}
    </div>
  );
}
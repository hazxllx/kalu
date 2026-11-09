import React, { useRef, useState } from "react";
import { Upload, X, FileText, Image as ImageIcon, AlertCircle, CheckCircle2 } from "lucide-react";

/**
 * Document upload field component for health service attachments.
 * Handles memo (PDF/DOC/DOCX) and pubmat (JPG/PNG/WebP) uploads with preview.
 *
 * Props:
 *   type: "memo" | "pubmat"
 *   label: display label
 *   filename: current filename (if any)
 *   uploading: boolean — upload in progress
 *   error: error message (if any)
 *   onSelect: (file) => void — called when file is selected
 *   onRemove: () => void — called when remove is clicked
 *   preview: for pubmat, an image preview (URL or data URI)
 */
export default function DocumentUploadField({
  type,
  label,
  filename,
  uploading,
  error,
  onSelect,
  onRemove,
  preview,
}) {
  const fileInputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);

  const acceptedTypes = type === "memo"
    ? ".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";

  const maxSize = type === "memo" ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
  const maxSizeMB = type === "memo" ? 10 : 5;

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const validateAndSelect = (file) => {
    if (!file) return;

    const allowedTypes = type === "memo"
      ? ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]
      : ["image/jpeg", "image/png", "image/webp"];

    if (!allowedTypes.includes(file.type)) {
      // Show error but don't call onSelect
      return;
    }

    if (file.size > maxSize) {
      // Show error but don't call onSelect
      return;
    }

    onSelect(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      validateAndSelect(files[0]);
    }
  };

  const handleFileChange = (e) => {
    const files = e.currentTarget?.files;
    if (files && files.length > 0) {
      validateAndSelect(files[0]);
    }
  };

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-brand-ink">{label}</label>

      {/* Current file display */}
      {filename && (
        <div className="flex items-center justify-between gap-3 rounded-btn border border-brand-border bg-brand-bg px-3.5 py-2.5 dark:border-border dark:bg-input">
          <div className="flex min-w-0 items-center gap-2.5">
            {type === "memo" ? (
              <FileText className="h-4 w-4 shrink-0 text-brand-blue" />
            ) : (
              <ImageIcon className="h-4 w-4 shrink-0 text-brand-blue" />
            )}
            <span className="truncate text-sm text-brand-ink">{filename}</span>
          </div>
          {!uploading && (
            <button
              type="button"
              onClick={onRemove}
              className="shrink-0 text-brand-gray hover:text-brand-danger transition-colors"
              aria-label="Remove file"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {/* Image preview for pubmat */}
      {type === "pubmat" && preview && (
        <div className="relative h-32 w-full overflow-hidden rounded-btn border border-brand-border bg-brand-bg dark:border-border dark:bg-input">
          <img
            src={preview}
            alt="Publication material preview"
            className="h-full w-full object-cover"
          />
        </div>
      )}

      {/* Upload area */}
      {!filename && (
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          className={`rounded-btn border-2 border-dashed px-4 py-6 text-center transition-colors ${
            dragActive
              ? "border-brand-blue bg-brand-blue/5"
              : "border-brand-border bg-white dark:border-border dark:bg-input"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={acceptedTypes}
            onChange={handleFileChange}
            disabled={uploading}
            className="hidden"
            aria-label={`Upload ${label}`}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="mx-auto flex flex-col items-center gap-2 text-center disabled:opacity-60"
          >
            <Upload className="h-5 w-5 text-brand-blue" />
            <span className="text-sm font-medium text-brand-ink">
              {type === "memo" ? "Upload Memo" : "Upload Pubmat"}
            </span>
            <span className="text-xs text-brand-gray">
              {type === "memo"
                ? "PDF, DOC, or DOCX up to 10 MB"
                : "JPG, PNG, or WebP up to 5 MB"}
            </span>
          </button>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="flex items-start gap-2 rounded-btn border border-brand-danger/25 bg-brand-danger/5 px-3 py-2.5 text-xs text-brand-danger">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Helper text */}
      {!filename && !error && (
        <p className="text-xs text-brand-gray">
          {type === "memo"
            ? "Drag and drop or click to select the official memorandum."
            : "Drag and drop or click to select the publication material image."}
        </p>
      )}

      {/* Upload progress */}
      {uploading && (
        <div className="flex items-center gap-2 rounded-btn border border-brand-border bg-brand-bg px-3 py-2.5 text-sm text-brand-gray dark:border-border dark:bg-input">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-blue border-t-transparent" />
          <span>Uploading...</span>
        </div>
      )}
    </div>
  );
}

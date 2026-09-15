import React, { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, RotateCcw, Upload, CheckCircle2, X, AlertCircle, ShieldCheck } from "lucide-react";
import { btnPrimary, btnSecondary } from "@/features/registration/components/RegistrationDesign";

export default function FaceVerification({ captured, onCapture, onRemove, error }) {
  const [mode, setMode] = useState(captured ? "preview" : "idle");
  const [cameraError, setCameraError] = useState("");
  const [stream, setStream] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (captured) {
      const url = URL.createObjectURL(captured);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreviewUrl(null);
  }, [captured]);

  const startCamera = useCallback(async () => {
    setCameraError("");
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      setStream(s);
      setMode("camera");
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play().catch(() => {});
        }
      }, 100);
    } catch {
      setCameraError("Unable to access camera. Please allow camera access or upload a photo instead.");
      setMode("idle");
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      setStream(null);
    }
  }, [stream]);

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 320;
    canvas.height = video.videoHeight || 320;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      const file = new File([blob], "selfie.png", { type: "image/png" });
      onCapture(file);
      stopCamera();
      setMode("preview");
    }, "image/png");
  }, [onCapture, stopCamera]);

  const retake = () => {
    onRemove();
    setMode("idle");
  };

  const handleUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setCameraError("Please upload an image file (PNG or JPG).");
      return;
    }
    onCapture(file);
    setMode("preview");
  };

  useEffect(() => {
    return () => stopCamera();
     
  }, []);

  return (
    <div>
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
      <canvas ref={canvasRef} className="hidden" />

      <AnimatePresence mode="wait">
        {mode === "idle" && !captured && (
          <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-6 text-center sm:p-8">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-brand-blue/25 bg-white">
                <Camera className="h-7 w-7 text-brand-blue" strokeWidth={1.7} />
              </div>
              <p className="mt-4 text-[12.5px] font-bold uppercase tracking-[0.08em] text-brand-dark">
                Face Verification Required
              </p>
              <p className="mx-auto mt-2 max-w-sm text-[12.5px] leading-relaxed text-slate-500">
                Take a selfie using your camera or upload a clear photo of your face.
                This will be reviewed by your assigned Barangay Health Worker.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2.5">
                <button type="button" onClick={startCamera} className={btnPrimary}>
                  <Camera className="h-4 w-4" /> Open Camera
                </button>
                <button type="button" onClick={() => fileInputRef.current?.click()} className={btnSecondary}>
                  <Upload className="h-4 w-4" /> Upload Photo
                </button>
              </div>
              {cameraError && (
                <p className="mt-4 flex items-center justify-center gap-1.5 text-[11.5px] font-medium text-brand-danger">
                  <AlertCircle className="h-3.5 w-3.5" /> {cameraError}
                </p>
              )}
            </div>
          </motion.div>
        )}

        {mode === "camera" && (
          <motion.div key="camera" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="relative overflow-hidden rounded-xl bg-brand-deep">
              <video ref={videoRef} autoPlay playsInline muted className="aspect-[4/3] w-full object-cover" />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-48 w-40 rounded-lg border border-white/50" />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap justify-center gap-2.5">
              <button type="button" onClick={capturePhoto} className={btnPrimary}>
                <Camera className="h-4 w-4" /> Capture Selfie
              </button>
              <button type="button" onClick={() => { stopCamera(); setMode("idle"); }} className={btnSecondary}>
                <X className="h-4 w-4" /> Cancel
              </button>
            </div>
          </motion.div>
        )}

        {mode === "preview" && captured && previewUrl && (
          <motion.div key="preview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-5">
              <div className="flex items-center gap-4">
                <div className="relative shrink-0">
                  <img src={previewUrl} alt="Face capture" className="h-20 w-20 rounded-lg border-2 border-brand-green/40 object-cover" />
                  <div className="absolute -bottom-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-brand-green">
                    <CheckCircle2 className="h-3.5 w-3.5 text-white" strokeWidth={2.5} />
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[13px] font-bold text-brand-ink">Face Captured</p>
                    <span className="inline-flex items-center gap-1 rounded-full border border-brand-gold/40 bg-brand-goldpale px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-brand-amber">
                      <span className="h-1.5 w-1.5 rounded-full bg-current" /> Pending Review
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] text-slate-500">{captured.name} &middot; {(captured.size / 1024).toFixed(0)} KB</p>
                  <button type="button" onClick={retake} className="mt-2 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.08em] text-brand-blue transition-colors hover:text-brand-dark">
                    <RotateCcw className="h-3.5 w-3.5" /> Retake Photo
                  </button>
                </div>
              </div>
              <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-blue" strokeWidth={1.8} />
                <p className="text-[12px] leading-relaxed text-slate-500">
                  Your photo will be reviewed by your assigned Barangay Health Worker.
                  Account access remains limited until verification is complete.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && <p className="mt-1.5 text-[11.5px] font-medium text-brand-danger">{error}</p>}
    </div>
  );
}

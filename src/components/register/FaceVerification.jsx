import React, { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, RotateCcw, Upload, CheckCircle2, X, AlertCircle, ShieldCheck } from "lucide-react";

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
      <canvas ref={canvasRef} className="hidden" />

      <AnimatePresence mode="wait">
        {mode === "idle" && !captured && (
          <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="bg-brand-bg border border-brand-border rounded-card p-8 text-center">
              <div className="w-16 h-16 rounded-full bg-brand-blue/10 flex items-center justify-center mx-auto">
                <Camera className="w-7 h-7 text-brand-blue" strokeWidth={1.8} />
              </div>
              <p className="mt-4 text-sm font-medium text-brand-ink">Face Verification Required</p>
              <p className="mt-1 text-xs text-brand-gray max-w-sm mx-auto">
                Take a selfie using your camera or upload a clear photo of your face. This will be reviewed by your assigned Barangay Health Worker.
              </p>
              <div className="mt-5 flex justify-center">
                <button type="button" onClick={startCamera} className="flex items-center justify-center gap-2 bg-brand-blue text-white px-6 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors">
                  <Camera className="w-4 h-4" /> Open Camera
                </button>
              </div>
              {cameraError && (
                <p className="mt-3 text-xs text-brand-danger flex items-center justify-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5" /> {cameraError}
                </p>
              )}
            </div>
          </motion.div>
        )}

        {mode === "camera" && (
          <motion.div key="camera" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="bg-brand-ink rounded-card overflow-hidden relative">
              <video ref={videoRef} autoPlay playsInline muted className="w-full aspect-[4/3] object-cover" />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-40 h-48 border-2 border-white/40 rounded-[50%]" />
              </div>
            </div>
            <div className="mt-3 flex gap-2.5 justify-center">
              <button type="button" onClick={capturePhoto} className="flex items-center justify-center gap-2 bg-brand-blue text-white px-5 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors">
                <Camera className="w-4 h-4" /> Capture Selfie
              </button>
              <button type="button" onClick={() => { stopCamera(); setMode("idle"); }} className="flex items-center justify-center gap-2 border border-brand-border bg-white text-brand-gray px-5 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-bg transition-colors">
                <X className="w-4 h-4" /> Cancel
              </button>
            </div>
          </motion.div>
        )}

        {mode === "preview" && captured && previewUrl && (
          <motion.div key="preview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="bg-brand-bg border border-brand-border rounded-card p-5">
              <div className="flex items-center gap-4">
                <div className="relative shrink-0">
                  <img src={previewUrl} alt="Face capture" className="w-20 h-20 rounded-card object-cover border-2 border-brand-green/30" />
                  <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-brand-green flex items-center justify-center border-2 border-white">
                    <CheckCircle2 className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
                  </div>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-brand-ink">Face Captured</p>
                    <span className="inline-flex items-center gap-1 text-xs font-body font-medium bg-brand-yellow/15 text-[#B07E00] rounded-full px-2 py-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-current" /> Pending Review
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-brand-gray">{captured.name} &middot; {(captured.size / 1024).toFixed(0)} KB</p>
                  <button type="button" onClick={retake} className="mt-2 flex items-center gap-1.5 text-xs text-brand-blue font-medium hover:underline">
                    <RotateCcw className="w-3.5 h-3.5" /> Retake Photo
                  </button>
                </div>
              </div>
              <div className="mt-4 flex items-start gap-2 bg-white border border-brand-border rounded-btn px-3 py-2.5">
                <ShieldCheck className="w-4 h-4 text-brand-blue shrink-0 mt-0.5" strokeWidth={1.8} />
                <p className="text-xs text-brand-gray">
                  Your photo will be reviewed by your assigned Barangay Health Worker. Account access remains limited until verification is complete.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && <p className="mt-2 text-xs text-brand-danger">{error}</p>}
    </div>
  );
}
import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertCircle, ArrowLeft, ArrowRight, FileText, Loader2 } from "lucide-react";
import {
  RegistrationShell,
  RegistrationCard,
  StepIndicator,
  PageHeading,
  InfoNote,
  btnPrimary,
  btnGhost,
} from "@/features/registration/components/RegistrationDesign";
import UploadComponent from "@/features/registration/components/UploadComponent";

/**
 * Transfer of residency — step 1 of the transfer flow. The upload is processed
 * and the extracted information is carried into the Personal Information
 * registration wizard (`/register/new/step-1`). Only the presentation is shared
 * with the other registration pages; the flow and navigation are unchanged.
 */
const STEPS = [
  { num: 1, label: "Upload Record" },
  { num: 2, label: "Personal Information" },
];

export default function TransferRegistration() {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  const handleProcess = async () => {
    if (!file) {
      setError("Please upload a document first.");
      return;
    }

    setProcessing(true);
    setError("");

    // Carry only the uploaded document reference into the wizard. Nothing is
    // extracted or invented here: the applicant confirms and types their own
    // personal information in the next step.
    try {
      sessionStorage.setItem(
        "transferData",
        JSON.stringify({ previousHealthRecord: file.name }),
      );
    } catch {
      /* storage may be unavailable; the wizard simply starts blank */
    }
    setProcessing(false);
    navigate("/register/new/step-1");
  };

  return (
    <RegistrationShell>
      <RegistrationCard>
        <div className="px-5 py-6 sm:px-10 sm:py-8">
          <StepIndicator current={1} steps={STEPS} flowLabel="Transfer Registration" />

          <motion.div
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.28 }}
            className="mt-6 space-y-5"
          >
            <PageHeading
              title="Transfer from Another Barangay"
              subtitle="Upload your health record from your previous barangay. You will confirm your personal information in the next step."
            />

            {error && (
              <InfoNote tone="danger" icon={AlertCircle}>
                {error}
              </InfoNote>
            )}

            <UploadComponent
              label="Health Record Document"
              file={file}
              onFile={setFile}
              onRemove={() => setFile(null)}
            />

            <InfoNote icon={FileText}>
              <p>
                <strong className="font-semibold text-brand-ink">Supported formats:</strong> PNG, JPG, JPEG, PDF
              </p>
              <p className="mt-0.5">
                <strong className="font-semibold text-brand-ink">Maximum file size:</strong> 10 MB
              </p>
            </InfoNote>
          </motion.div>

          {/* Navigation */}
          <div className="mt-8 flex items-center justify-between gap-3 border-t border-slate-100 pt-5">
            <Link to="/register" className={btnGhost}>
              <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" /> Back to options
            </Link>
            <button onClick={handleProcess} disabled={processing || !file} className={btnPrimary}>
              {processing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Processing...
                </>
              ) : (
                <>
                  Process Document <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </div>
        </div>
      </RegistrationCard>
    </RegistrationShell>
  );
}

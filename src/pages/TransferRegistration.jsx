import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Cloud, AlertCircle } from "lucide-react";
import { LOGO_URL } from "@/lib/brand";
import UploadComponent from "@/components/register/UploadComponent";

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

    // Simulate OCR/document processing
    // In production, this would call a backend service to process the document
    setTimeout(() => {
      // Mock extracted data from document
      const mockExtractedData = {
        firstName: "Juan",
        middleName: "Reyes",
        lastName: "Dela Cruz",
        suffix: "",
        dob: "1990-05-15",
        sex: "Male",
        civilStatus: "Married",
        mobile: "09123456789",
        province: "Camarines Sur",
        municipality: "Pili",
        barangay: "San Jose",
        sitio: "Purok 5",
        street: "Mabini St.",
        houseNo: "123",
        landmark: "Near San Jose Chapel",
        occupation: "Farmer",
        previousHealthRecord: file.name,
      };

      // Store the data and navigate to the wizard
      sessionStorage.setItem("transferData", JSON.stringify(mockExtractedData));
      setProcessing(false);
      navigate("/register/new/step-1");
    }, 2000);
  };

  return (
    <div className="w-full bg-gradient-to-br from-brand-bg via-brand-blue/5 to-brand-green/3 p-4 md:p-6">
      <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-brand-blue/8 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
      <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-brand-green/8 rounded-full blur-3xl translate-x-1/2 translate-y-1/2" />

      <div className="relative flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-2xl">
          <div className="text-center mb-6">
            <img src={LOGO_URL} alt="KALUSAGAP" className="h-16 w-auto mx-auto mb-6" />
          </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-card border border-brand-border shadow-float p-6 md:p-8"
        >
          <h1 className="text-xl md:text-2xl font-semibold text-brand-ink tracking-tight mb-1">
            Transfer from Another Barangay
          </h1>
          <p className="text-xs text-brand-gray mb-6">
            Step 1: Upload your health record
          </p>

          <div className="mb-6">
            <h2 className="text-base font-semibold text-brand-ink mb-2">
              Upload Health Record
            </h2>
            <p className="text-xs text-brand-gray mb-4 leading-relaxed">
              Upload your health record from your previous barangay.
              <br />
              We will extract your personal information automatically.
            </p>

            {error && (
              <div className="mb-5 bg-brand-danger/10 border border-brand-danger/20 rounded-card p-3 flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-brand-danger shrink-0 mt-0.5" />
                <p className="text-sm text-brand-danger">{error}</p>
              </div>
            )}

            <UploadComponent
              label="Health Record Document"
              file={file}
              onFile={setFile}
              onRemove={() => setFile(null)}
            />
          </div>

          <div className="bg-brand-blue/5 border border-brand-blue/15 rounded-card p-4 mb-8">
            <p className="text-xs text-brand-gray">
              <strong className="text-brand-ink">Supported formats:</strong> PNG, JPG, JPEG, PDF
              <br />
              <strong className="text-brand-ink">Maximum file size:</strong> 10 MB
            </p>
          </div>

          {/* Navigation Buttons */}
          <div className="flex items-center justify-between pt-6 border-t border-brand-border">
            <Link
              to="/register"
              className="flex items-center gap-2 text-sm font-medium text-brand-gray hover:text-brand-ink transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> Back to options
            </Link>
            <button
              onClick={handleProcess}
              disabled={processing || !file}
              className="flex items-center gap-2 bg-brand-blue text-white px-6 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors shadow-soft disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {processing ? (
                <>
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  >
                    <Cloud className="w-4 h-4" />
                  </motion.div>
                  Processing...
                </>
              ) : (
                <>
                  Process Document
                </>
              )}
            </button>
          </div>
        </motion.div>
        </div>
      </div>
    </div>
  );
}

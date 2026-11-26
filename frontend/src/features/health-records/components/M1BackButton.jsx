// frontend/src/features/health-records/components/M1BackButton.jsx
import React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { TCL_BACK_BUTTON_CLASS } from "./BackToTclButton";

// Renders or manages M1BackButton logic.
export default function M1BackButton({ fallback = "/app/health_supervisor/m1", label = "Back to M1 Programs" }) {
  const navigate = useNavigate();
  const goBack = () => {
    if (typeof window !== "undefined" && Number(window.history.state?.idx) > 0) {
      navigate(-1);
      return;
    }
    navigate(fallback, { replace: true });
  };

  return (
    <button type="button" onClick={goBack} className={TCL_BACK_BUTTON_CLASS} aria-label={label}>
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );
}

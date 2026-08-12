import React from "react";

const SPLINE_URL = "https://app.spline.design/community/file/ad01ab1f-12b9-446d-83de-fbb56a0b2813";

export default function AuthIllustration() {
  return (
    <div className="relative overflow-hidden rounded-[24px] border border-slate-200 bg-white p-2 shadow-card">
      <div className="aspect-[4/5] w-full overflow-hidden rounded-[18px] bg-slate-50">
        <iframe
          src={SPLINE_URL}
          title="Government digital services illustration"
          className="h-full w-full border-0"
          loading="lazy"
          allow="fullscreen"
        />
      </div>
    </div>
  );
}

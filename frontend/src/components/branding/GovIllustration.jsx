import React from "react";

export default function GovIllustration({ variant = "hero" }) {
  const isAbout = variant === "about";

  return (
    <div className="w-full rounded-[24px] border border-slate-200 bg-slate-50 p-5 shadow-card">
      <svg viewBox="0 0 560 420" className="w-full h-auto" role="img" aria-label="Government healthcare illustration">
        <rect x="44" y="44" width="472" height="332" rx="24" fill="#ffffff" stroke="#dbe3ee" strokeWidth="2" />
        <rect x="86" y="92" width="180" height="118" rx="16" fill="#eff6ff" stroke="#b7d3f3" strokeWidth="2" />
        <rect x="286" y="92" width="188" height="118" rx="16" fill="#f8fafc" stroke="#dbe3ee" strokeWidth="2" />
        <rect x="86" y="244" width="388" height="86" rx="16" fill="#f8fafc" stroke="#dbe3ee" strokeWidth="2" />

        <rect x="108" y="116" width="72" height="12" rx="6" fill="#0b5cad" />
        <rect x="108" y="138" width="116" height="10" rx="5" fill="#93bde8" />
        <rect x="108" y="158" width="88" height="10" rx="5" fill="#93bde8" />

        <circle cx="382" cy="128" r="34" fill="#0b5cad" opacity="0.12" />
        <circle cx="382" cy="128" r="22" fill="#0b5cad" />
        <rect x="314" y="170" width="136" height="12" rx="6" fill="#0b5cad" />
        <rect x="314" y="192" width="108" height="10" rx="5" fill="#9fb6cb" />

        <rect x="108" y="268" width="116" height="14" rx="7" fill="#0b5cad" />
        <rect x="108" y="292" width="154" height="10" rx="5" fill="#96c0e6" />
        <rect x="324" y="268" width="90" height="56" rx="12" fill="#0f766e" opacity="0.14" />
        <rect x="338" y="282" width="62" height="10" rx="5" fill="#0f766e" />
        <rect x="338" y="300" width="44" height="10" rx="5" fill="#8bc1ba" />

        <path d="M210 320h112" stroke="#0b5cad" strokeWidth="10" strokeLinecap="round" />
        <path d="M226 320l18-28 18 28" stroke="#0b5cad" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" fill="none" />

        {isAbout ? (
          <>
            <circle cx="188" cy="256" r="18" fill="#f59e0b" />
            <path d="M170 255c0-14 12-24 24-24s24 10 24 24v14h-48v-14z" fill="#0b5cad" />
            <rect x="152" y="276" width="72" height="18" rx="9" fill="#0f766e" />
            <path d="M272 198h92" stroke="#d0dae8" strokeWidth="8" strokeLinecap="round" />
            <path d="M272 220h72" stroke="#d0dae8" strokeWidth="8" strokeLinecap="round" />
            <path d="M272 242h58" stroke="#d0dae8" strokeWidth="8" strokeLinecap="round" />
          </>
        ) : (
          <>
            <rect x="136" y="270" width="82" height="56" rx="12" fill="#effbf7" stroke="#9bd2c2" strokeWidth="2" />
            <path d="M152 292h42" stroke="#0f766e" strokeWidth="8" strokeLinecap="round" />
            <path d="M152 308h26" stroke="#9bd2c2" strokeWidth="8" strokeLinecap="round" />
            <rect x="238" y="268" width="60" height="60" rx="14" fill="#0b5cad" opacity="0.12" />
            <path d="M252 310l12-18 12 18" stroke="#0b5cad" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <path d="M264 292v-18" stroke="#0b5cad" strokeWidth="8" strokeLinecap="round" />
          </>
        )}
      </svg>
    </div>
  );
}

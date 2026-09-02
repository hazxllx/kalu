import React from "react";
import { Link } from "react-router-dom";
import GovSeal from "@/components/branding/GovSeal";

/**
 * Agency identity block — logo mark and system name.
 * Used at the top of auth pages so they read as an official form, not an app.
 */
export function AgencyMark({ sealSize = 40, align = "left" }) {
  const isCenter = align === "center";
  return (
    <div className={`flex items-center gap-3.5 ${isCenter ? "justify-center text-center" : ""}`}>
      <GovSeal height={sealSize} eager className="shrink-0" />
      <div className={isCenter ? "text-left" : ""}>
        <p className="font-display text-[16px] font-bold leading-tight tracking-[0.03em] text-brand-dark">
          KALUSAGAP
        </p>
        <p className="mt-0.5 text-[10px] font-medium uppercase leading-tight tracking-[0.14em] text-brand-gray">
          Community Health System
        </p>
      </div>
    </div>
  );
}

/**
 * Standard section heading: kicker, serif display title, rule, and lede.
 */
export function SectionHeading({ kicker, title, lede, tone = "dark", align = "left", className = "" }) {
  const light = tone === "light";
  return (
    <div className={`${align === "center" ? "mx-auto text-center" : ""} max-w-2xl ${className}`}>
      {kicker && (
        <p
          className={`gov-kicker ${light ? "text-brand-goldlight" : "text-brand-blue"} ${
            align === "center" ? "flex items-center justify-center gap-2.5" : "flex items-center gap-2.5"
          }`}
        >
          <span
            className={`h-px w-6 ${light ? "bg-brand-goldlight/70" : "bg-brand-blue/45"}`}
            aria-hidden="true"
          />
          {kicker}
        </p>
      )}
      <h2
        className={`mt-3.5 font-display text-[26px] font-bold leading-[1.24] tracking-[-0.01em] md:text-[32px] ${
          light ? "text-white" : "text-brand-dark"
        } ${light ? "gov-underline-light" : "gov-underline"} ${align === "center" ? "[&::after]:mx-auto" : ""}`}
      >
        {title}
      </h2>
      {lede && (
        <p
          className={`mt-5 text-[15px] leading-[1.75] ${
            light ? "text-white/70" : "text-brand-gray"
          }`}
        >
          {lede}
        </p>
      )}
    </div>
  );
}

/**
 * Small official status chip, e.g. "Verified", "Advisory".
 */
export function GovChip({ children, tone = "navy", icon: Icon = null }) {
  const tones = {
    navy: "border-brand-blue/25 bg-brand-light text-brand-blue",
    gold: "border-brand-gold/35 bg-[#FDF6E3] text-brand-gold",
    light: "border-white/25 bg-white/10 text-white",
    plain: "border-brand-border bg-white text-brand-gray",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 border px-2.5 py-1 text-[10px] font-bold uppercase tracking-gov ${tones[tone]}`}
    >
      {Icon && <Icon className="h-3 w-3" strokeWidth={2.2} />}
      {children}
    </span>
  );
}

/**
 * Footer-style back link for auth pages.
 */
export function AuthReturnLink({ to = "/", label = "Return to portal home" }) {
  return (
    <Link
      to={to}
      className="text-[12px] font-medium text-brand-gray underline decoration-brand-rule underline-offset-4 transition-colors hover:text-brand-blue hover:decoration-brand-blue"
    >
      {label}
    </Link>
  );
}

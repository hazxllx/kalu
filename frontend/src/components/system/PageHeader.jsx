import React from "react";
import { ChevronRight } from "lucide-react";
import { TYPE, PALETTE, RADIUS } from "@/lib/designTokens";
import Icon from "@/components/common/Icon";

/**
 * Compact page header: eyebrow label + page title + one-line context.
 *
 * Replaces the full-card header pattern. Structure:
 *   [optional breadcrumb]
 *   EYEBROW — PAGE TITLE   (optional right-aligned context chip)
 *   thin gold rule
 *   caption/context line (only when context is supplied)
 *
 * No shadow, no filled card. Uses a single hairline bottom rule.
 */
export default function PageHeader({
  crumbs = [],
  eyebrow,
  title,
  context,
  action = null,
  goldRule = true,
}) {
  return (
    <div className="mb-7 flex flex-col gap-3">
      {crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] font-semibold uppercase tracking-[0.2em]">
          {crumbs.map((crumb, i) => {
            const isCurrent = i === crumbs.length - 1;
            const label = typeof crumb === "string" ? crumb : crumb.label;
            const to = typeof crumb === "object" && crumb !== null ? crumb.to : null;
            return (
              <React.Fragment key={i}>
                {i > 0 && (
                  <ChevronRight
                    className="h-3.5 w-3.5 shrink-0 text-[#8A95A4]"
                    aria-hidden="true"
                  />
                )}
                {isCurrent ? (
                  <span className="truncate text-[#12263F] dark:text-[#E8EDF3]">
                    {label}
                  </span>
                ) : to ? (
                  <a
                    href={to}
                    className="truncate text-[#54637A] hover:text-[#0B4A8F] dark:text-[#9AA7B5] dark:hover:text-[#1464A3]"
                  >
                    {label}
                  </a>
                ) : (
                  <span className="truncate text-[#54637A] dark:text-[#9AA7B5]">
                    {label}
                  </span>
                )}
              </React.Fragment>
            );
          })}
        </nav>
      )}

      <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          {eyebrow && (
            <p
              className="mb-0.5 text-[11px] font-semibold tracking-[0.22em] text-[#0B4A8F] dark:text-[#1464A3]"
              style={{
                fontFamily: TYPE.eyebrow.family,
                fontSize: TYPE.eyebrow.base,
                fontWeight: TYPE.eyebrow.weight,
                letterSpacing: TYPE.eyebrow.letter,
              }}
            >
              {eyebrow}
            </p>
          )}
          <h1 className="mb-1 truncate text-[#12263F] dark:text-[#E8EDF3]"
              style={{
                fontFamily: TYPE.h1.family,
                fontSize: TYPE.h1.base,
                fontWeight: TYPE.h1.weight,
                lineHeight: TYPE.h1.line,
              }}>
            {title}
          </h1>
          {context && (
            <p className="m-0 text-[#54637A] dark:text-[#9AA7B5]"
               style={{
                 fontFamily: TYPE.bodySm.family,
                 fontSize: TYPE.bodySm.base,
                 lineHeight: TYPE.bodySm.line,
               }}>
              {context}
            </p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>

      {goldRule && (
        <div
          className="h-[2px] w-full shrink-0"
          style={{
            background: "linear-gradient(90deg, #B98A1E 0%, #E4C35D 50%, #B98A1E 100%)",
            opacity: 0.9,
          }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

import React from "react";
import { TYPE } from "@/lib/designTokens";

/**
 * Section header: uppercase eyebrow + title.
 *
 * Used inside content areas (no surrounding card — spacing + hairline dividers
 * carry structure now). Always paired with a count on the right, and a "View
 * all" link when the section is a preview of a longer list.
 *
 * Layout:
 *   EYEBROW    TITLE — count · View all
 */
export default function SectionHeader({
  eyebrow,
  title,
  count = null,
  onViewAll = null,
  onRefresh = null,
  refreshLabel = "Refresh",
  children = null,
  className = "",
}) {
  return (
    <div className={`mb-4 flex items-start justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        {eyebrow && (
          <p
            className="mb-0.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#0B4A8F] dark:text-[#1464A3]"
            style={{
              fontFamily: TYPE.eyebrow.family,
              fontSize: TYPE.eyebrow.base,
              fontWeight: TYPE.eyebrow.weight,
              letterSpacing: TYPE.eyebrow.letter,
              lineHeight: TYPE.eyebrow.line,
            }}
          >
            {eyebrow}
          </p>
        )}
        <div className="flex items-center gap-2">
          <h2 className="truncate text-[18px] font-semibold text-[#12263F] dark:text-[#E8EDF3]"
              style={{
                fontFamily: TYPE.h2.family,
                fontSize: TYPE.h2.base,
                fontWeight: TYPE.h2.weight,
                lineHeight: TYPE.h2.line,
              }}>
            {title}
          </h2>
          {count !== null && (
            <span className="shrink-0 rounded-full border border-[#D6DEE8] bg-white px-2.5 py-0.5 text-xs font-semibold text-[#54637A] dark:border-[#2A3645] dark:bg-[#131E2C] dark:text-[#9AA7B5]"
                  style={{ fontFamily: TYPE.mono }}>
              {count}
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {children}
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#D6DEE8] bg-white px-3 py-1.5 text-[12px] font-medium text-[#54637A] transition-colors hover:border-[#0B4A8F] hover:text-[#0B4A8F] dark:border-[#2A3645] dark:bg-[#131E2C] dark:text-[#9AA7B5] dark:hover:border-[#1464A3] dark:hover:text-[#1464A3]"
          >
            {refreshLabel}
          </button>
        )}
        {onViewAll && (
          <a
            href={onViewAll}
            className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#0B4A8F] hover:underline dark:text-[#1464A3]"
            style={{ fontFamily: TYPE.body.family }}
          >
            View all
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
          </a>
        )}
      </div>
    </div>
  );
}

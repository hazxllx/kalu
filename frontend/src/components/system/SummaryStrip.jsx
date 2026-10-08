import React, { forwardRef } from "react";
import { ChevronRight } from "lucide-react";
import { TYPE, PALETTE, RADIUS } from "@/lib/designTokens";
import Icon from "@/components/common/Icon";

/**
 * Typographic stat strip: a row of numbers that carries the design.
 *
 * A stat is clickable only if it navigates somewhere — then it receives a
 * real affordance (pointer cursor, focus ring, subtle navy border + arrow).
 * Non-clickable stats render flat without any implied affordance.
 *
 * Layout: one line of labels/numbers; the value is the strongest element via
 * weight + tabular numerals; the label is secondary and the caption tertiary.
 */
export default forwardRef(function SummaryStrip(
  { items = [], onClick, className = "", labelBelow = false },
  ref,
) {
  if (!items.length) return null;

  return (
    <div
      ref={ref}
      role="list"
      className={`flex flex-col flex-wrap gap-x-6 gap-y-3 border-b border-[#E7ECF1] dark:border-[#2A3645] pb-4 ${className}`}
      style={{
        fontFamily: TYPE.body.family,
      }}
    >
      {items.map((item, i) => {
        const clickable = typeof onClick === "function" || !!item.onClick;
        const isActive = item.onClick || onClick ? (item.active ?? false) : false;

        return (
          <div
            key={item.id ?? i}
            role={clickable ? "listitem" : undefined}
            className={`group flex min-w-0 flex-1 items-end justify-between gap-4 pb-2 ${
              i < items.length - 1 ? "border-b border-[#E7ECF1] dark:border-[#2A3645]" : ""
            } ${clickable ? "cursor-pointer hover:pl-1" : ""}`}
            onClick={clickable ? (onClick ?? item.onClick) : undefined}
            onKeyDown={
              clickable
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      (onClick ?? item.onClick)?.();
                    }
                  }
                : undefined
            }
            tabIndex={clickable ? 0 : undefined}
            style={{
              width: item.width ? `${item.width}%` : "auto",
            }}
          >
            <div className={`flex min-w-0 flex-1 flex-col gap-0.5 ${labelBelow ? "items-center text-center" : "items-start"}`}>
              <span
                className={`truncate text-[#54637A] dark:text-[#9AA7B5] ${labelBelow ? "" : "text-[11px] font-medium tracking-[0.06em] uppercase"}`}
                style={{
                  fontFamily: TYPE.captionSm.family,
                  fontSize: labelBelow ? "0.8125rem" : TYPE.captionSm.base,
                  fontWeight: labelBelow ? 500 : TYPE.captionSm.weight,
                  letterSpacing: labelBelow ? "normal" : TYPE.captionSm.letter,
                }}
              >
                {item.label}
              </span>
              {item.caption && (
                <span className="truncate text-[#8A95A4] dark:text-[#6E7986]"
                      style={{
                        fontFamily: TYPE.caption.family,
                        fontSize: TYPE.caption.base,
                        lineHeight: TYPE.caption.line,
                      }}>
                  {item.caption}
                </span>
              )}
              {labelBelow && (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className={`truncate text-[#12263F] dark:text-[#E8EDF3] ${isActive ? "font-bold" : "font-semibold"}`}
                          style={{
                            fontFamily: TYPE.mono,
                            fontSize: labelBelow ? "1.125rem" : TYPE.h1.base,
                            fontWeight: labelBelow ? 700 : TYPE.h1.weight,
                            lineHeight: "1",
                            tabularNums: true,
                          }}>
                      {item.value}
                    </span>
                    {item.icon && (
                      <Icon name={item.icon} className="h-[17px] w-[17px] shrink-0 text-[#8A95A4]" />
                    )}
                  </div>
                  {item.caption && (
                    <span className="truncate text-[#8A95A4] dark:text-[#6E7986]"
                          style={{
                            fontFamily: TYPE.caption.family,
                            fontSize: TYPE.caption.base,
                            lineHeight: TYPE.caption.line,
                          }}>
                      {item.caption}
                    </span>
                  )}
                </>
              )}
            </div>

            <div className={`shrink-0 ${clickable ? "opacity-0 transition-opacity group-hover:opacity-100" : "invisible"}`}>
              <ChevronRight className="h-4 w-4 text-[#0B4A8F]" />
            </div>
          </div>
        );
      })}
    </div>
  );
});

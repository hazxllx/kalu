import React from "react";

/**
 * Skeleton loading primitives matching the final layout.
 */

export function Skeleton({ className = "", style = undefined }) {
  return (
    <div
      role="status"
      aria-hidden="true"
      style={style}
      className={`animate-pulse rounded-[4px] bg-[#D6DEE8] dark:bg-[#2A3645] ${className}`}
    />
  );
}

export function SkeletonRow({ variant = "default" }) {
  if (variant === "compact") {
    return (
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-2.5 w-1/4" />
        </div>
        <Skeleton className="h-5 w-16 shrink-0 rounded-[4px]" />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-4">
      <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <Skeleton className="h-3 w-16 shrink-0 rounded-full" />
    </div>
  );
}

export function SkeletonList({ rows = 5, variant = "default", className = "" }) {
  return (
    <div role="status" aria-label="Loading" className={`space-y-3 ${className}`}>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} variant={variant} />
      ))}
    </div>
  );
}

export function SkeletonCard({ className = "" }) {
  return (
    <div role="status" aria-label="Loading" className={`space-y-3 ${className}`}>
      <Skeleton className="h-4 w-1/4" />
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4, className = "" }) {
  return (
    <div role="status" aria-label="Loading" className={`overflow-hidden rounded-[8px] border border-[#D6DEE8] dark:border-[#2A3645] ${className}`}>
      <div className="flex items-center gap-4 border-b border-[#E7ECF1] bg-[#F4F6FA] px-4 py-2.5 dark:border-[#2A3645] dark:bg-[#0D1826]">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={`h-${i}`} className="h-3 flex-1 rounded-[2px]" />
        ))}
      </div>
      <div className="divide-y divide-[#E7ECF1] dark:divide-[#2A3645]">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={`r-${r}`} className="flex items-center gap-4 px-4 py-2.5">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton
                key={`c-${r}-${c}`}
                className={`h-3 flex-1 rounded-[2px] ${c === 0 ? "max-w-[40%]" : ""}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonStatGrid({ count = 4, className = "" }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={`grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 ${className}`}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-2.5">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-6 w-1/4" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonCardGrid({ count = 6, className = "" }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={`grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 ${className}`}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-[8px] border border-[#D6DEE8] bg-white p-4 dark:border-[#2A3645] dark:bg-[#131E2C]">
          <SkeletonCard />
        </div>
      ))}
    </div>
  );
}

export function SkeletonChart({ className = "" }) {
  return (
    <div role="status" aria-label="Loading" className={`rounded-[8px] border border-[#D6DEE8] bg-white p-4 dark:border-[#2A3645] dark:bg-[#131E2C] ${className}`}>
      <Skeleton className="h-4 w-1/4" />
      <Skeleton className="mt-3 h-3 w-1/3" />
      <div className="mt-5 flex h-56 items-end gap-2">
        {[62, 84, 45, 92, 70, 55, 80, 48, 66].map((h, i) => (
          <Skeleton key={i} className="flex-1 rounded-t-[4px]" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  );
}

export function PageSkeleton({ compact = false }) {
  return (
    <div role="status" aria-label="Loading" className="mx-auto w-full max-w-[1240px] space-y-5">
      <div className="space-y-2.5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-6 w-64" />
        {!compact && <Skeleton className="h-3 w-72" />}
      </div>
      <SkeletonStatGrid count={4} />
      <div className="rounded-[8px] border border-[#D6DEE8] bg-white p-4 dark:border-[#2A3645] dark:bg-[#131E2C]">
        <Skeleton className="h-4 w-40" />
        <SkeletonTable rows={5} cols={4} className="mt-4" />
      </div>
    </div>
  );
}

export function FullPageSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex min-h-dvh w-full items-center justify-center bg-[#F4F6FA] px-4 dark:bg-[#0D1826]"
    >
      <div className="w-full max-w-md space-y-5">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 shrink-0 rounded-[8px]" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
        <div className="rounded-[8px] border border-[#D6DEE8] bg-white p-6 dark:border-[#2A3645] dark:bg-[#131E2C]">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-10 w-full rounded-[4px]" />
          <Skeleton className="h-10 w-full rounded-[4px]" />
          <Skeleton className="h-10 w-1/3 rounded-[4px]" />
        </div>
      </div>
    </div>
  );
}

export default Skeleton;

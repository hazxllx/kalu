import React from "react";

/**
 * Skeleton loading primitives.
 *
 * One place for the loading placeholders so every page shows the same rhythm
 * while real data is being fetched from the API (or a page chunk is loading):
 *
 *   <Skeleton className="h-4 w-1/3" />   — a single bar
 *   <SkeletonList rows={5} />            — avatar + two-line rows
 *   <SkeletonCard />                     — card with stacked bars
 *   <SkeletonTable rows={6} cols={5} />  — table header + body rows
 *   <SkeletonStatGrid count={4} />       — the summary-card grid
 *   <SkeletonCardGrid count={6} />       — a grid of content cards
 *   <SkeletonChart />                    — an analytics chart panel
 *   <PageSkeleton />                     — full-page placeholder (route fallback)
 *
 * Motion is a single soft pulse (no looping animations beyond that). Every
 * primitive is decorative: it is hidden from assistive tech and the wrapping
 * region announces "Loading" instead.
 */
export function Skeleton({ className = "", style = undefined }) {
  return (
    <div
      aria-hidden="true"
      style={style}
      className={`animate-pulse rounded-lg bg-slate-200/80 dark:bg-slate-700/60 ${className}`}
    />
  );
}

export function SkeletonRow() {
  return (
    <div className="flex items-center gap-4">
      <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <Skeleton className="h-3 w-16 shrink-0" />
    </div>
  );
}

export function SkeletonList({ rows = 5, className = "" }) {
  return (
    <div role="status" aria-label="Loading" className={`space-y-4 ${className}`}>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

export function SkeletonCard({ className = "" }) {
  return (
    <div role="status" aria-label="Loading" className={`space-y-4 ${className}`}>
      <Skeleton className="h-4 w-1/4" />
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-3 w-3/5" />
    </div>
  );
}

/** Table placeholder: a header strip plus `rows` body rows across `cols`. */
export function SkeletonTable({ rows = 6, cols = 5, className = "" }) {
  return (
    <div role="status" aria-label="Loading" className={`w-full overflow-hidden ${className}`}>
      <div className="flex items-center gap-4 border-b border-brand-border bg-brand-bg/60 px-4 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={`h-${i}`} className="h-3 flex-1" />
        ))}
      </div>
      <div className="divide-y divide-brand-border">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={`r-${r}`} className="flex items-center gap-4 px-4 py-3.5">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton
                key={`c-${r}-${c}`}
                className={`h-3 flex-1 ${c === 0 ? "max-w-[40%]" : ""}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Summary cards across the top of a dashboard (icon + label + value). */
export function SkeletonStatGrid({ count = 4, className = "" }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={`grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 sm:gap-4 ${className}`}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-card border border-brand-border bg-white p-5 dark:bg-card">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-5 w-1/3" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Grid of generic content cards. */
export function SkeletonCardGrid({ count = 6, className = "" }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={`grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 ${className}`}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-card border border-brand-border bg-white p-5 dark:bg-card">
          <SkeletonCard />
        </div>
      ))}
    </div>
  );
}

/** Chart panel placeholder (plot area + axis hint). */
export function SkeletonChart({ className = "" }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={`rounded-card border border-brand-border bg-white p-5 dark:bg-card ${className}`}
    >
      <Skeleton className="h-4 w-1/4" />
      <Skeleton className="mt-3 h-3 w-1/3" />
      <div className="mt-5 flex h-56 items-end gap-2.5">
        {[62, 84, 45, 92, 70, 55, 80, 48, 66].map((h, i) => (
          <Skeleton key={i} className="flex-1 rounded-t-md" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  );
}

/**
 * Full-page placeholder used as the route-level Suspense fallback inside the
 * dashboard shell. Mirrors the dashboard rhythm (header, summary cards, content
 * table) so the layout does not jump when the real page mounts.
 */
export function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="mx-auto w-full max-w-content space-y-6">
      <div className="space-y-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-64 max-w-full" />
        <Skeleton className="h-3 w-80 max-w-full" />
      </div>
      <SkeletonStatGrid count={4} />
      <div className="rounded-card border border-brand-border bg-white p-4 sm:p-6 dark:bg-card">
        <Skeleton className="h-4 w-40" />
        <SkeletonTable rows={5} cols={4} className="mt-4" />
      </div>
    </div>
  );
}

/**
 * Bare, self-contained page placeholder used while the session is being
 * restored (before the dashboard shell exists). Centered and neutral so it
 * works on any route, public or protected.
 */
export function FullPageSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex min-h-dvh w-full items-center justify-center bg-[color:#f5f7fa] px-4 dark:bg-background"
    >
      <div className="w-full max-w-md space-y-5">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
        <div className="space-y-3 rounded-card border border-brand-border bg-white p-6 dark:bg-card">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-1/3" />
        </div>
      </div>
    </div>
  );
}

export default Skeleton;

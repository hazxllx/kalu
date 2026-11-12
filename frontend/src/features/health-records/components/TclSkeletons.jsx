import React from "react";
import { Skeleton, SkeletonTable } from "@/components/system/Skeleton";

/**
 * TCL page skeleton — matches the header + toolbar + table layout used across
 * all TCL program pages (Maternal, NCD, Oral Health, Environmental, etc.).
 */
export function TclPageHeaderSkeleton() {
  return (
    <div className="ui-tcl-header-skeleton mb-6 overflow-hidden rounded-card border border-brand-border bg-brand-dark p-6 shadow-card">
      <div className="space-y-4">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-3 w-full max-w-2xl" />
      </div>
    </div>
  );
}

/**
 * TCL toolbar skeleton — search field + filters + action buttons.
 */
export function TclToolbarSkeleton() {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
      <Skeleton className="h-10 flex-1 rounded-btn" />
      <Skeleton className="h-10 w-24 rounded-btn" />
      <Skeleton className="h-10 w-24 rounded-btn" />
    </div>
  );
}

/**
 * TCL list skeleton — table with typical TCL columns (resident, date, status, etc.).
 */
export function TclListSkeleton({ rows = 5 }) {
  return (
    <div className="space-y-4">
      <TclToolbarSkeleton />
      <SkeletonTable rows={rows} cols={5} />
    </div>
  );
}

/**
 * TCL directory skeleton — program card grid.
 */
export function TclDirectorySkeleton({ count = 6 }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-card border border-brand-border bg-white p-4">
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <Skeleton className="h-8 w-8 rounded" />
              <Skeleton className="h-5 w-12 rounded-full" />
            </div>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * TCL form modal skeleton — for editing/creating records.
 */
export function TclFormSkeleton() {
  return (
    <div className="space-y-6">
      {/* Form sections */}
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-3">
          <Skeleton className="h-4 w-32" />
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, j) => (
              <div key={j} className="space-y-1">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-10 w-full rounded-btn" />
              </div>
            ))}
          </div>
        </div>
      ))}
      {/* Form buttons */}
      <div className="flex gap-3 pt-4">
        <Skeleton className="h-10 w-20 rounded-btn" />
        <Skeleton className="h-10 w-20 rounded-btn" />
      </div>
    </div>
  );
}

/**
 * TCL program card skeleton in directory.
 */
export function TclCardSkeleton() {
  return (
    <div className="rounded-card border border-brand-border bg-white p-4">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <Skeleton className="h-10 w-10 rounded shrink-0" />
          <Skeleton className="h-5 w-16 rounded-full shrink-0" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
        </div>
      </div>
    </div>
  );
}

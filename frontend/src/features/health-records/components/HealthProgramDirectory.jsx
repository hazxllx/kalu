import React from "react";
import { Link } from "react-router-dom";
import { Activity, ArrowRight } from "lucide-react";
import PageHeader from "@/components/common/PageHeader";

const countFormatter = new Intl.NumberFormat();

function ProgramRecordCount({ count, state }) {
  if (state === "loading") {
    return <span className="text-xs text-brand-gray dark:text-muted-foreground">Loading count</span>;
  }

  if (state === "error" || !Number.isSafeInteger(count) || count < 0) {
    return <span className="text-xs text-brand-gray dark:text-muted-foreground">Count unavailable</span>;
  }

  return (
    <span className="inline-flex items-baseline gap-1.5 text-brand-gray dark:text-muted-foreground">
      <span className="font-stat text-sm font-semibold text-brand-ink dark:text-foreground">
        {countFormatter.format(count)}
      </span>
      <span className="text-xs">{count === 1 ? "record" : "records"}</span>
    </span>
  );
}

function ProgramCard({ program }) {
  const Icon = program.icon || Activity;
  const name = program.name || program.title;
  const disabled = Boolean(program.disabled);
  const cardClass = `group flex h-full min-h-[13rem] flex-col border bg-brand-paper p-5 text-left transition-colors dark:bg-card ${
    disabled
      ? "cursor-not-allowed border-brand-border/80 opacity-70 dark:border-border"
      : "border-brand-border hover:border-brand-blue/55 hover:bg-[#FBFCFE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/35 active:bg-brand-light/70 dark:border-border dark:hover:border-primary/60 dark:hover:bg-hover"
  }`;

  const content = (
    <>
      <div className="flex items-start justify-between gap-4">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-gray dark:text-muted-foreground">
          {program.category}
        </span>
        <Icon className="h-5 w-5 shrink-0 text-brand-blue dark:text-primary" strokeWidth={1.8} aria-hidden="true" />
      </div>

      <h3 className="mt-4 text-base font-semibold leading-snug text-brand-ink dark:text-foreground">
        {name}
      </h3>
      <p className="mt-2 text-[13px] leading-relaxed text-brand-gray dark:text-muted-foreground">
        {program.description}
      </p>

      <div className="mt-auto flex items-center justify-between gap-4 border-t border-brand-border/80 pt-4 dark:border-border">
        {disabled ? (
          <span className="text-xs font-medium text-brand-gray dark:text-muted-foreground" title={program.disabledReason}>
            Unavailable
          </span>
        ) : (
          <ProgramRecordCount count={program.recordCount} state={program.countState} />
        )}
        {!disabled && (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-brand-blue dark:text-primary">
            Review
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </span>
        )}
      </div>
    </>
  );

  if (disabled) {
    return (
      <article className={cardClass} aria-disabled="true" title={program.disabledReason}>
        {content}
      </article>
    );
  }

  return (
    <Link to={program.to} className={cardClass} aria-label={`Review ${name}`}>
      {content}
    </Link>
  );
}

export default function HealthProgramDirectory({
  programs = [],
  title = "Health Program Directory",
  subtitle = "Review health program records within your authorized service area.",
  crumbs = ["Clinical Care", "Health Programs"],
  context = null,
  notices = null,
  countNote = "",
  showSectionSummary = true,
}) {
  const availablePrograms = programs.filter((program) => !program.disabled).length;

  return (
    <section aria-label={title}>
      <PageHeader
        dense
        crumbs={crumbs}
        title={title}
        subtitle={subtitle}
        meta={(
          <span className="inline-flex items-baseline gap-1.5 border-l border-white/20 pl-3 text-white/75">
            <span className="font-stat text-sm font-semibold text-white">{availablePrograms}</span>
            <span className="text-[11px] font-medium uppercase tracking-[0.1em]">
              {availablePrograms === 1 ? "program available" : "programs available"}
            </span>
          </span>
        )}
      />

      {context && (
        <div className="mb-5 border border-brand-border bg-brand-paper px-4 py-3 dark:border-border dark:bg-card">
          {context}
        </div>
      )}

      {notices && <div className="mb-4 space-y-3">{notices}</div>}

      <div>
        {showSectionSummary && (
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2 border-b border-brand-border pb-2.5 dark:border-border">
            <h2 className="text-sm font-semibold text-brand-ink dark:text-foreground">Programs</h2>
            <p className="text-xs text-brand-gray dark:text-muted-foreground">
              {programs.length} {programs.length === 1 ? "program" : "programs"}
            </p>
          </div>
        )}

        {programs.length > 0 ? (
          <div className="grid auto-rows-fr grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
            {programs.map((program) => (
              <ProgramCard key={program.id} program={program} />
            ))}
          </div>
        ) : (
          <div className="flex min-h-56 flex-col items-center justify-center border border-brand-border bg-brand-paper px-6 py-10 text-center dark:border-border dark:bg-card">
            <h2 className="text-base font-semibold text-brand-ink dark:text-foreground">No health programs available</h2>
            <p className="mt-1.5 max-w-md text-sm text-brand-gray dark:text-muted-foreground">
              There are no programs available in this directory.
            </p>
          </div>
        )}
      </div>

      {countNote && (
        <p className="mt-4 text-[11px] leading-relaxed text-brand-gray dark:text-muted-foreground">
          {countNote}
        </p>
      )}
    </section>
  );
}

import React, { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

function hasContent(value) {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === "string") return Boolean(value.trim());
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export default function UniversalDetailsModal({
  open,
  record,
  onClose,
  actions = null,
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const image = typeof record?.image === "string" ? { src: record.image } : record?.image;
  const information = (record?.information || []).filter((item) => hasContent(item?.value));
  const sections = (record?.sections || []).filter((section) => hasContent(section?.content));

  useEffect(() => {
    setImageFailed(false);
  }, [image?.src]);

  if (!open || !record) return null;

  return (
    <Dialog.Root open onOpenChange={(isOpen) => { if (!isOpen) onClose?.(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-[1px]" />
        <Dialog.Content className="fixed inset-0 z-[85] flex h-[100dvh] w-full flex-col overflow-hidden border border-brand-border bg-white shadow-2xl focus:outline-none dark:bg-card sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-auto sm:max-h-[85dvh] sm:w-[calc(100%-2rem)] sm:max-w-3xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl">
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-brand-border px-5 py-4 sm:px-6">
            <div className="min-w-0">
              {record.category && (
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-blue">
                  {record.category}
                </p>
              )}
              <Dialog.Title className="mt-1 break-words text-xl font-semibold leading-tight text-brand-ink dark:text-foreground">
                {record.title || "Details"}
              </Dialog.Title>
              <Dialog.Description className="sr-only">
                Details for {record.title || "this record"}
              </Dialog.Description>
              {record.status && (
                <span className="mt-2 inline-flex max-w-full rounded-full bg-brand-blue/10 px-2.5 py-1 text-xs font-semibold text-brand-blue dark:bg-brand-blue/20 dark:text-blue-300">
                  {record.status}
                </span>
              )}
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="shrink-0 rounded-full p-2 text-brand-gray transition-colors hover:bg-brand-bg hover:text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue dark:hover:bg-hover"
                aria-label="Close details"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
            {image?.src && !imageFailed && (
              <div className="flex max-h-[34vh] items-center justify-center overflow-hidden rounded-lg border border-brand-border bg-brand-bg/50 p-2 dark:border-border dark:bg-background">
                <img
                  src={image.src}
                  alt={image.alt || ""}
                  className="max-h-[32vh] max-w-full object-contain"
                  onError={() => setImageFailed(true)}
                />
              </div>
            )}

            {hasContent(record.description) && (
              <section aria-label="Description">
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-brand-gray dark:text-muted-foreground">
                  {record.description}
                </p>
              </section>
            )}

            {information.length > 0 && (
              <section aria-label="Information">
                <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-4 rounded-lg border border-brand-border bg-brand-bg/50 p-4 dark:border-border dark:bg-background sm:grid-cols-2">
                  {information.map(({ label, value }) => (
                    <div key={label} className="min-w-0 [overflow-wrap:anywhere]">
                      <dt className="text-xs font-medium uppercase tracking-wide text-brand-gray dark:text-muted-foreground">
                        {label}
                      </dt>
                      <dd className="mt-1 whitespace-pre-wrap text-sm font-medium text-brand-ink dark:text-foreground">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            {sections.map(({ title, content }) => (
              <section key={title} className="border-t border-brand-border pt-4 dark:border-border">
                <h3 className="text-sm font-semibold text-brand-ink dark:text-foreground">{title}</h3>
                <div className="mt-2 break-words text-sm leading-relaxed text-brand-gray dark:text-muted-foreground">
                  {content}
                </div>
              </section>
            ))}
          </div>

          <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-brand-border bg-white px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:bg-card">
            <Dialog.Close asChild>
              <button
                type="button"
                className="h-10 rounded-btn border border-brand-border px-4 text-sm font-medium text-brand-gray transition-colors hover:bg-brand-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40 dark:border-border dark:text-muted-foreground dark:hover:bg-hover"
              >
                Close
              </button>
            </Dialog.Close>
            {actions && <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">{actions}</div>}
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

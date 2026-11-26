// frontend/src/components/ui/action-menu.jsx
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MoreVertical } from "lucide-react";

const triggerClassName =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-brand-border bg-white text-brand-blue shadow-none transition-colors hover:border-brand-blue hover:bg-brand-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40 disabled:pointer-events-none disabled:opacity-50 dark:border-border dark:bg-card dark:text-brand-blue";

const contentClassName =
  "z-[130] max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-56 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border border-brand-border bg-white p-1 text-brand-ink shadow-[0_8px_24px_rgba(12,39,67,0.16)] dark:border-border dark:bg-card dark:text-foreground";

const itemClassName =
  "flex min-h-9 w-full cursor-default items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm leading-5 outline-none transition-colors data-[highlighted]:bg-brand-light data-[highlighted]:text-brand-dark data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:data-[highlighted]:bg-hover";

// Renders or manages ActionMenu logic.
export function ActionMenu({ children, ...props }) {
  return <DropdownMenu.Root modal={false} {...props}>{children}</DropdownMenu.Root>;
}

// Renders or manages ActionMenuTrigger logic.
export function ActionMenuTrigger({
  children = <MoreVertical className="h-4 w-4" aria-hidden="true" />,
  label = "Actions",
  className = "",
  ...props
}) {
  return (
    <DropdownMenu.Trigger asChild>
      <button
        type="button"
        aria-label={label}
        className={`${triggerClassName} ${className}`.trim()}
        {...props}
      >
        {children}
      </button>
    </DropdownMenu.Trigger>
  );
}

// Renders or manages ActionMenuContent logic.
export function ActionMenuContent({ children, className = "", ...props }) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align="end"
        side="bottom"
        sideOffset={4}
        collisionPadding={8}
        avoidCollisions
        className={`${contentClassName} ${className}`.trim()}
        {...props}
      >
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

// Renders or manages ActionMenuItem logic.
export function ActionMenuItem({ children, icon: Icon, danger = false, onSelect, className = "", ...props }) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={`${itemClassName} ${danger ? "text-brand-danger data-[highlighted]:bg-brand-danger/10 data-[highlighted]:text-brand-danger" : ""} ${className}`.trim()}
      {...props}
    >
      {Icon && <Icon className={`h-4 w-4 shrink-0 ${danger ? "text-brand-danger" : "text-brand-blue"}`} aria-hidden="true" />}
      <span className="min-w-0 flex-1">{children}</span>
    </DropdownMenu.Item>
  );
}

// Renders or manages ActionMenuMessage logic.
export function ActionMenuMessage({ children, className = "" }) {
  return <p className={`px-2.5 py-2 text-xs leading-snug text-brand-gray ${className}`.trim()}>{children}</p>;
}

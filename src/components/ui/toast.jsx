import * as React from "react";
import { cva } from "class-variance-authority";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * `React.forwardRef` contextually types its render function, so destructured
 * defaults alone are not enough to infer the props type under `checkJs`.
 * These typedefs give each vendored primitive a real props contract.
 *
 * @typedef {React.ComponentPropsWithoutRef<"div">} DivProps
 * @typedef {React.ComponentPropsWithoutRef<"button">} ButtonProps
 */

/** @type {React.ForwardRefRenderFunction<HTMLDivElement, DivProps>} */
const renderToastProvider = ({ children = null, ...props }, ref) => (
  <div
    ref={ref}
    className="fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]"
    {...props}
  >
    {children}
  </div>
);
const ToastProvider = React.forwardRef(renderToastProvider);
ToastProvider.displayName = "ToastProvider";

/** @type {React.ForwardRefRenderFunction<HTMLDivElement, DivProps>} */
const renderToastViewport = ({ children = null, ...props }, ref) => (
  <div
    ref={ref}
    className="fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]"
    {...props}
  >
    {children}
  </div>
);
const ToastViewport = React.forwardRef(renderToastViewport);
ToastViewport.displayName = "ToastViewport";

const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-6 pr-8 shadow-lg transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full",
  {
    variants: {
      variant: {
        default: "border bg-background text-foreground",
        destructive:
          "destructive group border-destructive bg-destructive text-destructive-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

/** @type {React.ForwardRefRenderFunction<HTMLDivElement, DivProps & { variant?: "default" | "destructive" }>} */
const renderToast = ({ className = "", variant = "default", ...props }, ref) => (
  <div
    ref={ref}
    className={cn(toastVariants({ variant }), className)}
    {...props}
  />
);
const Toast = React.forwardRef(renderToast);
Toast.displayName = "Toast";

/** @type {React.ForwardRefRenderFunction<HTMLDivElement, DivProps>} */
const renderToastAction = ({ className = "", ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 group-[.destructive]:border-muted/40 group-[.destructive]:hover:border-destructive/30 group-[.destructive]:hover:bg-destructive group-[.destructive]:hover:text-destructive-foreground group-[.destructive]:focus:ring-destructive",
      className
    )}
    {...props}
  />
);
const ToastAction = React.forwardRef(renderToastAction);
ToastAction.displayName = "ToastAction";

/** @type {React.ForwardRefRenderFunction<HTMLButtonElement, ButtonProps>} */
const renderToastClose = ({ className = "", ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    aria-label="Close notification"
    className={cn(
      "absolute right-2 top-2 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 group-hover:opacity-100 group-[.destructive]:text-red-300 group-[.destructive]:hover:text-red-50 group-[.destructive]:focus:ring-red-400 group-[.destructive]:focus:ring-offset-red-600",
      className
    )}
    {...props}
  >
    <X className="h-4 w-4" aria-hidden="true" />
  </button>
);
const ToastClose = React.forwardRef(renderToastClose);
ToastClose.displayName = "ToastClose";

/** @type {React.ForwardRefRenderFunction<HTMLDivElement, DivProps>} */
const renderToastTitle = ({ className = "", ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm font-semibold", className)}
    {...props}
  />
);
const ToastTitle = React.forwardRef(renderToastTitle);
ToastTitle.displayName = "ToastTitle";

/** @type {React.ForwardRefRenderFunction<HTMLDivElement, DivProps>} */
const renderToastDescription = ({ className = "", ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm opacity-90", className)}
    {...props}
  />
);
const ToastDescription = React.forwardRef(renderToastDescription);
ToastDescription.displayName = "ToastDescription";

export {
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
};

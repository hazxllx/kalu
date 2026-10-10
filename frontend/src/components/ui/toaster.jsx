import { useToast } from "@/components/ui/use-toast";
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast";

export function Toaster() {
  const { toasts, dismiss } = useToast();

  return (
    <ToastProvider>
      {toasts
        // A dismissed toast flips `open` to false; drop it from the UI
        // immediately so the X click removes the notification right away.
        .filter((t) => t.open !== false)
        .map(function ({
          id,
          title,
          description,
          action,
          // Strip control-only fields so they aren't spread onto the DOM node.
          open: _open,
          onOpenChange: _onOpenChange,
          ...props
        }) {
          return (
            <Toast key={id} {...props}>
              <div className="grid gap-1">
                {title && <ToastTitle>{title}</ToastTitle>}
                {description && (
                  <ToastDescription>{description}</ToastDescription>
                )}
              </div>
              {action}
              <ToastClose onClick={() => dismiss(id)} />
            </Toast>
          );
        })}
      <ToastViewport />
    </ToastProvider>
  );
} 
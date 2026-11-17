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
      <ToastViewport>
        {toasts.map(({
            id,
            title,
            description,
            action,
            duration: _duration,
            open,
            onOpenChange: _onOpenChange,
            ...props
          }) => (
          <Toast key={id} {...props} data-state={open === false ? "closed" : "open"} role="status">
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            {action}
            <ToastClose onClick={() => dismiss(id)} />
          </Toast>
        ))}
      </ToastViewport>
    </ToastProvider>
  );
} 
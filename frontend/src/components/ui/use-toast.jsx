// frontend/src/components/ui/use-toast.jsx
// Inspired by react-hot-toast library
import { useState, useEffect } from "react";

const TOAST_LIMIT = 4;
const TOAST_REMOVE_DELAY = 250;

const actionTypes = {
  ADD_TOAST: "ADD_TOAST",
  UPDATE_TOAST: "UPDATE_TOAST",
  DISMISS_TOAST: "DISMISS_TOAST",
  REMOVE_TOAST: "REMOVE_TOAST",
};

let count = 0;

// Handles genId logic.
function genId() {
  count = (count + 1) % Number.MAX_VALUE;
  return count.toString();
}

const toastTimeouts = new Map();
const autoDismissTimeouts = new Map();

const addToRemoveQueue = (toastId) => {
  if (toastTimeouts.has(toastId)) {
    return;
  }

  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId);
    dispatch({
      type: actionTypes.REMOVE_TOAST,
      toastId,
    });
  }, TOAST_REMOVE_DELAY);

  toastTimeouts.set(toastId, timeout);
};

const _clearFromRemoveQueue = (toastId) => {
  const timeout = toastTimeouts.get(toastId);
  if (timeout) {
    clearTimeout(timeout);
    toastTimeouts.delete(toastId);
  }
};

export const reducer = (state, action) => {
  switch (action.type) {
    case actionTypes.ADD_TOAST:
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      };

    case actionTypes.UPDATE_TOAST:
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toast.id ? { ...t, ...action.toast } : t
        ),
      };

    case actionTypes.DISMISS_TOAST: {
      const { toastId } = action;

      // ! Side effects ! - This could be extracted into a dismissToast() action,
      // but I'll keep it here for simplicity
      if (toastId) {
        addToRemoveQueue(toastId);
      } else {
        state.toasts.forEach((toast) => {
          addToRemoveQueue(toast.id);
        });
      }

      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === toastId || toastId === undefined
            ? {
                ...t,
                open: false,
              }
            : t
        ),
      };
    }
    case actionTypes.REMOVE_TOAST:
      if (action.toastId === undefined) {
        return {
          ...state,
          toasts: [],
        };
      }
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      };
  }
};

const listeners = [];

let memoryState = { toasts: [] };

// Handles dispatch logic.
function dispatch(action) {
  memoryState = reducer(memoryState, action);
  listeners.forEach((listener) => {
    listener(memoryState);
  });
}

// Handles dismissToast logic.
function dismissToast(toastId) {
  if (toastId === undefined) {
    for (const timeout of autoDismissTimeouts.values()) clearTimeout(timeout);
    autoDismissTimeouts.clear();
  } else {
    const timeout = autoDismissTimeouts.get(toastId);
    if (timeout) clearTimeout(timeout);
    autoDismissTimeouts.delete(toastId);
  }
  dispatch({ type: actionTypes.DISMISS_TOAST, toastId });
}

/**
 * Publish a notification. Callers may use `variant` values of `success`,
 * `error`, `warning`, or `info`; the toaster maps these to the system palette.
 * `dedupeKey` prevents repeated requests from spamming the user.
 */
function toast({ ...props }) {
  const id = genId();

  if (props.dedupeKey) {
    const duplicate = memoryState.toasts.find((item) => item.dedupeKey === props.dedupeKey && item.open !== false);
    if (duplicate) return { id: duplicate.id, dismiss: () => dismissToast(duplicate.id), update: () => {} };
  }

  const update = (props) =>
    dispatch({
      type: actionTypes.UPDATE_TOAST,
      toast: { ...props, id },
    });

  const dismiss = () => dismissToast(id);
  if (typeof props.duration === "number" && props.duration > 0) {
    autoDismissTimeouts.set(id, setTimeout(dismiss, props.duration));
  }

  dispatch({
    type: actionTypes.ADD_TOAST,
    toast: {
      ...props,
      id,
      open: true,
      onOpenChange: (open) => {
        if (!open) dismiss();
      },
    },
  });

  return {
    id,
    dismiss,
    update,
  };
}

// Renders or manages useToast logic.
function useToast() {
  const [state, setState] = useState(memoryState);

  useEffect(() => {
    listeners.push(setState);
    return () => {
      const index = listeners.indexOf(setState);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }, [state]);

  return {
    ...state,
    toast,
    success: (description, options = {}) => toast({ title: "Success", description, variant: "success", duration: 4000, ...options }),
    error: (description, options = {}) => toast({ title: "Something went wrong", description, variant: "error", duration: 8000, ...options }),
    warning: (description, options = {}) => toast({ title: "Please review", description, variant: "warning", duration: 6000, ...options }),
    info: (description, options = {}) => toast({ title: "Information", description, variant: "info", duration: 5000, ...options }),
    dismiss: dismissToast,
  };
}

export { useToast, toast };

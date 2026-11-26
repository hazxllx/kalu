// frontend/src/components/system/ButtonSelectGroup.jsx
import React, { useRef } from "react";

/**
 * ButtonSelectGroup — the KALUSAGAP standard single-select button group.
 *
 * Replaces a native <select> for categorical fields that have exactly two
 * meaningful choices (e.g. Yes/No, Positive/Negative, Active/Inactive). Only
 * one option can be active at a time; clicking one calls `onChange` with that
 * option's raw value, preserving the exact value types (string / boolean /
 * number) the form state, API payload and database already expect.
 *
 * Behaviour & accessibility:
 *  - Rendered as an accessible radio group (role="radiogroup" / role="radio"
 *    with aria-checked), with roving tabindex so the group takes a single Tab
 *    stop and arrow keys move between options.
 *  - No option is auto-selected: when `value` matches none of the options
 *    (e.g. an empty/placeholder state) nothing is highlighted.
 *  - Supports hover, keyboard focus ring, disabled and validation-error states.
 *
 * Visual identity (unchanged KALUSAGAP blue-and-white):
 *  - Selected   -> solid brand-blue background, white text.
 *  - Unselected -> white background, subtle blue-gray border, dark navy text.
 *
 * Options may be given as plain strings (value === label) or as objects
 * `{ value, label, disabled? }`.
 */
function normalize(options) {
  return (options || []).map((opt) =>
    typeof opt === "object" && opt !== null
      ? { value: opt.value, label: opt.label ?? String(opt.value), disabled: Boolean(opt.disabled) }
      : { value: opt, label: String(opt), disabled: false },
  );
}

/**
 * Visual variants. `default` keeps the compact system look used across the app.
 * `registration` matches the KALUSAGAP registration form inputs (same rounding,
 * padding and light-gray border as `inputCls` in RegistrationDesign) so the
 * Sex buttons sit flush with the surrounding fields; the selected state stays a
 * solid brand-blue chip with white text, and the unselected state is white with
 * a thin light-gray border per the registration design.
 */
const VARIANTS = {
  default: {
    base: "min-w-0 flex-1 rounded-btn border px-3.5 py-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-1 focus-visible:ring-brand-blue/40 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-60 sm:min-w-[7rem]",
    selected: "border-brand-blue bg-brand-blue text-white hover:bg-brand-dark",
    unselectedError: "bg-white text-brand-ink hover:border-brand-blue hover:bg-brand-light border-brand-danger",
    unselected: "bg-white text-brand-ink hover:border-brand-blue hover:bg-brand-light border-brand-border",
  },
  registration: {
    base: "min-w-0 flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium outline-none transition-all duration-200 focus-visible:ring-1 focus-visible:ring-brand-blue/30 focus-visible:ring-offset-0 focus-visible:border-brand-blue disabled:cursor-not-allowed disabled:opacity-60 sm:min-w-[7rem]",
    selected: "border-brand-blue bg-brand-blue text-white shadow-sm hover:bg-brand-dark hover:border-brand-dark",
    unselectedError: "bg-white text-brand-ink hover:border-slate-300 border-brand-danger",
    unselected: "bg-white text-brand-ink hover:border-slate-300 border-slate-200",
  },
  compact: {
    base: "h-11 min-w-0 flex-1 rounded-btn border px-3 text-sm font-medium outline-none transition-colors focus-visible:border-[#2563EB] focus-visible:ring-1 focus-visible:ring-[#2563EB]/30 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-60",
    selected: "border-brand-blue bg-brand-blue text-white hover:bg-brand-dark",
    unselectedError: "border-brand-danger bg-white text-brand-ink hover:border-brand-blue",
    unselected: "border-[#CBD5E1] bg-white text-brand-ink hover:border-brand-blue hover:bg-brand-light",
  },
};

export default function ButtonSelectGroup({
  options,
  value,
  onChange,
  ariaLabel,
  name = undefined,
  disabled = false,
  error = false,
  id = undefined,
  ariaDescribedby = undefined,
  onBlur = undefined,
  variant = "default",
  className = "",
}) {
  const styles = VARIANTS[variant] || VARIANTS.default;
  const items = normalize(options);
  const selectedIndex = items.findIndex((o) => o.value === value);
  const buttonRefs = useRef([]);

  const onKeyDown = (e) => {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
    if (!keys.includes(e.key) || disabled) return;
    e.preventDefault();
    const enabled = items.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
    if (enabled.length === 0) return;
    const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
    const pos = enabled.indexOf(selectedIndex);
    const base = pos === -1 ? (forward ? -1 : 0) : pos;
    const nextPos = forward
      ? (base + 1) % enabled.length
      : (base - 1 + enabled.length) % enabled.length;
    const nextIndex = enabled[nextPos];
    onChange(items[nextIndex].value);
    buttonRefs.current[nextIndex]?.focus();
  };

  return (
    <div
      role="radiogroup"
      id={id}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedby}
      aria-invalid={error || undefined}
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onBlur?.();
      }}
      className={`mt-1.5 flex flex-wrap gap-2 ${className}`}
    >
      {items.map((opt, idx) => {
        const selected = opt.value === value;
        const isDisabled = disabled || opt.disabled;
        return (
          <button
            key={String(opt.value) === "" ? `none-${idx}` : String(opt.value)}
            ref={(element) => { buttonRefs.current[idx] = element; }}
            type="button"
            role="radio"
            aria-checked={selected}
            name={name}
            disabled={isDisabled}
            tabIndex={selected || (selectedIndex === -1 && idx === 0) ? 0 : -1}
            onClick={() => onChange(opt.value)}
            className={`${styles.base} ${
              selected
                ? styles.selected
                : error
                  ? styles.unselectedError
                  : styles.unselected
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

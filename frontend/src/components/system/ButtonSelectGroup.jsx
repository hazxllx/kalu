import React from "react";

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

export default function ButtonSelectGroup({
  options,
  value,
  onChange,
  ariaLabel,
  name,
  disabled = false,
  error = false,
  className = "",
}) {
  const items = normalize(options);
  const selectedIndex = items.findIndex((o) => o.value === value);

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
    onChange(items[enabled[nextPos]].value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={`mt-1.5 flex flex-wrap gap-2 ${className}`}
    >
      {items.map((opt, idx) => {
        const selected = opt.value === value;
        const isDisabled = disabled || opt.disabled;
        return (
          <button
            key={String(opt.value) === "" ? `none-${idx}` : String(opt.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            name={name}
            disabled={isDisabled}
            tabIndex={selected || (selectedIndex === -1 && idx === 0) ? 0 : -1}
            onClick={() => onChange(opt.value)}
            className={`min-w-[7rem] flex-1 rounded-btn border px-3.5 py-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60 ${
              selected
                ? "border-brand-blue bg-brand-blue text-white hover:bg-brand-dark"
                : `bg-white text-brand-ink hover:border-brand-blue hover:bg-brand-light ${
                    error ? "border-brand-danger" : "border-brand-border"
                  }`
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

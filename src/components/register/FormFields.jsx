import React from "react";
import { ChevronDown, Asterisk } from "lucide-react";

const baseInput =
  "w-full bg-transparent text-[13.5px] text-brand-ink outline-none placeholder:text-brand-gray/45";
const baseWrap = (error) =>
  `mt-1.5 flex items-center gap-2.5 border bg-white px-3.5 py-2.5 transition-colors ${
    error ? "border-brand-danger" : "border-brand-border focus-within:border-brand-blue"
  }`;

function Label({ label, optional = false }) {
  if (!label) return null;
  return (
    <label className="flex items-center gap-1 text-[12.5px] font-bold text-brand-ink">
      {label}
      {!optional && <Asterisk className="h-3 w-3 text-brand-danger" strokeWidth={2.4} />}
      {optional && <span className="font-normal text-brand-gray/70">(Optional)</span>}
    </label>
  );
}

function ErrorText({ error = "" }) {
  if (!error) return null;
  return <p className="mt-1 text-[11.5px] text-brand-danger">{error}</p>;
}

export function TextField({ label, icon: Icon = null, optional = false, error = "", ...props }) {
  return (
    <div>
      <Label label={label} optional={optional} />
      <div className={baseWrap(error)}>
        {Icon && <Icon className="h-4 w-4 shrink-0 text-brand-gray" strokeWidth={1.9} />}
        <input {...props} className={baseInput} />
      </div>
      <ErrorText error={error} />
    </div>
  );
}

export function SelectField({ label, icon: Icon = null, optional = false, error = "", children, ...props }) {
  return (
    <div>
      <Label label={label} optional={optional} />
      <div className={baseWrap(error)}>
        {Icon && <Icon className="h-4 w-4 shrink-0 text-brand-gray" strokeWidth={1.9} />}
        <select {...props} className={`${baseInput} appearance-none cursor-pointer`}>
          {children}
        </select>
        <ChevronDown className="h-4 w-4 shrink-0 text-brand-gray" />
      </div>
      <ErrorText error={error} />
    </div>
  );
}

export function TextAreaField({ label, optional = false, error = "", ...props }) {
  return (
    <div>
      <Label label={label} optional={optional} />
      <textarea
        {...props}
        rows={3}
        className={`mt-1.5 w-full resize-none border bg-white px-3.5 py-2.5 text-[13.5px] text-brand-ink outline-none transition-colors placeholder:text-brand-gray/45 ${
          error ? "border-brand-danger" : "border-brand-border focus:border-brand-blue"
        }`}
      />
      <ErrorText error={error} />
    </div>
  );
}

export function YesNoField({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-dashed border-brand-border py-2.5">
      <span className="text-[13px] font-medium text-brand-ink">{label}</span>
      <div className="flex border border-brand-border bg-white">
        {["Yes", "No"].map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`px-4 py-1.5 text-[11.5px] font-bold uppercase tracking-[0.08em] transition-colors ${
              value === opt
                ? "bg-brand-blue text-white"
                : "text-brand-gray hover:bg-brand-paper hover:text-brand-ink"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ChipSelect({ options, selected, onToggle }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            className={`border px-3.5 py-2 text-[11.5px] font-bold uppercase tracking-[0.08em] transition-colors ${
              active
                ? "border-brand-blue bg-brand-blue text-white"
                : "border-brand-border bg-white text-brand-gray hover:border-brand-blue/50 hover:text-brand-ink"
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

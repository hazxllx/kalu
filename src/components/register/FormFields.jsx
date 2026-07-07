import React from "react";
import { ChevronDown } from "lucide-react";

export function TextField({ label, icon: Icon, optional, error, ...props }) {
  return (
    <div>
      <label className="text-sm font-medium text-brand-ink">
        {label}
        {optional && <span className="text-brand-gray font-normal"> (Optional)</span>}
      </label>
      <div className={`mt-1.5 flex items-center gap-2 bg-white border rounded-input px-3.5 py-2.5 transition-colors ${error ? "border-brand-danger" : "border-brand-border focus-within:border-brand-blue"}`}>
        {Icon && <Icon className="w-4 h-4 text-brand-gray shrink-0" />}
        <input {...props} className="bg-transparent outline-none w-full text-sm text-brand-ink placeholder:text-brand-gray/50" />
      </div>
      {error && <p className="mt-1 text-xs text-brand-danger">{error}</p>}
    </div>
  );
}

export function SelectField({ label, icon: Icon, optional, error, children, ...props }) {
  return (
    <div>
      <label className="text-sm font-medium text-brand-ink">
        {label}
        {optional && <span className="text-brand-gray font-normal"> (Optional)</span>}
      </label>
      <div className={`mt-1.5 flex items-center gap-2 bg-white border rounded-input px-3.5 py-2.5 transition-colors ${error ? "border-brand-danger" : "border-brand-border focus-within:border-brand-blue"}`}>
        {Icon && <Icon className="w-4 h-4 text-brand-gray shrink-0" />}
        <select {...props} className="bg-transparent outline-none w-full text-sm text-brand-ink appearance-none cursor-pointer">
          {children}
        </select>
        <ChevronDown className="w-4 h-4 text-brand-gray shrink-0" />
      </div>
      {error && <p className="mt-1 text-xs text-brand-danger">{error}</p>}
    </div>
  );
}

export function TextAreaField({ label, optional, error, ...props }) {
  return (
    <div>
      <label className="text-sm font-medium text-brand-ink">
        {label}
        {optional && <span className="text-brand-gray font-normal"> (Optional)</span>}
      </label>
      <textarea {...props} rows={3} className={`mt-1.5 w-full bg-white border rounded-input px-3.5 py-2.5 text-sm text-brand-ink outline-none transition-colors resize-none ${error ? "border-brand-danger" : "border-brand-border focus:border-brand-blue"}`} />
      {error && <p className="mt-1 text-xs text-brand-danger">{error}</p>}
    </div>
  );
}

export function YesNoField({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm font-body text-brand-ink">{label}</span>
      <div className="flex items-center gap-1 bg-brand-bg rounded-btn p-1">
        {["Yes", "No"].map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`px-4 py-1.5 rounded-btn text-xs font-body font-medium transition-colors ${
              value === opt ? "bg-brand-blue text-white shadow-soft" : "text-brand-gray hover:text-brand-ink"
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
            className={`px-3.5 py-2 rounded-btn text-xs font-body font-medium border transition-all ${
              active
                ? "bg-brand-blue/10 text-brand-blue border-brand-blue/30"
                : "bg-white text-brand-gray border-brand-border hover:border-brand-blue/30 hover:text-brand-ink"
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
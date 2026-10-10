import React, { useEffect, useMemo, useState } from "react";
import { X, Save } from "lucide-react";
import { Card } from "@/components/common/Card";
import { ORAL_SERVICES, toRecord } from "../lib/programFormConfig";

const inputCls = (error) =>
  `mt-1.5 w-full bg-white border rounded-btn px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-brand-blue ${
    error ? "border-brand-danger" : "border-brand-border"
  }`;
const labelCls = "text-sm font-medium text-brand-ink";
const errorCls = "mt-1 text-xs text-brand-danger";

/** Age bucket used by the BOHC date column. */
const bohcBucket = (form) => (form.age_group === "pregnant" ? "pregnant" : form.age_group || "");

function Field({ config, field, fieldKey, form, setForm, error }) {
  const set = (value) => setForm((f) => ({ ...f, [fieldKey]: value }));
  const common = { id: `pf-${fieldKey}` };
  const value = form[fieldKey];

  switch (field.type) {
    case "textarea":
      return <textarea {...common} rows={2} value={value || ""} onChange={(e) => set(e.target.value)} className={`${inputCls(error)} resize-none`} />;
    case "date":
      return <input {...common} type="date" value={value || ""} onChange={(e) => set(e.target.value)} className={inputCls(error)} />;
    case "int":
      return <input {...common} type="number" value={value ?? ""} onChange={(e) => set(e.target.value === "" ? "" : Number(e.target.value))} className={inputCls(error)} placeholder={field.placeholder} />;
    case "select":
      return (
        <select {...common} value={value || ""} onChange={(e) => set(e.target.value)} className={`${inputCls(error)} cursor-pointer`}>
          <option value="">Select…</option>
          {field.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    case "checkbox":
      return (
        <label className="mt-1.5 flex items-center gap-2 cursor-pointer select-none">
          <input {...common} type="checkbox" checked={Boolean(value)} onChange={(e) => set(e.target.checked)} className="h-4 w-4 rounded border-brand-border text-brand-blue focus:ring-brand-blue" />
          <span className="text-sm text-brand-ink">Yes / Checked</span>
        </label>
      );
    case "service-checklist": {
      const services = value && typeof value === "object" ? value : {};
      const toggle = (code) => {
        const next = { ...services };
        if (code in next) delete next[code];
        else next[code] = "";
        set(next);
      };
      const setDate = (code, date) => set({ ...services, [code]: date });
      return (
        <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 rounded-btn border border-brand-border p-3">
          {ORAL_SERVICES.map(([code, name]) => {
            const checked = code in services;
            return (
              <div key={code} className="flex items-center gap-2">
                <input type="checkbox" checked={checked} onChange={() => toggle(code)} className="h-4 w-4 rounded border-brand-border text-brand-blue focus:ring-brand-blue" />
                <span className="text-xs text-brand-ink min-w-0 flex-1 truncate" title={name}><span className="font-semibold">{code}</span> · {name}</span>
                {checked && (
                  <input type="date" value={services[code] || ""} onChange={(e) => setDate(code, e.target.value)} className="w-36 border border-brand-border rounded px-2 py-1 text-xs outline-none focus:border-brand-blue" />
                )}
              </div>
            );
          })}
        </div>
      );
    }
    case "bohc": {
      const bucket = bohcBucket(form);
      const map = value && typeof value === "object" ? value : {};
      if (!bucket) return <p className="mt-1.5 text-xs text-brand-gray">Select an Age / Risk Group first.</p>;
      return (
        <div className="mt-1.5">
          <input type="date" value={map[bucket] || ""} onChange={(e) => set({ ...map, [bucket]: e.target.value })} className={inputCls(error)} />
          <p className="mt-1 text-xs text-brand-gray">BOHC date given for the <span className="font-medium">{bucket}</span> age bucket.</p>
        </div>
      );
    }
    case "text":
    default:
      return <input {...common} type="text" value={value || ""} onChange={(e) => set(e.target.value)} className={inputCls(error)} placeholder={field.placeholder} />;
  }
}

/**
 * Schema-driven create/edit form for a program-specific TCL / health form.
 * Validation (required + conditional) runs here AND is independently enforced
 * by the backend. Hidden conditional fields are never submitted.
 */
export default function ProgramFormModal({ config, entity, initialForm, onClose, onSave, saving, submitError }) {
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = ""; document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const visibleFields = useMemo(() => {
    const map = {};
    for (const group of config.groups) {
      map[group.title] = group.fields.filter((k) => {
        const f = config.fields[k];
        return f && (!f.visibleIf || f.visibleIf(form));
      });
    }
    return map;
  }, [config, form]);

  const validate = () => {
    const next = {};
    for (const group of config.groups) {
      for (const key of visibleFields[group.title]) {
        const field = config.fields[key];
        if (field.required) {
          const v = form[key];
          if (v === undefined || v === null || v === "") next[key] = `${field.label} is required.`;
        }
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = () => {
    if (!validate()) return;
    onSave(toRecord(config, form, entity.id));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-start justify-between gap-3 mb-1">
            <div>
              <h3 className="text-lg font-semibold text-brand-ink">{config.title}</h3>
              <p className="mt-0.5 text-sm text-brand-gray">
                {config.scope === "household" ? "Household" : "Client"}: <span className="font-medium text-brand-ink">{entity.name}</span>
              </p>
            </div>
            <button onClick={onClose} className="text-brand-gray hover:text-brand-ink" aria-label="Close"><X className="w-5 h-5" /></button>
          </div>

          <div className="space-y-5 mt-4">
            {config.groups.map((group) => {
              const keys = visibleFields[group.title];
              if (!keys.length) return null;
              return (
                <section key={group.title} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-xs font-semibold text-brand-gray uppercase tracking-wide mb-3">{group.title}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {keys.map((key) => {
                      const field = config.fields[key];
                      const wide = ["service-checklist", "textarea", "bohc"].includes(field.type);
                      return (
                        <div key={key} className={wide ? "sm:col-span-2" : ""}>
                          <label htmlFor={`pf-${key}`} className={labelCls}>
                            {field.label}{field.required && <span className="text-brand-danger"> *</span>}
                          </label>
                          <Field config={config} field={field} fieldKey={key} form={form} setForm={setForm} error={errors[key]} />
                          {field.help && <p className="mt-1 text-xs text-brand-gray">{field.help}</p>}
                          {errors[key] && <p className={errorCls}>{errors[key]}</p>}
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}

            {submitError && <div className="rounded-btn border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{submitError}</div>}

            <div className="flex justify-end gap-3 border-t border-brand-border pt-4">
              <button onClick={onClose} className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors">Cancel</button>
              <button onClick={submit} disabled={saving} className="flex items-center gap-2 rounded-btn bg-brand-blue px-5 py-2 text-sm font-medium text-white hover:bg-brand-dark transition-colors disabled:opacity-60">
                <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save Record"}
              </button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

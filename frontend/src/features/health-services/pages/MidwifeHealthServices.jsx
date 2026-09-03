import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import PageHeader from "@/components/common/PageHeader";
import StatusBadge from "@/components/common/StatusBadge";
import { Card } from "@/components/common/Card";
import { usePermissions } from "@/context/PermissionsContext";
import { barangayServices } from "@/services/mock/mockData";
import {
  Stethoscope,
  Syringe,
  Shield,
  Heart,
  Activity,
  Plus,
  Pencil,
  MoreVertical,
  Trash2,
  X,
  CheckCircle2,
} from "lucide-react";

const SERVICE_STATUSES = ["Available", "Scheduled", "Unavailable"];

const ICON_MAP = {
  Stethoscope: { Icon: Stethoscope, iconBg: "bg-brand-green/10", iconColor: "text-brand-green" },
  Syringe: { Icon: Syringe, iconBg: "bg-brand-blue/10", iconColor: "text-brand-blue" },
  Shield: { Icon: Shield, iconBg: "bg-brand-yellow/15", iconColor: "text-[#B07E00]" },
  Heart: { Icon: Heart, iconBg: "bg-brand-danger/10", iconColor: "text-brand-danger" },
  Activity: { Icon: Activity, iconBg: "bg-brand-accent/10", iconColor: "text-brand-accent" },
};
const ICON_KEYS = Object.keys(ICON_MAP);
const iconStyle = (icon) => ICON_MAP[icon] || ICON_MAP.Activity;

const emptyForm = () => ({
  name: "",
  days: "",
  hours: "",
  description: "",
  status: "Available",
});

const nextServiceId = (list) =>
  `SVC-${String(
    list.reduce((acc, s) => {
      const n = parseInt(String(s.id || "").replace(/\D/g, ""), 10);
      return Number.isNaN(n) ? acc : Math.max(acc, n);
    }, 0) + 1
  ).padStart(3, "0")}`;

const inputCls = (error) =>
  `w-full bg-white border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue ${
    error ? "border-red-400 bg-red-50/40" : "border-brand-border"
  }`;

export default function HealthServicesPage() {
  const { can } = usePermissions();
  const canCreate = can("services.create");
  const canEdit = can("services.edit");
  const canDelete = can("services.delete");
  const canManage = canEdit || canDelete;

  const [services, setServices] = useState(barangayServices);
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingService, setEditingService] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const anyModalOpen = showFormModal || Boolean(deleteTarget);

  // Lock background scrolling while a modal is open.
  useEffect(() => {
    if (!anyModalOpen) return undefined;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [anyModalOpen]);

  // Escape closes whichever dialog is open.
  useEffect(() => {
    if (!anyModalOpen) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (deleteTarget) setDeleteTarget(null);
      else setShowFormModal(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [anyModalOpen, deleteTarget]);

  // Close an open card menu when clicking anywhere outside it.
  useEffect(() => {
    if (!openMenuId) return undefined;
    const handler = (e) => {
      if (e.target instanceof Element && !e.target.closest("[data-service-menu]")) setOpenMenuId(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openMenuId]);

  const openAdd = () => {
    setEditingService(null);
    setForm(emptyForm());
    setErrors({});
    setShowFormModal(true);
  };

  const openEdit = (service) => {
    setEditingService(service);
    setForm({
      name: service.name,
      days: service.days,
      hours: service.hours,
      description: service.description,
      status: service.status,
    });
    setErrors({});
    setOpenMenuId(null);
    setShowFormModal(true);
  };

  const handleSave = () => {
    const name = form.name.trim();
    const days = form.days.trim();
    const nextErrors = {};
    if (!name) {
      nextErrors.name = "Service name is required.";
    } else if (
      services.some(
        (s) =>
          s.id !== (editingService ? editingService.id : null) &&
          s.name.trim().toLowerCase() === name.toLowerCase()
      )
    ) {
      nextErrors.name = "A health service with this name already exists.";
    }
    if (!days) nextErrors.days = "Schedule / days is required.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    if (editingService) {
      setServices((prev) =>
        prev.map((s) =>
          s.id === editingService.id
            ? {
                ...s,
                name,
                days,
                hours: form.hours.trim(),
                description: form.description.trim(),
                status: form.status,
              }
            : s
        )
      );
      showToast(`"${name}" updated successfully.`);
    } else {
      const icon = ICON_KEYS[services.length % ICON_KEYS.length];
      setServices((prev) => [
        ...prev,
        {
          id: nextServiceId(prev),
          name,
          days,
          hours: form.hours.trim(),
          description: form.description.trim(),
          status: form.status,
          icon,
        },
      ]);
      showToast(`"${name}" added to health services.`);
    }
    setShowFormModal(false);
    setEditingService(null);
  };

  const handleDelete = () => {
    setServices((prev) => prev.filter((s) => s.id !== deleteTarget.id));
    showToast(`"${deleteTarget.name}" removed from health services.`);
    setDeleteTarget(null);
  };

  return (
    <>
      <PageHeader
        crumbs={["Home", "Health Services"]}
        title="Health Services"
        subtitle="Ongoing healthcare services at the Barangay Health Station."
        action={
          canCreate && (
            <button
              onClick={openAdd}
              className="flex items-center gap-2 bg-brand-blue text-white px-4 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"
            >
              <Plus className="w-4 h-4" /> Add Health Service
            </button>
          )
        }
      />

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 flex animate-in slide-in-from-bottom-2 items-center gap-2 rounded-btn bg-brand-ink px-4 py-3 shadow-lg">
          <CheckCircle2 className="h-4 w-4 text-brand-green" />
          <span className="text-sm text-white">{toast}</span>
        </div>
      )}

      {/* Service cards */}
      {services.length > 0 ? (
        <div className="grid sm:grid-cols-2 gap-4 sm:gap-5">
          {services.map((s, i) => {
            const style = iconStyle(s.icon);
            return (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="bg-white rounded-card border border-brand-border shadow-card p-4 sm:p-5 h-full flex flex-col"
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div
                      className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl ${style.iconBg} flex items-center justify-center shrink-0`}
                    >
                      <style.Icon className={`w-4 h-4 sm:w-5 sm:h-5 ${style.iconColor}`} strokeWidth={1.8} />
                    </div>
                    <h3 className="font-semibold text-brand-ink text-sm sm:text-base leading-tight">{s.name}</h3>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <StatusBadge value={s.status} />
                    {canEdit && (
                      <button
                        onClick={() => openEdit(s)}
                        className="p-1.5 rounded-lg text-brand-gray transition-colors hover:bg-brand-light hover:text-brand-blue"
                        aria-label={`Edit ${s.name}`}
                        title="Edit"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {canManage && (
                      <div className="relative" data-service-menu>
                        <button
                          onClick={() => setOpenMenuId(openMenuId === s.id ? null : s.id)}
                          className="p-1.5 rounded-lg text-brand-gray transition-colors hover:bg-brand-bg hover:text-brand-ink"
                          aria-label={`More actions for ${s.name}`}
                          title="More actions"
                        >
                          <MoreVertical className="w-3.5 h-3.5" />
                        </button>
                        {openMenuId === s.id && (
                          <div className="absolute right-0 top-full z-20 mt-1 w-36 rounded-btn border border-brand-border bg-white py-1 shadow-float">
                            {canEdit && (
                              <button
                                onClick={() => openEdit(s)}
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-brand-ink transition-colors hover:bg-brand-bg"
                              >
                                <Pencil className="w-3.5 h-3.5 text-brand-gray" /> Edit
                              </button>
                            )}
                            {canDelete && (
                              <button
                                onClick={() => {
                                  setDeleteTarget(s);
                                  setOpenMenuId(null);
                                }}
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-brand-danger transition-colors hover:bg-brand-danger/5"
                              >
                                <Trash2 className="w-3.5 h-3.5" /> Delete
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="space-y-1.5 text-sm text-brand-gray flex-1">
                  <p className="text-brand-ink font-medium">{s.days}</p>
                  <p>{s.hours}</p>
                  <p className="line-clamp-1">{s.description}</p>
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <Card className="p-12 text-center">
          <Activity className="mx-auto h-10 w-10 text-brand-gray/50" />
          <p className="mt-3 text-sm text-brand-gray">
            No health services are currently offered at the Barangay Health Station.
          </p>
          {canCreate && (
            <button
              onClick={openAdd}
              className="mt-4 inline-flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
            >
              <Plus className="w-4 h-4" /> Add Health Service
            </button>
          )}
        </Card>
      )}

      {/* Add / Edit Health Service Modal */}
      {showFormModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card
            role="dialog"
            aria-modal="true"
            aria-label={editingService ? "Edit Health Service" : "Add Health Service"}
            className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden"
          >
            {/* Fixed header */}
            <div className="flex shrink-0 items-center justify-between border-b border-brand-border px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold text-brand-ink">
                  {editingService ? "Edit Health Service" : "Add Health Service"}
                </h3>
                <p className="text-xs text-brand-gray">
                  {editingService
                    ? "Update this service's information"
                    : "Add a new service to the Barangay Health Station"}
                </p>
              </div>
              <button
                onClick={() => setShowFormModal(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-brand-gray transition-colors hover:bg-brand-bg hover:text-brand-ink"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable form body */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="space-y-3.5">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-brand-ink">
                    Service Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => {
                      setForm({ ...form, name: e.target.value });
                      setErrors((prev) => ({ ...prev, name: "" }));
                    }}
                    placeholder="e.g. Medical Consultation"
                    className={inputCls(errors.name)}
                  />
                  {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name}</p>}
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-brand-ink">
                    Schedule / Days <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.days}
                    onChange={(e) => {
                      setForm({ ...form, days: e.target.value });
                      setErrors((prev) => ({ ...prev, days: "" }));
                    }}
                    placeholder="e.g. Monday – Friday"
                    className={inputCls(errors.days)}
                  />
                  {errors.days && <p className="mt-1 text-xs text-red-600">{errors.days}</p>}
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-brand-ink">Operating Hours</label>
                  <input
                    type="text"
                    value={form.hours}
                    onChange={(e) => setForm({ ...form, hours: e.target.value })}
                    placeholder="e.g. 8:00 AM – 12:00 PM"
                    className={inputCls()}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-brand-ink">Description</label>
                  <textarea
                    rows={3}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="e.g. General consultation and assessment."
                    className={`${inputCls()} resize-none`}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-brand-ink">Status</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className={`${inputCls()} cursor-pointer`}
                  >
                    {SERVICE_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Fixed footer */}
            <div className="flex shrink-0 justify-end gap-3 border-t border-brand-border bg-white px-6 py-4">
              <button
                onClick={() => setShowFormModal(false)}
                className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors"
              >
                {editingService ? "Save Changes" : "Add Service"}
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card role="alertdialog" aria-modal="true" aria-label="Delete Health Service" className="w-full max-w-md overflow-hidden">
            <div className="p-6">
              <div className="flex items-start gap-3.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-danger/10">
                  <Trash2 className="h-5 w-5 text-brand-danger" strokeWidth={1.8} />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-brand-ink">Delete Health Service?</h3>
                  <p className="mt-1 text-sm text-brand-gray">
                    Are you sure you want to remove{" "}
                    <span className="font-medium text-brand-ink">{deleteTarget.name}</span> from the available
                    health services?
                  </p>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-brand-border bg-white px-6 py-4">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 rounded-btn text-sm font-medium bg-brand-danger text-white hover:bg-brand-danger/90 transition-colors"
              >
                Delete
              </button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

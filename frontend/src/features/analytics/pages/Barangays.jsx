import React, { useState } from "react";
import { motion } from "framer-motion";
import PageHeader from "@/components/common/PageHeader";
import { Card } from "@/components/common/Card";
import { MapPin, Users, AlertTriangle, Syringe, Plus, X } from "lucide-react";
import { barangayOverview } from "@/services/mock/mockData";

export default function Barangays() {
  const [barangays, setBarangays] = useState(barangayOverview);
  const [showAddModal, setShowAddModal] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    municipality: "",
    province: "",
    captain: "",
    contact: "",
    healthStation: "",
    bhw: "",
    status: "Active",
  });
  /** @type {[Record<string, string>, Function]} */
  const [errors, setErrors] = useState({});

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: "" }));
    }
  };

  const validateForm = () => {
    const newErrors = {};
    if (!formData.name.trim()) newErrors.name = "Barangay Name is required";
    if (!formData.municipality.trim()) newErrors.municipality = "Municipality is required";
    if (!formData.province.trim()) newErrors.province = "Province is required";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSaveBarangay = () => {
    if (!validateForm()) return;

    const newBarangay = {
      name: formData.name,
      residents: 0,
      highRisk: 0,
      coverage: "0%",
    };

    setBarangays((prev) => [...prev, newBarangay]);
    setShowAddModal(false);
    setFormData({
      name: "",
      municipality: "",
      province: "",
      captain: "",
      contact: "",
      healthStation: "",
      bhw: "",
      status: "Active",
    });
    setErrors({});
  };

  const handleCancel = () => {
    setShowAddModal(false);
    setFormData({
      name: "",
      municipality: "",
      province: "",
      captain: "",
      contact: "",
      healthStation: "",
      bhw: "",
      status: "Active",
    });
    setErrors({});
  };

  return (
    <>
      <PageHeader
        crumbs={["Home", "Barangays"]}
        title="Barangays"
        subtitle="Health profile of every connected barangay."
        action={
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 bg-brand-blue text-white px-4 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Barangay
          </button>
        }
      />
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
        {barangays.map((b, i) => (
          <motion.div key={b.name} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} whileHover={{ y: -4 }}>
            <Card className="p-6">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-brand-light text-brand-blue flex items-center justify-center"><MapPin className="w-5 h-5" /></div>
                <h3 className="font-semibold text-brand-ink">Brgy. {b.name}</h3>
              </div>
              <div className="mt-5 space-y-3 text-sm">
                <p className="flex items-center justify-between"><span className="flex items-center gap-2 text-brand-gray"><Users className="w-4 h-4" /> Residents</span><span className="font-medium text-brand-ink">{b.residents.toLocaleString()}</span></p>
                <p className="flex items-center justify-between"><span className="flex items-center gap-2 text-brand-gray"><AlertTriangle className="w-4 h-4" /> High Risk</span><span className="font-medium text-brand-danger">{b.highRisk}</span></p>
                <p className="flex items-center justify-between"><span className="flex items-center gap-2 text-brand-gray"><Syringe className="w-4 h-4" /> Vax Coverage</span><span className="font-medium text-brand-green">{b.coverage}</span></p>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Add Barangay Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-brand-ink">Add New Barangay</h3>
                <button
                  onClick={handleCancel}
                  className="text-brand-gray hover:text-brand-ink"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Barangay Name *</label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    placeholder="Enter barangay name"
                    className={`w-full bg-white border ${errors.name ? "border-brand-danger" : "border-brand-border"} rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue`}
                  />
                  {errors.name && <p className="text-xs text-brand-danger mt-1">{errors.name}</p>}
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Municipality *</label>
                  <input
                    type="text"
                    name="municipality"
                    value={formData.municipality}
                    onChange={handleInputChange}
                    placeholder="Enter municipality"
                    className={`w-full bg-white border ${errors.municipality ? "border-brand-danger" : "border-brand-border"} rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue`}
                  />
                  {errors.municipality && <p className="text-xs text-brand-danger mt-1">{errors.municipality}</p>}
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Province *</label>
                  <input
                    type="text"
                    name="province"
                    value={formData.province}
                    onChange={handleInputChange}
                    placeholder="Enter province"
                    className={`w-full bg-white border ${errors.province ? "border-brand-danger" : "border-brand-border"} rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue`}
                  />
                  {errors.province && <p className="text-xs text-brand-danger mt-1">{errors.province}</p>}
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Barangay Captain</label>
                  <input
                    type="text"
                    name="captain"
                    value={formData.captain}
                    onChange={handleInputChange}
                    placeholder="Enter barangay captain name"
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Barangay Contact Number</label>
                  <input
                    type="text"
                    name="contact"
                    value={formData.contact}
                    onChange={handleInputChange}
                    placeholder="Enter contact number"
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Barangay Health Station Name</label>
                  <input
                    type="text"
                    name="healthStation"
                    value={formData.healthStation}
                    onChange={handleInputChange}
                    placeholder="Enter health station name"
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Assigned BHW</label>
                  <input
                    type="text"
                    name="bhw"
                    value={formData.bhw}
                    onChange={handleInputChange}
                    placeholder="Enter assigned BHW name"
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-brand-ink block mb-1.5">Status</label>
                  <select
                    name="status"
                    value={formData.status}
                    onChange={handleInputChange}
                    className="w-full bg-white border border-brand-border rounded-btn px-3 py-2.5 text-sm outline-none focus:border-brand-blue"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveBarangay}
                  className="px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors"
                >
                  Save Barangay
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
import React, { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { X, Loader2 } from "lucide-react";
import { residentsApi } from "@/services/api";
import {
  CIVIL_STATUSES,
  NAME_SUFFIXES,
  SEX_OPTIONS,
} from "@/utils/validation";
import {
  buildStaffResidentPayload,
  calcStaffRegistrationAge,
  todayInManila,
  validateStaffResidentForm,
} from "@/features/registration/lib/staffResidentRegistration";
import { BARANGAYS } from "@/lib/barangays";
import { ButtonSelectGroup } from "@/components/system";
import SearchableSelect from "@/components/common/SearchableSelect";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/ui/use-toast";

const labelClass = "block text-sm font-medium text-brand-ink mb-1.5";
const inputClass = (error) => `w-full rounded-btn border ${error ? "border-brand-danger" : "border-brand-border"} bg-white px-3 py-2 text-sm placeholder:text-brand-gray focus:outline-none focus:ring-1 focus:ring-brand-blue`;
const errorClass = "text-xs text-brand-danger mt-1";
const SERVER_ERROR_FIELDS = [
  [/first name/i, "firstName"],
  [/middle name/i, "middleName"],
  [/last name/i, "lastName"],
  [/suffix/i, "suffix"],
  [/date of birth/i, "dob"],
  [/sex/i, "gender"],
  [/civil status/i, "civilStatus"],
  [/mobile|contact number/i, "contact"],
  [/barangay/i, "barangay"],
  [/zone/i, "purok"],
  [/address/i, "street"],
  [/email/i, "email"],
];

/**
 * Staff Resident Registration Modal
 * 
 * Replaces the full-page wizard with a modal-based registration form
 * matching the PHN "Add Resident" modal structure and styling.
 * 
 * Props:
 * - isOpen: boolean - Modal visibility
 * - onClose: function - Close handler
 * - onSuccess: function - Success callback (optional)
 */
export default function StaffResidentRegistration({ isOpen = true, onClose, onSuccess }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState(null);
  const [barangayOptions, setBarangayOptions] = useState(BARANGAYS);
  const submitting = useRef(false);
  
  // Form state matching PHN modal structure
  const [form, setForm] = useState({
    firstName: "",
    middleName: "",
    lastName: "",
    suffix: "",
    dob: "",
    age: "",
    gender: "",
    civilStatus: "",
    contact: "",
    barangay: "",
    purok: "",
    street: "",
    houseNo: "",
    createAccount: false,
    email: "",
  });

  const assignedBarangay = ["health_supervisor", "bhw"].includes(user?.role)
    ? String(user?.assignedBarangay || user?.barangay || "").trim()
    : "";

  useEffect(() => {
    if (!isOpen) return undefined;
    let active = true;
    const loadBarangays = async () => {
      try {
        const result = await residentsApi.directoryFilters();
        if (!active) return;
        const names = result?.barangays?.map((item) => item.name).filter(Boolean);
        if (names?.length) setBarangayOptions(names);
      } catch {
        // The server still enforces municipality scope; keep the approved offline list for continuity.
      }
    };
    void loadBarangays();
    return () => { active = false; };
  }, [isOpen, user?.id]);

  useEffect(() => {
    if (assignedBarangay) setForm((prev) => ({ ...prev, barangay: assignedBarangay }));
  }, [assignedBarangay]);

  // Helpers
  const set = (field) => (value) => {
    const nextValue = value?.target ? value.target.value : value;
    const nextForm = { ...form, [field]: nextValue };
    setForm((prev) => ({ ...prev, [field]: nextValue }));
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const message = validateStaffResidentForm(nextForm)[field];
      const nextErrors = { ...prev };
      if (message) nextErrors[field] = message;
      else delete nextErrors[field];
      return nextErrors;
    });
  };

  const validateField = (field) => {
    const message = validateStaffResidentForm(form)[field];
    setErrors((prev) => {
      const nextErrors = { ...prev };
      if (message) nextErrors[field] = message;
      else delete nextErrors[field];
      return nextErrors;
    });
  };

  const handleClose = useCallback(() => {
    if (onClose) {
      onClose();
    } else {
      navigate("/residents");
    }
  }, [onClose, navigate]);
  
  const onDobChange = (e) => {
    const dob = e.target.value;
    const nextForm = { ...form, dob, age: calcStaffRegistrationAge(dob) };
    setForm((prev) => ({ ...prev, dob, age: calcStaffRegistrationAge(dob) }));
    setErrors((prev) => {
      if (!prev.dob) return prev;
      const message = validateStaffResidentForm(nextForm).dob;
      const nextErrors = { ...prev };
      if (message) nextErrors.dob = message;
      else delete nextErrors.dob;
      return nextErrors;
    });
  };

  const onContactChange = (e) => {
    set("contact")(e.target.value);
  };

  // Validation
  const validateForm = useCallback(() => validateStaffResidentForm(form), [form]);

  // Submit
  const handleSubmit = async () => {
    if (submitting.current) return;
    const stepErrors = validateForm();
    setErrors(stepErrors);

    if (Object.keys(stepErrors).length > 0) return;

    submitting.current = true;
    setLoading(true);
    setApiError(null);

    try {
      const payload = buildStaffResidentPayload(form);
      await residentsApi.create({ resident: payload });

      // Success - reset and close
      setForm({
        firstName: "",
        middleName: "",
        lastName: "",
        suffix: "",
        dob: "",
        age: "",
        gender: "",
        civilStatus: "",
        contact: "",
        barangay: "",
        purok: "",
        street: "",
        houseNo: "",
        createAccount: false,
        email: "",
      });
      setErrors({});

      toast({
        title: "Resident registered",
        description: "The resident was added to the directory successfully.",
      });
      if (onSuccess) onSuccess();
      handleClose();
    } catch (error) {
      const response = error?.payload?.error || error?.response?.data?.error || error?.response?.data || {};
      const message = response.message || error?.message || "Failed to register resident";
      const details = response.errors || response.details;
      const serverErrors = {};
      if (details && !Array.isArray(details) && typeof details === "object") {
        const fieldMap = {
          firstName: "firstName", middleName: "middleName", lastName: "lastName",
          suffix: "suffix", birthDate: "dob", sex: "gender", civilStatus: "civilStatus",
          cellphoneNo: "contact", barangay: "barangay", zone: "purok",
          currentAddress: "street", permanentAddress: "street", email: "email",
        };
        Object.entries(details).forEach(([key, value]) => {
          if (fieldMap[key] && typeof value === "string") serverErrors[fieldMap[key]] = value;
        });
      } else if (Array.isArray(details)) {
        details.forEach((detail) => {
          const field = SERVER_ERROR_FIELDS.find(([pattern]) => pattern.test(String(detail)))?.[1];
          if (field && !serverErrors[field]) serverErrors[field] = String(detail);
        });
      }
      if (Object.keys(serverErrors).length) setErrors((prev) => ({ ...prev, ...serverErrors }));
      setApiError(message);
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

     if (!isOpen) return null;

   return (
     <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
       <div className="w-full max-w-2xl max-h-[90vh] bg-white rounded-card shadow-xl flex flex-col overflow-hidden">
         {/* Fixed Header with blue accent */}
         <div className="flex-shrink-0 border-b-2 border-brand-blue bg-white px-6 py-4">
           <div className="flex items-center justify-between">
             <div>
               <h3 className="text-lg font-semibold text-brand-ink">Add Resident</h3>
               <p className="text-sm text-brand-gray mt-0.5">Register a new resident in the directory.</p>
             </div>
             <button 
               onClick={handleClose}
               className="text-brand-gray hover:text-brand-blue transition-colors"
               aria-label="Close resident registration"
             >
               <X className="w-5 h-5" />
             </button>
           </div>
         </div>

         {/* Scrollable Content */}
         <div className="flex-1 overflow-y-auto">
           <div className="px-6 py-6 space-y-6">
             {/* Error Alert */}
             {apiError && (
               <div className="rounded-card border border-brand-danger/30 bg-brand-danger/5 px-4 py-3 text-sm text-brand-danger">
                 {apiError}
               </div>
             )}

             {/* Personal Information Section */}
             <div>
               <div className="flex items-center gap-2 mb-4">
                 <div className="h-px flex-1 bg-brand-border"></div>
                 <h4 className="text-sm font-semibold text-brand-ink uppercase tracking-wide">Personal Information</h4>
                 <div className="h-px flex-1 bg-brand-border"></div>
               </div>
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                 <div>
                   <label className={labelClass}>First Name *</label>
                   <input
                     type="text"
                     value={form.firstName}
                     onChange={(e) => set("firstName")(e.target.value)}
                     onBlur={() => validateField("firstName")}
                     aria-invalid={Boolean(errors.firstName)}
                     placeholder="e.g. Maria"
                     className={inputClass(Boolean(errors.firstName))}
                   />
                   {errors.firstName && <p className={errorClass}>{errors.firstName}</p>}
                 </div>
                 <div>
                   <label className={labelClass}>Middle Name</label>
                   <input
                     type="text"
                     value={form.middleName}
                     onChange={(e) => set("middleName")(e.target.value)}
                     onBlur={() => validateField("middleName")}
                     aria-invalid={Boolean(errors.middleName)}
                     placeholder="e.g. Santos"
                     className={inputClass(Boolean(errors.middleName))}
                   />
                   {errors.middleName && <p className={errorClass}>{errors.middleName}</p>}
                 </div>
                 <div>
                   <label className={labelClass}>Last Name *</label>
                   <input
                     type="text"
                     value={form.lastName}
                     onChange={(e) => set("lastName")(e.target.value)}
                     onBlur={() => validateField("lastName")}
                     aria-invalid={Boolean(errors.lastName)}
                     placeholder="e.g. Dela Cruz"
                     className={inputClass(Boolean(errors.lastName))}
                   />
                   {errors.lastName && <p className={errorClass}>{errors.lastName}</p>}
                 </div>
                 <div>
                   <label className={labelClass}>Suffix</label>
                   <select
                     value={form.suffix}
                     onChange={(e) => set("suffix")(e.target.value)}
                     onBlur={() => validateField("suffix")}
                     className={inputClass(Boolean(errors.suffix))}
                   >
                     <option value="">None</option>
                     {NAME_SUFFIXES.filter(Boolean).map((s) => (
                       <option key={s} value={s}>{s}</option>
                     ))}
                   </select>
                   {errors.suffix && <p className={errorClass}>{errors.suffix}</p>}
                 </div>
                 <div>
                   <label className={labelClass}>Date of Birth *</label>
                   <input
                     type="date"
                     value={form.dob}
                     onChange={onDobChange}
                     onBlur={() => validateField("dob")}
                     max={todayInManila()}
                     aria-invalid={Boolean(errors.dob)}
                     className={inputClass(Boolean(errors.dob))}
                   />
                   {errors.dob && <p className={errorClass}>{errors.dob}</p>}
                 </div>
                 <div>
                   <label className={labelClass}>Age</label>
                    <input
                      type="text"
                      value={form.age}
                     placeholder="Auto-calculated"
                     readOnly
                     className={inputClass(false)}
                   />
                 </div>
                 <div>
                   <label className={labelClass}>Sex *</label>
                   <ButtonSelectGroup
                     name="sex"
                     ariaLabel="Sex"
                     options={SEX_OPTIONS}
                     value={form.gender}
                     onChange={set("gender")}
                     onBlur={() => validateField("gender")}
                     error={Boolean(errors.gender)}
                   />
                   {errors.gender && <p className={errorClass}>{errors.gender}</p>}
                 </div>
                 <div>
                   <label className={labelClass}>Civil Status *</label>
                   <select
                     value={form.civilStatus}
                     onChange={(e) => set("civilStatus")(e.target.value)}
                     onBlur={() => validateField("civilStatus")}
                     className={inputClass(Boolean(errors.civilStatus))}
                   >
                     <option value="">Select civil status</option>
                     {CIVIL_STATUSES.map((s) => (
                       <option key={s} value={s}>{s}</option>
                     ))}
                   </select>
                   {errors.civilStatus && <p className={errorClass}>{errors.civilStatus}</p>}
                 </div>
               </div>
             </div>

             {/* Contact and Address Section */}
             <div>
               <div className="flex items-center gap-2 mb-4">
                 <div className="h-px flex-1 bg-brand-border"></div>
                 <h4 className="text-sm font-semibold text-brand-ink uppercase tracking-wide">Contact & Address</h4>
                 <div className="h-px flex-1 bg-brand-border"></div>
               </div>
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                 <div>
                   <label className={labelClass}>Contact Number</label>
                    <input
                      type="tel"
                      value={form.contact}
                      onChange={onContactChange}
                      onBlur={() => validateField("contact")}
                      placeholder="e.g. 09171234567"
                      maxLength={20}
                      inputMode="tel"
                      autoComplete="tel-national"
                      aria-invalid={Boolean(errors.contact)}
                     className={inputClass(Boolean(errors.contact))}
                   />
                   {errors.contact && <p className={errorClass}>{errors.contact}</p>}
                 </div>
                 <div>
                   <label className={labelClass}>Barangay *</label>
                   <SearchableSelect
                     required
                      value={form.barangay}
                      onChange={set("barangay")}
                      onBlur={() => validateField("barangay")}
                      options={assignedBarangay ? [assignedBarangay] : barangayOptions}
                      disabled={Boolean(assignedBarangay)}
                     placeholder="Search barangay..."
                     emptyText="No barangay found."
                     error={errors.barangay}
                   />
                   {errors.barangay && <p className={errorClass}>{errors.barangay}</p>}
                 </div>
                 <div>
                   <label className={labelClass}>Purok/Zone</label>
                   <input
                     type="text"
                     value={form.purok}
                     onChange={(e) => set("purok")(e.target.value)}
                     onBlur={() => validateField("purok")}
                     placeholder="e.g. Purok 5"
                     className={inputClass(Boolean(errors.purok))}
                   />
                   {errors.purok && <p className={errorClass}>{errors.purok}</p>}
                 </div>
                 <div>
                   <label className={labelClass}>Street / Sitio</label>
                   <input
                     type="text"
                     value={form.street}
                     onChange={(e) => set("street")(e.target.value)}
                     onBlur={() => validateField("street")}
                     placeholder="Enter street or sitio"
                     className={inputClass(Boolean(errors.street))}
                   />
                   {errors.street && <p className={errorClass}>{errors.street}</p>}
                 </div>
                 <div>
                   <label className={labelClass}>House No.</label>
                   <input
                     type="text"
                     value={form.houseNo}
                     onChange={(e) => set("houseNo")(e.target.value)}
                     onBlur={() => validateField("houseNo")}
                     placeholder="Enter house number"
                     className={inputClass(Boolean(errors.houseNo))}
                   />
                   {errors.houseNo && <p className={errorClass}>{errors.houseNo}</p>}
                 </div>
               </div>
             </div>

             {/* Optional Login Account Section */}
             <div>
               <div className="flex items-center gap-2 mb-4">
                 <div className="h-px flex-1 bg-brand-border"></div>
                 <h4 className="text-sm font-semibold text-brand-ink uppercase tracking-wide">Login Account</h4>
                 <div className="h-px flex-1 bg-brand-border"></div>
               </div>
               <div className="rounded-card border border-brand-light bg-brand-light/30 p-4">
                 <p className="text-sm font-medium text-brand-ink">Create Resident Login Account?</p>
                 <p className="mt-2 text-xs text-brand-gray">
                   Optional. The resident profile is created either way. Choose "Yes" only if this resident should be able to log in.
                 </p>
                 <div className="mt-3 flex gap-2">
                   <button
                     type="button"
                     onClick={() => set("createAccount")(false)}
                     className={`rounded-btn px-4 py-2 text-sm font-medium transition-colors ${
                       !form.createAccount ? "bg-brand-blue text-white" : "border border-brand-border bg-white text-brand-ink hover:bg-brand-bg"
                     }`}
                   >
                     No
                   </button>
                   <button
                     type="button"
                     onClick={() => set("createAccount")(true)}
                     className={`rounded-btn px-4 py-2 text-sm font-medium transition-colors ${
                       form.createAccount
                         ? "bg-brand-blue text-white"
                         : "border border-brand-border bg-white text-brand-ink hover:bg-brand-bg"
                     }`}
                   >
                     Yes
                   </button>
                 </div>
                 {form.createAccount && (
                   <div className="mt-4">
                     <div>
                       <label className={labelClass}>Email for login account *</label>
                       <input
                         type="email"
                         value={form.email}
                         onChange={(e) => set("email")(e.target.value)}
                         onBlur={() => validateField("email")}
                         placeholder="e.g. resident@example.com"
                         className={inputClass(Boolean(errors.email))}
                       />
                       {errors.email && <p className={errorClass}>{errors.email}</p>}
                     </div>
                     <p className="mt-2 text-xs text-brand-gray">
                       The account starts in Pending Activation. An invitation link is emailed to this address — the resident clicks it to set their own password and activate the account.
                     </p>
                   </div>
                 )}
               </div>
             </div>
           </div>
         </div>

         {/* Fixed Footer */}
         <div className="flex-shrink-0 border-t border-brand-border bg-brand-bg px-6 py-4">
           <div className="flex justify-end gap-3">
             <button 
               onClick={handleClose}
               disabled={loading}
               className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray bg-white border border-brand-border hover:bg-brand-light transition-colors disabled:opacity-50"
             >
               Cancel
             </button>
             <button
               onClick={handleSubmit}
               disabled={loading}
               className="flex items-center gap-2 px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors disabled:opacity-60"
             >
               {loading ? (
                 <>
                   <Loader2 size={16} className="animate-spin" />
                   Saving...
                 </>
               ) : (
                 "Add Resident"
               )}
             </button>
           </div>
         </div>
       </div>
     </div>
   );
 }

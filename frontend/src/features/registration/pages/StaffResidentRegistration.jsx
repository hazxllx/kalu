import React, { useState, useCallback } from "react";
import { X, Loader2 } from "lucide-react";
import { Card } from "@/components/common/Card";
import { residentsApi } from "@/services/api";
import {
  CIVIL_STATUSES,
  NAME_SUFFIXES,
  SEX_OPTIONS,
  email as validateEmail,
  strictMobile as validateStrictMobile,
  required,
  personName,
  validateFields,
  dateOfBirth,
} from "@/utils/validation";
import { BARANGAYS } from "@/lib/barangays";
import { ButtonSelectGroup } from "@/components/system";
import SearchableSelect from "@/components/common/SearchableSelect";

const labelClass = "block text-sm font-medium text-brand-ink mb-1.5";
const inputClass = (error) => `w-full rounded-btn border ${error ? "border-brand-danger" : "border-brand-border"} bg-white px-3 py-2 text-sm placeholder:text-brand-gray focus:outline-none focus:ring-1 focus:ring-brand-blue`;
const errorClass = "text-xs text-brand-danger mt-1";

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
export default function StaffResidentRegistration({ isOpen, onClose, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState(null);
  
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

  // Helpers
  const set = (field) => (value) => setForm((prev) => ({ ...prev, [field]: value }));
  
  // Simple DOB handler - just update the date
  const onDobChange = (e) => {
    set("dob")(e.target.value);
  };

  const onContactChange = (e) => {
    const val = e.target.value.replace(/\D/g, "").slice(0, 11);
    set("contact")(val);
  };

  // Validation
  const validateForm = useCallback(() => {
    const stepErrors = {};
    
    const fields = {
      firstName: [required("First name"), personName("First name")],
      lastName: [required("Last name"), personName("Last name")],
      dob: [required("Date of birth"), dateOfBirth("Date of birth")],
      gender: [required("Sex")],
      civilStatus: [required("Civil status")],
      barangay: [required("Barangay")],
    };

    if (form.middleName && !personName("Middle name")(form.middleName)) {
      stepErrors.middleName = "Middle name can contain letters, spaces, hyphens, apostrophes, and periods only.";
    }

    if (form.contact && !validateStrictMobile(form.contact)) {
      stepErrors.contact = "Contact number must be exactly 11 digits.";
    }

    if (form.createAccount && !form.email) {
      stepErrors.email = "Email is required when creating a login account.";
    }
    if (form.email && !validateEmail(form.email)) {
      stepErrors.email = "Enter a valid email address.";
    }

    const validationErrors = validateFields(fields, form);
    return { ...stepErrors, ...validationErrors };
  }, [form]);

  // Submit
  const handleSubmit = async () => {
    const stepErrors = validateForm();
    setErrors(stepErrors);
    
    if (Object.keys(stepErrors).length > 0) return;

    setLoading(true);
    setApiError(null);
    
    try {
      const payload = {
        firstName: form.firstName,
        middleName: form.middleName,
        lastName: form.lastName,
        suffix: form.suffix || undefined,
        birthDate: form.dob,
        sex: form.gender,
        civilStatus: form.civilStatus,
        barangay: form.barangay,
        zone: form.purok ? parseInt(form.purok) : undefined,
        cellphoneNo: form.contact || undefined,
        currentAddress: form.street || undefined,
        createLoginAccount: form.createAccount,
        ...(form.createAccount ? { email: form.email } : {}),
      };

      await residentsApi.createResident({ resident: payload });
      
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
      
      if (onSuccess) onSuccess();
      onClose();
    } catch (error) {
      const message = error?.response?.data?.message || error?.message || "Failed to register resident";
      setApiError(message);
    } finally {
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
               onClick={onClose}
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
                     className={inputClass(Boolean(errors.suffix))}
                   >
                     <option value="">None</option>
                     {NAME_SUFFIXES.filter(Boolean).map((s) => (
                       <option key={s} value={s}>{s}</option>
                     ))}
                   </select>
                 </div>
                 <div>
                   <label className={labelClass}>Date of Birth *</label>
                   <input
                     type="date"
                     value={form.dob}
                     onChange={onDobChange}
                     className={inputClass(Boolean(errors.dob))}
                   />
                   {errors.dob && <p className={errorClass}>{errors.dob}</p>}
                 </div>
                 <div>
                   <label className={labelClass}>Age</label>
                   <input
                     type="text"
                     value={form.age}
                     onChange={() => {}}
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
                     error={Boolean(errors.gender)}
                   />
                   {errors.gender && <p className={errorClass}>{errors.gender}</p>}
                 </div>
                 <div>
                   <label className={labelClass}>Civil Status *</label>
                   <select
                     value={form.civilStatus}
                     onChange={(e) => set("civilStatus")(e.target.value)}
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
                     placeholder="e.g. 09171234567"
                     maxLength="11"
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
                     options={BARANGAYS}
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
                     placeholder="e.g. Purok 5"
                     className={inputClass(Boolean(errors.purok))}
                   />
                 </div>
                 <div>
                   <label className={labelClass}>Street / Sitio</label>
                   <input
                     type="text"
                     value={form.street}
                     onChange={(e) => set("street")(e.target.value)}
                     placeholder="Enter street or sitio"
                     className={inputClass(Boolean(errors.street))}
                   />
                 </div>
                 <div>
                   <label className={labelClass}>House No.</label>
                   <input
                     type="text"
                     value={form.houseNo}
                     onChange={(e) => set("houseNo")(e.target.value)}
                     placeholder="Enter house number"
                     className={inputClass(Boolean(errors.houseNo))}
                   />
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
               onClick={onClose}
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

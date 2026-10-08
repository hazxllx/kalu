import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Plus, X, Eye, Pencil, CheckCircle2, ChevronDown, Users } from "lucide-react";
import PageHeader from "@/components/common/PageHeader";
import DataTable from "@/components/tables/DataTable";
import StatusBadge from "@/components/common/StatusBadge";
import RiskBadge from "@/components/common/RiskBadge";
import SearchableSelect from "@/components/common/SearchableSelect";
import { Card } from "@/components/common/Card";
import EmptyState from "@/components/common/EmptyState";
import ErrorState from "@/components/common/ErrorState";
import { SkeletonList } from "@/components/common/Skeleton";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/context/PermissionsContext";
import { getSupervisorScope, HS_SCOPE } from "@/lib/supervisorScope";
import { residentsApi } from "@/services/api";
import { BARANGAYS } from "@/lib/barangays";
import { dateOfBirth } from "@/utils/validation";

const CIVIL_STATUS_OPTIONS = ["Single", "Married", "Widowed", "Separated"];
const SEX_OPTIONS = ["Female", "Male"];
const SUFFIX_OPTIONS = ["", "Jr.", "Sr.", "II", "III", "IV"];
const RELIGION_OPTIONS = ["Roman Catholic", "Protestant", "Iglesia ni Cristo", "Born Again", "Muslim", "Other"];

const EMPTY_FORM = {
  firstName: "",
  middleName: "",
  lastName: "",
  suffix: "",
  dob: "",
  age: "",
  gender: "",
  contact: "",
  purok: "",
  street: "",
  houseNo: "",
  barangay: "",
  civilStatus: "",
  // Optional login account (health-personnel registration). A resident profile
  // never requires an account; when the health worker opts in, the backend
  // creates a Supabase Auth user linked to this profile in Pending Activation.
  createAccount: false,
  email: "",
};

/**
 * @typedef {Object} ResidentForm
 * @property {string} firstName
 * @property {string} middleName
 * @property {string} lastName
 * @property {string} suffix
 * @property {string} dob
 * @property {string} age
 * @property {string} gender
 * @property {string} contact
 * @property {string} purok
 * @property {string} street
 * @property {string} houseNo
 * @property {string} barangay
 * @property {string} civilStatus
 * @property {boolean} createAccount
 * @property {string} email
 */

/**
 * @typedef {Object} ResidentRecord
 * @property {string} id
 * @property {string} [firstName]
 * @property {string} [middleName]
 * @property {string} [lastName]
 * @property {string} [suffix]
 * @property {string} [name]
 * @property {string} [birthDate]
 * @property {string} [sex]
 * @property {string} [gender]
 * @property {string} [civilStatus]
 * @property {string} [cellphoneNo]
 * @property {string} [barangay]
 * @property {string} [currentAddress]
 * @property {string} [permanentAddress]
 * @property {string} [philhealthNo]
 * @property {string} [verificationStatus]
 * @property {string} [status]
 * @property {string} [healthRecordNo]
 * @property {string} [createdAt]
 * @property {string} [authUserId]
 * @property {string} [accountStatus]
 * @property {string} [guardianStatus]
 * @property {string} [religion]
 * @property {string} [employmentStatus]
 * @property {string} [fatherName]
 * @property {string} [motherName]
 * @property {string} [birthPlace]
 * @property {number|null} [riskScore]
 * @property {string|null} [riskLevel]
 * @property {string} [riskAssessedAt]
 * @property {Array<{code?: string, name: string, measured?: string|number|null, weight: number}>} [riskFactors]
 * @property {string} [age]
 */

/** @typedef {ResidentRecord & {name: string, age: string, gender: string, status: string, riskLevel: string|null}} ResidentRow */
/** @typedef {Record<string, string>} ValidationErrors */
/** @typedef {{message?: string, status?: number, payload?: {error?: {details?: string[]}}}} RequestError */

/** @param {boolean|string|undefined} invalid */
const inputClass = (invalid) =>
  `mt-1.5 w-full bg-white border px-3.5 py-2.5 text-sm outline-none transition-colors rounded-input ${
    invalid ? "border-brand-danger focus:border-brand-danger" : "border-brand-border focus:border-brand-blue"
  }`;

const labelClass = "text-sm font-medium text-brand-ink";
const errorClass = "mt-1 text-xs text-brand-danger";

/** @param {string|null|undefined} dob */
const calcAge = (dob) => {
  if (typeof dob !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return "";
  const [year, month, day] = dob.split("-").map(Number);
  const birth = new Date(Date.UTC(year, month - 1, day));
  if (birth.getUTCFullYear() !== year || birth.getUTCMonth() !== month - 1 || birth.getUTCDate() !== day) return "";
  const now = new Date();
  let age = now.getUTCFullYear() - year;
  if (now.getUTCMonth() < month - 1 || (now.getUTCMonth() === month - 1 && now.getUTCDate() < day)) age -= 1;
  return age >= 0 && age <= 120 ? String(age) : "";
};

/** @param {Partial<ResidentRecord>|null|undefined} r */
const fullNameOf = (r) => [r?.firstName, r?.middleName, r?.lastName, r?.suffix].filter(Boolean).join(" ");

/** @param {string} name */
const initialsOf = (name) =>
  String(name || "")
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

/**
 * Compose the address line from the form's address parts.
 * @param {ResidentForm} f
 */
const composeAddress = (f) =>
  [f.houseNo, f.street, f.purok ? `Purok ${f.purok}` : "", f.barangay, "Pili, Camarines Sur"]
    .filter(Boolean)
    .join(", ");

/**
 * Login-account status, separate from the resident's verification status. A
 * resident profile is fully valid with "No Account"; an account can later be
 * created/linked without changing the verification status.
 */
/** @type {Record<string, string>} */
const ACCOUNT_STATUS_LABELS = {
  active: "Active",
  pending: "Pending Activation",
  disabled: "Disabled",
  none: "No Account",
};

/** @param {string} status */
const accountStatusClass = (status) => {
  switch (status) {
    case "active":
      return "bg-emerald-50 text-emerald-700";
    case "pending":
      return "bg-amber-50 text-amber-700";
    case "disabled":
      return "bg-rose-50 text-rose-700";
    default:
      return "bg-slate-100 text-slate-500";
  }
};

/** @param {{status?: string}} props */
const AccountStatusPill = ({ status }) => {
  const key = status || "none";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${accountStatusClass(key)}`}>
      {ACCOUNT_STATUS_LABELS[key] || "No Account"}
    </span>
  );
};

/**
 * @param {{label: string, value: string, onChange: (value: string) => void, options?: string[], placeholder?: string, error?: string, emptyLabel?: string, children?: import("react").ReactNode}} props
 */
function Select({ label, value, onChange, options = [], placeholder = "", error = "", emptyLabel = "", children = null }) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass(error)} appearance-none pr-9 cursor-pointer`}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o} value={o}>{o === "" ? emptyLabel : o}</option>
          ))}
          {children}
        </select>
        <ChevronDown className="w-4 h-4 text-brand-gray absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>
      {error && <p className={errorClass}>{error}</p>}
    </div>
  );
}

/**
 * @param {{label: string, value: string, onChange: (value: string) => void, placeholder?: string, error?: string, type?: string, optional?: boolean, readOnly?: boolean}} props
 */
function Field({ label, value, onChange, placeholder = "", error = "", type = "text", optional = false, readOnly = false }) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass(error)} ${readOnly ? "bg-brand-bg text-brand-gray cursor-not-allowed" : ""}`}
      />
      {optional && !error && <p className="mt-1 text-xs text-brand-gray">(Optional)</p>}
      {error && <p className={errorClass}>{error}</p>}
    </div>
  );
}

/** @param {{assignedBarangay?: string|null, barangay?: string|null}|null|undefined} user */
const initialFromUser = (user) => {
  const assigned = user?.assignedBarangay || user?.barangay || "";
  return { ...EMPTY_FORM, barangay: assigned };
};

/**
 * Resident Directory (Health Supervisor).
 *
 * Backed by the real API (GET/POST/PUT /api/residents): the list, search,
 * registration, and permitted demographic corrections all run against the
 * Supabase database with the caller's barangay scope enforced on the server.
 * Loading, error, and empty states are rendered from the request lifecycle —
 * no mock data is used.
 */
export default function ResidentsPage() {
  /** @type {{user: {id?: string, role?: string, assignedBarangay?: string|null, barangay?: string|null}|null}} */
  const { user } = useAuth();
  const { can } = usePermissions();
  const canCreate = can("residents.create");
  const canCreateLoginAccount = can("accounts.create");
  const canEditPermission = can("residents.edit");

  const [residents, setResidents] = useState(/** @type {ResidentRecord[]} */ ([]));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(/** @type {string|null} */ (null));

  const [q, setQ] = useState("");

  const [showAddModal, setShowAddModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selected, setSelected] = useState(/** @type {ResidentRow|null} */ (null));
  const [editTarget, setEditTarget] = useState(/** @type {ResidentRow|null} */ (null));
  const [form, setForm] = useState(/** @type {ResidentForm} */ (initialFromUser(user)));
  const [errors, setErrors] = useState(/** @type {ValidationErrors} */ ({}));
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(/** @type {string|null} */ (null));
  const [editForm, setEditForm] = useState(/** @type {Record<string, string>} */ ({ contact: "", barangay: "", civilStatus: "", currentAddress: "", philhealthNo: "", religion: "", employmentStatus: "", fatherName: "", motherName: "", birthPlace: "" }));
  const [editErrors, setEditErrors] = useState(/** @type {ValidationErrors} */ ({}));
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState(/** @type {string|null} */ (null));
  const [toast, setToast] = useState(/** @type {string|null} */ (null));

  /** @param {string} message */
  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3200);
  };

  // The Resident Directory is owned by the Health Supervisor. Rows are scoped
  // to the supervisor's assigned barangay by the BACKEND (403 on any other
  // barangay); the scope here only drives the subtitle and the barangay picker.
  const scope = getSupervisorScope(user);
  const assignedBarangay = scope && scope.level === HS_SCOPE.BARANGAY ? scope.assignedBarangay : null;
  const allowedBarangays = assignedBarangay ? [assignedBarangay] : [...BARANGAYS];

  /**
   * The MHO browses the same directory municipally but may not correct
   * resident demographics (the API's edit roles are the PHN and the Health
   * Supervisor), so the edit action is hidden rather than shown and 403'd.
   */
  const canEdit =
    (user?.role === "phn" || user?.role === "health_supervisor") && canEditPermission;

  /** Load the directory from the API (search term is applied server-side). */
  const load = useCallback(
    async (searchTerm = "") => {
      setLoading(true);
      setLoadError(null);
      try {
        // Verified directory only: the backend returns residents who are
        // individually approved OR belong to a Verified household, scoped to
        // this supervisor's barangay. Pending/unverified residents live in the
        // Resident Verification queue, not here.
        const result = await residentsApi.list({ q: searchTerm, limit: 100, verified: true });
        setResidents(result?.rows || []);
      } catch (err) {
        setResidents([]);
        const error = /** @type {RequestError} */ (err);
        setLoadError(error?.message || "Could not load the resident directory.");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    load("");
  }, [load]);

  // Debounced server-side search.
  const debounceRef = useRef(/** @type {ReturnType<typeof setTimeout>|null} */ (null));
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      load(q.trim());
    }, 350);
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, [q, load]);

  const rows = useMemo(() => {
    return residents
      .map((r) => ({
        ...r,
        name: fullNameOf(r),
        age: calcAge(r.birthDate),
        gender: r.sex || "—",
        status: r.verificationStatus || "verified",
        // Authoritative risk comes from the backend (persisted/recomputed from
        // recorded vitals + the configured criteria); the directory never
        // recalculates it locally.
        riskLevel: r.riskLevel || null,
      }));
  }, [residents]);

  const openAdd = () => {
    if (!canCreate) return;
    setForm(initialFromUser(user));
    setErrors({});
    setFormError(null);
    setShowAddModal(true);
  };

  /** @param {ResidentRow} resident */
  const openView = (resident) => {
    setSelected(resident);
    setShowViewModal(true);
  };

  /**
   * Open the Edit Resident modal (Health Supervisor, assigned barangay only).
   * Only the fields the API permits for correction are editable — identity
   * keys (name, birth date, sex) are locked and change through an admin.
   */
  /** @param {ResidentRow} resident */
  const openEdit = (resident) => {
    if (!canEdit) return;
    setEditTarget(resident);
    setEditForm({
      contact: resident.cellphoneNo || "",
      barangay: resident.barangay || "",
      civilStatus: resident.civilStatus || "",
      currentAddress: resident.currentAddress || "",
      philhealthNo: resident.philhealthNo || "",
      religion: resident.religion || "",
      employmentStatus: resident.employmentStatus || "",
      fatherName: resident.fatherName || "",
      motherName: resident.motherName || "",
      birthPlace: resident.birthPlace || "",
    });
    setEditErrors({});
    setEditError(null);
    setShowEditModal(true);
  };

  const closeAdd = () => {
    setShowAddModal(false);
    setErrors({});
    setFormError(null);
  };

  /** @returns {ValidationErrors} */
  const validate = () => {
    const errs = /** @type {ValidationErrors} */ ({});
    if (!form.firstName.trim()) errs.firstName = "First name is required";
    if (!form.lastName.trim()) errs.lastName = "Last name is required";
    const dobError = dateOfBirth(form.dob, { label: "Date of birth" });
    if (dobError) errs.dob = dobError;
    if (!form.gender) errs.gender = "Sex is required";
    if (!form.barangay) errs.barangay = "Barangay is required";
    if (form.contact && !/^[0-9+\-\s()]{7,20}$/.test(form.contact.trim())) {
      errs.contact = "Enter a valid contact number";
    }
    // An email is required only when a login account is being created.
    if (form.createAccount) {
      const email = form.email.trim();
      if (!email) errs.email = "An email is required to create a login account";
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = "Enter a valid email address";
    }
    return errs;
  };

  const handleSubmit = async () => {
    if (!canCreate) return;
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const payload = /** @type {Record<string, string|boolean>} */ ({
        firstName: form.firstName.trim(),
        middleName: form.middleName.trim(),
        lastName: form.lastName.trim(),
        suffix: form.suffix,
        birthDate: form.dob,
        sex: form.gender,
        civilStatus: form.civilStatus,
        barangay: form.barangay,
        cellphoneNo: form.contact.trim(),
        currentAddress: composeAddress(form),
        permanentAddress: composeAddress(form),
      });
      // Optional login account: only sent when the health worker opts in. The
      // backend creates the Supabase Auth user in Pending Activation and links
      // it to this profile; the resident sets their own password later.
      if (form.createAccount) {
        payload.createLoginAccount = true;
        payload.email = form.email.trim();
      }
      const result = await residentsApi.create({ resident: payload });
      setShowAddModal(false);
      setErrors({});
      const record = result?.resident;
      const accountCreated = Boolean(record?.authUserId);
      showToast(
        record
          ? accountCreated
            ? `${fullNameOf(record)} added. An invitation link was emailed to ${form.email.trim()}.`
            : `${fullNameOf(record)} added to the resident directory.`
          : "Resident added.",
      );
      await load(q.trim());
      if (record) {
        setSelected({
          ...record,
          name: fullNameOf(record),
          age: calcAge(record.birthDate),
          status: record.verificationStatus || "unverified",
          // A freshly created account starts in Pending Activation; otherwise
          // the resident has No Account. The directory list refresh above reads
          // the authoritative status from the API.
          accountStatus: accountCreated ? "pending" : "none",
        });
        setShowViewModal(true);
      }
    } catch (err) {
      const error = /** @type {RequestError} */ (err);
      // 422 details are the server's field-level validation list.
      if (error?.status === 422 && Array.isArray(error?.payload?.error?.details)) {
        setFormError(error.payload.error.details.join(" "));
      } else {
        setFormError(error?.message || "Could not register the resident. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const validateEdit = () => {
    const errs = {};
    if (!editForm.barangay) errs.barangay = "Barangay is required.";
    else if (!allowedBarangays.includes(editForm.barangay)) errs.barangay = "You can only edit residents within your assigned barangay.";
    if (editForm.contact && !/^[0-9+\-\s()]{7,20}$/.test(editForm.contact.trim())) errs.contact = "Enter a valid contact number.";
    return errs;
  };

  /** Save the permitted corrections through the API. */
  const handleEditSave = async () => {
    if (!canEdit || !validateEdit() || !editTarget) return;
    setEditSubmitting(true);
    setEditError(null);
    try {
      await residentsApi.update(editTarget.id, {
        resident: {
          cellphoneNo: editForm.contact.trim(),
          barangay: editForm.barangay,
          civilStatus: editForm.civilStatus,
          currentAddress: editForm.currentAddress.trim(),
          philhealthNo: editForm.philhealthNo.trim(),
          religion: editForm.religion,
          employmentStatus: editForm.employmentStatus,
          fatherName: editForm.fatherName.trim(),
          motherName: editForm.motherName.trim(),
          birthPlace: editForm.birthPlace.trim(),
        },
      });
      setShowEditModal(false);
      setEditTarget(null);
      showToast("Resident updated successfully.");
      await load(q.trim());
    } catch (err) {
      const error = /** @type {RequestError} */ (err);
      if (error?.status === 422 && Array.isArray(error?.payload?.error?.details)) {
        setEditError(error.payload.error.details.join(" "));
      } else {
        setEditError(error?.message || "Could not save the changes. Please try again.");
      }
    } finally {
      setEditSubmitting(false);
    }
  };

  /** @param {string} value */
  const onDobChange = (value) => {
    setForm((p) => ({ ...p, dob: value, age: calcAge(value) || "" }));
    if (errors.dob) setErrors((p) => ({ ...p, dob: "" }));
  };

  /** @param {keyof ResidentForm} key */
  const set = (key) =>
    /** @param {string|boolean} value */
    (value) => {
      setForm((p) => ({ ...p, [key]: value }));
      if (errors[key]) setErrors((p) => ({ ...p, [key]: "" }));
    };

  const columns = [
    { key: "name", label: "Resident" },
    { key: "age", label: "Age" },
    { key: "gender", label: "Sex" },
    { key: "barangay", label: "Barangay" },
    { key: "healthRecordNo", label: "Health Record No." },
    { key: "riskLevel", label: "Risk" },
    { key: "status", label: "Status" },
    { key: "account", label: "Account" },
    { key: "actions", label: "" },
  ];

  /** @param {string} label @param {string|number|null|undefined} value */
  const detailCell = (label, value) => (
    <div>
      <p className="text-[11px] text-brand-gray uppercase tracking-wide">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-brand-ink">{value || "—"}</p>
    </div>
  );

  return (
    <>
      <PageHeader
        crumbs={["Residents"]}
        title="Resident Directory"
        subtitle={
          assignedBarangay
            ? `Verified residents in Barangay ${assignedBarangay}. Pending registrations are reviewed under Resident Verification.`
            : "Verified residents in your area. Pending registrations are reviewed under Resident Verification."
        }
        action={canCreate ? (
          <button
            onClick={openAdd}
            className="flex items-center gap-2 bg-brand-blue text-white px-4 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Resident
          </button>
        ) : null}
      />

      <Card className="p-4 mb-5 flex flex-col lg:flex-row gap-3">
        <div className="flex items-center gap-2 bg-brand-bg border border-brand-border rounded-btn px-3 py-2 flex-1">
          <Search className="w-4 h-4 text-brand-gray" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, health record no., PhilHealth, or contact..."
            className="bg-transparent text-sm outline-none w-full"
          />
        </div>
      </Card>

      {loadError && (
        <Card className="mb-5">
          <ErrorState
            title="Could not load the resident directory"
            message={loadError}
            onRetry={() => load(q.trim())}
          />
        </Card>
      )}

      {!loadError && loading && (
        <Card className="p-5">
          <SkeletonList rows={5} />
        </Card>
      )}

      {!loadError && !loading && rows.length === 0 && (
        <Card>
          <EmptyState
            icon={Users}
            title="No residents found"
            description={
              q.trim()
                ? `No residents match “${q.trim()}”. Try a different name, health record number, or clear the search.`
                : "The resident directory is empty. Register the first resident to get started."
            }
            action={
              q.trim() ? (
                <button
                  onClick={() => setQ("")}
                  className="rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
                >
                  Clear search
                </button>
              ) : undefined
            }
          />
        </Card>
      )}

      {!loadError && !loading && rows.length > 0 && (
        <>
          <DataTable
            columns={columns}
            rows={rows}
            renderCell={(/** @type {string} */ key, /** @type {ResidentRow} */ row) => {
              if (key === "name")
                return (
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-brand-light text-brand-blue flex items-center justify-center text-xs font-semibold">
                      {initialsOf(row.name)}
                    </div>
                    <div>
                      <p className="font-medium text-brand-ink">{row.name}</p>
                      <p className="text-xs text-brand-gray">{row.id}</p>
                    </div>
                  </div>
                );
              if (key === "status") return <StatusBadge value={row.status} />;
              if (key === "riskLevel") return <RiskBadge level={row.riskLevel} />;
              if (key === "account") return <AccountStatusPill status={row.accountStatus} />;
              if (key === "actions")
                return (
                  <div className="flex gap-3">
                    <button
                      onClick={() => openView(row)}
                      className="flex items-center gap-1 text-brand-blue text-sm font-medium hover:underline"
                    >
                      <Eye className="w-4 h-4" /> View
                    </button>
                    {canEdit && (
                      <button
                        onClick={() => openEdit(row)}
                        className="flex items-center gap-1 text-brand-gray text-sm font-medium hover:underline"
                      >
                        <Pencil className="w-4 h-4" /> Edit
                      </button>
                    )}
                  </div>
                );
              return row[/** @type {keyof ResidentRow} */ (key)] || "—";
            }}
          />
          <p className="mt-4 text-sm text-brand-gray">
            {rows.length === 0
              ? "No residents found."
              : `Showing ${rows.length} resident${rows.length === 1 ? "" : "s"}${
                  q.trim() ? ` matching “${q.trim()}”` : ""
                }`}
          </p>
        </>
      )}

      {/* Add Resident Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-lg font-semibold text-brand-ink">Add Resident</h3>
                <button onClick={closeAdd} className="text-brand-gray hover:text-brand-ink">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-sm text-brand-gray mb-5">Register a new resident in the directory.</p>

              {formError && (
                <div className="mb-4 rounded-btn border border-brand-danger/30 bg-brand-danger/5 px-3.5 py-3 text-sm text-brand-danger">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="First Name" value={form.firstName} onChange={set("firstName")} placeholder="e.g. Maria" error={errors.firstName} />
                <Field label="Middle Name" value={form.middleName} onChange={set("middleName")} placeholder="e.g. Santos" optional />
                <Field label="Last Name" value={form.lastName} onChange={set("lastName")} placeholder="e.g. Dela Cruz" error={errors.lastName} />
                <Select label="Suffix" value={form.suffix} onChange={set("suffix")} options={SUFFIX_OPTIONS.filter(Boolean)} placeholder="None" />

                <Field label="Date of Birth" type="date" value={form.dob} onChange={onDobChange} error={errors.dob} />
                <Field label="Age" value={form.age} onChange={() => {}} placeholder="Auto-calculated" readOnly optional />

                <Select label="Sex" value={form.gender} onChange={set("gender")} options={SEX_OPTIONS} placeholder="Select sex" error={errors.gender} />
                <Select label="Civil Status" value={form.civilStatus} onChange={set("civilStatus")} options={CIVIL_STATUS_OPTIONS} placeholder="Select civil status" />

                <Field label="Contact Number" value={form.contact} onChange={set("contact")} placeholder="e.g. 0917 123 4567" error={errors.contact} optional />
                <SearchableSelect
                  label="Barangay"
                  required
                  value={form.barangay}
                  onChange={set("barangay")}
                  options={allowedBarangays}
                  placeholder="Search barangay..."
                  emptyText="No barangay found."
                  error={errors.barangay}
                />

                <Field label="Purok/Zone" value={form.purok} onChange={set("purok")} placeholder="e.g. Purok 5" optional />
                <Field label="Street / Sitio" value={form.street} onChange={set("street")} placeholder="Enter street or sitio" optional />
                <Field label="House No." value={form.houseNo} onChange={set("houseNo")} placeholder="Enter house number" optional />
              </div>

              {/* Optional resident login account. A resident profile never
                  requires an account; the health worker chooses whether to
                  create one. When Yes, the account is created in Pending
                  Activation and the resident sets their own password later. */}
              {canCreateLoginAccount && (
                <div className="mt-5 rounded-2xl border border-slate-200 bg-brand-bg/40 p-4">
                  <p className="text-sm font-medium text-brand-ink">Create Resident Login Account?</p>
                  <p className="mt-0.5 text-xs text-brand-gray">
                    Optional. The resident profile is created either way. Choose “Yes” only if this resident should be able to log in.
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
                        form.createAccount ? "bg-brand-blue text-white" : "border border-brand-border bg-white text-brand-ink hover:bg-brand-bg"
                      }`}
                    >
                      Yes
                    </button>
                  </div>
                  {form.createAccount && (
                    <div className="mt-4">
                      <Field
                        label="Email for login account"
                        type="email"
                        value={form.email}
                        onChange={set("email")}
                        placeholder="e.g. resident@example.com"
                        error={errors.email}
                      />
                      <p className="mt-1 text-xs text-brand-gray">
                        The account starts in Pending Activation. An invitation link is emailed to this address — the resident clicks it to set their own password and activate the account.
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-3 mt-6">
                <button onClick={closeAdd} className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="flex items-center gap-2 px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors disabled:opacity-60"
                >
                  {submitting ? "Saving..." : "Add Resident"}
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* View Resident Modal */}
      {showViewModal && selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-brand-light text-brand-blue flex items-center justify-center text-sm font-semibold">
                    {initialsOf(selected.name)}
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-brand-ink">{selected.name}</h3>
                    <p className="text-xs text-brand-gray">{selected.id}</p>
                  </div>
                </div>
                <button onClick={() => setShowViewModal(false)} className="text-brand-gray hover:text-brand-ink">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-4">
                <p className="text-xs font-semibold text-brand-gray uppercase tracking-wide mb-3">Demographics</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {detailCell("Age", selected.age)}
                  {Number(selected.age) < 18 && detailCell("Age Category", "Minor — under 18")}
                  {detailCell("Sex", selected.sex || selected.gender)}
                  {detailCell("Civil Status", selected.civilStatus)}
                  {detailCell("Birthdate", selected.birthDate)}
                  {detailCell("Barangay", selected.barangay)}
                  {detailCell("Contact Number", selected.cellphoneNo)}
                  {Number(selected.age) < 18 && detailCell("Parent / Guardian Link", selected.guardianStatus || "Skipped")}
                  {detailCell("Address", selected.currentAddress)}
                  {detailCell("PhilHealth No.", selected.philhealthNo)}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-6">
                <p className="text-xs font-semibold text-brand-gray uppercase tracking-wide mb-3">Record Information</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div>
                    <p className="text-[11px] text-brand-gray uppercase tracking-wide">Health Record No.</p>
                    <p className="mt-0.5 text-sm font-medium text-brand-ink">{selected.healthRecordNo || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-brand-gray uppercase tracking-wide">Verification Status</p>
                    <div className="mt-1"><StatusBadge value={selected.status} /></div>
                  </div>
                  <div>
                    <p className="text-[11px] text-brand-gray uppercase tracking-wide">Account Status</p>
                    <div className="mt-1"><AccountStatusPill status={selected.accountStatus} /></div>
                  </div>
                  <div>
                    <p className="text-[11px] text-brand-gray uppercase tracking-wide">Registered</p>
                    <p className="mt-0.5 text-sm font-medium text-brand-ink">
                      {selected.createdAt ? new Date(selected.createdAt).toLocaleDateString() : "—"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Risk Assessment — the authoritative, backend-computed result for
                  this resident. HEALTH DATA -> RISK CRITERIA -> RISK SCORE ->
                  RISK LEVEL. Only criteria that actually applied are listed. */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-6">
                <p className="text-xs font-semibold text-brand-gray uppercase tracking-wide mb-3">Risk Assessment</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div>
                    <p className="text-[11px] text-brand-gray uppercase tracking-wide">Current Risk</p>
                    <div className="mt-1"><RiskBadge level={selected.riskLevel} /></div>
                  </div>
                  <div>
                    <p className="text-[11px] text-brand-gray uppercase tracking-wide">Risk Score</p>
                    <p className="mt-0.5 text-sm font-medium text-brand-ink">
                      {Number.isFinite(selected.riskScore) ? selected.riskScore : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-brand-gray uppercase tracking-wide">Last Assessment</p>
                    <p className="mt-0.5 text-sm font-medium text-brand-ink">
                      {selected.riskAssessedAt ? new Date(selected.riskAssessedAt).toLocaleDateString() : "—"}
                    </p>
                  </div>
                </div>

                {Array.isArray(selected.riskFactors) && selected.riskFactors.length > 0 ? (
                  <div className="mt-4">
                    <p className="text-[11px] text-brand-gray uppercase tracking-wide mb-2">Contributing Risk Criteria</p>
                    <div className="overflow-hidden rounded-lg border border-brand-border">
                      <table className="w-full text-sm">
                        <thead className="bg-brand-light/40 text-brand-gray">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium">Criterion</th>
                            <th className="px-3 py-2 text-left font-medium">Result</th>
                            <th className="px-3 py-2 text-right font-medium">Score</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selected.riskFactors.map((f) => (
                            <tr key={f.code || f.name} className="border-t border-brand-border">
                              <td className="px-3 py-2 text-brand-ink">{f.name}</td>
                              <td className="px-3 py-2 text-brand-gray">{f.measured ?? "Present"}</td>
                              <td className="px-3 py-2 text-right font-stat font-medium text-brand-ink">+{f.weight}</td>
                            </tr>
                          ))}
                          <tr className="border-t border-brand-border bg-brand-light/20">
                            <td className="px-3 py-2 font-medium text-brand-ink" colSpan={2}>Total Score</td>
                            <td className="px-3 py-2 text-right font-stat font-bold text-brand-ink">{selected.riskScore ?? 0}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-brand-gray">
                    {selected.riskLevel
                      ? "No individual criteria contributed to this resident's score."
                      : "No consultation with recorded vitals yet, so no risk has been assessed."}
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowViewModal(false)}
                  className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Edit Resident Modal (Health Supervisor, assigned barangay only).
          Edits are limited to the fields the API permits for correction —
          identity fields (name, birth date, sex) are locked by design. */}
      {showEditModal && editTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-brand-ink">Edit Resident</h3>
                  <p className="text-sm text-brand-gray mt-0.5">
                    {editTarget.id} · updates are limited to your assigned barangay.
                  </p>
                </div>
                <button onClick={() => setShowEditModal(false)} className="text-brand-gray hover:text-brand-ink" aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {editError && (
                <div className="mb-4 rounded-btn border border-brand-danger/30 bg-brand-danger/5 px-3.5 py-3 text-sm text-brand-danger">
                  {editError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <Field label="Full Name" value={editTarget.name || ""} onChange={() => {}} placeholder="" readOnly optional />
                  <p className="mt-1 text-xs text-brand-gray">Identity corrections go through an administrator.</p>
                </div>
                <Field label="Contact Number" value={editForm.contact} onChange={(v) => { setEditForm((p) => ({ ...p, contact: v })); if (editErrors.contact) setEditErrors((p) => ({ ...p, contact: "" })); }} placeholder="e.g. 0917 123 4567" error={editErrors.contact} optional />
                <Select label="Civil Status" value={editForm.civilStatus} onChange={(v) => setEditForm((p) => ({ ...p, civilStatus: v }))} options={CIVIL_STATUS_OPTIONS} placeholder="Select civil status" />
                <SearchableSelect
                  label="Barangay"
                  required
                  value={editForm.barangay}
                  onChange={(v) => { setEditForm((p) => ({ ...p, barangay: v })); if (editErrors.barangay) setEditErrors((p) => ({ ...p, barangay: "" })); }}
                  options={allowedBarangays}
                  placeholder="Search barangay..."
                  emptyText="No barangay found."
                  error={editErrors.barangay}
                />
                <Select label="Religion" value={editForm.religion} onChange={(v) => setEditForm((p) => ({ ...p, religion: v }))} options={RELIGION_OPTIONS} placeholder="Select religion" />
                <Field label="Birth Place" value={editForm.birthPlace} onChange={(v) => setEditForm((p) => ({ ...p, birthPlace: v }))} placeholder="e.g. Pili, Camarines Sur" optional />
                <Field label="Employment Status" value={editForm.employmentStatus} onChange={(v) => setEditForm((p) => ({ ...p, employmentStatus: v }))} placeholder="e.g. Employed" optional />
                <Field label="PhilHealth No." value={editForm.philhealthNo} onChange={(v) => setEditForm((p) => ({ ...p, philhealthNo: v }))} placeholder="e.g. 12-345678901-2" optional />
                <Field label="Father's Name" value={editForm.fatherName} onChange={(v) => setEditForm((p) => ({ ...p, fatherName: v }))} placeholder="Enter father's name" optional />
                <Field label="Mother's Name" value={editForm.motherName} onChange={(v) => setEditForm((p) => ({ ...p, motherName: v }))} placeholder="Enter mother's name" optional />
                <div className="sm:col-span-2">
                  <Field label="Address" value={editForm.currentAddress} onChange={(v) => setEditForm((p) => ({ ...p, currentAddress: v }))} placeholder="House no., street, purok, barangay" optional />
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-brand-border">
                <button onClick={() => setShowEditModal(false)} className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray hover:bg-brand-bg transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleEditSave}
                  disabled={editSubmitting}
                  className="flex items-center gap-2 px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors disabled:opacity-60"
                >
                  <CheckCircle2 className="w-4 h-4" /> {editSubmitting ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 bg-brand-ink text-white px-4 py-3 rounded-btn shadow-lg flex items-center gap-2 z-50 animate-in slide-in-from-bottom-2">
          <CheckCircle2 className="w-4 h-4 text-brand-green" />
          <span className="text-sm">{toast}</span>
        </div>
      )}
    </>
  );
}

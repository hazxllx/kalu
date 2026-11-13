import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, Plus, X, Eye, Pencil, CheckCircle2, ChevronDown, MoreVertical, Users } from "lucide-react";
import PageHeader from "@/components/common/PageHeader";
import DataTable from "@/components/tables/DataTable";
import TablePagination from "@/components/tables/TablePagination";
import StatusBadge from "@/components/common/StatusBadge";
import RiskBadge from "@/components/common/RiskBadge";
import SearchableSelect from "@/components/common/SearchableSelect";
import { ButtonSelectGroup } from "@/components/system";
import { Card } from "@/components/common/Card";
import EmptyState from "@/components/common/EmptyState";
import ErrorState from "@/components/common/ErrorState";
import { SkeletonList } from "@/components/common/Skeleton";
import { useAuth } from "@/context/AuthContext";
import { usePermissions } from "@/context/PermissionsContext";
import { getSupervisorScope, HS_SCOPE } from "@/lib/supervisorScope";
import { residentsApi } from "@/services/api";
import {
  createResidentOffline,
  listResidentsOffline,
  updateResidentOffline,
} from "@/services/offline/residentOfflineService";
import { dateOfBirth, isStrictMobile } from "@/utils/validation";
import ResidentConflictReview from "../components/ResidentConflictReview";

const CIVIL_STATUS_OPTIONS = ["Single", "Married", "Widowed", "Separated"];
const SEX_OPTIONS = ["Female", "Male"];
const SUFFIX_OPTIONS = ["", "Jr.", "Sr.", "II", "III", "IV"];
const RELIGION_OPTIONS = ["Roman Catholic", "Protestant", "Iglesia ni Cristo", "Born Again", "Muslim", "Other"];
const RISK_FILTERS = ["All", "High", "Moderate", "Low", "Unassessed"];

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
 * @property {string} [updatedAt]
 * @property {number} [revision]
 * @property {string} [syncStatus]
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

/** @param {ResidentRecord} resident @returns {ResidentRow} */
const mapRecord = (resident) => ({
  ...resident,
  name: fullNameOf(resident) || resident.name || "Name unavailable",
  age: calcAge(resident.birthDate),
  gender: resident.sex || "—",
  status: resident.verificationStatus === "approved" ? "Approved" : resident.verificationStatus || "Unknown",
  riskLevel: resident.riskLevel || null,
});

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
    <span className={`ui-status-badge inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${accountStatusClass(key)}`}>
      {ACCOUNT_STATUS_LABELS[key] || "No Account"}
    </span>
  );
};

/**
 * Account-linking state, derived purely from PERSISTED data the API returns:
 * `authUserId` (is a Supabase Auth account linked to this resident record?) and
 * the linked account's `accountStatus` (profiles.status). This is the staff-
 * facing wording the task calls for and is never computed from form state.
 *
 *   Not Linked          — no auth account is linked (authUserId null)
 *   Pending Verification — linked, but the account is not active yet
 *   Linked              — linked and the account is active
 *   Account Disabled    — linked, but the account was disabled by an admin
 *
 * @param {{authUserId?: string, accountStatus?: string}|null|undefined} resident
 */
const linkingStateOf = (resident) => {
  if (!resident?.authUserId || resident.accountStatus === "none") {
    return { key: "not_linked", label: "Not Linked", cls: "bg-slate-100 text-slate-500" };
  }
  if (resident.accountStatus === "active") {
    return { key: "linked", label: "Linked", cls: "bg-emerald-50 text-emerald-700" };
  }
  if (resident.accountStatus === "disabled") {
    return { key: "disabled", label: "Account Disabled", cls: "bg-rose-50 text-rose-700" };
  }
  return { key: "pending", label: "Pending Verification", cls: "bg-amber-50 text-amber-700" };
};

/** @param {{resident: ResidentRow|null}} props */
const LinkingStatePill = ({ resident }) => {
  const state = linkingStateOf(resident);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${state.cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {state.label}
    </span>
  );
};

/**
 * @param {{label: string, value: string, onChange: (value: string) => void, options?: string[], placeholder?: string, error?: string, emptyLabel?: string, children?: import("react").ReactNode}} props
 */
function Select({ label, value, onChange, options = [], placeholder = "", error = "", emptyLabel = "", children = null }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={labelClass}>{label}</label>
      <div className="relative">
        <select
          id={id}
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
 * @param {{label: string, value: string, onChange: (value: string) => void, placeholder?: string, error?: string, type?: string, optional?: boolean, readOnly?: boolean, maxLength?: number, pattern?: string, autoComplete?: string}} props
 */
function Field({
  label,
  value,
  onChange,
  placeholder = "",
  error = "",
  type = "text",
  optional = false,
  readOnly = false,
  maxLength,
  pattern,
  autoComplete,
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={labelClass}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        maxLength={maxLength}
        pattern={pattern}
        autoComplete={autoComplete}
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
  const { can, matrixLoadState } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const supervisor = user?.role === "health_supervisor";
  const scope = getSupervisorScope(user);
  const assignedBarangay = scope?.level === HS_SCOPE.BARANGAY ? scope.assignedBarangay : null;
  const queryParam = supervisor ? searchParams.get("q") || "" : "";
  const riskParam = supervisor && RISK_FILTERS.includes(searchParams.get("risk")) ? searchParams.get("risk") : "All";
  const residentParam = supervisor ? searchParams.get("residentId") || "" : "";
  /** @type {(permissionId: string) => boolean} */
  const canFn = can;
  const canCreate = canFn("residents.create") && (!supervisor || Boolean(assignedBarangay));
  const canViewDirectory = canFn("residents.directory.view");
  const canViewProfile = canFn("residents.profile.view");
  const canCreateLoginAccount = canFn("accounts.create");
  // Show the Yes/No choice whenever the user may add a resident. The actual
  // account-creation capability is gated separately on the Yes button; this
  // keeps the two permissions distinct — a Health Supervisor who may add
  // residents but whose accounts.create was revoked still sees the choice and
  // can add residents (No), and only Yes is blocked.
  const showLoginAccountOption = canCreate;
  const canEditPermission = canFn("residents.edit");
  const canCreateLoginAccountForResident = canCreateLoginAccount;

  const [residents, setResidents] = useState(/** @type {ResidentRecord[]} */ ([]));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(/** @type {string|null} */ (null));
  const [loadWarning, setLoadWarning] = useState(/** @type {string|null} */ (null));
  const [directoryOwner, setDirectoryOwner] = useState(/** @type {string|null} */ (null));
  const loadRequest = useRef(0);

  const [q, setQ] = useState(queryParam);
  const [riskFilter, setRiskFilter] = useState(riskParam);
  const [directoryPage, setDirectoryPage] = useState(1);
  const [directoryPageSize, setDirectoryPageSize] = useState(8);
  const [barangayFilter, setBarangayFilter] = useState("");
  const [zoneFilter, setZoneFilter] = useState("");
  const [geographicOptions, setGeographicOptions] = useState(null);
  const [geographicOptionsLoading, setGeographicOptionsLoading] = useState(false);
  const [geographicOptionsError, setGeographicOptionsError] = useState("");
  const [linkedLoading, setLinkedLoading] = useState(false);
  const [linkedError, setLinkedError] = useState("");
  const [linkedRetry, setLinkedRetry] = useState(0);

  const [showAddModal, setShowAddModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selected, setSelected] = useState(/** @type {ResidentRow|null} */ (null));
  const [selectedOwner, setSelectedOwner] = useState(/** @type {string|null|undefined} */ (null));
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
  const [openActionMenu, setOpenActionMenu] = useState(null);

  // "Create login account" action inside the View modal, shown only for records
  // that are Not Linked. It invites a Supabase Auth account for the EXISTING
  // resident record (backend links residents.auth_user_id) — it never creates a
  // second resident and never changes the verification status.
  const [linkPanelOpen, setLinkPanelOpen] = useState(false);
  const [linkEmail, setLinkEmail] = useState("");
  const [linkSubmitting, setLinkSubmitting] = useState(false);
  const [linkError, setLinkError] = useState(/** @type {string|null} */ (null));

  /** @param {string} message */
  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3200);
  };

  useEffect(() => {
    if (!openActionMenu) return undefined;
    const close = (event) => {
      if (!event.target.closest("[data-resident-actions]")) setOpenActionMenu(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [openActionMenu]);

  const role = String(user?.role || "").toLowerCase();
  const showBarangayFilter = role === "phn" || role === "mho";
  const showZoneFilter = supervisor && Boolean(assignedBarangay);
  // Reuse the municipality-scoped directory options for resident registration.
  // A Health Supervisor can register only in their assigned barangay; PHN/MHO
  // can choose from the same authorized barangays shown by the directory filter.
  const allowedBarangays = assignedBarangay
    ? [assignedBarangay]
    : (geographicOptions?.barangays || []).map((barangay) => barangay.name).filter(Boolean);

  useEffect(() => {
    if (!user?.id || (!showBarangayFilter && !showZoneFilter)) {
      setGeographicOptions(null);
      return undefined;
    }
    let current = true;
    setGeographicOptionsLoading(true);
    setGeographicOptionsError("");
    residentsApi.directoryFilters({ ownerId: user.id })
      .then((result) => {
        if (current) setGeographicOptions(result || null);
      })
      .catch((error) => {
        if (current) setGeographicOptionsError(error?.message || "Unable to load geographic filters.");
      })
      .finally(() => {
        if (current) setGeographicOptionsLoading(false);
      });
    return () => { current = false; };
  }, [user?.id, showBarangayFilter, showZoneFilter]);

  /**
   * The MHO browses the same directory municipally but may not correct
   * resident demographics (the API's edit roles are the PHN and the Health
   * Supervisor), so the edit action is hidden rather than shown and 403'd.
   */
  const canEdit =
    (user?.role === "phn" || (supervisor && Boolean(assignedBarangay))) && canEditPermission;

  useEffect(() => {
    if (supervisor) setQ(queryParam);
  }, [supervisor, queryParam]);
  useEffect(() => {
    if (supervisor) setRiskFilter(riskParam);
  }, [supervisor, riskParam]);

  /** Load authorized rows from the API or this account's encrypted local cache. */
  const load = useCallback(
    async (searchTerm = "") => {
      const requestId = ++loadRequest.current;
      setLoading(true);
      setLoadError(null);
      setLoadWarning(null);
      if (supervisor && matrixLoadState.status === "loading") return;
      try {
        if (supervisor && !assignedBarangay) throw new Error("A valid barangay assignment is required to access the resident directory.");
        if (supervisor && !canViewDirectory) {
          throw new Error("Your account is not permitted to view the resident directory.");
        }
        // Verified directory only: the backend returns residents who are
        // individually approved OR belong to a Verified household, scoped to
        // this supervisor's barangay. Pending/unverified residents live in the
        // Resident Verification queue, not here.
        const directoryParams = {
          q: searchTerm,
          limit: 100,
          verified: true,
          ...(showBarangayFilter && barangayFilter ? { barangayId: barangayFilter } : {}),
          ...(showZoneFilter && zoneFilter ? { zone: zoneFilter } : {}),
        };
        const result = await listResidentsOffline({
          ownerId: user?.id,
          params: directoryParams,
        });
        if (requestId !== loadRequest.current) return;
        if (!Array.isArray(result?.rows)) throw new Error("The resident directory response was incomplete.");
        // Unverified local creates are not part of the server's verified directory.
        setResidents(result.rows.filter((r) => !supervisor || !r.localId || ["approved", "verified"].includes(r.verificationStatus)));
        setDirectoryOwner(user?.id || null);
        if (result.warning) setLoadWarning(result.warning.message);
      } catch (err) {
        if (requestId !== loadRequest.current) return;
        setResidents([]);
        setDirectoryOwner(user?.id || null);
        const error = /** @type {RequestError} */ (err);
        setLoadError(error?.message || "Could not load the resident directory.");
      } finally {
        if (requestId === loadRequest.current) setLoading(false);
      }
    },
    [user?.id, supervisor, assignedBarangay, canViewDirectory, matrixLoadState.status,
      showBarangayFilter, barangayFilter, showZoneFilter, zoneFilter],
  );

  // Debounced server-side search.
  const debounceRef = useRef(/** @type {ReturnType<typeof setTimeout>|null} */ (null));
  useEffect(() => {
    loadRequest.current += 1;
    setLoading(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      load(q.trim());
    }, 350);
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      loadRequest.current += 1;
    };
  }, [q, load]);

  const rows = useMemo(() => {
    if (directoryOwner !== user?.id || (supervisor && !assignedBarangay)) return [];
    return residents.filter((r) => !supervisor || String(r.barangay || "").trim().toLowerCase() === assignedBarangay.toLowerCase()).map(mapRecord);
  }, [residents, directoryOwner, user?.id, supervisor, assignedBarangay]);
  const visibleRows = supervisor && riskFilter !== "All"
    ? rows.filter((row) => riskFilter === "Unassessed" ? !row.riskLevel : row.riskLevel === riskFilter)
    : rows;
  const pageRows = visibleRows.slice((directoryPage - 1) * directoryPageSize, directoryPage * directoryPageSize);

  useEffect(() => { setDirectoryPage(1); }, [q, riskFilter, barangayFilter, zoneFilter]);
  useEffect(() => {
    setDirectoryPage((page) => Math.min(page, Math.max(1, Math.ceil(visibleRows.length / directoryPageSize))));
  }, [visibleRows.length, directoryPageSize]);

  useEffect(() => {
    if (!supervisor || !residentParam) {
      setLinkedLoading(false);
      setLinkedError("");
      return undefined;
    }
    let active = true;
    setShowViewModal(false);
    setSelected(null);
    setLinkedError("");
    if (matrixLoadState.status === "loading") return undefined;
    if (!user?.id || !canViewProfile || !assignedBarangay) {
      setLinkedLoading(false);
      setLinkedError(!assignedBarangay ? "A valid barangay assignment is required to view this resident." : "Your account is not permitted to view resident profiles.");
      return undefined;
    }
    setLinkedLoading(true);
    residentsApi.get(encodeURIComponent(residentParam), { ownerId: user.id })
      .then((response) => {
        if (!active) return;
        const record = response?.resident;
        if (!record || String(record.id) !== residentParam) throw new Error("The requested resident record was not returned.");
        if (String(record.barangay || "").trim().toLowerCase() !== assignedBarangay.toLowerCase()) throw new Error("This resident is not available in your assigned barangay.");
        setSelected(mapRecord(record));
        setSelectedOwner(user.id);
        setLinkPanelOpen(false);
        setLinkEmail("");
        setLinkError(null);
        setShowViewModal(true);
      })
      .catch((error) => { if (active) setLinkedError(error?.message || "Could not open the requested resident."); })
      .finally(() => { if (active) setLinkedLoading(false); });
    return () => { active = false; };
  }, [supervisor, residentParam, user?.id, assignedBarangay, canViewProfile, matrixLoadState.status, linkedRetry]);

  useEffect(() => {
    setShowAddModal(false);
    setShowEditModal(false);
    setEditTarget(null);
  }, [user?.id, assignedBarangay]);

  const closeView = () => {
    setShowViewModal(false);
    if (residentParam) {
      const next = new URLSearchParams(searchParams);
      next.delete("residentId");
      setSearchParams(next, { replace: true });
    }
  };

  const openAdd = () => {
    if (!canCreate) return;
    setForm(initialFromUser(user));
    setErrors({});
    setFormError(null);
    setShowAddModal(true);
  };

  /** @param {ResidentRow} resident */
  const openView = (resident) => {
    if (supervisor && (!canViewProfile || !assignedBarangay)) return;
    setSelected(resident);
    setSelectedOwner(user?.id);
    setLinkPanelOpen(false);
    setLinkEmail("");
    setLinkError(null);
    setShowViewModal(true);
  };

  /**
   * Invite a login account for an EXISTING, unlinked resident record. The
   * backend creates the Supabase Auth user, links it to this resident
   * (residents.auth_user_id) in Pending Activation, and emails an invitation —
   * it never duplicates the resident and never auto-verifies anyone.
   */
  const handleCreateAccount = async () => {
    if (!canCreateLoginAccount || !selected || selectedOwner !== user?.id) return;
    const email = linkEmail.trim();
    if (!email) {
      setLinkError("An email is required to create a login account.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setLinkError("Enter a valid email address.");
      return;
    }
    setLinkSubmitting(true);
    setLinkError(null);
    try {
      const result = await residentsApi.createAccount(selected.id, { email });
      const record = result?.resident;
      // Reflect the new linked-but-pending state immediately; the list refresh
      // below reads the authoritative status from the API.
      setSelected((prev) =>
        prev
          ? { ...prev, authUserId: record?.authUserId || prev.authUserId || "linked", accountStatus: "pending" }
          : prev,
      );
      setLinkPanelOpen(false);
      setLinkEmail("");
      showToast(`Invitation emailed to ${email}. The account is Pending Verification until the resident activates it.`);
      await load(q.trim());
    } catch (err) {
      const error = /** @type {RequestError} */ (err);
      if (error?.status === 422 && Array.isArray(error?.payload?.error?.details)) {
        setLinkError(error.payload.error.details.join(" "));
      } else {
        setLinkError(error?.message || "Could not create the login account. Please try again.");
      }
    } finally {
      setLinkSubmitting(false);
    }
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
    // Date of birth is validated strictly: the raw input must be a valid YYYY-MM-DD
    // calendar date (five-digit years like 20000 fail the 4-digit parse), must not
    // be a future date, and must be within the documented 0..120 age range.
    // Age is always derived from this field and never trusted from the client.
    if (!form.dob || !/^\d{4}-\d{2}-\d{2}$/.test(form.dob)) {
      // Let the shared helper produce the user-facing message, but ensure a raw
      // value that does not even look like YYYY-MM-DD is not mistakenly treated
      // as "auto-filled" by a loose browser parse.
      const dobError = dateOfBirth(form.dob, { label: "Date of birth" });
      if (dobError) errs.dob = dobError;
      else errs.dob = "Date of birth is required.";
    } else {
      const dobError = dateOfBirth(form.dob, { label: "Date of birth" });
      if (dobError) errs.dob = dobError;
      else {
        const computed = calcAge(form.dob);
        if (form.dob && !computed) {
          // calcAge returns "" for out-of-range or impossible dates that still
          // passed the format check (e.g. capped age > 120 or future-date edge).
          errs.dob = "Date of birth is not a valid age.";
        } else if (form.age && computed && form.age !== computed) {
          errs.dob = "Age does not match the date of birth.";
        }
      }
    }
    if (!form.gender) errs.gender = "Sex is required";
    if (!form.barangay) errs.barangay = "Barangay is required";
    // Contact is optional; when supplied, require the exact local format used
    // by resident registration and enforced by the backend.
    if (form.contact && !isStrictMobile(form.contact)) {
      errs.contact = "Enter exactly 11 digits starting with 09, with no spaces or symbols.";
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
    // Guard: a Health Supervisor whose accounts.create is revoked must not
    // submit a login-account request even if the UI state was toggled before
    // the permission changed. Surface a clear field error instead of a 403.
    if (form.createAccount && !canCreateLoginAccount) {
      setErrors((p) => ({ ...p, email: "Your role is not permitted to create login accounts." }));
      return;
    }
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    // Age is always derived from the validated birth date (UTC). Recompute
    // here so a stale form.age can never be persisted.
    const canonicalAge = calcAge(form.dob);
    setForm((p) => ({ ...p, age: canonicalAge || "" }));
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
        cellphoneNo: form.contact,
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
      const result = await createResidentOffline({
        ownerId: user?.id,
        payload: { resident: payload },
      });
      setShowAddModal(false);
      setErrors({});
      const record = result?.resident;
      const accountCreated = Boolean(record?.authUserId);
      showToast(
        result.queued
          ? `${fullNameOf(record)} saved on this device. It will sync when you reconnect.`
          : record
          ? accountCreated
            ? `${fullNameOf(record)} added. An invitation link was emailed to ${form.email.trim()}.`
            : `${fullNameOf(record)} added to the resident directory.`
          : "Resident added.",
      );
      await load(q.trim());
      if (record) {
        setSelectedOwner(user?.id);
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

  /** @returns {ValidationErrors} */
  const validateEdit = () => {
    const errs = /** @type {ValidationErrors} */ ({});
    if (!editForm.barangay) errs.barangay = "Barangay is required.";
    else if (!allowedBarangays.includes(editForm.barangay)) errs.barangay = "You can only edit residents within your assigned barangay.";
    if (editForm.contact && !isStrictMobile(editForm.contact)) errs.contact = "Enter exactly 11 digits starting with 09, with no spaces or symbols.";
    return errs;
  };

  /** Save the permitted corrections through the API. */
  const handleEditSave = async () => {
    if (!canEdit || !editTarget) return;
    const errs = validateEdit();
    if (Object.keys(errs).length > 0) {
      setEditErrors(errs);
      return;
    }
    setEditSubmitting(true);
    setEditError(null);
    try {
      const result = await updateResidentOffline({
        ownerId: user?.id,
        residentId: editTarget.id,
        baseRevision: editTarget.revision ?? editTarget.updatedAt,
        payload: {
          resident: {
            cellphoneNo: editForm.contact,
            barangay: editForm.barangay,
            civilStatus: editForm.civilStatus,
            currentAddress: editForm.currentAddress.trim(),
            philhealthNo: editForm.philhealthNo.trim(),
            religion: editForm.religion,
            employmentStatus: editForm.employmentStatus,
            fatherName: editForm.fatherName,
            motherName: editForm.motherName,
            birthPlace: editForm.birthPlace,
          },
        },
      });
      setShowEditModal(false);
      setEditTarget(null);
      showToast(
        result.conflict
          ? "A newer server version exists. Your changes are saved on this device for conflict review."
          : result.queued
          ? "Changes saved on this device. They will sync when you reconnect."
          : "Resident updated successfully.",
      );
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

  /** @param {string} value */
  const onContactChange = (value) => {
    // Strip non-digit characters
    const digitsOnly = value.replace(/\D/g, '');
    // Enforce maximum 11 digits
    const truncated = digitsOnly.slice(0, 11);
    setForm((p) => ({ ...p, contact: truncated }));
    setErrors((p) => ({
      ...p,
      contact: truncated && !isStrictMobile(truncated)
        ? "Enter exactly 11 digits starting with 09, with no spaces or symbols."
        : "",
    }));
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
    { key: "barangay", label: "Barangay" },
    { key: "healthRecordNo", label: "Health Record No." },
    { key: "riskLevel", label: "Risk" },
    { key: "status", label: supervisor ? "Verification" : "Status" },
    { key: "account", label: "Account" },
    { key: "actions", label: "Actions" },
  ];

  /** @param {string} label @param {string|number|null|undefined} value */
  const detailCell = (label, value) => (
    <div>
      <p className="text-[11px] text-brand-gray uppercase tracking-wide">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-brand-ink">{value || "—"}</p>
    </div>
  );

  return (
    <div className={supervisor ? "supervisor-module" : "contents"}>
      {canEdit && <ResidentConflictReview onResolved={async (result) => {
        showToast(result.queued ? 'Reviewed changes are queued with the current server revision.' : 'The current server version was kept.');
        await load(q.trim());
      }} />}
      <PageHeader
        crumbs={["Residents"]}
        title="Resident Directory"
        subtitle={
          assignedBarangay
            ? `Verified residents in Barangay ${assignedBarangay}. Pending registrations are reviewed under Resident Verification.`
            : supervisor ? "No valid barangay assignment. Resident records are unavailable."
            : "Verified residents in your area. Pending registrations are reviewed under Resident Verification."
        }
        action={canCreate ? (
          <button
            onClick={openAdd}
            className={supervisor ? "supervisor-button is-primary" : "flex items-center gap-2 bg-brand-blue text-white px-4 py-2.5 rounded-btn text-sm font-medium hover:bg-brand-dark transition-colors"}
          >
            <Plus className="w-4 h-4" /> Add Resident
          </button>
        ) : null}
      />

      {loadWarning && (
        <div className="mb-4 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
          {loadWarning}
          {residents.length > 0 ? " Showing authorized records saved on this device." : ""}
        </div>
      )}

      {supervisor ? (
        <Card className="clinical-toolbar supervisor-toolbar mb-4 flex flex-wrap items-end gap-3">
          <label htmlFor="resident-search" className="min-w-[12rem] flex-1 text-caption font-medium text-brand-gray">
            Search Residents
            <div className="clinical-search supervisor-input mt-1 flex items-center gap-2">
              <Search className="h-4 w-4 shrink-0 text-brand-gray" aria-hidden="true" />
              <input id="resident-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, health record no. or contact" className="min-w-0 w-full bg-transparent outline-none" />
            </div>
          </label>
          {showZoneFilter && <label htmlFor="resident-zone-filter" className="text-caption font-medium text-brand-gray">
            Zone
            <select id="resident-zone-filter" value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)} disabled={geographicOptionsLoading} className="clinical-filter supervisor-input mt-1 block w-full sm:w-48">
              <option value="">All Zones</option>
              {(geographicOptions?.zones || []).map((zone) => <option key={zone} value={String(zone)}>Zone {zone}</option>)}
              {geographicOptions?.hasUnassigned && <option value="unassigned">Unassigned</option>}
              {!geographicOptionsLoading && geographicOptions && !geographicOptions.zones?.length && !geographicOptions.hasUnassigned && <option value="" disabled>No recorded zones</option>}
            </select>
          </label>}
          <label htmlFor="resident-risk" className="text-caption font-medium text-brand-gray">
            Recorded Risk
            <select id="resident-risk" value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)} className="clinical-filter supervisor-input mt-1 block w-full sm:w-40">
              {RISK_FILTERS.map((risk) => <option key={risk} value={risk}>{risk === "All" ? "All risk levels" : risk === "Unassessed" ? "Not assessed" : risk}</option>)}
            </select>
          </label>
          {(q || riskFilter !== "All" || zoneFilter) && <button type="button" className="supervisor-button is-quiet" onClick={() => { setQ(""); setRiskFilter("All"); setZoneFilter(""); }}>Clear filters</button>}
        </Card>
      ) : <Card className="clinical-toolbar p-4 mb-5 flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="clinical-search flex min-h-[50px] flex-1 items-center gap-2 px-3 py-2">
          <Search className="w-4 h-4 text-brand-gray" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, health record no., PhilHealth, or contact..."
            className="w-full bg-transparent text-sm outline-none"
          />
        </div>
        {showBarangayFilter && <label htmlFor="resident-barangay-filter" className="text-sm font-medium text-brand-ink lg:w-60">
          Barangay
          <select id="resident-barangay-filter" value={barangayFilter} onChange={(e) => setBarangayFilter(e.target.value)} disabled={geographicOptionsLoading}           className={`${inputClass(false)} clinical-filter`}>
            <option value="">All Barangays</option>
            {(geographicOptions?.barangays || []).map((barangay) => <option key={barangay.id} value={barangay.id}>{barangay.name}</option>)}
          </select>
        </label>}
        {(q || barangayFilter) && <button type="button" className="px-3 py-2 text-sm font-medium text-brand-blue hover:underline self-end" onClick={() => { setQ(""); setBarangayFilter(""); }}>Clear filters</button>}
      </Card>}
      {geographicOptionsError && (showBarangayFilter || showZoneFilter) && <p className="-mt-3 mb-4 text-sm text-brand-danger" role="status">{geographicOptionsError}</p>}

      {residentParam && (linkedLoading || linkedError) && (
        <Card className="mb-4" aria-busy={linkedLoading}>
          {linkedLoading ? <p role="status" className="p-4 text-ui text-brand-gray">Opening the authorized resident profile...</p> : <ErrorState compact title="Resident profile unavailable" message={linkedError} onRetry={() => setLinkedRetry((value) => value + 1)} />}
        </Card>
      )}

      {loadError && (
        <Card className="mb-5">
          <ErrorState
            compact={supervisor}
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

      {!loadError && !loading && visibleRows.length === 0 && (
        <Card>
          <EmptyState
            compact={supervisor}
            icon={Users}
            title="No residents found"
            description={
              loadWarning
                ? "No locally cached or queued resident records are available. Reconnect to load this authorized directory."
                : supervisor && riskFilter !== "All" ? "No loaded residents match this recorded risk level. Risk filters apply to the current directory page, not the complete barangay population."
                : q.trim()
                ? `No residents match “${q.trim()}”. Try a different name, health record number, or clear the search.`
                : "The resident directory is empty. Register the first resident to get started."
            }
            action={
              q.trim() || (supervisor && riskFilter !== "All") ? (
                <button
                  onClick={() => { setQ(""); setRiskFilter("All"); }}
                  className="rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
                >
                  Clear filters
                </button>
              ) : undefined
            }
          />
        </Card>
      )}

      {!loadError && !loading && visibleRows.length > 0 && (
        <>
          <DataTable
            className="clinical-data-table resident-directory-table"
            tableClassName="clinical-table resident-directory-grid"
            fitContainer
            mobileCards={false}
            dense={supervisor}
            columns={columns}
            rows={pageRows}
            renderCell={(/** @type {string} */ key, /** @type {ResidentRow} */ row) => {
              if (key === "name")
                return (
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-blue text-xs font-semibold text-white">
                      {initialsOf(row.name)}
                    </div>
                    <div>
                      <p className="font-medium text-brand-ink">{row.name}</p>
                      <p className="text-xs text-brand-gray">{supervisor ? row.cellphoneNo || "Contact not recorded" : row.id}</p>
                      {supervisor && row.syncStatus && <p className="text-caption text-amber-800">{row.syncStatus}</p>}
                    </div>
                  </div>
                );
              if (key === "status") return <StatusBadge value={row.status} />;
              if (key === "riskLevel") return <RiskBadge level={row.riskLevel} />;
              if (key === "account") return <AccountStatusPill status={row.accountStatus} />;
              if (key === "actions")
                return (
                  <div className="relative flex justify-end" data-resident-actions>
                    <button
                      type="button"
                      onClick={() => setOpenActionMenu((current) => current === row.id ? null : row.id)}
                      className="inline-flex items-center gap-1 rounded-btn border border-brand-border px-2.5 py-1.5 text-sm font-medium text-brand-blue hover:border-brand-blue"
                      aria-haspopup="menu"
                      aria-expanded={openActionMenu === row.id}
                    >
                      <MoreVertical className="h-4 w-4" aria-hidden="true" />
                    </button>
                    {openActionMenu === row.id && (
                      <div role="menu" className="absolute right-0 top-full z-30 mt-1 min-w-[9rem] rounded-btn border border-brand-border bg-white p-1 shadow-lg">
                        {(!supervisor || canViewProfile) && <button type="button" role="menuitem" onClick={() => { setOpenActionMenu(null); openView(row); }} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm text-brand-ink hover:bg-brand-bg"><Eye className="h-4 w-4 text-brand-blue" /> View Details</button>}
                        {canEdit && <button type="button" role="menuitem" onClick={() => { setOpenActionMenu(null); openEdit(row); }} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm text-brand-ink hover:bg-brand-bg"><Pencil className="h-4 w-4 text-brand-gray" /> Edit Resident</button>}
                      </div>
                    )}
                  </div>
                );
              return row[/** @type {keyof ResidentRow} */ (key)] || "—";
            }}
          />
          <div className="resident-directory-mobile">
            {pageRows.map((row) => (
              <article key={row.id} className="border-b border-brand-border p-3 last:border-b-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-blue text-xs font-semibold text-white">{initialsOf(row.name)}</div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-brand-ink">{row.name}</p>
                      <p className="truncate text-xs text-brand-gray">{row.cellphoneNo || "Contact not recorded"}</p>
                    </div>
                  </div>
                  <div className="relative shrink-0" data-resident-actions>
                    <button type="button" onClick={() => setOpenActionMenu((current) => current === row.id ? null : row.id)} className="inline-flex h-8 w-8 items-center justify-center rounded-btn text-brand-blue transition-colors hover:bg-brand-light hover:text-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40" aria-label={`Actions for ${row.name}`} aria-haspopup="menu" aria-expanded={openActionMenu === row.id}><MoreVertical className="h-4 w-4" aria-hidden="true" /></button>
                    {openActionMenu === row.id && <div role="menu" className="absolute right-0 top-full z-30 mt-1 min-w-[9rem] rounded-btn border border-brand-border bg-white p-1 shadow-lg">
                      {(!supervisor || canViewProfile) && <button type="button" role="menuitem" onClick={() => { setOpenActionMenu(null); openView(row); }} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm text-brand-ink hover:bg-brand-bg"><Eye className="h-4 w-4 text-brand-blue" /> View Details</button>}
                      {canEdit && <button type="button" role="menuitem" onClick={() => { setOpenActionMenu(null); openEdit(row); }} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm text-brand-ink hover:bg-brand-bg"><Pencil className="h-4 w-4 text-brand-gray" /> Edit Resident</button>}
                    </div>}
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div><dt className="text-brand-gray">Barangay</dt><dd className="truncate font-medium text-brand-ink">{row.barangay || "—"}</dd></div>
                  <div><dt className="text-brand-gray">Health Record No.</dt><dd className="truncate font-medium text-brand-ink">{row.healthRecordNo || "—"}</dd></div>
                  <div><dt className="text-brand-gray">Risk</dt><dd><RiskBadge level={row.riskLevel} /></dd></div>
                  <div><dt className="text-brand-gray">Verification</dt><dd><StatusBadge value={row.status} /></dd></div>
                  <div><dt className="text-brand-gray">Account</dt><dd><AccountStatusPill status={row.accountStatus} /></dd></div>
                </dl>
              </article>
            ))}
          </div>
          <TablePagination total={visibleRows.length} page={directoryPage} pageSize={directoryPageSize} onPageChange={setDirectoryPage} onPageSizeChange={(size) => { setDirectoryPageSize(size); setDirectoryPage(1); }} className="mt-4" />
          <p className={supervisor ? "mt-2 text-caption text-brand-gray" : "mt-4 text-sm text-brand-gray"}>
            {supervisor ? `Showing ${visibleRows.length} of ${rows.length} loaded residents. The directory loads up to 100 server records per search; risk filters do not represent barangay totals.` : rows.length === 0
              ? "No residents found."
              : `Showing ${rows.length} resident${rows.length === 1 ? "" : "s"}${
                  q.trim() ? ` matching “${q.trim()}”` : ""
                }`}
          </p>
        </>
      )}

      {/* Add Resident Modal */}
      {showAddModal && canCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-2xl max-h-[90vh] bg-white rounded-card shadow-xl flex flex-col overflow-hidden">
            {/* Fixed Header with blue accent */}
            <div className="flex-shrink-0 border-b-2 border-brand-blue bg-white px-6 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-brand-ink">Add Resident</h3>
                  <p className="text-sm text-brand-gray mt-0.5">Register a new resident in the directory.</p>
                </div>
                <button onClick={closeAdd} className="text-brand-gray hover:text-brand-blue transition-colors" aria-label="Close resident registration">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto">
              <div className="px-6 py-6 space-y-6">
                {formError && (
                  <div className="rounded-card border border-brand-danger/30 bg-brand-danger/5 px-4 py-3 text-sm text-brand-danger">
                    {formError}
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
                    <Field label="First Name" value={form.firstName} onChange={set("firstName")} placeholder="e.g. Maria" error={errors.firstName} />
                    <Field label="Middle Name" value={form.middleName} onChange={set("middleName")} placeholder="e.g. Santos" optional />
                    <Field label="Last Name" value={form.lastName} onChange={set("lastName")} placeholder="e.g. Dela Cruz" error={errors.lastName} />
                    <Select label="Suffix" value={form.suffix} onChange={set("suffix")} options={SUFFIX_OPTIONS.filter(Boolean)} placeholder="None" />
                    <Field label="Date of Birth" type="date" value={form.dob} onChange={onDobChange} error={errors.dob} />
                    <Field label="Age" value={form.age} onChange={() => {}} placeholder="Auto-calculated" readOnly optional />
                    <div>
                      <label className={labelClass}>Sex</label>
                      <ButtonSelectGroup name="sex" ariaLabel="Sex" options={SEX_OPTIONS} value={form.gender} onChange={set("gender")} error={Boolean(errors.gender)} />
                      {errors.gender && <p className={errorClass}>{errors.gender}</p>}
                    </div>
                    <Select label="Civil Status" value={form.civilStatus} onChange={set("civilStatus")} options={CIVIL_STATUS_OPTIONS} placeholder="Select civil status" />
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
                    <Field label="Contact Number" value={form.contact} onChange={onContactChange} placeholder="e.g. 09171234567" error={errors.contact} optional maxLength={11} />
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
                </div>

                {/* Optional resident login account. A resident profile never
                    requires an account; the health worker chooses whether to
                    create one. When Yes, the account is created in Pending
                    Activation and the resident sets their own password later. */}
                {showLoginAccountOption && (
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
                            !form.createAccount 
                              ? "bg-brand-blue text-white" 
                              : "border border-brand-border bg-white text-brand-ink hover:bg-brand-bg"
                          }`}
                        >
                          No
                        </button>
                        <button
                          type="button"
                          onClick={() => set("createAccount")(true)}
                          disabled={!canCreateLoginAccountForResident}
                          className={`rounded-btn px-4 py-2 text-sm font-medium transition-colors ${
                            form.createAccount
                              ? "bg-brand-blue text-white"
                              : "border border-brand-border bg-white text-brand-ink hover:bg-brand-bg"
                          } disabled:cursor-not-allowed disabled:opacity-50 ${
                            !canCreateLoginAccountForResident ? "hover:bg-white" : ""
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
                          <p className="mt-2 text-xs text-brand-gray">
                            The account starts in Pending Activation. An invitation link is emailed to this address — the resident clicks it to set their own password and activate the account.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Fixed Footer */}
            <div className="flex-shrink-0 border-t border-brand-border bg-brand-bg px-6 py-4">
              <div className="flex justify-end gap-3">
                <button onClick={closeAdd} className="px-4 py-2 rounded-btn text-sm font-medium text-brand-gray bg-white border border-brand-border hover:bg-brand-light transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="px-4 py-2 rounded-btn text-sm font-medium bg-brand-blue text-white hover:bg-brand-dark transition-colors disabled:opacity-60"
                >
                  {submitting ? "Saving..." : "Add Resident"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* View Resident Modal */}
      {showViewModal && selected && selectedOwner === user?.id && (!supervisor || (canViewProfile && assignedBarangay)) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card role="dialog" aria-modal="true" aria-label="Resident Profile" className={`w-full max-w-2xl max-h-[90vh] overflow-y-auto ${supervisor ? "supervisor-modal" : ""}`}>
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
                <button onClick={closeView} className="text-brand-gray hover:text-brand-ink" aria-label="Close resident profile">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-4">
                <p className="text-xs font-semibold text-brand-gray uppercase tracking-wide mb-3">Demographics</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {detailCell("Age", selected.age)}
                  {selected.age !== "" && Number(selected.age) < 18 && detailCell("Age Category", "Minor — under 18")}
                  {detailCell("Sex", selected.sex || selected.gender)}
                  {detailCell("Civil Status", selected.civilStatus)}
                  {detailCell("Birthdate", selected.birthDate)}
                  {detailCell("Barangay", selected.barangay)}
                  {detailCell("Contact Number", selected.cellphoneNo)}
                  {selected.age !== "" && Number(selected.age) < 18 && detailCell("Parent / Guardian Link", selected.guardianStatus || "Skipped")}
                  {detailCell("Address", selected.currentAddress)}
                  {detailCell("PhilHealth No.", selected.philhealthNo)}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-4">
                <p className="text-xs font-semibold text-brand-gray uppercase tracking-wide mb-3">Record Information</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div>
                    <p className="text-[11px] text-brand-gray uppercase tracking-wide">Resident ID</p>
                    <p className="mt-0.5 text-sm font-medium text-brand-ink font-stat">{selected.id || "—"}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-brand-gray">
                      Internal master-record ID. A resident self-registering gives this to link their account.
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-brand-gray uppercase tracking-wide">Health Record No.</p>
                    <p className="mt-0.5 text-sm font-medium text-brand-ink font-stat">{selected.healthRecordNo || "—"}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-brand-gray">
                      Clinical chart number used across consultations and referrals.
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-brand-gray uppercase tracking-wide">Verification Status</p>
                    <div className="mt-1"><StatusBadge value={selected.status} /></div>
                  </div>
                  <div>
                    <p className="text-[11px] text-brand-gray uppercase tracking-wide">Registered</p>
                    <p className="mt-0.5 text-sm font-medium text-brand-ink">
                      {selected.createdAt ? new Date(selected.createdAt).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric" }) : "—"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Account Linking — the actual, persisted link between this
                  resident record and a Supabase Auth login account. Verification
                  Status (clinical review) and Account Linking (login) are kept
                  separate on purpose: linking a login never verifies a resident,
                  and verifying a resident never creates a login. */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-6">
                <p className="text-xs font-semibold text-brand-gray uppercase tracking-wide mb-3">Account Linking</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div>
                    <p className="text-[11px] text-brand-gray uppercase tracking-wide">Linking State</p>
                    <div className="mt-1"><LinkingStatePill resident={selected} /></div>
                  </div>
                  <div>
                    <p className="text-[11px] text-brand-gray uppercase tracking-wide">Account Status</p>
                    <div className="mt-1"><AccountStatusPill status={selected.accountStatus} /></div>
                  </div>
                </div>
                <p className="mt-3 text-[11px] leading-snug text-brand-gray">
                  {linkingStateOf(selected).key === "not_linked"
                    ? "No login account is linked to this record. The resident can self-register and link using their Resident ID, or you can invite a login below."
                    : linkingStateOf(selected).key === "linked"
                      ? "A login account is linked and active. The resident can sign in and view their own health record."
                      : linkingStateOf(selected).key === "disabled"
                        ? "The linked login account has been disabled by an administrator."
                        : "A login account is linked but not yet active — awaiting the resident to accept the invitation and set a password."}
                </p>

                {canCreateLoginAccount && linkingStateOf(selected).key === "not_linked" && (
                  <div className="mt-4 border-t border-brand-border pt-4">
                    {!linkPanelOpen ? (
                      <button
                        type="button"
                        onClick={() => { setLinkPanelOpen(true); setLinkError(null); }}
                        className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
                      >
                        <Plus className="h-4 w-4" /> Create login account
                      </button>
                    ) : (
                      <div>
                        <label className={labelClass}>Email for login account</label>
                        <input
                          type="email"
                          value={linkEmail}
                          placeholder="e.g. resident@example.com"
                          onChange={(e) => { setLinkEmail(e.target.value); if (linkError) setLinkError(null); }}
                          aria-label="Email for login account"
                          className={inputClass(linkError || "")}
                        />
                        {linkError && <p className={errorClass}>{linkError}</p>}
                        <p className="mt-1 text-[11px] leading-snug text-brand-gray">
                          An invitation link is emailed to this address. The resident sets their own password to
                          activate the account. This links the login to the existing Resident ID and does not change
                          the verification status.
                        </p>
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={() => { setLinkPanelOpen(false); setLinkEmail(""); setLinkError(null); }}
                            className="rounded-btn px-4 py-2 text-sm font-medium text-brand-gray transition-colors hover:bg-brand-bg"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={handleCreateAccount}
                            disabled={linkSubmitting}
                            className="rounded-btn bg-brand-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
                          >
                            {linkSubmitting ? "Sending invitation..." : "Send invitation"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
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
                      {selected.riskAssessedAt ? new Date(selected.riskAssessedAt).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric" }) : "—"}
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
                  onClick={closeView}
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
      {showEditModal && editTarget && canEdit && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card role="dialog" aria-modal="true" aria-label="Edit Resident" className={`w-full max-w-2xl max-h-[90vh] overflow-y-auto ${supervisor ? "supervisor-modal supervisor-form" : ""}`}>
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
                <Field label="Contact Number" value={editForm.contact} onChange={(v) => { const digitsOnly = v.replace(/\D/g, ''); const truncated = digitsOnly.slice(0, 11); setEditForm((p) => ({ ...p, contact: truncated })); if (editErrors.contact) setEditErrors((p) => ({ ...p, contact: "" })); }} placeholder="e.g. 09171234567" error={editErrors.contact} optional maxLength={11} />
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
    </div>
  );
}

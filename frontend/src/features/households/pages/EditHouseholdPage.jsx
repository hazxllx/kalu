import React, { createContext, useContext, useId, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, RotateCcw, ChevronDown } from 'lucide-react';
import { Card } from '@/components/common/Card';
import { useAuth } from '@/context/AuthContext';
import { usePermissions } from '@/context/PermissionsContext';
import PageHeader from '@/components/common/PageHeader';
import HouseholdFeedback from '../components/HouseholdFeedback';
import { validateHouseholdField, householdFieldErrors, safeHouseholdError } from '../lib/householdFeedback';
import { householdsApi } from '@/services/api/householdsApi';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { getHouseholdOffline, updateHouseholdOffline } from '@/services/offline/householdOfflineService';
import {
  WATER_SOURCES, WATER_TYPES, WATER_DISTANCES, WATER_AVAILABILITY,
  TREATMENT_METHODS, TOILET_TYPES, SANITATION_ACCESS, WASTE_DISPOSAL,
  PHILHEALTH_CATEGORIES,
  PUROKS,
  RELATIONSHIPS,
  SEX_OPTIONS,
  CLASSIFICATIONS,
  MEMBER_PHILHEALTH,
  FP_METHODS,
  QUARTER_STATUSES,
} from '../lib/householdOptions';

const newVisitRequestId = () => globalThis.crypto?.randomUUID?.()
  || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
const todayLocal = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};

const SECTIONS = [
  { id: 'household', title: 'Household Information', fields: [
    ['headName', 'Household head name'], ['purok', 'Zone / Purok', 'select', PUROKS], ['streetAddress', 'Street address / sitio'], ['contact', 'Contact number', 'tel'],
  ] },
  { id: 'details', title: 'Household Details', fields: [
    ['families', 'Number of families', 'number'], ['monthlyIncome', 'Monthly income', 'number'],
  ] },
  { id: 'respondent', title: 'Respondent Information', fields: [
    ['respondentFirst', 'First name'], ['respondentLast', 'Last name'], ['respondentMaiden', "Mother's maiden name"],
  ] },
  { id: 'philhealth', title: 'HH Head PhilHealth Information', fields: [
    ['nhts', 'NHTS status'], ['ip', 'Indigenous People status'], ['philhealthMember', 'PhilHealth member?', 'boolean'],
    ['philhealthId', 'PhilHealth ID'], ['philhealthCategory', 'PhilHealth category', 'select', PHILHEALTH_CATEGORIES],
  ] },
  { id: 'water', title: 'Water Source and Sanitation Details', fields: [
    ['waterSource', 'Primary water source', 'selectObjects', WATER_SOURCES], ['waterType', 'Water source type', 'select', WATER_TYPES],
    ['waterDistance', 'Distance to water source', 'select', WATER_DISTANCES], ['waterAvailability', 'Water availability', 'select', WATER_AVAILABILITY],
    ['waterTreated', 'Water treatment practiced?', 'boolean'], ['treatmentMethods', 'Treatment methods', 'multi', TREATMENT_METHODS],
    ['toiletType', 'Toilet facility', 'selectObjects', TOILET_TYPES], ['sanitationAccess', 'Sanitation facility access', 'select', SANITATION_ACCESS],
    ['wasteDisposal', 'Waste disposal method', 'select', WASTE_DISPOSAL], ['wasteSegregation', 'Waste segregation practiced?', 'boolean'],
  ] },
];

const MEMBER_FIELDS = [
  ['name', 'Name'], ['relationship', 'Relationship', 'select', RELATIONSHIPS], ['sex', 'Sex', 'select', SEX_OPTIONS], ['birthday', 'Birth date', 'date'],
  ['age', 'Age', 'number'], ['classification', 'Classification', 'selectObjects', CLASSIFICATIONS], ['contact', 'Contact', 'tel'],
  ['isPwd', 'Person with disability?', 'boolean'], ['philhealth', 'Member PhilHealth', 'buttons', MEMBER_PHILHEALTH],
  ['fpMethod', 'Family planning method', 'select', FP_METHODS], ['quarterStatus', 'Quarter status', 'select', QUARTER_STATUSES],
];
const MEMBER_SECTION = 'Household Members';
const VISIT_REASONS = ['Follow-up', 'Updating Household Information', 'Verification', 'Monitoring', 'Other'];
const LEGACY_FIELDS = [
  ['headName', 'Household head', 'text'], ['purok', 'Purok / zone', 'text'],
  ['streetAddress', 'Street address / sitio', 'text'], ['contact', 'Contact number', 'tel'],
  ['families', 'Number of families', 'number'], ['monthlyIncome', 'Monthly income', 'number'],
];

const displayValue = (value) => Array.isArray(value) ? value.join(', ') : value ?? '';
const ageFromBirthday = (value) => {
  if (!value) return '';
  const birthDate = new Date(`${value}T00:00:00`);
  if (Number.isNaN(birthDate.getTime())) return '';
  const now = new Date();
  let age = now.getFullYear() - birthDate.getFullYear();
  if (now.getMonth() < birthDate.getMonth()
    || (now.getMonth() === birthDate.getMonth() && now.getDate() < birthDate.getDate())) age -= 1;
  return age >= 0 ? age : '';
};

const FeedbackContext = createContext(null);
const FIELD_NAMES = Object.fromEntries([...SECTIONS.flatMap((section) => section.fields), ...MEMBER_FIELDS, ...LEGACY_FIELDS].map(([field, label]) => [label, field]));
Object.assign(FIELD_NAMES, { 'Full name': 'name', 'Relationship to household head': 'relationship', 'Contact number': 'contact', PhilHealth: 'philhealth', 'Visit date': 'visitDate', 'Visit reason': 'visitReason' });
function Field({ field, scope = 'household', ...props }) {
  const context = useContext(FeedbackContext);
  const id = useId();
  const [touched, setTouched] = useState(false);
  const name = field || FIELD_NAMES[props.label];
  const key = `${scope}.${name}`;
  const error = context?.errors[key] || '';
  const validate = (value) => validateHouseholdField(name, value, { member: scope !== 'household' && scope !== 'visit', adding: scope === 'newMember' });
  return <div className={`min-w-0 ${error ? '[&_input]:border-red-400 [&_select]:border-red-400 [&_textarea]:border-red-400 [&_fieldset]:rounded [&_fieldset]:ring-1 [&_fieldset]:ring-red-300' : ''}`}
    onFocus={() => context?.clearNotice()}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) { setTouched(true); if (!error) context?.setFieldError(key, validate(props.value)); } }}>
    <InputField {...props} controlProps={{ 'aria-invalid': Boolean(error), 'aria-describedby': error ? id : undefined, disabled: context?.pending }}
      onChange={(value) => { props.onChange(value); if (touched || error) context?.setFieldError(key, validate(value)); }} />
    {error && <p id={id} className="mt-1 text-xs leading-5 text-red-700">{error}</p>}
  </div>;
}

function InputField({ label, type = 'text', value, options = [], onChange, controlProps = {} }) {
  if (type === 'boolean') {
    const checked = value === true || ['true', 'yes', '1'].includes(String(value ?? '').trim().toLowerCase());
    return <label className="flex items-center gap-2 rounded-lg border border-brand-border px-3 py-2.5 text-sm text-brand-ink">
      <input {...controlProps} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-brand-blue" />
      {label}
    </label>;
  }
  if (type === 'buttons') {
    return <fieldset className="min-w-0"><legend className="mb-1.5 text-sm font-medium text-brand-ink">{label}</legend>
      <div className="flex flex-wrap gap-2">{options.map((option) => (
        <button {...controlProps} key={option.value} type="button" aria-pressed={value === option.value}
          onClick={() => onChange(value === option.value ? '' : option.value)}
          className={`min-h-11 rounded-btn border px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue ${value === option.value ? 'border-brand-blue bg-brand-blue text-white' : 'border-brand-border bg-white text-brand-ink hover:bg-brand-bg'}`}>
          {option.label}
        </button>
      ))}</div>
    </fieldset>;
  }
  if (type === 'multi') {
    const selected = Array.isArray(value) ? value : [];
    return <fieldset className="space-y-2"><legend className="text-sm font-medium text-brand-ink">{label}</legend>
      <div className="flex flex-wrap gap-3">{options.map((option) => <label key={option} className="flex items-center gap-1.5 text-sm text-brand-gray">
        <input {...controlProps} type="checkbox" checked={selected.includes(option)} onChange={() => onChange(selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option])} className="h-4 w-4 accent-brand-blue" />{option}
      </label>)}</div>
    </fieldset>;
  }
  const selectOptions = type === 'selectObjects' ? options.map((option) => ({ value: option.value, label: option.label })) : options.map((option) => ({ value: option, label: option }));
  return <label className="block space-y-1.5 text-sm font-medium text-brand-ink">
    {label}
    {type === 'select' || type === 'selectObjects' ? <select {...controlProps} value={value ?? ''} onChange={(event) => onChange(event.target.value)} className="w-full rounded-input border border-brand-border bg-white px-3 py-2.5 font-normal outline-none focus:border-brand-blue">
      <option value="">Select…</option>{selectOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select> : <input {...controlProps} type={type} min={type === 'number' ? 0 : undefined} value={displayValue(value)} onChange={(event) => onChange(type === 'number' ? (event.target.value === '' ? '' : Number(event.target.value)) : event.target.value)} className="w-full rounded-input border border-brand-border bg-white px-3 py-2.5 font-normal outline-none focus:border-brand-blue" />}
  </label>;
}

export default function EditHouseholdPage() {
  const { householdId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { canAny } = usePermissions();
  const syncStatus = useSyncStatus();
  const householdsPath = useMemo(() => {
    const parts = window.location.pathname.split('/').filter(Boolean);
    const index = parts.indexOf('households');
    return index < 0 ? window.location.pathname : `/${parts.slice(0, index + 1).join('/')}`;
  }, []);
  const [form, setForm] = useState(null);
  const [savedForm, setSavedForm] = useState(null);
  const [members, setMembers] = useState([]);
  const [savedMembers, setSavedMembers] = useState([]);
  const [revision, setRevision] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingSection, setSavingSection] = useState('');
  const [collapsedSections, setCollapsedSections] = useState(() => new Set(SECTIONS.slice(1).map((section) => section.id)));
  const [savingMember, setSavingMember] = useState('');
  const [collapsedMembers, setCollapsedMembers] = useState(() => new Set());
  const [showAddMember, setShowAddMember] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [newMember, setNewMember] = useState({
    name: '', relationship: '', sex: '', birthday: '', age: '', classification: '',
    contact: '', isPwd: false, philhealth: '', fpMethod: '', quarterStatus: '',
  });
  const [residentSearch, setResidentSearch] = useState({ query: '', rows: [], loading: false, searched: false, error: '' });
  const [linkedResidentId, setLinkedResidentId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [noticeTone, setNoticeTone] = useState('success');
  const [feedbackScope, setFeedbackScope] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const submitLock = useRef(false);
  const dismissNotice = useCallback(() => setNotice(''), []);
  const setFieldError = (key, message) => {
    setFieldErrors((current) => ({ ...current, [key]: message }));
    if (!message && error === 'Check the highlighted fields.' && !Object.entries(fieldErrors).some(([field, value]) => field !== key && value)) setError('');
  };
  const validateFields = (scope, fields, values) => {
    const errors = Object.fromEntries(fields.map(([field]) => [field, validateHouseholdField(field, values[field], { member: scope.startsWith('member') || scope === 'newMember', adding: scope === 'newMember' })]).filter(([, message]) => message));
    setFieldErrors((current) => ({ ...Object.fromEntries(Object.entries(current).filter(([key]) => !fields.some(([field]) => key === `${scope}.${field}`))), ...Object.fromEntries(Object.entries(errors).map(([key, value]) => [`${scope}.${key}`, value])) }));
    if (Object.keys(errors).length) { setError('Check the highlighted fields.'); return false; }
    return true;
  };
  const clearFieldFeedback = (scope, fields) => {
    setFieldErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !fields.some(([field]) => key === `${scope}.${field}`))));
    setError(''); setNotice('');
  };
  const beginFeedback = (scope) => { setFeedbackScope(scope); setError(''); setNotice(''); setNoticeTone('success'); };
  const fail = (failure, scope, fields) => {
    const errors = householdFieldErrors(failure);
    const known = new Set(fields.map(([field]) => field));
    const mapped = Object.entries(errors).filter(([field]) => known.has(field));
    setFieldErrors((current) => ({ ...current, ...Object.fromEntries(mapped.map(([key, value]) => [`${scope}.${key}`, value])) }));
    setError(mapped.length ? 'Check the highlighted fields.' : safeHouseholdError(failure));
  };
  const feedback = (scope) => feedbackScope === scope && (error || notice) ? <div className="my-2 space-y-2"><HouseholdFeedback message={error} tone="error" /><HouseholdFeedback message={notice} tone={noticeTone} onDismiss={dismissNotice} /></div> : null;

  const [visitDate, setVisitDate] = useState(todayLocal());
  const [visitReason, setVisitReason] = useState('Follow-up');
  const [recordingVisit, setRecordingVisit] = useState(false);
  const visitRequestId = useRef(newVisitRequestId());

  useEffect(() => {
    let active = true;
    getHouseholdOffline({ ownerId: user?.id, householdId })
      .then((household) => {
        if (!active) return;
        setForm({ ...household });
        setSavedForm({ ...household });
        setMembers((household.members || []).map((member) => ({ ...member })));
        setCollapsedMembers(new Set((household.members || []).map((member) => member.id)));
        setSavedMembers((household.members || []).map((member) => ({ ...member })));
        setRevision(household.revision ?? null);
      })
      .catch((loadError) => { if (active) setError(safeHouseholdError(loadError, 'Could not load this household.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [householdId, user?.id]);

  useEffect(() => {
    const query = residentSearch.query.trim();
    if (!showAddMember || linkedResidentId || query.length < 2) {
      setResidentSearch((current) => ({ ...current, rows: [], loading: false, searched: false, error: '' }));
      return undefined;
    }
    let active = true;
    const timer = setTimeout(() => {
      setResidentSearch((current) => ({ ...current, loading: true, error: '' }));
      householdsApi.searchResidents(query)
        .then((response) => {
          if (!active) return;
          const rows = Array.isArray(response) ? response : response?.rows || [];
          setResidentSearch((current) => ({ ...current, rows, loading: false, searched: true }));
        })
        .catch((searchError) => {
          if (!active) return;
          setResidentSearch((current) => ({
            ...current, rows: [], loading: false, searched: true,
            error: safeHouseholdError(searchError, 'Could not search existing residents.'),
          }));
        });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [linkedResidentId, residentSearch.query, showAddMember]);

  const updateField = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const saveVisitHistory = async (updatedSections, reason = 'Updating Household Information') => {
    if (user?.role !== 'bhw') return null;
    return householdsApi.createVisit(householdId, {
      visitDate,
      requestId: newVisitRequestId(),
      visitReason: reason,
      updatedSections,
    });
  };

  const saveSection = async (section) => {
    if (submitLock.current) return;
    beginFeedback(section.id);
    if (!validateFields('household', section.fields, form)) {
      setCollapsedSections((current) => { const next = new Set(current); next.delete(section.id); return next; });
      return;
    }

    if (!canAny(['households.create', 'households.verify'])) return setError('You do not have permission to edit this household.');
    const patch = Object.fromEntries(section.fields.map(([field]) => [field, form[field] ?? (field === 'treatmentMethods' ? [] : '')]));
    if (patch.families !== undefined && patch.families !== '') patch.families = Number(patch.families);
    if (patch.monthlyIncome === '') patch.monthlyIncome = null;
    submitLock.current = true;
    setSavingSection(section.id); setError(''); setNotice('');
    try {
      const result = await updateHouseholdOffline({ ownerId: user?.id, serverId: householdId, payload: patch, baseRevision: revision });
      setRevision(result?.household?.revision ?? revision);
      const savedValues = Object.fromEntries(section.fields.map(([field]) => [field, result.household?.[field] ?? patch[field]]));
      setForm((current) => ({ ...current, ...savedValues }));
      setSavedForm((current) => ({ ...current, ...savedValues }));
      if (result.queued) {
        setNoticeTone('warning'); setNotice('Saved on this device. Waiting to sync.');
        return;
      }
      let historyNotice = '';
      try { await saveVisitHistory([section.title]); }
      catch { historyNotice = 'Profile saved; visit history was not recorded.'; }
      setNoticeTone(historyNotice ? 'warning' : 'success');
      setNotice(historyNotice || 'Changes saved.');
      setCollapsedSections((current) => new Set(current).add(section.id));
    } catch (saveError) {
      fail(saveError, 'household', section.fields);
      setCollapsedSections((current) => { const next = new Set(current); next.delete(section.id); return next; });
    }
    finally { submitLock.current = false; setSavingSection(''); }
  };

  const saveMember = async (member) => {
    if (submitLock.current) return;
    beginFeedback(`member-${member.id}`);
    if (!validateFields(`member-${member.id}`, MEMBER_FIELDS, member)) return;
    submitLock.current = true;

    setSavingMember(member.id); setError(''); setNotice('');
    try {
      const response = await householdsApi.updateMember(householdId, member.id, member);
      const updatedMember = { ...member, ...(response?.member || {}) };
      setMembers((current) => current.map((item) => item.id === member.id ? updatedMember : item));
      setSavedMembers((current) => current.map((item) => item.id === member.id ? updatedMember : item));
      let historyNotice = '';
      try { await saveVisitHistory([MEMBER_SECTION]); }
      catch { historyNotice = 'Member saved; visit history was not recorded.'; }
      setNoticeTone(historyNotice ? 'warning' : 'success');
      setNotice(historyNotice || 'Member saved.');
      setCollapsedMembers((current) => new Set(current).add(member.id));
    } catch (saveError) { fail(saveError, `member-${member.id}`, MEMBER_FIELDS); }
    finally { submitLock.current = false; setSavingMember(''); }
  };

  const chooseResident = (resident) => {
    const name = [resident.firstName, resident.middleName, resident.lastName, resident.suffix]
      .filter(Boolean).join(' ');
    const age = ageFromBirthday(resident.birthDate || '');
    clearFieldFeedback('newMember', MEMBER_FIELDS.filter(([field]) => ['name', 'birthday', 'age', 'sex', 'contact', 'philhealth'].includes(field)));
    setLinkedResidentId(resident.residentId || resident.id);
    setNewMember((current) => ({
      ...current,
      name,
      birthday: resident.birthDate || '',
      age,
      sex: resident.sex || '',
      contact: resident.cellphoneNo || '',
      philhealth: resident.philhealthNo ? 'member' : '',
    }));
    setResidentSearch((current) => ({ ...current, query: name, rows: [], searched: false, error: '' }));
  };

  const resetNewMember = () => {
    clearFieldFeedback('newMember', MEMBER_FIELDS);
    setNewMember({ name: '', relationship: '', sex: '', birthday: '', age: '', classification: '', contact: '', isPwd: false, philhealth: '', fpMethod: '', quarterStatus: '' });
    setLinkedResidentId('');
    setResidentSearch({ query: '', rows: [], loading: false, searched: false, error: '' });
  };

  const addMember = async () => {
    if (submitLock.current) return;
    beginFeedback('newMember');
    if (!canAny(['households.create', 'households.verify'])) return setError('You do not have permission to add household members.');
    if (!validateFields('newMember', MEMBER_FIELDS, newMember)) return;
    submitLock.current = true;
    setAddingMember(true); setError(''); setNotice('');
    try {
      const response = await householdsApi.addMember(householdId, {
        ...newMember,
        name: newMember.name.trim(),
        age: newMember.age === '' ? null : Number(newMember.age),
        residentId: linkedResidentId || undefined,
      });
      let refreshWarning = '';
      const household = response?.household;
      if (household?.members) {
        setMembers(household.members.map((member) => ({ ...member })));
        setSavedMembers(household.members.map((member) => ({ ...member })));
      } else {
        try {
        const result = await householdsApi.get(householdId);
        const refreshed = result?.household?.members || [];
        setMembers(refreshed.map((member) => ({ ...member })));
        setSavedMembers(refreshed.map((member) => ({ ...member })));
        } catch { refreshWarning = 'Member added. Reload to see the updated roster.'; }
      }
      setShowAddMember(false);
      resetNewMember();
      let historyNotice = '';
      try { await saveVisitHistory([MEMBER_SECTION]); }
      catch { historyNotice = 'Member added; visit history was not recorded.'; }
      setNoticeTone(historyNotice || refreshWarning ? 'warning' : 'success');
      setNotice([refreshWarning, historyNotice].filter(Boolean).join(' ') || 'Member added.');
    } catch (addError) {
      fail(addError, 'newMember', MEMBER_FIELDS);
    } finally {
      submitLock.current = false;
      setAddingMember(false);
    }
  };

  const recordVisit = async () => {
    if (submitLock.current) return;
    beginFeedback('visit');
    if (!validateFields('visit', [['visitDate'], ['visitReason']], { visitDate, visitReason })) return;
    submitLock.current = true;
    setError(''); setNotice('');
    setRecordingVisit(true);
    try {
      await householdsApi.createVisit(householdId, { visitDate, requestId: visitRequestId.current, visitReason, updatedSections: [] });
      visitRequestId.current = newVisitRequestId();
      setNotice('Visit recorded.');
    } catch (visitError) { fail(visitError, 'visit', [['visitDate'], ['visitReason']]); }
    finally { submitLock.current = false; setRecordingVisit(false); }
  };

  const sectionChangesPending = Boolean(form) && SECTIONS.some((section) => section.fields.some(([field]) =>
    JSON.stringify(form[field] ?? null) !== JSON.stringify(savedForm?.[field] ?? null)));
  const memberChangesPending = members.some((member) => {
    const saved = savedMembers.find((item) => item.id === member.id);
    return MEMBER_FIELDS.some(([field]) => JSON.stringify(member[field] ?? null) !== JSON.stringify(saved?.[field] ?? null));
  });
  const resubmitHousehold = async () => {
    if (submitLock.current) return;
    beginFeedback('resubmit');
    if (user?.role !== 'bhw' || form?.verificationStatus !== 'Returned for Correction' || savingSection || savingMember || sectionChangesPending || memberChangesPending) return;
    if (!window.confirm('Resubmit this corrected household profile to the Health Supervisor for verification?')) return;
    submitLock.current = true;
    setError(''); setNotice(''); setSavingSection('resubmit');
    try {
      const result = await updateHouseholdOffline({ ownerId: user?.id, serverId: householdId, payload: { hhStatus: 'Submitted' }, baseRevision: revision });
      const updated = result?.household || {};
      setRevision(updated.revision ?? revision);
      setForm((current) => ({ ...current, ...updated }));
      setSavedForm((current) => ({ ...current, ...updated }));
      setNoticeTone(result?.queued ? 'warning' : 'success');
      setNotice(result?.queued
        ? 'Correction saved on this device and queued for verification submission. It will sync when a connection is available.'
        : 'Corrected household profile resubmitted for verification.');
    } catch (submitError) {
      setError(safeHouseholdError(submitError, 'Could not resubmit the household profile.'));
    } finally {
      submitLock.current = false;
      setSavingSection('');
    }
  };

  const saveLegacy = async (event) => {
    event.preventDefault();
    if (submitLock.current) return;
    beginFeedback('legacy');
    if (!validateFields('household', LEGACY_FIELDS, form)) return;
    if (!canAny(['households.create', 'households.verify'])) return setError('You do not have permission to edit this household.');
    submitLock.current = true;
    setSavingSection('legacy'); setError('');
    try {
      const payload = Object.fromEntries(LEGACY_FIELDS.map(([field]) => [field, form[field] ?? '']));
      payload.families = Number(payload.families);
      payload.monthlyIncome = payload.monthlyIncome === '' ? null : Number(payload.monthlyIncome);
      const result = await updateHouseholdOffline({ ownerId: user?.id, serverId: householdId, payload, baseRevision: revision });
      if (result.queued) { setNoticeTone('warning'); setNotice('Saved on this device. Waiting to sync.'); return; }
      navigate(householdsPath, { replace: true, state: { hhToast: `Household ${householdId} updated successfully` } });
    } catch (saveError) { fail(saveError, 'household', LEGACY_FIELDS); }
    finally { submitLock.current = false; setSavingSection(''); }
  };

  if (loading) return <Card className="p-6 text-sm text-brand-gray">Loading household…</Card>;
  if (!form) return <Card className="space-y-4 p-6"><p role="alert" className="text-sm text-red-700">{error || 'Household not found.'}</p><button type="button" onClick={() => navigate(householdsPath)} className="text-sm text-brand-blue">Back to households</button></Card>;

  if (user?.role !== 'bhw') return <FeedbackContext.Provider value={{ errors: fieldErrors, setFieldError, clearNotice: dismissNotice, pending: Boolean(savingSection || savingMember || addingMember || recordingVisit) }}><div className="mx-auto w-full max-w-6xl space-y-4 [overflow-wrap:anywhere]">
    <PageHeader
      dense
      action={<button type="button" onClick={() => navigate(householdsPath)} className="inline-flex min-h-11 items-center gap-2 rounded px-2 text-xs font-medium text-white/90 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to households</button>}
      title="Household Profile" subtitle="Review and update the household's registered information." meta={<span className="text-xs text-white/75">Household {householdId}</span>} />
    <Card className="p-5 sm:p-7"><form noValidate onSubmit={saveLegacy} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">{LEGACY_FIELDS.map(([field, label, type]) => <Field key={field} field={field} label={label} type={type} value={form[field] ?? ''} onChange={(value) => updateField(field, value)} />)}</div>
      <p className="text-xs text-brand-gray">Household members, verification, approval, status, scope, and audit fields are not changed by this editor.</p>
      {feedback('legacy')}
      <div className="flex justify-end"><button type="submit" disabled={savingSection === 'legacy'} className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"><Save className="h-4 w-4" />{savingSection === 'legacy' ? 'Saving…' : 'Save changes'}</button></div>
    </form></Card>
  </div></FeedbackContext.Provider>;

  return <FeedbackContext.Provider value={{ errors: fieldErrors, setFieldError, clearNotice: dismissNotice, pending: Boolean(savingSection || savingMember || addingMember || recordingVisit) }}><div onFocusCapture={(event) => { const scope = event.target.closest('[data-feedback-scope]')?.dataset.feedbackScope; if (scope && scope !== feedbackScope) setNotice(''); }} className="mx-auto w-full max-w-6xl space-y-4 [overflow-wrap:anywhere] [&_input]:max-w-full [&_select]:max-w-full">
    <PageHeader
      dense
      action={<button type="button" onClick={() => navigate(householdsPath)} className="inline-flex min-h-11 items-center gap-2 rounded px-2 text-xs font-medium text-white/90 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to households</button>}
      title="Household Profile" subtitle="Review and update the household's registered information." meta={<span className="text-xs text-white/75">{`Household ${householdId}${syncStatus.online ? '' : ' · Working offline'}`}</span>} />
    {feedbackScope === '' && error && <HouseholdFeedback message={error} tone="error" />}
    {feedback('resubmit')}
    {user?.role === 'bhw' && form.verificationStatus === 'Returned for Correction' && <Card className="border-amber-300 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-500/10 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-amber-950 dark:text-amber-200">Returned for correction</h2>
          <p className="mt-1 text-sm text-amber-900 dark:text-amber-100">{form.correctionReason || 'The Health Supervisor requested an update to this household profile.'}</p>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">Returned by {form.verifiedBy || 'Health Supervisor'}{form.verifiedAt ? ` · ${new Date(form.verifiedAt).toLocaleString()}` : ''}</p>
          {(sectionChangesPending || memberChangesPending) && <p className="mt-2 text-xs font-medium text-amber-900 dark:text-amber-100">Save all profile and member changes before resubmitting.</p>}
        </div>
        <button type="button" onClick={resubmitHousehold} disabled={savingSection === 'resubmit' || Boolean(savingSection) || Boolean(savingMember) || sectionChangesPending || memberChangesPending}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-btn bg-brand-blue px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60">
          <RotateCcw className="h-4 w-4" />{savingSection === 'resubmit' ? 'Submitting…' : 'Resubmit for verification'}
        </button>
      </div>
    </Card>}
    {user?.role === 'bhw' && <Card className="p-4 sm:p-5">
      <div className="mb-3"><h2 className="text-sm font-semibold text-brand-ink">Visit Tracking</h2><p className="mt-1 text-xs text-brand-gray">Record a household visit without changing its profile.</p></div>
      {feedback('visit')}
      <form data-feedback-scope="visit" noValidate className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" onSubmit={(event) => { event.preventDefault(); recordVisit(); }}>
        <Field scope="visit" field="visitDate" label="Visit date" type="date" value={visitDate} onChange={(value) => { setVisitDate(value); visitRequestId.current = newVisitRequestId(); }} />
        <Field scope="visit" field="visitReason" label="Visit reason" type="select" options={VISIT_REASONS} value={visitReason} onChange={(value) => { setVisitReason(value); visitRequestId.current = newVisitRequestId(); }} />
        <button type="submit" disabled={recordingVisit} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-btn border border-brand-border px-4 py-2.5 text-sm font-medium text-brand-ink hover:bg-brand-bg disabled:opacity-60">
          <RotateCcw className="h-4 w-4 shrink-0" /> {recordingVisit ? 'Recording visit…' : 'Record visit'}
        </button>
      </form>
    </Card>}
    <div className="grid items-start gap-4 xl:grid-cols-2">
    {SECTIONS.map((section) => {
      const sectionDirty = section.fields.some(([field]) => JSON.stringify(form[field] ?? null) !== JSON.stringify(savedForm?.[field] ?? null));
      const collapsed = collapsedSections.has(section.id);
      return <section key={section.id} data-feedback-scope={section.id} aria-labelledby={`section-heading-${section.id}`} className={`min-w-0 rounded-md border border-brand-border bg-white dark:bg-card ${section.id === 'water' ? 'xl:col-span-2' : ''}`}>
        <div className={`flex flex-wrap items-center justify-between gap-x-3 px-4 py-1.5 ${collapsed ? '' : 'border-b border-brand-border bg-brand-bg/40'}`}>
          <button type="button" aria-expanded={!collapsed} aria-controls={`section-${section.id}`}
            onClick={() => { setNotice(''); setCollapsedSections((current) => { const next = new Set(current); if (next.has(section.id)) next.delete(section.id); else next.add(section.id); return next; }); }}
            className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-3 text-left text-sm font-semibold text-brand-ink hover:text-brand-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue">
            <span id={`section-heading-${section.id}`}>{({ household: 'Household information', details: 'Household details', respondent: 'Respondent information', philhealth: 'Household head PhilHealth', water: 'Water and sanitation' })[section.id]}
              {sectionDirty && <span className="ml-2 text-xs font-normal text-amber-700">Unsaved changes</span>}
            </span>
            <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-brand-gray transition-transform ${collapsed ? '' : 'rotate-180'}`} />
          </button>
          {sectionDirty && <div className="flex flex-wrap gap-2">
            <button type="button" disabled={Boolean(savingSection)} onClick={() => { clearFieldFeedback('household', section.fields); setForm((current) => ({ ...current, ...Object.fromEntries(section.fields.map(([field]) => [field, savedForm?.[field]])) })); }} className="min-h-11 rounded-btn border border-brand-border px-3 py-2 text-sm text-brand-gray hover:bg-brand-bg">Cancel</button>
            <button type="button" disabled={Boolean(savingSection)} onClick={() => saveSection(section)} className="inline-flex min-h-11 items-center gap-2 rounded-btn bg-brand-blue px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"><Save className="h-4 w-4" />{savingSection === section.id ? 'Saving...' : 'Save section'}</button>
          </div>}
        </div>
        {feedback(section.id)}
        <div id={`section-${section.id}`} hidden={collapsed} className="p-4">
      {section.id === 'details' && <p className="mb-4 text-xs text-brand-gray">Household status: {form.hhStatus || '—'} · Approval: {form.approvalStatus || '—'} · Assigned BHW: {form.collectorName || '—'}</p>}
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">{section.fields.map(([field, label, type = 'text', options]) => {
        const fieldOptions = field === 'purok' && form.purok && !PUROKS.includes(form.purok)
          ? [...PUROKS, form.purok]
          : options || [];
        return <Field key={field} field={field} label={label} type={type} options={fieldOptions} value={form[field]} onChange={(value) => updateField(field, value)} />;
      })}</div>
        </div>
    </section>;
    })}
    </div>
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-sm font-semibold text-brand-ink">{MEMBER_SECTION}</h2><p className="mt-1 text-xs text-brand-gray">Edit existing members or add another by linking a resident profile or entering their details.</p></div>
        {user?.role === 'bhw' && canAny(['households.create', 'households.verify']) && (
          <button type="button" onClick={() => { setNotice(''); setShowAddMember((current) => !current); setError(''); }} className="rounded-btn bg-brand-blue px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-dark">
            {showAddMember ? 'Cancel add' : 'Add another member'}
          </button>
        )}
      </div>
      {feedback('newMember')}
      <div className="mt-4 space-y-4">{members.map((member, index) => {
        const savedMember = savedMembers.find((item) => item.id === member.id);
        const memberDirty = MEMBER_FIELDS.some(([field]) => JSON.stringify(member[field] ?? null) !== JSON.stringify(savedMember?.[field] ?? null));
        const collapsed = collapsedMembers.has(member.id);
        return <div key={member.id || `${member.name}-${index}`} data-feedback-scope={`member-${member.id}`} className="rounded-xl border border-brand-border p-4">
        {feedback(`member-${member.id}`)}
        <div className={`flex flex-wrap items-center justify-between gap-3 ${collapsed ? "" : "mb-3"}`}><div className="min-w-0 flex-1 basis-40"><p className="text-sm font-semibold text-brand-ink">{member.name || `Member ${index + 1}`}{member.residentId ? <span className="ml-2 text-xs font-normal text-emerald-700">Linked resident</span> : null}</p>{collapsed && <p className="mt-1 text-xs text-brand-gray">{[member.relationship, member.sex, member.age !== null && member.age !== undefined && member.age !== "" ? `${member.age} yrs` : "", MEMBER_PHILHEALTH.find((option) => option.value === member.philhealth)?.label].filter(Boolean).join(" / ")}</p>}{memberDirty && <p className="mt-1 text-xs font-medium text-amber-700">Unsaved changes</p>}</div><div className="flex flex-wrap gap-2 [&>button]:min-h-11">{memberDirty && <button type="button" disabled={Boolean(savingMember || savingSection)} onClick={() => { clearFieldFeedback(`member-${member.id}`, MEMBER_FIELDS); setMembers((current) => current.map((row) => row.id === member.id ? { ...savedMember } : row)); }} className="rounded-btn border border-brand-border px-3 py-2 text-xs font-medium text-brand-gray hover:bg-brand-bg">Cancel</button>}{!collapsed && <button type="button" disabled={!member.id || !memberDirty || Boolean(savingMember)} onClick={() => saveMember(member)} className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-3 py-2 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-60"><Save className="h-3.5 w-3.5" />{savingMember === member.id ? 'Saving…' : 'Save member'}</button>}
          <button type="button" aria-expanded={!collapsed} aria-controls={`member-fields-${member.id || index}`} disabled={savingMember === member.id}
            onClick={() => { setNotice(''); setCollapsedMembers((current) => { const next = new Set(current); if (next.has(member.id)) next.delete(member.id); else next.add(member.id); return next; }); }}
            className="rounded-btn border border-brand-border px-3 py-2 text-xs font-medium text-brand-blue hover:bg-brand-bg disabled:opacity-60">
            {collapsed ? 'Edit member' : 'Collapse'}
          </button></div></div>
        <div id={`member-fields-${member.id || index}`} hidden={collapsed} className={collapsed ? "hidden" : "grid gap-3 sm:grid-cols-2 xl:grid-cols-3"}>{MEMBER_FIELDS.map(([field, label, type = 'text', options]) => <Field key={field} scope={`member-${member.id}`} field={field} label={label} type={type} options={options || []} value={member[field]} onChange={(value) => setMembers((current) => current.map((row) => row.id === member.id ? { ...row, [field]: value } : row))} />)}</div>
      </div>;
      })}{members.length === 0 && <p className="text-sm text-brand-gray">No household members are recorded.</p>}</div>
      {showAddMember && user?.role === 'bhw' && (
        <div className="mt-5 space-y-4 rounded-xl border border-brand-border bg-brand-bg/40 p-4">
          <div>
            <label className="block text-sm font-medium text-brand-ink" htmlFor="edit-household-resident-search">Search existing resident</label>
            {linkedResidentId ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <span className="text-sm text-emerald-800">{newMember.name} · linked to existing resident</span>
                <button type="button" onClick={() => { setLinkedResidentId(''); setNewMember((current) => ({ ...current, name: '', birthday: '', age: '', sex: '', contact: '', philhealth: '' })); setResidentSearch({ query: '', rows: [], loading: false, searched: false, error: '' }); }} className="text-xs font-medium text-brand-blue hover:underline">Remove link</button>
              </div>
            ) : (
              <>
                <input disabled={addingMember} id="edit-household-resident-search" type="search" value={residentSearch.query} onChange={(event) => { setResidentSearch((current) => ({ ...current, query: event.target.value })); setNewMember((current) => ({ ...current, name: event.target.value })); }} placeholder="Search by resident name, or enter a new member’s name" autoComplete="off" className="mt-1.5 w-full rounded-input border border-brand-border bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-blue" />
                {residentSearch.loading && <p className="mt-1 text-xs text-brand-gray">Searching resident records…</p>}
                {residentSearch.error && <p role="alert" className="mt-1 text-xs text-red-700">{residentSearch.error}</p>}
                {residentSearch.rows.length > 0 && (
                  <ul className="mt-2 max-h-48 divide-y divide-brand-border overflow-y-auto rounded-lg border border-brand-border bg-white">
                    {residentSearch.rows.map((resident) => <li key={resident.residentId || resident.id}>
                      <button type="button" disabled={addingMember} onClick={() => chooseResident(resident)} className="w-full px-3 py-2 text-left hover:bg-brand-bg">
                        <span className="block text-sm font-medium text-brand-ink">{[resident.firstName, resident.middleName, resident.lastName, resident.suffix].filter(Boolean).join(' ')}</span>
                        <span className="text-xs text-brand-gray">{resident.birthDate || 'Birth date unavailable'} · {resident.barangay || 'Barangay unavailable'} · {resident.verificationStatus || 'Resident profile'}</span>
                      </button>
                    </li>)}
                  </ul>
                )}
                {residentSearch.searched && !residentSearch.loading && !residentSearch.error && residentSearch.rows.length === 0 && <p className="mt-1 text-xs text-brand-gray">No resident profile found. Enter the member details below; this adds them to the household without creating a login account.</p>}
              </>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
              <Field scope="newMember" field="name" label="Full name" value={newMember.name} onChange={(value) => setNewMember((current) => ({ ...current, name: value }))} />
              <Field scope="newMember" label="Relationship to household head" type="select" options={RELATIONSHIPS} value={newMember.relationship} onChange={(value) => setNewMember((current) => ({ ...current, relationship: value }))} />
              <Field scope="newMember" label="Sex" type="select" options={SEX_OPTIONS} value={newMember.sex} onChange={(value) => setNewMember((current) => ({ ...current, sex: value }))} />
              <Field scope="newMember" field="birthday" label="Birth date" type="date" value={newMember.birthday} onChange={(value) => setNewMember((current) => ({ ...current, birthday: value, age: ageFromBirthday(value) }))} />
              <Field scope="newMember" label="Age" type="number" value={newMember.age} onChange={(value) => setNewMember((current) => ({ ...current, age: value }))} />
              <Field scope="newMember" label="Classification" type="selectObjects" options={CLASSIFICATIONS} value={newMember.classification} onChange={(value) => setNewMember((current) => ({ ...current, classification: value }))} />
              <Field scope="newMember" label="Contact number" type="tel" value={newMember.contact} onChange={(value) => setNewMember((current) => ({ ...current, contact: value }))} />
              <Field scope="newMember" label="PhilHealth" type="buttons" options={MEMBER_PHILHEALTH} value={newMember.philhealth} onChange={(value) => setNewMember((current) => ({ ...current, philhealth: value }))} />
              <Field scope="newMember" label="Family planning method" type="select" options={FP_METHODS} value={newMember.fpMethod} onChange={(value) => setNewMember((current) => ({ ...current, fpMethod: value }))} />
              <Field scope="newMember" label="Quarter status" type="select" options={QUARTER_STATUSES} value={newMember.quarterStatus} onChange={(value) => setNewMember((current) => ({ ...current, quarterStatus: value }))} />
              <Field scope="newMember" label="Person with disability?" type="boolean" value={newMember.isPwd} onChange={(value) => setNewMember((current) => ({ ...current, isPwd: value }))} />
            </div>
          <div className="flex justify-end">
            <button type="button" onClick={addMember} disabled={addingMember} className="rounded-btn bg-brand-blue px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60">{addingMember ? 'Adding member…' : 'Add to household'}</button>
          </div>
        </div>
      )}
    </Card>
  </div></FeedbackContext.Provider>;
}

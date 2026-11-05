import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, RotateCcw } from 'lucide-react';
import { Card } from '@/components/common/Card';
import { useAuth } from '@/context/AuthContext';
import { usePermissions } from '@/context/PermissionsContext';
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
  ['isPwd', 'Person with disability?', 'boolean'], ['philhealth', 'Member PhilHealth', 'selectObjects', MEMBER_PHILHEALTH],
  ['fpMethod', 'Family planning method', 'select', FP_METHODS], ['quarterStatus', 'Quarter status', 'select', QUARTER_STATUSES],
];
const MEMBER_SECTION = 'Household Members';
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

function Field({ label, type = 'text', value, options = [], onChange }) {
  if (type === 'boolean') {
    return <label className="flex items-center gap-2 rounded-lg border border-brand-border px-3 py-2.5 text-sm text-brand-ink">
      <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-brand-blue" />
      {label}
    </label>;
  }
  if (type === 'multi') {
    const selected = Array.isArray(value) ? value : [];
    return <fieldset className="space-y-2"><legend className="text-sm font-medium text-brand-ink">{label}</legend>
      <div className="flex flex-wrap gap-3">{options.map((option) => <label key={option} className="flex items-center gap-1.5 text-sm text-brand-gray">
        <input type="checkbox" checked={selected.includes(option)} onChange={() => onChange(selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option])} className="h-4 w-4 accent-brand-blue" />{option}
      </label>)}</div>
    </fieldset>;
  }
  const selectOptions = type === 'selectObjects' ? options.map((option) => ({ value: option.value, label: option.label })) : options.map((option) => ({ value: option, label: option }));
  return <label className="block space-y-1.5 text-sm font-medium text-brand-ink">
    {label}
    {type === 'select' || type === 'selectObjects' ? <select value={value ?? ''} onChange={(event) => onChange(event.target.value)} className="w-full rounded-input border border-brand-border bg-white px-3 py-2.5 font-normal outline-none focus:border-brand-blue">
      <option value="">Select…</option>{selectOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select> : <input type={type} min={type === 'number' ? 0 : undefined} value={displayValue(value)} onChange={(event) => onChange(type === 'number' ? (event.target.value === '' ? '' : Number(event.target.value)) : event.target.value)} className="w-full rounded-input border border-brand-border bg-white px-3 py-2.5 font-normal outline-none focus:border-brand-blue" />}
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
  const [savingMember, setSavingMember] = useState('');
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
  const [visitDate, setVisitDate] = useState(todayLocal());

  useEffect(() => {
    let active = true;
    getHouseholdOffline({ ownerId: user?.id, householdId })
      .then((household) => {
        if (!active) return;
        setForm({ ...household });
        setSavedForm({ ...household });
        setMembers((household.members || []).map((member) => ({ ...member })));
        setSavedMembers((household.members || []).map((member) => ({ ...member })));
        setRevision(household.revision ?? null);
      })
      .catch((loadError) => { if (active) setError(loadError?.message || 'Could not load this household.'); })
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
            error: searchError?.message || 'Could not search existing residents.',
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
    if (!canAny(['households.create', 'households.verify'])) return setError('You do not have permission to edit this household.');
    const patch = Object.fromEntries(section.fields.map(([field]) => [field, form[field] ?? (field === 'treatmentMethods' ? [] : '')]));
    if (patch.families !== undefined && patch.families !== '') patch.families = Number(patch.families);
    if (patch.monthlyIncome === '') patch.monthlyIncome = null;
    setSavingSection(section.id); setError(''); setNotice('');
    try {
      const result = await updateHouseholdOffline({ ownerId: user?.id, serverId: householdId, payload: patch, baseRevision: revision });
      setRevision(result?.household?.revision ?? revision);
      setForm((current) => ({ ...current, ...result.household }));
      setSavedForm((current) => ({ ...current, ...result.household }));
      let historyNotice = '';
      try { await saveVisitHistory([section.title]); }
      catch (historyError) { historyNotice = ` The profile was saved, but visit history could not be recorded: ${historyError?.message || 'Please retry.'}`; }
      setNotice(`${section.title} saved.${historyNotice}`);
    } catch (saveError) { setError(saveError?.message || `Could not save ${section.title.toLowerCase()}.`); }
    finally { setSavingSection(''); }
  };

  const saveMember = async (member) => {
    setSavingMember(member.id); setError(''); setNotice('');
    try {
      const response = await householdsApi.updateMember(householdId, member.id, member);
      const updatedMember = { ...member, ...(response?.member || {}) };
      setMembers((current) => current.map((item) => item.id === member.id ? updatedMember : item));
      setSavedMembers((current) => current.map((item) => item.id === member.id ? updatedMember : item));
      let historyNotice = '';
      try { await saveVisitHistory([MEMBER_SECTION]); }
      catch (historyError) { historyNotice = ` Member details were saved, but visit history could not be recorded: ${historyError?.message || 'Please retry.'}`; }
      setNotice(`Member information saved.${historyNotice}`);
    } catch (saveError) { setError(saveError?.message || 'Could not save member information.'); }
    finally { setSavingMember(''); }
  };

  const chooseResident = (resident) => {
    const name = [resident.firstName, resident.middleName, resident.lastName, resident.suffix]
      .filter(Boolean).join(' ');
    const age = ageFromBirthday(resident.birthDate || '');
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
    setNewMember({ name: '', relationship: '', sex: '', birthday: '', age: '', classification: '', contact: '', isPwd: false, philhealth: '', fpMethod: '', quarterStatus: '' });
    setLinkedResidentId('');
    setResidentSearch({ query: '', rows: [], loading: false, searched: false, error: '' });
  };

  const addMember = async () => {
    if (!canAny(['households.create', 'households.verify'])) return setError('You do not have permission to add household members.');
    if (!newMember.name.trim() || !newMember.relationship || !newMember.sex) {
      return setError('Name, relationship to household head, and sex are required.');
    }
    setAddingMember(true); setError(''); setNotice('');
    try {
      const response = await householdsApi.addMember(householdId, {
        ...newMember,
        name: newMember.name.trim(),
        age: newMember.age === '' ? null : Number(newMember.age),
        residentId: linkedResidentId || undefined,
      });
      const household = response?.household;
      if (household?.members) {
        setMembers(household.members.map((member) => ({ ...member })));
        setSavedMembers(household.members.map((member) => ({ ...member })));
      } else {
        const result = await householdsApi.get(householdId);
        const refreshed = result?.household?.members || [];
        setMembers(refreshed.map((member) => ({ ...member })));
        setSavedMembers(refreshed.map((member) => ({ ...member })));
      }
      setShowAddMember(false);
      resetNewMember();
      let historyNotice = '';
      try { await saveVisitHistory([MEMBER_SECTION]); }
      catch (historyError) { historyNotice = ` The member was added, but visit history could not be recorded: ${historyError?.message || 'Please retry.'}`; }
      setNotice(`Household member added.${historyNotice}`);
    } catch (addError) {
      setError(addError?.message || 'Could not add the household member.');
    } finally {
      setAddingMember(false);
    }
  };

  const recordVisit = async () => {
    setError(''); setNotice('');
    try {
      await householdsApi.createVisit(householdId, { visitDate, requestId: newVisitRequestId(), visitReason: 'Follow-up', updatedSections: [] });
      setNotice('Visit recorded.');
    } catch (visitError) { setError(visitError?.message || 'Could not record this visit.'); }
  };

  const saveLegacy = async (event) => {
    event.preventDefault();
    if (!canAny(['households.create', 'households.verify'])) return setError('You do not have permission to edit this household.');
    setSavingSection('legacy'); setError('');
    try {
      const payload = Object.fromEntries(LEGACY_FIELDS.map(([field]) => [field, form[field] ?? '']));
      payload.families = Number(payload.families);
      payload.monthlyIncome = payload.monthlyIncome === '' ? null : Number(payload.monthlyIncome);
      await updateHouseholdOffline({ ownerId: user?.id, serverId: householdId, payload, baseRevision: revision });
      navigate(householdsPath, { replace: true, state: { hhToast: `Household ${householdId} updated successfully` } });
    } catch (saveError) { setError(saveError?.message || 'Could not save household changes.'); }
    finally { setSavingSection(''); }
  };

  if (loading) return <Card className="p-6 text-sm text-brand-gray">Loading household…</Card>;
  if (!form) return <Card className="space-y-4 p-6"><p role="alert" className="text-sm text-red-700">{error || 'Household not found.'}</p><button type="button" onClick={() => navigate(householdsPath)} className="text-sm text-brand-blue">Back to households</button></Card>;

  if (user?.role !== 'bhw') return <div className="mx-auto max-w-3xl space-y-5">
    <button type="button" onClick={() => navigate(householdsPath)} className="inline-flex items-center gap-2 text-sm font-medium text-brand-blue hover:underline"><ArrowLeft className="h-4 w-4" /> Back to households</button>
    <div><h1 className="text-2xl font-semibold text-brand-ink">Edit Household</h1><p className="mt-1 text-sm text-brand-gray">{householdId} · {syncStatus.online ? 'Changes are checked by the server.' : 'Working offline'}</p></div>
    <Card className="p-5 sm:p-7"><form onSubmit={saveLegacy} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">{LEGACY_FIELDS.map(([field, label, type]) => <Field key={field} label={label} type={type} value={form[field] ?? ''} onChange={(value) => updateField(field, value)} />)}</div>
      <p className="text-xs text-brand-gray">Household members, verification, approval, status, scope, and audit fields are not changed by this editor.</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex justify-end"><button type="submit" disabled={savingSection === 'legacy'} className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"><Save className="h-4 w-4" />{savingSection === 'legacy' ? 'Saving…' : 'Save changes'}</button></div>
    </form></Card>
  </div>;

  return <div className="mx-auto max-w-4xl space-y-5">
    <button type="button" onClick={() => navigate(householdsPath)} className="inline-flex items-center gap-2 text-sm font-medium text-brand-blue hover:underline"><ArrowLeft className="h-4 w-4" /> Back to households</button>
    <header><h1 className="text-2xl font-semibold text-brand-ink">Household Profile</h1><p className="mt-1 text-sm text-brand-gray">{householdId} · Saved information is loaded from this household’s existing profile. {syncStatus.online ? '' : 'Working offline.'}</p></header>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {user?.role === 'bhw' && <Card className="flex flex-wrap items-end gap-3 p-4">
      <label className="text-sm font-medium text-brand-ink">Visit date<input type="date" value={visitDate} onChange={(event) => setVisitDate(event.target.value)} className="mt-1.5 block rounded-input border border-brand-border bg-white px-3 py-2.5" /></label>
      <button type="button" onClick={recordVisit} className="inline-flex items-center gap-2 rounded-btn border border-brand-border px-4 py-2.5 text-sm font-medium text-brand-ink hover:bg-brand-bg"><RotateCcw className="h-4 w-4" /> Record visit without profile changes</button>
    </Card>}
    {SECTIONS.map((section) => {
      const sectionDirty = section.fields.some(([field]) => JSON.stringify(form[field] ?? null) !== JSON.stringify(savedForm?.[field] ?? null));
      return <Card key={section.id} className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-brand-ink">{section.title}</h2><p className="mt-1 text-xs text-brand-gray">Review the saved values and update only what changed.</p>{sectionDirty && <p className="mt-1 text-xs font-medium text-amber-700">Unsaved changes</p>}</div><div className="flex gap-2">{sectionDirty && <button type="button" onClick={() => setForm((current) => ({ ...current, ...Object.fromEntries(section.fields.map(([field]) => [field, savedForm?.[field]])) }))} className="rounded-btn border border-brand-border px-3.5 py-2 text-sm font-medium text-brand-gray hover:bg-brand-bg">Cancel</button>}<button type="button" disabled={!sectionDirty || Boolean(savingSection)} onClick={() => saveSection(section)} className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"><Save className="h-4 w-4" />{savingSection === section.id ? 'Saving…' : 'Save section'}</button></div></div>
      {section.id === 'details' && <p className="mb-4 text-xs text-brand-gray">Household status: {form.hhStatus || '—'} · Approval: {form.approvalStatus || '—'} · Assigned BHW: {form.collectorName || '—'}</p>}
      <div className="grid gap-4 sm:grid-cols-2">{section.fields.map(([field, label, type = 'text', options]) => {
        const fieldOptions = field === 'purok' && form.purok && !PUROKS.includes(form.purok)
          ? [...PUROKS, form.purok]
          : options || [];
        return <Field key={field} label={label} type={type} options={fieldOptions} value={form[field]} onChange={(value) => updateField(field, value)} />;
      })}</div>
    </Card>;
    })}
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-sm font-semibold text-brand-ink">{MEMBER_SECTION}</h2><p className="mt-1 text-xs text-brand-gray">Edit existing members or add another by linking a resident profile or entering their details.</p></div>
        {user?.role === 'bhw' && canAny(['households.create', 'households.verify']) && (
          <button type="button" onClick={() => { setShowAddMember((current) => !current); setError(''); }} className="rounded-btn bg-brand-blue px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-dark">
            {showAddMember ? 'Cancel add' : 'Add another member'}
          </button>
        )}
      </div>
      <div className="mt-4 space-y-4">{members.map((member, index) => {
        const savedMember = savedMembers.find((item) => item.id === member.id);
        const memberDirty = MEMBER_FIELDS.some(([field]) => JSON.stringify(member[field] ?? null) !== JSON.stringify(savedMember?.[field] ?? null));
        return <div key={member.id || `${member.name}-${index}`} className="rounded-xl border border-brand-border p-4">
        <div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-brand-ink">{member.name || `Member ${index + 1}`}{member.residentId ? <span className="ml-2 text-xs font-normal text-emerald-700">Linked resident</span> : null}</p>{memberDirty && <p className="mt-1 text-xs font-medium text-amber-700">Unsaved changes</p>}</div><div className="flex gap-2">{memberDirty && <button type="button" onClick={() => setMembers((current) => current.map((row) => row.id === member.id ? { ...savedMember } : row))} className="rounded-btn border border-brand-border px-3 py-2 text-xs font-medium text-brand-gray hover:bg-brand-bg">Cancel</button>}<button type="button" disabled={!member.id || !memberDirty || Boolean(savingMember)} onClick={() => saveMember(member)} className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-3 py-2 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-60"><Save className="h-3.5 w-3.5" />{savingMember === member.id ? 'Saving…' : 'Save member'}</button></div></div>
        <div className="grid gap-3 sm:grid-cols-2">{MEMBER_FIELDS.map(([field, label, type = 'text', options]) => <Field key={field} label={label} type={type} options={options || []} value={member[field]} onChange={(value) => setMembers((current) => current.map((row) => row.id === member.id ? { ...row, [field]: value } : row))} />)}</div>
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
                <input id="edit-household-resident-search" type="search" value={residentSearch.query} onChange={(event) => { setResidentSearch((current) => ({ ...current, query: event.target.value })); setNewMember((current) => ({ ...current, name: event.target.value })); }} placeholder="Search by resident name, or enter a new member’s name" autoComplete="off" className="mt-1.5 w-full rounded-input border border-brand-border bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-blue" />
                {residentSearch.loading && <p className="mt-1 text-xs text-brand-gray">Searching resident records…</p>}
                {residentSearch.error && <p role="alert" className="mt-1 text-xs text-red-700">{residentSearch.error}</p>}
                {residentSearch.rows.length > 0 && (
                  <ul className="mt-2 max-h-48 divide-y divide-brand-border overflow-y-auto rounded-lg border border-brand-border bg-white">
                    {residentSearch.rows.map((resident) => <li key={resident.residentId || resident.id}>
                      <button type="button" onClick={() => chooseResident(resident)} className="w-full px-3 py-2 text-left hover:bg-brand-bg">
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
          {!linkedResidentId && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5 text-sm font-medium text-brand-ink">Full name *<input value={newMember.name} onChange={(event) => { setNewMember((current) => ({ ...current, name: event.target.value })); setResidentSearch((current) => ({ ...current, query: event.target.value })); }} className="w-full rounded-input border border-brand-border bg-white px-3 py-2.5 font-normal outline-none focus:border-brand-blue" placeholder="Member name" /></label>
              <Field label="Relationship to household head" type="select" options={RELATIONSHIPS} value={newMember.relationship} onChange={(value) => setNewMember((current) => ({ ...current, relationship: value }))} />
              <Field label="Sex" type="select" options={SEX_OPTIONS} value={newMember.sex} onChange={(value) => setNewMember((current) => ({ ...current, sex: value }))} />
              <label className="block space-y-1.5 text-sm font-medium text-brand-ink">Birth date<input type="date" value={newMember.birthday} onChange={(event) => setNewMember((current) => ({ ...current, birthday: event.target.value, age: ageFromBirthday(event.target.value) }))} className="w-full rounded-input border border-brand-border bg-white px-3 py-2.5 font-normal outline-none focus:border-brand-blue" /></label>
              <Field label="Age" type="number" value={newMember.age} onChange={(value) => setNewMember((current) => ({ ...current, age: value }))} />
              <Field label="Classification" type="selectObjects" options={CLASSIFICATIONS} value={newMember.classification} onChange={(value) => setNewMember((current) => ({ ...current, classification: value }))} />
              <Field label="Contact number" type="tel" value={newMember.contact} onChange={(value) => setNewMember((current) => ({ ...current, contact: value }))} />
              <Field label="PhilHealth" type="selectObjects" options={MEMBER_PHILHEALTH} value={newMember.philhealth} onChange={(value) => setNewMember((current) => ({ ...current, philhealth: value }))} />
              <Field label="Family planning method" type="select" options={FP_METHODS} value={newMember.fpMethod} onChange={(value) => setNewMember((current) => ({ ...current, fpMethod: value }))} />
              <Field label="Quarter status" type="select" options={QUARTER_STATUSES} value={newMember.quarterStatus} onChange={(value) => setNewMember((current) => ({ ...current, quarterStatus: value }))} />
              <Field label="Person with disability?" type="boolean" value={newMember.isPwd} onChange={(value) => setNewMember((current) => ({ ...current, isPwd: value }))} />
            </div>
          )}
          {linkedResidentId && <div className="grid gap-3 sm:grid-cols-2"><Field label="Relationship to household head" type="select" options={RELATIONSHIPS} value={newMember.relationship} onChange={(value) => setNewMember((current) => ({ ...current, relationship: value }))} /><Field label="Classification" type="selectObjects" options={CLASSIFICATIONS} value={newMember.classification} onChange={(value) => setNewMember((current) => ({ ...current, classification: value }))} /><Field label="Person with disability?" type="boolean" value={newMember.isPwd} onChange={(value) => setNewMember((current) => ({ ...current, isPwd: value }))} /></div>}
          <div className="flex justify-end">
            <button type="button" onClick={addMember} disabled={addingMember} className="rounded-btn bg-brand-blue px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60">{addingMember ? 'Adding member…' : 'Add to household'}</button>
          </div>
        </div>
      )}
    </Card>
  </div>;
}

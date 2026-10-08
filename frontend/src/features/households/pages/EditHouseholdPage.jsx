import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import { Card } from '@/components/common/Card';
import { useAuth } from '@/context/AuthContext';
import { usePermissions } from '@/context/PermissionsContext';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import {
  getHouseholdOffline,
  updateHouseholdOffline,
} from '@/services/offline/householdOfflineService';

const FIELDS = [
  ['headName', 'Household head', 'text'],
  ['purok', 'Purok / zone', 'text'],
  ['streetAddress', 'Street address / sitio', 'text'],
  ['contact', 'Contact number', 'tel'],
  ['families', 'Number of families', 'number'],
  ['monthlyIncome', 'Monthly income', 'number'],
];

const toForm = (household) => ({
  headName: household.headName || '',
  purok: household.purok || '',
  streetAddress: household.streetAddress || '',
  contact: household.contact || '',
  families: household.families ?? 1,
  monthlyIncome: household.monthlyIncome ?? '',
});

export default function EditHouseholdPage() {
  const { householdId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { canAny } = usePermissions();
  const syncStatus = useSyncStatus();
  const pathname = window.location.pathname;
  const householdsIndex = pathname.indexOf('/households');
  const householdsPath = householdsIndex < 0
    ? pathname
    : pathname.slice(0, householdsIndex + '/households'.length);
  const [form, setForm] = useState(null);
  const [revision, setRevision] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getHouseholdOffline({ ownerId: user?.id, householdId })
      .then((household) => {
        if (!active) return;
        setForm(toForm(household));
        setRevision(household.revision ?? null);
      })
      .catch((loadError) => {
        if (active) setError(loadError?.message || 'Could not load this household.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [householdId, user?.id]);

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const save = async (event) => {
    event.preventDefault();
    if (!canAny(['households.create', 'households.verify'])) {
      setError('You do not have permission to edit this household.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        families: Number(form.families),
        monthlyIncome: form.monthlyIncome === '' ? null : Number(form.monthlyIncome),
      };
      const result = await updateHouseholdOffline({
        ownerId: user?.id,
        serverId: householdId,
        payload,
        baseRevision: revision,
      });
      navigate(householdsPath, {
        replace: true,
        state: {
          hhToast: result.queued
            ? 'Saved offline — will sync automatically'
            : `Household ${householdId} updated successfully`,
        },
      });
    } catch (saveError) {
      setError(saveError?.message || 'Could not save household changes.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <button
        type="button"
        onClick={() => navigate(householdsPath)}
        className="inline-flex items-center gap-2 text-sm font-medium text-brand-blue hover:underline"
      >
        <ArrowLeft className="h-4 w-4" /> Back to households
      </button>
      <div>
        <h1 className="text-2xl font-semibold text-brand-ink">Edit Household</h1>
        <p className="mt-1 text-sm text-brand-gray">
          {householdId} · {syncStatus.online ? 'Changes are checked by the server.' : 'Working offline'}
        </p>
      </div>
      <Card className="p-5 sm:p-7">
        {loading ? (
          <p className="text-sm text-brand-gray">Loading household…</p>
        ) : error && !form ? (
          <div role="alert" className="space-y-4 text-sm text-red-700">
            <p>{error}</p>
            <button type="button" onClick={() => navigate(householdsPath)} className="text-brand-blue hover:underline">
              Return to households
            </button>
          </div>
        ) : (
          <form onSubmit={save} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              {FIELDS.map(([field, label, type]) => (
                <label key={field} className="space-y-1.5 text-sm font-medium text-brand-ink">
                  {label}
                  <input
                    type={type}
                    min={type === 'number' ? 0 : undefined}
                    value={form?.[field] ?? ''}
                    onChange={(event) => updateField(field, event.target.value)}
                    className="w-full rounded-input border border-brand-border bg-white px-3 py-2.5 font-normal outline-none focus:border-brand-blue"
                  />
                </label>
              ))}
            </div>
            <p className="text-xs text-brand-gray">
              Household members, verification, approval, status, scope, and audit fields are not changed by this offline-safe editor.
            </p>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving || loading}
                className="inline-flex items-center gap-2 rounded-btn bg-brand-blue px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
              >
                <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}

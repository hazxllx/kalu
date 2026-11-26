// frontend/src/features/advisories/pages/AdvisoryManagement.jsx
import React, { useCallback, useEffect, useState } from 'react';
import { Edit2, Megaphone, Plus, Trash2 } from 'lucide-react';
import PageHeader from '@/components/common/PageHeader';
import ConfirmDialog from '@/components/system/ConfirmDialog';
import { useToast } from '@/components/ui/use-toast';
import { advisoriesApi } from '@/services/api/advisoriesApi';

const EMPTY_FORM = { title: '', message: '', isActive: true, displayOrder: '0' };
const inputClass = 'w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15';

const AdvisoryManagement = () => {
  const { toast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);

  const loadAdvisories = useCallback(async () => {
    setLoadError('');
    try {
      setRows(await advisoriesApi.listAll());
    } catch (error) {
      setLoadError(error?.message || 'Could not load advisories.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAdvisories();
  }, [loadAdvisories]);

  const resetForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const beginEdit = (advisory) => {
    setEditingId(advisory.id);
    setForm({
      title: advisory.title || '',
      message: advisory.message,
      isActive: advisory.isActive,
      displayOrder: String(advisory.displayOrder),
    });
  };

  const submit = async (event) => {
    event.preventDefault();
    const message = form.message.trim();
    if (!message) {
      toast({ variant: 'destructive', title: 'Message required', description: 'Enter an advisory message before saving.' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim() || null,
        message,
        isActive: form.isActive,
        displayOrder: Number(form.displayOrder),
      };
      if (editingId) {
        await advisoriesApi.update(editingId, payload);
        toast({ title: 'Advisory updated.' });
      } else {
        await advisoriesApi.create(payload);
        toast({ title: 'Advisory created.' });
      }
      resetForm();
      await loadAdvisories();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could not save advisory', description: error?.message || 'Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (advisory) => {
    setUpdatingId(advisory.id);
    try {
      await advisoriesApi.setStatus(advisory.id, !advisory.isActive);
      toast({ title: advisory.isActive ? 'Advisory deactivated.' : 'Advisory activated.' });
      await loadAdvisories();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could not update advisory status', description: error?.message || 'Please try again.' });
    } finally {
      setUpdatingId(null);
    }
  };

  const deleteAdvisory = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await advisoriesApi.delete(pendingDelete.id);
      toast({ title: 'Advisory deleted.' });
      setPendingDelete(null);
      await loadAdvisories();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could not delete advisory', description: error?.message || 'Please try again.' });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        management
        crumbs={[{ label: 'Admin', to: '/app/admin/dashboard' }, 'Advisory Management']}
        title="Advisory Management"
        subtitle="Create and manage announcements shown in the public advisory ticker."
      />

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="advisory-form-title">
        <div className="mb-4 flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-brand-blue" aria-hidden="true" />
          <h2 id="advisory-form-title" className="text-sm font-semibold text-slate-900">
            {editingId ? 'Edit advisory' : 'Create advisory'}
          </h2>
        </div>
        <form className="space-y-4" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <label className="space-y-1.5 text-xs font-medium text-slate-600">
              Title <span className="font-normal text-slate-400">(optional)</span>
              <input
                className={inputClass}
                maxLength={160}
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="Short internal title"
              />
            </label>
            <label className="space-y-1.5 text-xs font-medium text-slate-600">
              Display order
              <input
                className={inputClass}
                type="number"
                min="0"
                step="1"
                required
                value={form.displayOrder}
                onChange={(event) => setForm((current) => ({ ...current, displayOrder: event.target.value }))}
              />
            </label>
          </div>
          <label className="block space-y-1.5 text-xs font-medium text-slate-600">
            Message <span className="text-rose-600">*</span>
            <textarea
              className={`${inputClass} min-h-24 resize-y`}
              maxLength={5000}
              required
              value={form.message}
              onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))}
              placeholder="Write the announcement residents should see"
            />
            <span className="block text-right font-normal text-slate-400">{form.message.length}/5000</span>
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-brand-blue focus:ring-brand-blue"
                checked={form.isActive}
                onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
              />
              Active on public ticker
            </label>
            <div className="flex gap-2">
              {editingId && (
                <button type="button" onClick={resetForm} className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  Cancel
                </button>
              )}
              <button
                type="submit"
                disabled={saving || !form.message.trim() || !Number.isInteger(Number(form.displayOrder)) || Number(form.displayOrder) < 0}
                className="inline-flex items-center gap-2 rounded-md bg-brand-blue px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
              >
                {!editingId && <Plus className="h-4 w-4" aria-hidden="true" />}
                {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add advisory'}
              </button>
            </div>
          </div>
        </form>
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm" aria-labelledby="advisory-list-title">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 id="advisory-list-title" className="text-sm font-semibold text-slate-900">All advisories</h2>
        </div>
        {loadError ? (
          <div className="flex flex-wrap items-center justify-between gap-3 p-5" role="alert">
            <p className="text-sm text-rose-700">{loadError}</p>
            <button type="button" onClick={loadAdvisories} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Try again</button>
          </div>
        ) : loading ? (
          <p className="p-5 text-sm text-slate-500" role="status">Loading advisories…</p>
        ) : rows.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">No advisories have been created.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-5 py-3">Message</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Created</th>
                  <th scope="col" className="px-4 py-3">Order</th>
                  <th scope="col" className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((advisory) => (
                  <tr key={advisory.id} className="align-top">
                    <td className="max-w-xl px-5 py-4">
                      {advisory.title && <p className="mb-1 font-semibold text-slate-800">{advisory.title}</p>}
                      <p className="whitespace-pre-wrap break-words text-slate-600">{advisory.message}</p>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${advisory.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                        {advisory.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                      {advisory.createdAt ? new Date(advisory.createdAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-4 text-slate-600">{advisory.displayOrder}</td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          disabled={updatingId === advisory.id}
                          onClick={() => toggleStatus(advisory)}
                          className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {advisory.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                        <button type="button" onClick={() => beginEdit(advisory)} aria-label={`Edit ${advisory.title || 'advisory'}`} className="rounded-md p-2 text-slate-500 hover:bg-blue-50 hover:text-brand-blue">
                          <Edit2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button type="button" onClick={() => setPendingDelete(advisory)} aria-label={`Delete ${advisory.title || 'advisory'}`} className="rounded-md p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-700">
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmDialog
        isOpen={Boolean(pendingDelete)}
        title="Delete advisory?"
        message="This announcement will be permanently removed from the database and public ticker."
        confirmLabel={deleting ? 'Deleting…' : 'Delete advisory'}
        onConfirm={deleteAdvisory}
        onCancel={() => !deleting && setPendingDelete(null)}
      />
    </div>
  );
};

export default AdvisoryManagement;

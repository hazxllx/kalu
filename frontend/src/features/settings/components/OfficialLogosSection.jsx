import React, { useCallback, useEffect, useState } from 'react';
import { Building2, Image, RefreshCw, Trash2, Upload } from 'lucide-react';
import { Card } from '@/components/common/Card';
import { documentBrandingApi } from '@/services/api/documentBrandingApi';

const LOGO_DETAILS = {
  municipal: {
    title: 'Municipality Logo',
    description: 'Used by approved municipal and barangay health document templates.',
  },
  rhu: {
    title: 'Rural Health Unit (RHU) Logo',
    description: 'Used only by document templates whose approved format calls for RHU branding.',
  },
};

const MAX_SIZE = 5 * 1024 * 1024;

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

export default function OfficialLogosSection() {
  const [configuration, setConfiguration] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmation, setConfirmation] = useState(null);

  const loadConfiguration = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await documentBrandingApi.getAdminLogos();
      setConfiguration(result);
    } catch (loadError) {
      setError(loadError?.message || 'Could not load official logo settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfiguration();
  }, [loadConfiguration]);

  useEffect(() => () => {
    Object.values(drafts).forEach((draft) => URL.revokeObjectURL(draft.previewUrl));
  }, [drafts]);

  const stageFile = (logoType, file) => {
    setError('');
    setNotice('');
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setError('Choose a PNG or JPEG image.');
      return;
    }
    if (file.size > MAX_SIZE) {
      setError('Logo files must not exceed 5 MB.');
      return;
    }
    setDrafts((previous) => {
      if (previous[logoType]?.previewUrl) URL.revokeObjectURL(previous[logoType].previewUrl);
      return {
        ...previous,
        [logoType]: { file, previewUrl: URL.createObjectURL(file) },
      };
    });
  };

  const clearDraft = (logoType) => {
    setDrafts((previous) => {
      if (previous[logoType]?.previewUrl) URL.revokeObjectURL(previous[logoType].previewUrl);
      const next = { ...previous };
      delete next[logoType];
      return next;
    });
  };

  const upload = async (logoType) => {
    const draft = drafts[logoType];
    if (!draft) return;
    setBusy((previous) => ({ ...previous, [logoType]: true }));
    setError('');
    setNotice('');
    try {
      const result = await documentBrandingApi.uploadLogo(logoType, draft.file);
      setConfiguration((previous) => ({
        ...previous,
        logos: { ...previous.logos, [logoType]: result.logo },
      }));
      clearDraft(logoType);
      setNotice(`${LOGO_DETAILS[logoType].title} ${configuration?.logos?.[logoType] ? 'replaced' : 'uploaded'} successfully.${result.cleanupWarning ? ` ${result.cleanupWarning}` : ''}`);
    } catch (uploadError) {
      setError(uploadError?.message || `Could not save the ${LOGO_DETAILS[logoType].title.toLowerCase()}.`);
    } finally {
      setBusy((previous) => ({ ...previous, [logoType]: false }));
      setConfirmation(null);
    }
  };

  const remove = async (logoType) => {
    setBusy((previous) => ({ ...previous, [logoType]: true }));
    setError('');
    setNotice('');
    try {
      const result = await documentBrandingApi.removeLogo(logoType);
      setConfiguration((previous) => ({
        ...previous,
        logos: { ...previous.logos, [logoType]: null },
      }));
      setNotice(`${LOGO_DETAILS[logoType].title} removed.${result.cleanupWarning ? ` ${result.cleanupWarning}` : ''}`);
    } catch (removeError) {
      setError(removeError?.message || `Could not remove the ${LOGO_DETAILS[logoType].title.toLowerCase()}.`);
    } finally {
      setBusy((previous) => ({ ...previous, [logoType]: false }));
      setConfirmation(null);
    }
  };

  const runConfirmation = () => {
    if (!confirmation) return;
    const { action, logoType } = confirmation;
    if (action === 'replace') upload(logoType);
    else remove(logoType);
  };

  return (
    <>
      <Card className="p-4 sm:p-5">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand-blue">
            <Building2 className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-brand-ink sm:text-base">Official Logos &amp; Document Branding</h2>
            <p className="mt-1 text-sm text-brand-gray">
              Manage municipality-scoped logos used automatically by approved document templates.
              {configuration?.municipality?.name ? ` Scope: ${configuration.municipality.name}${configuration.municipality.province ? `, ${configuration.municipality.province}` : ''}.` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={loadConfiguration}
            disabled={loading}
            aria-label="Refresh official logo settings"
            className="ml-auto rounded-btn p-2 text-brand-gray transition-colors hover:bg-brand-bg hover:text-brand-blue disabled:opacity-50 dark:hover:bg-hover"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <p className="mb-3 rounded-btn bg-brand-bg px-3 py-1.5 text-xs text-brand-gray dark:bg-card-nested">
          Supported formats: PNG and JPEG. Maximum file size: 5 MB. Document branding is selected by the server-approved template; uploading a logo does not grant document access.
        </p>

        {error && <p role="alert" className="mb-4 rounded-btn bg-brand-danger/5 px-3 py-2 text-sm text-brand-danger">{error}</p>}
        {notice && <p role="status" className="mb-4 rounded-btn bg-brand-green/10 px-3 py-2 text-sm text-brand-green">{notice}</p>}

        {loading ? (
          <p className="py-6 text-center text-sm text-brand-gray">Loading logo configuration…</p>
        ) : (
          <>
            {!configuration?.logos?.municipal || !configuration?.logos?.rhu ? (
              <p className="mb-4 rounded-btn border border-brand-yellow/30 bg-brand-yellow/10 px-3 py-2 text-sm text-brand-ink dark:text-foreground">
                Branding is incomplete. Templates requiring an unconfigured logo will use their text-only fallback.
              </p>
            ) : null}

            <div className="grid items-start gap-3 lg:grid-cols-2">
              {Object.entries(LOGO_DETAILS).map(([logoType, details]) => {
                const configuredLogo = configuration?.logos?.[logoType] || null;
                const draft = drafts[logoType];
                const isBusy = Boolean(busy[logoType]);
                return (
                  <section key={logoType} className="rounded-btn border border-brand-border p-3 dark:border-border">
                    <h3 className="text-sm font-semibold text-brand-ink">
                      {logoType === 'municipal' && configuration?.municipality?.name
                        ? `Municipality of ${configuration.municipality.name} Logo`
                        : details.title}
                    </h3>
                    <p className="mt-1 text-xs text-brand-gray">{details.description}</p>

                    <div className="mt-2 flex h-[110px] min-h-0 shrink-0 items-center justify-center overflow-hidden rounded-btn bg-brand-bg p-2 dark:bg-card-nested">
                      {draft ? (
                        <img src={draft.previewUrl} alt={`${details.title} preview`} className="block h-auto max-h-[90px] max-w-[110px] w-auto object-contain" />
                      ) : configuredLogo ? (
                        <img src={configuredLogo.url} alt={`${details.title} current preview`} className="block h-auto max-h-[90px] max-w-[110px] w-auto object-contain" />
                      ) : (
                        <div className="flex items-center gap-2 text-sm text-brand-gray">
                          <Image className="h-4 w-4" /> No logo configured
                        </div>
                      )}
                    </div>

                    {draft ? (
                      <>
                        <p className="mt-2 truncate text-xs text-brand-gray" title={draft.file.name}>
                          Preview: {draft.file.name}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => configuredLogo
                              ? setConfirmation({ action: 'replace', logoType })
                              : upload(logoType)}
                            className="inline-flex min-h-10 items-center gap-2 rounded-btn bg-brand-blue px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                          >
                            <Upload className="h-4 w-4" />
                            {isBusy ? 'Saving…' : configuredLogo ? 'Save replacement' : 'Upload logo'}
                          </button>
                          <button type="button" disabled={isBusy} onClick={() => clearDraft(logoType)} className="min-h-10 rounded-btn border border-brand-border px-3 py-2 text-sm text-brand-gray hover:bg-brand-bg disabled:opacity-50 dark:border-border dark:hover:bg-hover">
                            Cancel preview
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-btn border border-brand-border px-3 py-2 text-sm font-medium text-brand-ink transition-colors hover:border-brand-blue hover:text-brand-blue dark:border-border">
                          <Upload className="h-4 w-4" />
                          {configuredLogo ? 'Replace logo' : 'Upload logo'}
                          <input
                            type="file"
                            accept="image/png,image/jpeg"
                            className="sr-only"
                            disabled={isBusy}
                            onChange={(event) => {
                              stageFile(logoType, event.target.files?.[0]);
                              event.target.value = '';
                            }}
                          />
                        </label>
                        {configuredLogo && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => setConfirmation({ action: 'remove', logoType })}
                            className="inline-flex min-h-10 items-center gap-2 rounded-btn border border-brand-danger/30 px-3 py-2 text-sm text-brand-danger hover:bg-brand-danger/5 disabled:opacity-50"
                          >
                            <Trash2 className="h-4 w-4" /> Remove
                          </button>
                        )}
                      </div>
                    )}

                    <p className="mt-2 text-xs text-brand-gray">
                      {configuredLogo
                        ? `Configured · Updated ${formatDate(configuredLogo.updatedAt)}`
                        : 'Not configured'}
                    </p>
                    {configuredLogo?.originalFilename && (
                      <p className="truncate text-xs text-brand-gray" title={configuredLogo.originalFilename}>
                        {configuredLogo.originalFilename} · {(configuredLogo.fileSize / 1024).toFixed(0)} KB
                      </p>
                    )}
                  </section>
                );
              })}
            </div>
          </>
        )}
      </Card>

      {confirmation && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4" role="presentation">
          <div role="alertdialog" aria-modal="true" aria-labelledby="logo-confirm-title" className="w-full max-w-md rounded-card border border-brand-border bg-white p-5 shadow-float dark:border-border dark:bg-card">
            <h3 id="logo-confirm-title" className="font-semibold text-brand-ink dark:text-foreground">
              {confirmation.action === 'replace' ? 'Replace official logo?' : 'Remove official logo?'}
            </h3>
            <p className="mt-2 text-sm text-brand-gray">
              {confirmation.action === 'replace'
                ? `The new ${LOGO_DETAILS[confirmation.logoType].title.toLowerCase()} will become active for its approved document templates.`
                : `The ${LOGO_DETAILS[confirmation.logoType].title.toLowerCase()} will no longer be available to document templates.`}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmation(null)} className="min-h-10 rounded-btn border border-brand-border px-3 py-2 text-sm text-brand-gray dark:border-border">
                Cancel
              </button>
              <button
                type="button"
                disabled={Boolean(busy[confirmation.logoType])}
                onClick={runConfirmation}
                className="min-h-10 rounded-btn bg-brand-danger px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy[confirmation.logoType]
                  ? confirmation.action === 'replace' ? 'Saving…' : 'Removing…'
                  : confirmation.action === 'replace' ? 'Confirm replacement' : 'Confirm removal'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

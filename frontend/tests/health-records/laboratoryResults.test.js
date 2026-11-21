import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { transformWithEsbuild } from 'vite';

const origin = 'http://127.0.0.1:59999';
const token = 'synthetic-lab-session';
const endpoint = '/api/lab-results';
const result = { id: 'result/a', fileName: 'synthetic-urinalysis.pdf', category: 'urinalysis' };
const json = (data, status = 200) => Response.json(data, { status });
const Empty = () => null;

async function compile(path, loader, define) {
  const filename = new URL(path, import.meta.url);
  const { code } = await transformWithEsbuild(await readFile(filename, 'utf8'), filename.pathname, {
    loader, format: 'cjs', jsx: 'transform', define,
  });
  return code;
}

const [panelCode, apiCode] = await Promise.all([
  compile('../../src/features/health-records/components/LabResultsPanel.jsx', 'jsx'),
  compile('../../src/services/api/apiClient.js', 'js', { 'import.meta.env': '{}' }),
]);

function load(code, imports, globals = {}) {
  const module = { exports: {} };
  const resolve = (id) => {
    assert.ok(Object.hasOwn(imports, id), `Unexpected dependency: ${id}`);
    return imports[id];
  };
  new Function('require', 'module', 'exports', ...Object.keys(globals), code)(
    resolve, module, module.exports, ...Object.values(globals),
  );
  return module.exports;
}

async function mount(t, { props, respond, permissions = [], userId = 'synthetic-user' }) {
  const requests = [];
  const { api } = load(apiCode, {
    '../../lib/supabase.js': {
      supabase: { auth: { getSession: async () => ({ data: { session: { access_token: token, user: { id: userId } } } }) } },
    },
    './apiBaseUrl.js': { resolveApiBaseUrl: () => `${origin}/api` },
    '../offline/mutationPolicy.js': { MUTATION_TIER: { ONLINE_ONLY: 'ONLINE_ONLY' }, requireOnlineForMutation() {} },
    '../accessControl/permissionCache.js': {},
    '../offline/db.js': {
      getOfflineOwnerId: () => userId,
      captureOwnerGuard: (ownerId) => { assert.equal(ownerId, userId); return () => ownerId === userId; },
      assertCurrentOwner: (guard) => assert.equal(guard(), true),
    },
    '../../utils/performanceMonitor.js': { performanceMonitor: { recordApiMetric() {} } },
  }, {
    setTimeout: () => 1,
    fetch: async (url, options) => {
      const request = new Request(url, options);
      assert.equal(new URL(request.url).origin, origin);
      requests.push(request);
      return respond(request);
    },
  });
  const opened = { opener: {} };
  const openCalls = [];
  const previewBlobs = [];
  const timers = [];
  const revoked = [];
  const objectUrl = 'blob:http://127.0.0.1:59999/synthetic-lab-preview';
  const { default: LabResultsPanel } = load(panelCode, {
    react: React,
    'lucide-react': { FileText: Empty, FlaskConical: Empty, Loader2: Empty, Upload: Empty },
    '@/services/api': { api },
    '@/context/AuthContext': { useAuth: () => ({ user: { id: userId } }) },
    '@/context/PermissionsContext': { usePermissions: () => ({ can: (permission) => permissions.includes(permission) }) },
  }, {
    window: {
      open: (...args) => { openCalls.push(args); return opened; },
      setTimeout: (callback, delay) => timers.push({ callback, delay }),
    },
    URL: {
      createObjectURL: (blob) => { previewBlobs.push(blob); return objectUrl; },
      revokeObjectURL: (url) => revoked.push(url),
    },
  });
  let renderer;
  await act(async () => { renderer = create(React.createElement(LabResultsPanel, props)); });
  t.after(() => act(() => renderer.unmount()));
  return {
    requests, opened, openCalls, previewBlobs, timers, revoked, objectUrl,
    text: () => JSON.stringify(renderer.toJSON()),
    alert: () => renderer.root.findAllByProps({ role: 'alert' })[0]?.children.join(''),
    button: (label) => renderer.root.findAllByType('button').find((node) =>
      node.children.filter((child) => typeof child === 'string').join('').trim() === label),
    selectFile: (file, category) => act(async () => {
      renderer.root.findByType('select').props.onChange({ target: { value: category } });
      renderer.root.findByType('input').props.onChange({ target: { files: [file] } });
    }),
    submit: (reset) => act(async () => {
      await renderer.root.findByType('form').props.onSubmit({ preventDefault() {}, currentTarget: { reset } });
    }),
    update: (nextProps) => act(async () => { renderer.update(React.createElement(LabResultsPanel, nextProps)); }),
  };
}

test('resident requests their own results and retains a failed multipart upload for retry', async (t) => {
  let attempts = 0;
  let uploaded = false;
  const panel = await mount(t, {
    props: { canUpload: true },
    respond: (request) => {
      assert.equal(request.url, `${origin}${endpoint}`);
      if (request.method === 'GET') return json({ data: uploaded ? [result] : [] });
      assert.equal(request.method, 'POST');
      attempts += 1;
      if (attempts === 1) return json({ error: { message: 'Laboratory upload temporarily unavailable' } }, 503);
      uploaded = true;
      return json({ data: result }, 201);
    },
  });
  assert.match(panel.text(), /No laboratory results recorded yet/);
  assert.equal(panel.requests[0].cache, 'no-store');
  assert.equal(panel.button('Upload').props.disabled, true);

  const file = new File(['synthetic pdf contents'], result.fileName, { type: 'application/pdf' });
  await panel.selectFile(file, result.category);
  let resets = 0;
  const reset = () => { resets += 1; };
  await panel.submit(reset);
  assert.equal(panel.alert(), 'Laboratory upload temporarily unavailable');
  assert.equal(panel.button('Upload').props.disabled, false);
  assert.match(panel.text(), /synthetic-urinalysis\.pdf/);
  assert.equal(resets, 0);
  assert.deepEqual(panel.requests.map(({ method }) => method), ['GET', 'POST']);

  await panel.submit(reset);
  assert.equal(panel.alert(), undefined);
  assert.equal(resets, 1);
  assert.equal(panel.button('Upload').props.disabled, true);
  assert.deepEqual(panel.requests.map(({ method }) => method), ['GET', 'POST', 'POST', 'GET']);
  assert.equal(panel.requests.at(-1).cache, 'no-store');
  for (const request of panel.requests.filter(({ method }) => method === 'POST')) {
    assert.match(request.headers.get('content-type'), /^multipart\/form-data;\s*boundary=/i);
    const body = await request.formData();
    assert.deepEqual([...body.keys()].sort(), ['category', 'file']);
    assert.equal(body.get('category'), result.category);
    assert.ok(body.get('file') instanceof File);
    assert.equal(body.get('file').name, file.name);
    assert.equal(body.get('file').type, file.type);
    assert.equal(await body.get('file').text(), await file.text());
  }
  assert.match(panel.text(), /synthetic-urinalysis\.pdf/);
  assert.match(panel.text(), /Requires clinical review/);
  assert.ok(panel.button('Open'), 'the refreshed list contains the uploaded result');
});

test('staff list by resident and open a private authenticated no-store blob', async (t) => {
  const panel = await mount(t, {
    props: { residentId: 'resident / a', consultationId: 'visit-1' },
    respond: (request) => new URL(request.url).pathname.endsWith('/file')
      ? new Response('synthetic pdf', { headers: { 'Content-Type': 'application/pdf' } })
      : json({ data: [result] }),
  });
  assert.deepEqual([...new URL(panel.requests[0].url).searchParams], [['residentId', 'resident / a']]);
  assert.equal(panel.requests[0].cache, 'no-store');
  assert.equal(panel.button('Upload'), undefined);
  assert.equal(panel.button('Link to consultation'), undefined);
  await act(async () => { await panel.button('Open').props.onClick(); });
  const request = panel.requests[1];
  assert.equal(request.method, 'GET');
  assert.equal(request.url, `${origin}${endpoint}/result%2Fa/file`);
  assert.equal(request.headers.get('Authorization'), `Bearer ${token}`);
  assert.equal(request.cache, 'no-store');
  assert.deepEqual(panel.openCalls, [['about:blank', '_blank']]);
  assert.equal(panel.opened.opener, null);
  assert.equal(panel.opened.location, panel.objectUrl);
  assert.ok(panel.previewBlobs[0] instanceof Blob);
  assert.equal(panel.previewBlobs[0].type, 'application/pdf');
  assert.equal(await panel.previewBlobs[0].text(), 'synthetic pdf');
  assert.equal(panel.timers.length, 1);
  panel.timers[0].callback();
  assert.deepEqual(panel.revoked, [panel.objectUrl]);
});

test('authorized staff explicitly link an unassigned result to the current consultation and reload', async (t) => {
  let linked = null;
  const panel = await mount(t, {
    props: { residentId: 'resident-a', consultationId: 'consultation-current' },
    permissions: ['consultation.records.update', 'consultation.history.view'],
    respond: async (request) => {
      if (request.method === 'GET') return json({ data: [{ ...result, consultationId: linked }] });
      assert.equal(request.method, 'PATCH');
      assert.equal(request.url, `${origin}${endpoint}/result%2Fa`);
      const body = await request.json();
      assert.deepEqual(body, { consultationId: 'consultation-current' });
      linked = body.consultationId;
      return json({ data: { ...result, consultationId: linked } });
    },
  });
  assert.deepEqual(panel.requests.map(({ method }) => method), ['GET']);
  await act(async () => { await panel.button('Link to consultation').props.onClick(); });
  assert.deepEqual(panel.requests.map(({ method }) => method), ['GET', 'PATCH', 'GET']);
  assert.equal(panel.requests[2].url, `${origin}${endpoint}?residentId=resident-a`);
  assert.equal(panel.button('Link to consultation'), undefined);
  assert.ok(panel.button('Open'));
});

test('a late GET for the previous resident cannot replace the current resident results', async (t) => {
  let finishPrevious;
  const previous = new Promise((resolve) => { finishPrevious = resolve; });
  const panel = await mount(t, {
    props: { residentId: 'previous-resident' },
    respond: (request) => new URL(request.url).searchParams.get('residentId') === 'previous-resident'
      ? previous
      : json({ data: [{ ...result, id: 'current-result', fileName: 'current-resident-result.pdf' }] }),
  });
  assert.match(panel.text(), /Loading laboratory results/);
  await panel.update({ residentId: 'current-resident' });
  assert.match(panel.text(), /current-resident-result\.pdf/);
  await act(async () => { finishPrevious(json({ data: [{ ...result, fileName: 'previous-resident-result.pdf' }] })); });
  assert.deepEqual(panel.requests.map(({ url }) => new URL(url).searchParams.get('residentId')), ['previous-resident', 'current-resident']);
  assert.match(panel.text(), /current-resident-result\.pdf/);
  assert.doesNotMatch(panel.text(), /previous-resident-result\.pdf/);
});

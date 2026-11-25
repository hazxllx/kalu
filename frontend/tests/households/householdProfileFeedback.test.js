import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Module from 'node:module';
import { build } from 'esbuild';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const result = await build({
  entryPoints: ['src/features/households/pages/EditHouseholdPage.jsx'], bundle: true, write: false,
  platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'test-context', setup(builder) {
    builder.onResolve({ filter: /^(@\/|react-router-dom$|lucide-react$)/ }, (args) => ({ path: args.path, namespace: 'test-context' }));
    builder.onLoad({ filter: /.*/, namespace: 'test-context' }, ({ path: name }) => {
      let contents;
      if (name === 'lucide-react') contents = `export const ArrowLeft = () => null, Save = () => null, RotateCcw = () => null, ChevronDown = () => null, CheckCircle2 = () => null, X = () => null;`;
      else if (name === 'react-router-dom') contents = `export const useNavigate = () => () => {}; export const useParams = () => ({ householdId: 'HH-test' });`;
      else if (name.includes('AuthContext')) contents = `export const useAuth = () => ({ user: { id: 'worker', role: 'bhw' } });`;
      else if (name.includes('PermissionsContext')) contents = `export const usePermissions = () => ({ canAny: () => true });`;
      else if (name.includes('useSyncStatus')) contents = `export const useSyncStatus = () => ({ online: true });`;
      else if (name.includes('householdsApi')) contents = `export const householdsApi = { updateMember: (...args) => globalThis.hhFeedbackTest.updateMember(...args), createVisit: (...args) => globalThis.hhFeedbackTest.createVisit(...args) };`;
      else if (name.includes('householdOfflineService')) contents = `export const getHouseholdOffline = async () => globalThis.hhFeedbackTest.household; export const updateHouseholdOffline = (...args) => globalThis.hhFeedbackTest.update(...args);`;
      else contents = `import React from 'react'; export const Card = ({ children }) => React.createElement('div', null, children); export default Card;`;
      return { contents, loader: 'js', resolveDir: process.cwd() };
    });
  } }],
});
const compiled = new Module(path.resolve('feedback-test.cjs'));
compiled.filename = path.resolve('feedback-test.cjs');
compiled.paths = Module._nodeModulePaths(process.cwd());
compiled._compile(result.outputFiles[0].text, compiled.filename);
const Page = compiled.exports.default;
const text = (node) => typeof node === 'string' ? node : (node?.children || []).map(text).join('');
const findButton = (root, label) => root.findAllByType('button').find((node) => text(node) === label);
const field = (root, label) => root.findAllByType('label').find((node) => typeof node.children[0] === 'string' && node.children[0] === label).findByType('input');
async function mount(t, update) {
  globalThis.window = { location: { pathname: '/app/bhw/households/HH-test/edit' } };
  globalThis.hhFeedbackTest = {
    household: { headName: 'Test Head', purok: 'Purok 1', streetAddress: 'Main Street', contact: '', members: [] },
    update, createVisit: async () => ({}), updateMember: async () => ({}),
  };
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(Page)); });
  t.after(() => { act(() => renderer.unmount()); delete globalThis.hhFeedbackTest; delete globalThis.window; });
  return renderer;
}

test('profile save validates fields, prevents duplicate requests and shows success only after confirmation', async (t) => {
  let resolve, calls = 0;
  const renderer = await mount(t, () => { calls++; return new Promise((done) => { resolve = done; }); });
  const root = renderer.root;
  assert.equal(root.findAll((node) => node.props['aria-invalid'] === true).length, 0);
  act(() => field(root, 'Household head name').props.onChange({ target: { value: '' } }));
  await act(async () => findButton(root, 'Save section').props.onClick());
  assert.equal(calls, 0);
  assert.equal(field(root, 'Household head name').props['aria-invalid'], true);
  act(() => field(root, 'Household head name').props.onChange({ target: { value: 'Updated Head' } }));
  assert.equal(field(root, 'Household head name').props['aria-invalid'], false);
  const save = findButton(root, 'Save section').props.onClick;
  await act(async () => { save(); save(); });
  assert.equal(calls, 1);
  assert.ok(!text(renderer.toJSON()).includes('Changes saved.'));
  await act(async () => resolve({ household: { headName: 'Updated Head', purok: 'Purok 1', streetAddress: 'Main Street' }, queued: false }));
  assert.ok(text(renderer.toJSON()).includes('Changes saved.'));
  act(() => root.findAllByType('button').find((node) => text(node).startsWith('Household details')).props.onClick());
  assert.ok(!text(renderer.toJSON()).includes('Changes saved.'));
});

test('API field errors remain beside the field and failed requests retain entered values', async (t) => {
  const renderer = await mount(t, async () => { throw { status: 422, payload: { error: { errors: { contact: 'Check this mobile number.' } } } }; });
  const root = renderer.root;
  act(() => field(root, 'Contact number').props.onChange({ target: { value: '09123456789' } }));
  await act(async () => findButton(root, 'Save section').props.onClick());
  assert.equal(field(root, 'Contact number').props.value, '09123456789');
  assert.equal(field(root, 'Contact number').props['aria-invalid'], true);
  assert.ok(text(renderer.toJSON()).includes('Check this mobile number.'));
  assert.ok(!text(renderer.toJSON()).includes('Changes saved.'));
});

test('queued changes use warning feedback and never write a server visit', async (t) => {
  const renderer = await mount(t, async () => ({ household: { headName: 'Queued Head' }, queued: true }));
  let visits = 0;
  globalThis.hhFeedbackTest.createVisit = async () => { visits++; };
  act(() => field(renderer.root, 'Household head name').props.onChange({ target: { value: 'Queued Head' } }));
  await act(async () => findButton(renderer.root, 'Save section').props.onClick());
  assert.equal(visits, 0);
  assert.ok(text(renderer.toJSON()).includes('Waiting to sync.'));
  assert.ok(!text(renderer.toJSON()).includes('Changes saved.'));
});

test('missing visit date is shown next to the date without sending a request', async (t) => {
  const renderer = await mount(t, async () => ({}));
  let visits = 0;
  globalThis.hhFeedbackTest.createVisit = async () => { visits++; };
  act(() => field(renderer.root, 'Visit date').props.onChange({ target: { value: '' } }));
  await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.equal(visits, 0);
  assert.equal(field(renderer.root, 'Visit date').props['aria-invalid'], true);
});


test('confirmed success dismisses automatically; partial visit-history failure is a warning', async (t) => {
  const renderer = await mount(t, async () => ({ household: { headName: 'Saved Head' }, queued: false }));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  act(() => field(renderer.root, 'Household head name').props.onChange({ target: { value: 'Saved Head' } }));
  await act(async () => findButton(renderer.root, 'Save section').props.onClick());
  assert.ok(text(renderer.toJSON()).includes('Changes saved.'));
  act(() => t.mock.timers.tick(4500));
  assert.ok(!text(renderer.toJSON()).includes('Changes saved.'));
  act(() => renderer.root.findAllByType('button').find((node) => text(node).startsWith('Household information')).props.onClick());
  globalThis.hhFeedbackTest.createVisit = async () => { throw new Error('SQL internal error'); };
  act(() => field(renderer.root, 'Household head name').props.onChange({ target: { value: 'Another Head' } }));
  await act(async () => findButton(renderer.root, 'Save section').props.onClick());
  assert.ok(text(renderer.toJSON()).includes('Profile saved; visit history was not recorded.'));
  assert.ok(!text(renderer.toJSON()).includes('SQL'));
  assert.ok(renderer.root.findAll((node) => node.type === 'div' && node.props.role === 'status').some((node) => node.props.className.includes('bg-amber-50')));
});


test('cancel restores saved values and clears stale field errors', async (t) => {
  const renderer = await mount(t, async () => ({}));
  const root = renderer.root;
  act(() => field(root, 'Household head name').props.onChange({ target: { value: '' } }));
  await act(async () => findButton(root, 'Save section').props.onClick());
  assert.equal(field(root, 'Household head name').props['aria-invalid'], true);
  act(() => findButton(root, 'Cancel').props.onClick());
  assert.equal(field(root, 'Household head name').props.value, 'Test Head');
  assert.equal(field(root, 'Household head name').props['aria-invalid'], false);
  assert.ok(!text(renderer.toJSON()).includes('Check the highlighted fields.'));
});

test('failed visit requests retain date and reason without success feedback', async (t) => {
  const renderer = await mount(t, async () => ({}));
  globalThis.hhFeedbackTest.createVisit = async () => { throw { status: 500, message: 'SQL constraint stack trace' }; };
  act(() => field(renderer.root, 'Visit date').props.onChange({ target: { value: '2026-01-15' } }));
  await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.equal(field(renderer.root, 'Visit date').props.value, '2026-01-15');
  assert.ok(!text(renderer.toJSON()).includes('Visit recorded.'));
  assert.ok(!text(renderer.toJSON()).includes('SQL constraint'));
  assert.ok(text(renderer.toJSON()).includes('Please try again.'));
});

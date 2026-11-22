import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { act, create } from "react-test-renderer";
import { transformWithEsbuild } from "vite";
import * as lifecycle from "../../src/features/users/personnelLifecycle.js";

const require = createRequire(import.meta.url);
const filename = new URL("../../src/features/users/pages/UserManagement.jsx", import.meta.url);
const source = await readFile(filename, "utf8");
const { code } = await transformWithEsbuild(source, filename.pathname, { loader: "jsx", format: "cjs", jsx: "transform" });
const Panel = ({ children }) => React.createElement("div", null, children);
const Empty = () => null;
// Keep application dialogs, fields and handlers real; replace only portal/menu primitives.
const dialog = Object.fromEntries(["Root", "Portal", "Overlay", "Content", "Title", "Description", "Close"].map((name) => [name, Panel]));
const dropdown = {
  ...Object.fromEntries(["Root", "Trigger", "Portal", "Content"].map((name) => [name, Panel])),
  Item: ({ children, onSelect, disabled }) => React.createElement("button", { onClick: onSelect, disabled }, children),
};
const options = {
  roles: [{ id: "phn", name: "Public Health Nurse" }],
  municipalities: [{ id: "pili", name: "Pili" }], barangays: [], facilities: [], rhuStations: [],
};
const resident = { id: "resident-1", name: "Directory Resident", email: "resident@example.test", role: "resident", status: "active" };
const personnel = {
  id: "personnel-1", name: "Directory Personnel", email: "personnel@example.test", role: "phn", status: "disabled",
  approvalStatus: "approved", setupRequired: true, activationRequested: true,
};
const text = (node) => typeof node === "string" ? node : Array.isArray(node)
  ? node.map(text).join(" ") : node?.children ? text(node.children) : "";
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

async function mount({ account = resident, accounts = [account], get = async () => ({ user: account }), history = async () => ({ audit: [], notifications: [] }), created = personnel } = {}) {
  const calls = { get: [], history: [], create: [], list: 0, summary: 0 };
  const creationStarted = deferred();
  const toasts = [];
  const timers = new Map();
  let timerId = 0;
  const browser = {
    setTimeout: (callback) => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: (id) => timers.delete(id),
  };
  const usersApi = {
    options: async () => options,
    summary: async () => { calls.summary += 1; return { total: 1 }; },
    list: async () => { calls.list += 1; return { rows: accounts, total: accounts.length }; },
    get: async (id) => { calls.get.push(id); return get(id); },
    history: async (id) => { calls.history.push(id); return history(id); },
    create: async (...args) => { calls.create.push(args); creationStarted.resolve(); return { user: created }; },
  };
  const overrides = {
    "@/services/api": { usersApi },
    "../personnelLifecycle": lifecycle,
    "@/context/AuthContext": { useAuth: () => ({ user: { id: "admin-1", role: "admin" } }) },
    "@/context/PermissionsContext": { usePermissions: () => ({ can: () => true }) },
    "@/components/ui/use-toast": { useToast: () => ({ toast: (toast) => toasts.push(toast) }) },
    "@/lib/supabase": { supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: "admin-1" }, access_token: "test-token" } } }) } } },
    "react-router-dom": { useOutletContext: () => ({}) },
    "@radix-ui/react-dialog": dialog,
    "@radix-ui/react-dropdown-menu": dropdown,
    "@/components/common/Card": { Card: Panel },
    "@/components/common/PageHeader": Empty,
    "@/components/tables/TablePagination": Empty,
    "@/layouts/NavTabsLayout": { NavTabs: Empty },
    "@/features/verification/components/DocumentPreviewCard": Empty,
    "lucide-react": new Proxy({}, { get: () => Empty }),
  };
  const module = { exports: {} };
  const load = (id) => {
    if (Object.hasOwn(overrides, id)) return overrides[id];
    if (id === "react") return require(id);
    throw new Error(`Unexpected component dependency: ${id}`);
  };
  new Function("require", "module", "exports", "window", code)(load, module, module.exports, browser);
  let renderer;
  await act(async () => { renderer = create(React.createElement(module.exports.default)); });
  await act(async () => {
    for (const [id, callback] of timers) { timers.delete(id); await callback(); }
  });
  return {
    renderer, calls, toasts,
    text: () => text(renderer.toJSON()),
    click: async (label, within = renderer.root) => {
      const button = within.findAllByType("button").find((node) => text(node).trim() === label);
      assert.ok(button, `Expected button: ${label}`);
      assert.ok(!button.props.disabled, `${label} must be enabled`);
      await act(async () => { await button.props.onClick(); });
    },
    change: async (id, value) => act(async () => { renderer.root.findByProps({ id }).props.onChange({ target: { value } }); }),
    submit: async () => act(async () => {
      renderer.root.findByType("form").props.onSubmit({ preventDefault() {} });
      await creationStarted.promise;
    }),
    close: () => act(() => renderer.unmount()),
  };
}

for (const role of ["resident", "resident-limited"]) {
  test(`${role} details fetch the full profile without requesting personnel history`, async () => {
    const response = deferred();
    const page = await mount({ account: { ...resident, role }, get: () => response.promise });
    try {
      await page.click("View details");
      assert.deepEqual(page.calls.get, [resident.id]);
      assert.deepEqual(page.calls.history, []);
      await act(async () => response.resolve({ user: {
        ...resident, role, name: "Fetched Resident", status: "disabled", contact: "09123456789", municipality: "Pili", barangay: "Fetched Barangay",
      } }));
      const overview = page.renderer.root.findByProps({ "aria-label": "Account Overview" });
      assert.match(text(overview), /Deactivated/);
      assert.match(text(overview), /Fetched Barangay/);
      assert.match(page.text(), /Fetched Resident/);
      assert.match(page.text(), /09123456789/);
      assert.doesNotMatch(page.text(), /Account Activity/);
      assert.equal(page.renderer.root.findAllByProps({ role: "alert" }).length, 0);
    } finally { page.close(); }
  });
}

test("resident profile failure is displayed inside details without requesting history", async () => {
  const page = await mount({ get: async () => { throw new Error("Resident details unavailable"); } });
  try {
    await page.click("View details");
    assert.deepEqual(page.calls.get, [resident.id]);
    assert.deepEqual(page.calls.history, []);
    assert.equal(text(page.renderer.root.findByProps({ role: "alert" })), "Resident details unavailable");
    assert.match(page.text(), /Directory Resident/);
  } finally { page.close(); }
});

test("personnel profile refresh applies despite history failure and activity can be retried", async () => {
  let failHistory = true;
  const page = await mount({
    account: personnel,
    get: async () => ({ user: { ...personnel, name: "Refreshed Personnel", status: "active", setupRequired: false, position: "Updated Position", municipality: "Pili" } }),
    history: async () => {
      if (failHistory) throw new Error("History temporarily unavailable");
      return { audit: [{ id: "event-1", action: "account_updated", createdAt: "2026-11-20T10:00:00Z", actorName: "Reviewing Admin" }], notifications: [] };
    },
  });
  try {
    await page.click("View details");
    assert.deepEqual(page.calls.get, [personnel.id]);
    assert.deepEqual(page.calls.history, [personnel.id]);
    assert.match(page.text(), /Refreshed Personnel/);
    assert.match(page.text(), /Updated Position/);
    const overview = page.renderer.root.findByProps({ "aria-label": "Account Overview" });
    assert.match(text(overview), /Sign-in access Enabled/);
    assert.equal(text(page.renderer.root.findByProps({ role: "alert" })), "History temporarily unavailable");
    assert.equal(page.renderer.root.findAllByProps({ role: "status" }).length, 0);
    failHistory = false;
    await page.click("Refresh");
    assert.deepEqual(page.calls.get, [personnel.id, personnel.id]);
    assert.deepEqual(page.calls.history, [personnel.id, personnel.id]);
    assert.equal(page.renderer.root.findAllByProps({ role: "alert" }).length, 0);
    assert.match(page.text(), /account updated/);
    assert.match(page.text(), /Reviewing Admin/);
  } finally { page.close(); }
});

test("closing resident details keeps them closed when the pending profile arrives", async () => {
  const profile = deferred();
  const page = await mount({ get: () => profile.promise });
  try {
    await page.click("View details");
    assert.deepEqual(page.calls.get, [resident.id]);
    assert.equal(page.renderer.root.findAllByProps({ "aria-label": "Account Overview" }).length, 1);

    await page.click("Close");
    await act(async () => profile.resolve({ user: { ...resident, name: "Late Resident Profile" } }));

    assert.equal(page.renderer.root.findAllByProps({ "aria-label": "Account Overview" }).length, 0);
    assert.doesNotMatch(page.text(), /Late Resident Profile/);
  } finally { page.close(); }
});

test("late personnel profile and history cannot replace a different account's open details", async () => {
  const oldProfile = deferred();
  const oldHistory = deferred();
  const next = { ...personnel, id: "personnel-2", name: "Next Directory Account", email: "next@example.test" };
  const activity = (id, action) => ({ audit: [{ id, action }], notifications: [] });
  const page = await mount({
    accounts: [personnel, next],
    get: (id) => id === personnel.id ? oldProfile.promise : { user: { ...next, position: "Current Account Position" } },
    history: (id) => id === personnel.id ? oldHistory.promise : activity("current", "current_account_event"),
  });
  try {
    const row = (account) => page.renderer.root.findAllByType("tr").find((node) => text(node).includes(account.email));
    await page.click("View details", row(personnel));
    assert.deepEqual(page.calls.get, [personnel.id]);
    assert.deepEqual(page.calls.history, [personnel.id]);
    assert.match(page.text(), /Loading account activity/);

    await page.click("Close");
    await page.click("View details", row(next));
    assert.deepEqual(page.calls.get, [personnel.id, next.id]);
    assert.deepEqual(page.calls.history, [personnel.id, next.id]);
    const currentView = page.text();
    assert.match(currentView, /Current Account Position/);
    assert.match(currentView, /current account event/);

    await act(async () => oldProfile.resolve({ user: { ...personnel, position: "Stale Account Position" } }));
    assert.equal(page.text(), currentView);
    await act(async () => oldHistory.resolve(activity("stale", "stale_account_event")));
    assert.equal(page.text(), currentView);
  } finally { page.close(); }
});

for (const [status, expected] of [["failed", /email definitively failed before acceptance/i], ["pending", /Email is queued/], ["sent", /mail server accepted this email/i]]) {
  test(`creation feedback reflects ${status} email state from the returned account`, async () => {
    const page = await mount({ created: { ...personnel, notification: { status } } });
    try {
      await page.click("Create Account");
      await page.change("account-name", "New Personnel");
      await page.change("account-email", "new.personnel@example.test");
      await page.change("account-contact", "09123456789");
      await page.submit();
      assert.equal(page.calls.create.length, 1);
      assert.equal(page.calls.create[0][0].email, "new.personnel@example.test");
      assert.equal(page.calls.create[0][0].role, "phn");
      assert.equal(page.calls.create[0][1].headers.Authorization, "Bearer test-token");
      assert.equal(page.renderer.root.findAllByType("form").length, 0, "confirmed creation closes the form");
      assert.equal(page.calls.list, 2, "creation refreshes the directory");
      assert.equal(page.toasts.length, 1);
      const feedback = text(createToastTree(page.toasts[0].description));
      assert.match(feedback, /account created/i);
      assert.match(feedback, /must finish password setup/);
      assert.match(feedback, expected);
      assert.doesNotMatch(feedback, /Invitation sent|email sent|now active/i);
      if (status !== "sent") assert.doesNotMatch(feedback, /email (?:was |has been )?(?:sent|delivered|accepted)/i);
    } finally { page.close(); }
  });
}

// Toast descriptions are React elements captured before the toast provider renders them.
function createToastTree(element) {
  if (typeof element === "string" || element == null) return element;
  if (Array.isArray(element)) return element.map(createToastTree);
  return { children: createToastTree(element.props?.children) };
}

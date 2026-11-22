// From frontend: node --test tests/offline/consultationBrowserLifecycle.test.mjs
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { calculateConsultationBmi } from '../../../shared/consultationClinical.js';
import { classifyBloodPressure } from '../../../shared/bloodPressure.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixturePath = '/__consultation-browser-test';
const createPath = `${fixturePath}/consultations`;
const ownerId = 'synthetic-browser-owner';
const payload = {
  residentId: 'synthetic-browser-resident',
  consultationDate: '2026-11-06',
  consultationTime: '09:42',
  recordedAt: '2026-11-06T01:43:12.000Z',
  chiefComplaint: 'Synthetic browser complaint',
  findings: 'Synthetic browser findings',
  diagnosis: 'Synthetic browser diagnosis',
  bloodPressure: '118/76', temperature: '36.7', pulseRate: '70', respiratoryRate: '18', height: '160', weight: '60', oxygenSaturation: '98',
  clinicalIndicators: { dangerSignsReviewed: true },
  consultationDetails: { clinicalNote: 'Synthetic immutable note' },
};

async function loadOfflineModules(page) {
  await page.evaluate(async () => {
    const base = '/src/services/offline';
    const [consultations, engine, { db }, { getOperation }] = await Promise.all([
      import(`${base}/consultationOfflineService.js`),
      import(`${base}/syncEngine.js`),
      import(`${base}/db.js`),
      import(`${base}/outbox.js`),
    ]);
    const create = async (data, { headers, signal }) => {
      const response = await fetch(`${location.pathname}/consultations`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal,
      });
      if (!response.ok) throw Object.assign(new Error('Synthetic endpoint failure'), { status: response.status });
      return response.json();
    };
    globalThis.lifecycle = { ...consultations, engine, db, getOperation, create };
  });
}

async function startOfflineEngine(page, { stopOnFailure = false } = {}) {
  await page.evaluate(async ({ ownerId, stopOnFailure }) => {
    const { engine, create, createConsultationSyncHandler } = globalThis.lifecycle;
    const handler = createConsultationSyncHandler(create);
    engine.configureSyncEngine({
      getOwnerId: () => ownerId,
      getHandler: (entity, action) => entity === 'consultation' && action === 'create' ? handler : null,
    });
    if (stopOnFailure) {
      // Hold automatic backoff until the failed IndexedDB state has been checked after a browser restart.
      const unsubscribe = engine.subscribe((snapshot) => {
        if (snapshot.lastResult?.failed !== 1) return;
        unsubscribe();
        engine.stopSyncEngine();
      });
    }
    globalThis.lifecycle.onlineEvents = [];
    globalThis.lifecycle.engineObservedReconnect = false;
    engine.subscribe(({ online, syncing, lastResult }) => {
      if (online && !syncing && !lastResult) globalThis.lifecycle.engineObservedReconnect = true;
    });
    window.addEventListener('online', (event) => globalThis.lifecycle.onlineEvents.push(event.isTrusted));
    engine.startSyncEngine();
    await engine.refreshSyncState();
  }, { ownerId, stopOnFailure });
}

test('Chromium persists and automatically replays one consultation across offline reload and restart', { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'consultation-chromium-'));
  const cacheDir = join(directory, 'vite');
  const requests = [];
  const records = new Map();
  const cachedModules = new Map();
  const blocked = [];
  const pageErrors = [];
  let server;
  let context;
  let origin;
  let offline = false;

  try {
    // Use only explicit test config. The application Vite config loads local .env and enables app plugins.
    server = await createServer({
      root,
      cacheDir,
      configFile: false,
      envDir: false,
      envPrefix: [],
      appType: 'custom',
      server: {
        host: '127.0.0.1', port: 0, strictPort: true, hmr: false, open: false, cors: false, watch: null,
        fs: { allow: [root, cacheDir, fileURLToPath(new URL('../../../shared/', import.meta.url))] },
      },
      optimizeDeps: { noDiscovery: true, include: ['dexie'] },
      plugins: [{
        name: 'synthetic-consultation-endpoint',
        configureServer(vite) {
          vite.middlewares.use(async (request, response, next) => {
            if (request.headers.host !== new URL(origin).host) return response.writeHead(403).end();
            if (request.method !== 'POST' || request.url !== createPath) return next();
            const chunks = [];
            for await (const chunk of request) chunks.push(chunk);
            const body = JSON.parse(Buffer.concat(chunks).toString());
            const key = request.headers['idempotency-key'];
            requests.push({ key, body });
            if (!records.has(key)) {
              records.set(key, {
                ...body,
                id: `synthetic-visit-${records.size + 1}`,
                resident: { id: body.residentId },
                createdAt: body.recordedAt,
                consultationEffectsCompletedAt: body.recordedAt,
                status: 'completed',
                vitals: { bp: body.bloodPressure, temperature: Number(body.temperature), hr: Number(body.pulseRate), rr: Number(body.respiratoryRate), heightCm: Number(body.height), weightKg: Number(body.weight), o2sat: Number(body.oxygenSaturation), bmi: calculateConsultationBmi(body.height, body.weight) },
                bloodPressureClassification: classifyBloodPressure(body.bloodPressure),
              });
              return response.writeHead(503).end('Synthetic failure after committing the visit');
            }
            response.writeHead(200, { 'Content-Type': 'application/json' })
              .end(JSON.stringify({ consultation: records.get(key) }));
          });
        },
      }],
    });
    await server.listen();
    origin = `http://127.0.0.1:${server.httpServer.address().port}`;

    const launch = async () => {
      context = await chromium.launchPersistentContext(join(directory, 'profile'), {
        serviceWorkers: 'block',
        acceptDownloads: false,
        offline,
        args: ['--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'],
      });
      await context.routeWebSocket('**/*', (socket) => socket.close());
      await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === origin && request.method() === 'GET') {
          if (url.pathname === fixturePath) {
            return route.fulfill({
              contentType: 'text/html',
              headers: { 'Content-Security-Policy': "default-src 'none'; script-src 'self'; connect-src 'self'" },
              body: '<!doctype html><meta charset="utf-8"><title>Consultation browser test</title>',
            });
          }
          if (request.resourceType() === 'script') {
            // Routing disables Chromium's HTTP cache. Replay only module responses warmed from Vite.
            if (!offline && !cachedModules.has(url.href)) {
              const response = await route.fetch({ maxRedirects: 0 });
              cachedModules.set(url.href, { status: response.status(), headers: response.headers(), body: await response.body() });
            }
            const cached = cachedModules.get(url.href);
            if (cached) return route.fulfill(cached);
          }
        }
        if (url.origin === origin && url.pathname === createPath && request.method() === 'POST' && !offline) {
          return route.continue();
        }
        blocked.push(request.url());
        return route.abort('blockedbyclient');
      });
      const page = context.pages()[0] ?? await context.newPage();
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await page.goto(`${origin}${fixturePath}`);
      await loadOfflineModules(page);
      return page;
    };

    const setOffline = async (value) => {
      offline = value;
      await context.setOffline(value);
    };

    let page = await launch();
    await setOffline(true);
    await page.waitForFunction(() => !navigator.onLine);
    const saved = await page.evaluate(({ ownerId, payload }) => globalThis.lifecycle.saveConsultationOffline({
      ownerId, payload, create: globalThis.lifecycle.create,
    }), { ownerId, payload });
    assert.equal(saved.source, 'local');
    assert.equal(saved.queued, true);
    const { localId, record: { clientOperationKey } } = saved;
    assert.match(clientOperationKey, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    const stored = () => page.evaluate(async ({ ownerId, localId, clientOperationKey }) => {
      const { db, getOperation, restoreConsultationDraft } = globalThis.lifecycle;
      return {
        online: navigator.onLine,
        draft: await restoreConsultationDraft({ ownerId, localId }),
        operation: await getOperation(clientOperationKey, ownerId),
        rawDraft: await db.drafts.get(localId),
        rawOperation: await db.outbox.get(clientOperationKey),
        counts: [await db.drafts.count(), await db.outbox.count(), await db.records.count()],
      };
    }, { ownerId, localId, clientOperationKey });

    await page.reload();
    assert.equal(await page.evaluate(() => globalThis.lifecycle), undefined);
    await loadOfflineModules(page);
    const pending = await stored();
    const original = { ...payload, clientOperationKey };
    assert.equal(pending.online, false);
    assert.equal(pending.draft.status, 'pending');
    assert.equal(pending.operation.status, 'pending');
    assert.deepEqual(pending.draft.data, original);
    assert.deepEqual(pending.operation.payload, original);
    assert.equal(pending.rawDraft.data.enc, true);
    assert.equal(pending.rawOperation.payload.enc, true);
    assert.deepEqual(pending.counts, [1, 1, 0]);
    assert.deepEqual(requests, []);

    await startOfflineEngine(page, { stopOnFailure: true });
    await setOffline(false);
    await page.waitForFunction(() => globalThis.lifecycle.engine.getSnapshot().lastResult?.failed === 1);
    assert.deepEqual(await page.evaluate(() => globalThis.lifecycle.onlineEvents), [true]);
    assert.equal(await page.evaluate(() => globalThis.lifecycle.engineObservedReconnect), true);
    assert.deepEqual(requests, [{ key: clientOperationKey, body: original }]);

    await setOffline(true);
    await context.close();
    page = await launch();
    const failed = await stored();
    assert.equal(failed.online, false);
    assert.equal(failed.draft.status, 'failed');
    assert.equal(failed.operation.status, 'failed');
    assert.equal(failed.operation.lastError.status, 503);
    assert.equal(failed.operation.lastError.retryable, true);
    assert.equal(failed.operation.attempts, 1);
    assert.deepEqual(failed.draft.data, original);
    assert.deepEqual(failed.operation.payload, original);
    assert.deepEqual(failed.counts, [1, 1, 0]);

    await startOfflineEngine(page);
    await setOffline(false);
    await page.waitForFunction(() => {
      const { counts, syncing } = globalThis.lifecycle.engine.getSnapshot();
      return !syncing && counts.synced === 1;
    });
    assert.deepEqual(await page.evaluate(() => globalThis.lifecycle.onlineEvents), [true]);
    assert.equal(await page.evaluate(() => globalThis.lifecycle.engineObservedReconnect), true);
    assert.deepEqual(requests, Array(2).fill({ key: clientOperationKey, body: original }));
    assert.equal(records.size, 1);
    const synced = await stored();
    assert.equal(synced.draft.status, 'synced');
    assert.equal(synced.operation.status, 'synced');
    assert.equal(synced.operation.serverId, records.get(clientOperationKey).id);
    assert.deepEqual(synced.counts, [1, 1, 1]);
    assert.deepEqual(await page.evaluate((ownerId) => globalThis.lifecycle.listConsultationDrafts(ownerId), ownerId), []);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(blocked, [], 'the fixture must use only the test page, modules, and loopback endpoint');
  } finally {
    try {
      await context?.close();
    } finally {
      await server?.close();
      await rm(directory, { recursive: true, force: true, maxRetries: 5 });
    }
  }
});

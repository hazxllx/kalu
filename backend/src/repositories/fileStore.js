/**
 * JSON-file data store backing `fileRepository.js` for local development and
 * automated tests when Supabase is not configured (`route -> authenticate ->
 * authorize -> controller -> service -> fileRepository -> fileStore`).
 *
 * Persists residents, visits (submissions), referrals, verification/audit logs,
 * transfer requests, risk/BP settings, and medicines under a single JSON file
 * (`<DATA_DIR>/kalusagap-store.json` or `./data/kalusagap-store.json`) so
 * multi-step clinical workflows retain state across requests on one server.
 *
 * Concurrency & crash-safety guarantees:
 *  - Reads are served from an in-memory snapshot lazily hydrated once from disk.
 *  - Mutations execute serially along a promise chain (`this.chain`) to prevent interleaved writes.
 *  - Persistence writes to `<file>.tmp` first and atomically renames over the target file.
 */
import fs from 'node:fs';
import path from 'node:path';

import env from '../config/env.js';

const defaultDataFile = path.resolve('data', 'kalusagap-store.json');

/** Recursively creates `dir` if it does not yet exist on disk. */
const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

/**
 * Builds an empty store snapshot containing sequential ID counters, entity
 * arrays, and nullable singleton settings (`riskSettings`, `bpThresholdSettings`).
 */
const emptyData = () => ({
  meta: { version: 1, driver: 'file' },
  counters: { residents: 0, submissions: 0, referrals: 0 },
  residents: [],
  visits: [],
  referrals: [],
  verifications: [],
  residentVerificationLogs: [],
  transferRequests: [],
  transferRequestAuditLogs: [],
  riskCriteria: [],
  riskSettings: null,
  healthAuditLogs: [],
  medicines: [],
  medicineAvailability: [],
  bpThresholdSettings: null,
});

/**
 * Serialized, crash-safe JSON file persistence engine for local dev workflows.
 */
export class FileStore {
  /**
   * @param {string} [filePath] Target JSON path; defaults to `env.dataDir/kalusagap-store.json` or `./data/kalusagap-store.json`.
   */
  constructor(filePath = env.dataDir ? path.join(env.dataDir, 'kalusagap-store.json') : defaultDataFile) {
    this.filePath = filePath;
    this.data = null;
    this.chain = Promise.resolve();
  }

  /**
   * Lazily loads the JSON snapshot from disk on first read/write, falling back
   * to `emptyData()` when absent or unreadable, and backfills collections added
   * in newer schema versions so older local store files remain compatible.
   */
  ensureLoaded() {
    if (this.data) return;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        this.data = JSON.parse(raw);
      }
    } catch {
      this.data = null;
    }
    if (!this.data) this.data = emptyData();
    // Older store files predate the verifications collection and later modules.
    if (!Array.isArray(this.data.verifications)) this.data.verifications = [];
    if (!Array.isArray(this.data.residentVerificationLogs)) this.data.residentVerificationLogs = [];
    if (!Array.isArray(this.data.transferRequests)) this.data.transferRequests = [];
    if (!Array.isArray(this.data.transferRequestAuditLogs)) this.data.transferRequestAuditLogs = [];
    if (!Array.isArray(this.data.riskCriteria)) this.data.riskCriteria = [];
    if (this.data.riskSettings === undefined) this.data.riskSettings = null;
    if (!Array.isArray(this.data.healthAuditLogs)) this.data.healthAuditLogs = [];
    if (!Array.isArray(this.data.medicines)) this.data.medicines = [];
    if (!Array.isArray(this.data.medicineAvailability)) this.data.medicineAvailability = [];
    if (this.data.bpThresholdSettings === undefined) this.data.bpThresholdSettings = null;
  }

  /**
   * Run a synchronous mutation against the store. `fn(repo)` receives the live
   * data object and may mutate it; the result of `fn` is returned to callers.
   * Serialized so concurrent requests never interleave writes.
   */
  mutate(fn) {
    const run = async () => {
      this.ensureLoaded();
      const result = fn(this.data);
      await this.persist();
      return result;
    };
    const next = this.chain.then(run, run);
    // Keep the chain alive even when a mutation throws.
    this.chain = next.catch(() => {});
    return next;
  }

  /**
   * Atomically flushes the in-memory `this.data` snapshot to disk via a `.tmp`
   * staging file followed by `fs.promises.rename` to prevent partial/corrupt writes.
   */
  async persist() {
    const dir = path.dirname(this.filePath);
    ensureDir(dir);
    const tmp = `${this.filePath}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    await fs.promises.rename(tmp, this.filePath);
  }

  // Lazy-loaded collection accessors (hydrate in-memory snapshot on first read).
  get counters() {
    this.ensureLoaded();
    return this.data.counters;
  }

  get residents() {
    this.ensureLoaded();
    return this.data.residents;
  }

  get visits() {
    this.ensureLoaded();
    return this.data.visits;
  }

  get referrals() {
    this.ensureLoaded();
    return this.data.referrals;
  }

  get verifications() {
    this.ensureLoaded();
    return this.data.verifications;
  }

  get residentVerificationLogs() {
    this.ensureLoaded();
    return this.data.residentVerificationLogs;
  }

  get transferRequests() {
    this.ensureLoaded();
    return this.data.transferRequests;
  }

  get transferRequestAuditLogs() {
    this.ensureLoaded();
    return this.data.transferRequestAuditLogs;
  }

  get riskCriteria() {
    this.ensureLoaded();
    return this.data.riskCriteria;
  }

  get riskSettings() {
    this.ensureLoaded();
    return this.data.riskSettings;
  }

  get healthAuditLogs() {
    this.ensureLoaded();
    return this.data.healthAuditLogs;
  }

  get medicines() {
    this.ensureLoaded();
    return this.data.medicines;
  }

  get medicineAvailability() {
    this.ensureLoaded();
    return this.data.medicineAvailability;
  }

  get bpThresholdSettings() {
    this.ensureLoaded();
    return this.data.bpThresholdSettings;
  }
}

/** Process-wide `FileStore` singleton consumed by `fileRepository.js`. */
export const store = new FileStore();

export default store;

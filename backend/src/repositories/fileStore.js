/**
 * JSON-file data store for local development (used while Supabase is not
 * configured). Persists residents, visits (submissions) and referrals under a
 * single JSON file so the intake -> PHN workflow actually saves data and moves
 * records between users on the same server.
 *
 * This store is intentionally small and safe:
 *  - reads are served from an in-memory snapshot (loaded once),
 *  - mutations run serially under a promise chain (no interleaved writes),
 *  - writes go to a temp file then rename, so a crash never corrupts the file.
 */
import fs from 'node:fs';
import path from 'node:path';

import env from '../config/env.js';

const defaultDataFile = path.resolve('data', 'kalusagap-store.json');

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const emptyData = () => ({
  meta: { version: 1, driver: 'file' },
  counters: { residents: 0, submissions: 0, referrals: 0 },
  residents: [],
  visits: [],
  referrals: [],
});

class FileStore {
  constructor(filePath = env.dataDir ? path.join(env.dataDir, 'kalusagap-store.json') : defaultDataFile) {
    this.filePath = filePath;
    this.data = null;
    this.chain = Promise.resolve();
  }

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

  async persist() {
    const dir = path.dirname(this.filePath);
    ensureDir(dir);
    const tmp = `${this.filePath}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    await fs.promises.rename(tmp, this.filePath);
  }

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
}

export const store = new FileStore();

export default store;

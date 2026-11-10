import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDir, '../.env') });

const inputPath = process.argv[2];
const apply = process.argv.includes('--apply');

if (!inputPath) {
  console.error('Usage: node backend/scripts/remove_resident_document_storage_objects.mjs <storage-paths.csv> [--apply]');
  process.exit(2);
}

const parseCsv = (text) => {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.length > 0);
  if (!lines.length) return [];
  const parseRow = (line) => {
    const cells = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"' && quoted && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === ',' && !quoted) {
        cells.push(cell);
        cell = '';
      } else {
        cell += char;
      }
    }
    cells.push(cell);
    return cells;
  };
  const headers = parseRow(lines[0]).map((value) => value.trim());
  const column = headers.indexOf('storage_path');
  if (column < 0) throw new Error('CSV must contain a storage_path column.');
  return [...new Set(lines.slice(1).map((line) => parseRow(line)[column]?.trim()).filter(Boolean))];
};

const csv = await fs.readFile(path.resolve(inputPath), 'utf8');
const storagePaths = parseCsv(csv);
const allowedPrefixes = ['resident-documents/', 'transfer-documents/'];
const invalid = storagePaths.filter((value) => !allowedPrefixes.some((prefix) => value.startsWith(prefix)));
if (invalid.length) throw new Error(`Refusing ${invalid.length} path(s) outside the resident document prefixes.`);

console.log(`${storagePaths.length} unique document object path(s) loaded.`);
if (!apply) {
  console.log('Preview only. Re-run with --apply after the SQL cleanup commits to remove these files from the private documents bucket.');
  process.exit(0);
}

const { getServiceClient } = await import('../src/config/supabase.js');
const storage = getServiceClient().storage.from('documents');
let removed = 0;
for (let offset = 0; offset < storagePaths.length; offset += 100) {
  const batch = storagePaths.slice(offset, offset + 100);
  const { error } = await storage.remove(batch);
  if (error) throw new Error(`Storage removal failed after ${removed} path(s): ${error.message}`);
  removed += batch.length;
  console.log(`Removed batch: ${removed}/${storagePaths.length}`);
}
console.log(`Storage cleanup completed for ${removed} path(s).`);

import 'fake-indexeddb/auto';
import Dexie from 'dexie';
const DB='kalusagap-offline';
await Dexie.delete(DB);
// Simulate fresh v2 install with the OLD broken direct pk change
const v2broken = new Dexie(DB);
v2broken.version(1).stores({
  drafts: 'localId, entity, ownerId, status, updatedAt',
  outbox: 'opId, entity, ownerId, status, localRecordId, nextAttemptAt, updatedAt, [ownerId+status]',
  records: '[entity+remoteId], entity, ownerId, cachedAt',
  syncMeta: 'key',
  keys: 'id',
});
v2broken.version(2).stores({
  drafts: 'localId, entity, ownerId, status, updatedAt',
  outbox: 'opId, entity, ownerId, status, localRecordId, nextAttemptAt, updatedAt, [ownerId+status]',
  records: '[ownerId+entity+remoteId], ownerId, entity, remoteId, cachedAt',
  syncMeta: 'key',
  keys: 'id',
}).upgrade(async (tx)=>{ const r=await tx.table('records').toArray(); await tx.table('records').clear(); await Promise.all(r.map(x=>tx.table('records').put(x))); });
await v2broken.open();
await v2broken.table('records').put({ entity:'phnQueueVisit', remoteId:'VISIT-FRESH2', ownerId:'owner-a', cachedAt:1, data:{enc:false,v:1,plain:{id:'VISIT-FRESH2',val:1}}});
console.log('v2broken ver',v2broken.verno, 'count',await v2broken.table('records').count());
v2broken.close();

// Now open with fixed code (v4)
import { db } from './src/services/offline/db.js';
try{
  await db.open();
  console.log('fixed open ver',db.verno);
  const rec = await db.table('records').get(['owner-a','phnQueueVisit','VISIT-FRESH2']);
  console.log('preserved?', !!rec, JSON.stringify(rec?.data));
  console.log('tables', db.tables.map(t=>t.name));
  console.log('records count', await db.table('records').count());
  // verify backup table removed
  const hasBackup = db.tables.some(t=>t.name==='records_backup');
  console.log('backup exists?', hasBackup);
}catch(e){ console.error('open failed',e.name,e.message); }

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
});
try{
  await v2broken.open();
  console.log('v2broken opened ver',v2broken.verno);
}catch(e){ console.log('v2broken failed',e.name,e.message);}
try{ await v2broken.table('records').put({ entity:'phnQueueVisit', remoteId:'VISIT-FRESH2', ownerId:'owner-a', cachedAt:1, data:{enc:false,v:1,plain:{id:'VISIT-FRESH2',val:1}}}); console.log('put ok',await v2broken.table('records').count());}catch(e){ console.log('put fail',e.message);}
v2broken.close();

// inspect what version is stored
const check = new Dexie(DB);
check.version(1).stores({
  drafts: 'localId, entity, ownerId, status, updatedAt',
  outbox: 'opId, entity, ownerId, status, localRecordId, nextAttemptAt, updatedAt, [ownerId+status]',
  records: '[entity+remoteId], entity, ownerId, cachedAt',
  syncMeta: 'key',
  keys: 'id',
});
try{ await check.open(); console.log('check ver',check.verno); await check.close(); }catch(e){console.log('check fail',e.message);}

// Now try to open with fixed code in isolation via dynamic import after clearing versions
// Need to bypass cached db instance that has stale _dbSchema
const { db } = await import('./src/services/offline/db.js');
console.log('fixed db versions registered:', db.versions.map(v=>v._cfg.version));
console.log('fixed OFFLINE_DB_VERSION', (await import('./src/services/offline/db.js')).OFFLINE_DB_VERSION);
try{
  if(db.isOpen()) db.close();
  // force re-read of idb version by closing
  await db.open();
  console.log('fixed open ver',db.verno);
}catch(e){ console.error('fixed open failed',e.name,e.message); console.error(e.stack?.split('\n').slice(0,10).join('\n')); }

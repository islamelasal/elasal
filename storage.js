import {DAY, emptyState, normalize} from './model.js';
const KEY = 'elasal_state_v2';
export function readLocal() {
  const saved = localStorage.getItem(KEY);
  if (saved) { const value = JSON.parse(saved); return {state: normalize(value.state), revision: value.revision}; }
  const legacy = localStorage.getItem('elassal_members');
  const state = legacy ? normalize({members: JSON.parse(legacy), expenses: JSON.parse(localStorage.getItem('elassal_expenses') || '[]'), managerPhoto: localStorage.getItem('elassal_manager_photo') || '', adminWhatsApp: localStorage.getItem('elassal_admin_whatsapp') || ''}) : emptyState();
  const record = {state, revision: 0};
  localStorage.setItem(KEY, JSON.stringify(record));
  return record;
}
export async function writeLocal(state, revision) {
  const save = () => {
    if (readLocal().revision !== revision) throw Object.assign(Error('البيانات تغيّرت في تبويب آخر؛ اضغط تحديث البيانات'), {status: 409});
    localStorage.setItem(KEY, JSON.stringify({state, revision: revision + 1}));
  };
  if (navigator.locks) await navigator.locks.request('elasal-state-write', save); else save();
  return revision + 1;
}
function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('elasal-backups-v2', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('snapshots', {keyPath: 'id'});
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
export async function localBackups() {
  const db = await openDB();
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readonly'), req = tx.objectStore('snapshots').getAll();
    req.onsuccess = () => resolve(req.result.filter(r => r.created_at > Date.now() - 30 * DAY).sort((a, b) => b.created_at - a.created_at));
    req.onerror = () => reject(req.error);
  }); } finally { db.close(); }
}
export async function localSnapshot(state, revision, kind = 'daily') {
  const now = Date.now(), id = kind + ':' + new Date(now).toISOString().slice(0, 10) + (kind === 'before-restore' ? ':' + revision : '');
  const db = await openDB();
  try { await new Promise((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readwrite'), store = tx.objectStore('snapshots'), req = store.getAll();
    req.onsuccess = () => {
      const rows = req.result;
      if (kind !== 'daily' || !rows.some(r => r.id === id)) store.put({id, kind, revision, created_at: now, state});
      for (const r of rows) if (r.created_at <= now - 30 * DAY) store.delete(r.id);
      const extras = rows.filter(r => r.kind !== 'daily' && r.id !== id).sort((a, b) => b.created_at - a.created_at).slice(59);
      for (const r of extras) store.delete(r.id);
    };
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}

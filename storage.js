import {DAY, emptyState, normalize, today} from './model.js?v=3';

const DATABASE = 'elasal-backups-v2';
const VERSION = 2;
const LEGACY_KEYS = ['elasal_state_v2', 'elassal_members', 'elassal_expenses', 'elassal_manager_photo', 'elassal_admin_whatsapp', 'elasal_api_base', 'elasal_mode'];
const FORMAT = 'elasal-encrypted-backup';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let session;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', {keyPath: 'id'});
      if (!db.objectStoreNames.contains('vault')) db.createObjectStore('vault');
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error('أغلق أي تبويب قديم للوحة الإدارة وأعد المحاولة.'));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction(names, mode, work) {
  const db = await openDB();
  try {
    const tx = db.transaction(names, mode);
    const finished = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || Error('توقفت عملية الحفظ.'));
    });
    finished.catch(() => {});
    try {
      const result = await work(tx);
      await finished;
      return result;
    } catch (error) {
      try { tx.abort(); } catch {}
      throw error;
    }
  } finally {
    db.close();
  }
}

const getStateRecord = tx => requestResult(tx.objectStore('vault').get('state'));
const getSnapshots = tx => requestResult(tx.objectStore('snapshots').getAll());
const stateContext = record => 'state:' + record.generation + ':' + record.revision;
const snapshotContext = (row, generation) => 'snapshot:' + generation + ':' + row.id + ':' + row.revision;
const recent = row => row.created_at > Date.now() - 30 * DAY;

function changed() {
  return Error('تغيّرت البيانات في تبويب آخر. حدّث البيانات أو أعد فتح اللوحة.');
}

function requireSession(record) {
  if (!session || record?.generation !== session.generation) throw Error('الجلسة مغلقة أو تغيّرت كلمة المرور. اقفل اللوحة وافتحها من جديد.');
  return session.key;
}

function requireUnchanged(actual, expected) {
  if (actual?.generation !== expected?.generation || actual?.revision !== expected?.revision) throw changed();
}

function toBase64(data) {
  const bytes = new Uint8Array(data);
  let binary = '';
  for (let start = 0; start < bytes.length; start += 8192) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  }
  return btoa(binary);
}

const fromBase64 = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));

async function derive(password, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {name: 'PBKDF2', salt, hash: 'SHA-256', iterations: 600_000},
    material, {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']
  );
}

async function seal(key, value, context) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {name: 'AES-GCM', iv, additionalData: encoder.encode(context)},
    key, encoder.encode(JSON.stringify(value))
  );
  return {iv, ciphertext};
}

async function unseal(key, sealed, context) {
  const bytes = await crypto.subtle.decrypt(
    {name: 'AES-GCM', iv: sealed.iv, additionalData: encoder.encode(context)},
    key, sealed.ciphertext
  );
  return JSON.parse(decoder.decode(bytes));
}

function legacyState() {
  const saved = localStorage.getItem(LEGACY_KEYS[0]);
  if (saved) {
    const value = JSON.parse(saved);
    return {state: normalize(value.state), revision: value.revision};
  }
  const members = localStorage.getItem('elassal_members');
  if (!members) return {state: emptyState(), revision: 0};
  return {state: normalize({
    members: JSON.parse(members),
    expenses: JSON.parse(localStorage.getItem('elassal_expenses') || '[]'),
    managerPhoto: localStorage.getItem('elassal_manager_photo') || '',
    adminWhatsApp: localStorage.getItem('elassal_admin_whatsapp') || ''
  }), revision: 0};
}

async function newKey(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
    throw Error('اختر كلمة مرور من 12 إلى 256 حرفًا.');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {salt, generation: crypto.randomUUID(), key: await derive(password, salt)};
}

async function prepareVault(password, value, snapshots) {
  const {salt, generation, key} = await newKey(password);
  const record = {salt, generation, revision: value.revision};
  record.sealed = await seal(key, value.state, stateContext(record));
  const encryptedRows = await Promise.all(snapshots.filter(recent).map(async ({state, sealed, ...row}) => ({
    ...row,
    sealed: await seal(key, state, snapshotContext(row, generation))
  })));
  return {record, encryptedRows, key};
}

async function replaceVault(prepared, expected, originalRows) {
  await transaction(['vault', 'snapshots'], 'readwrite', async tx => {
    requireUnchanged(await getStateRecord(tx), expected);
    const rows = await getSnapshots(tx);
    const signatures = values => JSON.stringify(values.map(row => [row.id, row.revision, row.created_at]));
    if (signatures(rows) !== signatures(originalRows)) throw changed();
    tx.objectStore('vault').put(prepared.record, 'state');
    const snapshots = tx.objectStore('snapshots');
    snapshots.clear();
    for (const row of prepared.encryptedRows) snapshots.put(row);
  });
  session = {key: prepared.key, generation: prepared.record.generation};
}

export const vaultExists = () => transaction(['vault'], 'readonly', getStateRecord).then(Boolean);

export async function unlockVault(password, create = false) {
  if (!crypto.subtle) throw Error('افتح لوحة الإدارة على رابط HTTPS في متصفح حديث.');
  const current = await transaction(['vault', 'snapshots'], 'readonly', async tx => ({
    record: await getStateRecord(tx), rows: await getSnapshots(tx)
  }));
  const {record, rows} = current;
  let value;
  if (create) {
    if (record) throw Error('تم ضبط كلمة مرور في تبويب آخر. حدّث الصفحة.');
    value = legacyState();
    await replaceVault(await prepareVault(password, value, rows), undefined, rows);
  } else {
    if (!record) throw Error('إعداد كلمة المرور مطلوب أولًا.');
    const key = await derive(password, record.salt);
    try {
      value = {state: normalize(await unseal(key, record.sealed, stateContext(record))), revision: record.revision};
    } catch {
      throw Error('تعذر فتح البيانات. تحقّق من كلمة المرور.');
    }
    session = {key, generation: record.generation};
  }
  for (const name of LEGACY_KEYS) localStorage.removeItem(name);
  return value;
}

export function lockVault() { session = undefined; }

export async function changeVaultPassword(currentPassword, password) {
  const {record, rows} = await transaction(['vault', 'snapshots'], 'readonly', async tx => ({
    record: await getStateRecord(tx), rows: await getSnapshots(tx)
  }));
  const oldKey = requireSession(record);
  const proof = await derive(currentPassword, record.salt);
  let state;
  try { state = await unseal(proof, record.sealed, stateContext(record)); }
  catch { throw Error('كلمة المرور الحالية غير صحيحة.'); }
  const snapshots = await Promise.all(rows.filter(recent).map(async row => ({
    ...row, state: await unseal(oldKey, row.sealed, snapshotContext(row, record.generation))
  })));
  await replaceVault(await prepareVault(password, {state, revision: record.revision}, snapshots), record, rows);
}

export async function readLocal() {
  const record = await transaction(['vault'], 'readonly', getStateRecord);
  const key = requireSession(record);
  return {state: normalize(await unseal(key, record.sealed, stateContext(record))), revision: record.revision};
}

export async function writeLocal(state, revision) {
  const current = await transaction(['vault'], 'readonly', getStateRecord);
  const key = requireSession(current);
  if (current.revision !== revision) throw changed();
  const record = {...current, revision: revision + 1};
  record.sealed = await seal(key, state, stateContext(record));
  await transaction(['vault'], 'readwrite', async tx => {
    requireUnchanged(await getStateRecord(tx), current);
    tx.objectStore('vault').put(record, 'state');
  });
  return record.revision;
}

export async function localBackups() {
  const {record, rows} = await transaction(['vault', 'snapshots'], 'readonly', async tx => ({
    record: await getStateRecord(tx), rows: await getSnapshots(tx)
  }));
  requireSession(record);
  return rows.filter(recent).sort((a, b) => b.created_at - a.created_at);
}

export async function readSnapshot(snapshot) {
  const record = await transaction(['vault'], 'readonly', getStateRecord);
  return unseal(requireSession(record), snapshot.sealed, snapshotContext(snapshot, record.generation));
}

export async function localSnapshot(state, revision, kind = 'daily') {
  const current = await transaction(['vault'], 'readonly', getStateRecord);
  const key = requireSession(current);
  const day = today();
  const id = kind + ':' + day + (kind === 'before-restore' ? ':' + revision : '');
  const row = {id, kind, revision, created_at: Date.now()};
  row.sealed = await seal(key, state, snapshotContext(row, current.generation));
  await transaction(['vault', 'snapshots'], 'readwrite', async tx => {
    const latest = await getStateRecord(tx);
    requireSession(latest);
    if (latest.generation !== current.generation) throw changed();
    if (kind === 'before-restore' && latest.revision !== revision) throw changed();
    const rows = await getSnapshots(tx);
    const stored = rows.find(candidate => candidate.id === id);
    if (stored && stored.revision >= revision && kind === 'daily') return;
    const store = tx.objectStore('snapshots');
    store.put(row);
    for (const old of rows) if (old.id !== id && !recent(old)) store.delete(old.id);
    const extras = rows.filter(old => old.kind !== 'daily' && old.id !== id && recent(old));
    extras.sort((a, b) => b.created_at - a.created_at);
    for (const old of extras.slice(59)) store.delete(old.id);
  });
}

export async function exportEncrypted(state) {
  const record = await transaction(['vault'], 'readonly', getStateRecord);
  const key = requireSession(record);
  const {iv, ciphertext} = await seal(key, state, FORMAT + ':1');
  return {format: FORMAT, version: 1, salt: toBase64(record.salt), iv: toBase64(iv), data: toBase64(ciphertext)};
}

export async function decryptBackup(backup, readPassword) {
  if (backup.format !== FORMAT) return backup;
  if (backup.version !== 1) throw Error('إصدار النسخة المشفّرة غير مدعوم.');
  const record = await transaction(['vault'], 'readonly', getStateRecord);
  const current = requireSession(record);
  const salt = fromBase64(backup.salt);
  const sealed = {iv: fromBase64(backup.iv), ciphertext: fromBase64(backup.data)};
  if (salt.length !== 16 || sealed.iv.length !== 12) throw Error('ملف النسخة المشفّرة غير صالح.');
  try {
    if (backup.salt === toBase64(record.salt)) return await unseal(current, sealed, FORMAT + ':1');
    const password = readPassword();
    if (password === null) return null;
    return await unseal(await derive(password, salt), sealed, FORMAT + ':1');
  } catch {
    throw Error('تعذر فتح النسخة. تحقّق من كلمة مرور النسخة وسلامة الملف.');
  }
}

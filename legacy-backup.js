const format = 'elasal-encrypted-backup';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const decode = text => Uint8Array.from(atob(text), char => char.charCodeAt(0));

function encode(data) {
  const bytes = new Uint8Array(data);
  let binary = '';
  for (let start = 0; start < bytes.length; start += 8192) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  }
  return btoa(binary);
}

async function derive(password, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {name: 'PBKDF2', salt, hash: 'SHA-256', iterations: 600_000}, material,
    {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']
  );
}

function parameters(iv) {
  return {name: 'AES-GCM', iv, additionalData: encoder.encode(format + ':1')};
}

export async function exportEncrypted(state, password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
    throw Error('اختر كلمة مرور للنسخة من 12 إلى 256 حرفًا.');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(password, salt);
  const ciphertext = await crypto.subtle.encrypt(parameters(iv), key, encoder.encode(JSON.stringify(state)));
  return {format, version: 1, salt: encode(salt), iv: encode(iv), data: encode(ciphertext)};
}

export async function decryptBackup(backup, readPassword) {
  if (!backup || typeof backup !== 'object') throw Error('ملف النسخة غير صالح.');
  if (backup.format !== format) return backup;
  if (backup.version !== 1) throw Error('إصدار النسخة المشفّرة غير مدعوم.');
  try {
    const salt = decode(backup.salt);
    const iv = decode(backup.iv);
    if (salt.length !== 16 || iv.length !== 12) throw Error('Invalid format');
    const password = await readPassword();
    if (password === null) return null;
    const data = await crypto.subtle.decrypt(parameters(iv), await derive(password, salt), decode(backup.data));
    return JSON.parse(decoder.decode(data));
  } catch {
    throw Error('تعذر فتح النسخة. تحقّق من كلمة مرور النسخة وسلامة الملف.');
  }
}

export async function openPreviousVault(record, password) {
  try {
    const key = await derive(password, record.salt);
    const context = encoder.encode('state:' + record.generation + ':' + record.revision);
    const bytes = await crypto.subtle.decrypt(
      {name: 'AES-GCM', iv: record.sealed.iv, additionalData: context},
      key, record.sealed.ciphertext
    );
    return JSON.parse(decoder.decode(bytes));
  } catch {
    throw Error('تعذّر فتح البيانات القديمة. جرّب كلمة المرور اللي كنت بتستخدمها على هذا الجهاز.');
  }
}

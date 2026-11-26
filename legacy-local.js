import {today} from './model.js?v=4';
import {exportEncrypted, openPreviousVault} from './legacy-backup.js?v=2';

function previousVault() {
  return new Promise((resolve, reject) => {
    let missing = false;
    const request = indexedDB.open('elasal-backups-v2');
    request.onupgradeneeded = () => {
      missing = true;
      request.transaction.abort();
    };
    request.onerror = () => missing ? resolve(null) : reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('vault')) {
        database.close();
        resolve(null);
        return;
      }
      const transaction = database.transaction('vault');
      const read = transaction.objectStore('vault').get('state');
      transaction.oncomplete = () => { database.close(); resolve(read.result); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  });
}

function previousPlainData() {
  const versionTwo = localStorage.getItem('elasal_state_v2');
  if (versionTwo) return JSON.parse(versionTwo).state;
  const members = localStorage.getItem('elassal_members');
  if (!members) return null;
  return {
    members: JSON.parse(members),
    expenses: JSON.parse(localStorage.getItem('elassal_expenses') || '[]'),
    managerPhoto: localStorage.getItem('elassal_manager_photo') || '',
    adminWhatsApp: localStorage.getItem('elassal_admin_whatsapp') || ''
  };
}

export async function prepareLegacyExport() {
  const options = document.getElementById('legacy-export');
  const password = document.getElementById('legacy-password');
  const feedback = document.getElementById('legacy-feedback');
  const form = document.getElementById('legacy-export-form');
  let vault, plain;
  try { vault = await previousVault(); } catch {}
  if (!vault) {
    try { plain = previousPlainData(); } catch { return; }
  }
  if (!vault && !plain) return;
  options.hidden = false;
  document.getElementById('legacy-password-label').textContent = vault
    ? 'كلمة المرور القديمة لهذا الجهاز'
    : 'كلمة مرور لتشفير ملف النسخة';
  password.autocomplete = vault ? 'current-password' : 'new-password';
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = form.querySelector('button');
    submit.disabled = true;
    feedback.textContent = '';
    try {
      const secret = password.value;
      password.value = '';
      const state = vault ? await openPreviousVault(await previousVault(), secret) : plain;
      const backup = await exportEncrypted(state, secret);
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], {type:'application/json'}));
      const download = document.createElement('a');
      download.href = url;
      download.download = 'elasal-previous-device-' + today() + '.json';
      download.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      feedback.textContent = 'نُزّلت النسخة المشفّرة. بعد دخول الإدارة اختَر «استعادة نسخة من ملف».';
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
}

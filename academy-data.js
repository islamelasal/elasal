import {db, unwrap} from './supabase-client.js';

export async function loadAcademy() {
  const value = unwrap(await db.rpc('admin_academy_state'));
  if (!value?.state || !Number.isSafeInteger(value.revision)) throw Error('تعذر قراءة بيانات الأكاديمية.');
  return value;
}

export async function saveAcademy(state, revision, restore = false) {
  const result = await db.rpc('admin_write_academy_state', {
    p_state: state, p_revision: revision, p_restore: restore
  });
  if (result.error?.code === '40001') throw Error('تغيّرت البيانات في جلسة أخرى. اضغط تحديث البيانات وأعد المحاولة.');
  return unwrap(result);
}

export async function makeBackup(kind = 'daily') {
  unwrap(await db.rpc('admin_save_academy_backup', {p_kind: kind}));
}

export async function listAcademyBackups() {
  return unwrap(await db.from('academy_backups').select('id, kind, revision, created_at')
    .order('created_at', {ascending: false}).limit(100));
}

export async function loadBackup(id) {
  const row = unwrap(await db.from('academy_backups').select('data').eq('id', id).single());
  return row.data;
}

export async function linkAccount(memberId, email) {
  const result = await db.rpc('admin_link_academy_member', {p_member_id: memberId, p_email: email});
  if (result.error?.code === 'P0002') throw Error('تأكّد من تسجيل المشترك وتأكيد بريده قبل الربط.');
  if (result.error?.code === '23505') throw Error('حساب المشترك مربوط بالفعل بعضو آخر.');
  unwrap(result);
}

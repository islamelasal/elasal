// Shared validation for locally stored records and imported backups.
export const MAX_BYTES = 1_500_000;
export const DAY = 86_400_000;
export const emptyState = () => ({schemaVersion: 2, members: [], expenses: [], payments: [], audit: [], managerPhoto: '', adminWhatsApp: ''});
export const piasters = value => Math.round(value * 100);
export function today(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit'}).format(date);
}
export function expiryDate(member) {
  const d = new Date(member.startDate + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + member.validityDays);
  return d.toISOString().slice(0, 10);
}
export const expired = m => today() >= expiryDate(m) || m.remainingSessions <= 0;
export const uid = () => Date.now() * 1000 + Math.floor(Math.random() * 1000);
function text(v, max, required = false) {
  if (typeof v !== 'string' || v.length > max || (required && !v.trim())) throw Error('حقل نصي غير صالح أو يتجاوز الحد المسموح');
  return v.trim();
}
function number(v, min, max, integer = false) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isSafeInteger(v))) throw Error('قيمة رقمية غير صالحة');
  return integer ? v : piasters(v) / 100;
}
function date(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) throw Error('تاريخ غير صالح');
  return v;
}
export function accountingDate(value) {
  let normalized = String(value).replace(/[\u061c\u200e\u200f]/g, '').trim();
  normalized = normalized.replace(/[٠-٩۰-۹]/g, digit => (digit.charCodeAt(0) & 15).toString());
  const local = normalized.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (local) normalized = [local[3], local[2].padStart(2, '0'), local[1].padStart(2, '0')].join('-');
  try { return date(normalized); } catch { return ''; }
}
export function safePhoto(v) {
  if (!v || /^https?:/.test(v)) return '';
  if (typeof v !== 'string' || v.length > 40_000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(v)) throw Error('الصورة غير صالحة أو كبيرة؛ أعد اختيارها لضغطها');
  return v;
}
function list(v, max) {
  if (!Array.isArray(v) || v.length > max) throw Error('عدد السجلات يتجاوز الحد المسموح');
  return v;
}
function unique(rows) {
  if (new Set(rows.map(x => x.id)).size !== rows.length) throw Error('معرّفات سجلات مكررة');
  return rows;
}
export function normalize(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('ملف بيانات غير صالح');
  const s = input.state ?? input;
  if (s.schemaVersion != null && ![1, 2].includes(s.schemaVersion)) throw Error('إصدار الملف غير مدعوم');
  const legacy = s.schemaVersion !== 2;
  const members = unique(list(s.members, 1500).map(m => {
    const totalPrice = number(m.totalPrice, 0, 10_000_000);
    const debtCarried = number(m.debtCarried ?? 0, 0, 10_000_000);
    const due = piasters(totalPrice) + piasters(debtCarried);
    const paid = number(m.paid, 0, due / 100);
    const totalSessions = number(m.totalSessions, 1, 1000, true);
    const packageType = text(m.packageType ?? 'custom', 20, true);
    if (!['p5','p8','p12','p24','g1','g3','g6','g12','custom'].includes(packageType)) throw Error('باقة غير صالحة');
    const phone = text(m.phone, 25, true);
    if (!/^[+\d ()-]{7,25}$/.test(phone)) throw Error('رقم الهاتف غير صالح؛ استخدم الأرقام الإنجليزية');
    return {id: number(m.id, 1, Number.MAX_SAFE_INTEGER, true), name: text(m.name, 100, true), phone,
      photo: safePhoto(m.photo), startDate: date(m.startDate), packageType, totalPrice, debtCarried, paid,
      remaining: (due - piasters(paid)) / 100,
      totalSessions, remainingSessions: number(m.remainingSessions, 0, totalSessions, true), validityDays: number(m.validityDays ?? 30, 1, 3650, true)};
  }));
  const expenses = unique(list(s.expenses ?? [], 10_000).map(e => {
    const originalDate = text(e.date, 40, true);
    return {id: number(e.id, 1, Number.MAX_SAFE_INTEGER, true), title: text(e.title, 200, true), amount: number(e.amount, 0.01, 10_000_000), date: accountingDate(originalDate) || originalDate};
  }));
  const opening = members.filter(m => m.paid > 0).map(m => ({id: m.id, memberId: m.id, amount: m.paid, date: m.startDate, kind: 'opening'}));
  const payments = unique(list(legacy ? opening : s.payments, 10_000).map(p => ({id: number(p.id, 1, Number.MAX_SAFE_INTEGER, true), memberId: number(p.memberId, 1, Number.MAX_SAFE_INTEGER, true), amount: number(p.amount, -10_000_000, 10_000_000), date: date(p.date), kind: text(p.kind, 30, true)})));
  const audit = unique(list(s.audit ?? [], 10_000).map(entry => ({
    id: text(entry.id, 50, true), action: text(entry.action, 80, true),
    subject: text(entry.subject ?? '', 100), at: text(entry.at, 30, true)
  })));
  if (audit.some(entry => !Number.isFinite(Date.parse(entry.at)))) throw Error('تاريخ سجل العمليات غير صالح.');
  const state = {schemaVersion: 2, members, expenses, payments, audit, managerPhoto: safePhoto(s.managerPhoto), adminWhatsApp: text(s.adminWhatsApp ?? '', 25)};
  if (new TextEncoder().encode(JSON.stringify(state)).length > MAX_BYTES) throw Error('البيانات تجاوزت 1.5 MB؛ احفظ نسخة وقلل الصور أو أرشف السجلات');
  return state;
}

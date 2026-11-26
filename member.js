import {db, unwrap, authFeedback} from './supabase-client.js';
import {today, piasters} from './model.js?v=4';

const $ = id => document.getElementById(id);
const form = $('member-login');
const details = $('member-details');
const subscriptions = $('subscriber-subscriptions');
const formatMoney = new Intl.NumberFormat('ar-EG', {style: 'currency', currency: 'EGP'});

function field(list, label, value) {
  const term = document.createElement('dt');
  const description = document.createElement('dd');
  term.textContent = label;
  description.textContent = value;
  list.append(term, description);
}

function subscriptionCard(row) {
  const card = document.createElement('article');
  card.className = 'stat-gold-card';
  const info = document.createElement('dl');
  info.className = 'subscriber-facts';
  const day = today();
  let status = 'منتهي';
  if (day < row.start_date) status = 'مجدول';
  else if (day < row.end_date && row.remaining_sessions > 0 && row.is_current) status = 'نشط';
  field(info, 'الحالة', status);
  field(info, 'تاريخ البداية', row.start_date);
  field(info, 'تاريخ الانتهاء', row.end_date);
  field(info, 'الحصص المتبقية', row.remaining_sessions + ' من ' + row.total_sessions);
  const remaining = piasters(row.total_price) + piasters(row.debt_carried) - piasters(row.paid);
  field(info, 'المبلغ المدفوع', formatMoney.format(Number(row.paid)));
  field(info, 'المبلغ المتبقي', formatMoney.format(remaining / 100));
  card.append(info);
  return card;
}

function clear(message) {
  $('subscriber-name').textContent = '';
  subscriptions.replaceChildren();
  form.reset();
  details.hidden = true;
  form.hidden = false;
  $('member-feedback').textContent = message;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = form.querySelector('button');
  submit.disabled = true;
  try {
    const result = unwrap(await db.auth.signInWithPassword({
      email: $('member-email').value.trim(), password: $('member-password').value
    }));
    const member = unwrap(await db.from('members').select('id, name').eq('auth_user_id', result.user.id).maybeSingle());
    const rows = member ? unwrap(await db.from('subscriptions')
      .select('start_date,end_date,total_sessions,remaining_sessions,total_price,debt_carried,paid,is_current')
      .eq('member_id', member.id).order('is_current', {ascending: false}).order('start_date', {ascending: false})) : [];
    $('subscriber-name').textContent = member?.name || 'حساب المشترك';
    subscriptions.replaceChildren(...rows.map(subscriptionCard));
    $('member-feedback').textContent = !member ? 'الحساب غير مربوط بعضو بعد. تواصل مع إدارة الأكاديمية لتأكيد الربط.'
      : rows.length ? 'اشتراكاتك المسجّلة لدى الأكاديمية.' : 'لا توجد اشتراكات مسجّلة لهذا الحساب.';
    form.reset();
    form.hidden = true;
    details.hidden = false;
  } catch (error) {
    await db.auth.signOut({scope: 'local'});
    clear(authFeedback(error));
  } finally {
    submit.disabled = false;
  }
});

$('member-logout').addEventListener('click', async () => {
  try { await db.auth.signOut({scope: 'local'}); }
  finally { clear('تم تسجيل الخروج.'); }
});
db.auth.onAuthStateChange(event => {
  if (event === 'SIGNED_OUT') clear('تم تسجيل الخروج.');
});

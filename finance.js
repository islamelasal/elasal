import {accountingDate, piasters, today} from './model.js?v=3';

const labels = {
  subscription: 'اشتراك',
  renewal: 'تجديد',
  settlement: 'سداد مستحق',
  adjustment: 'تسوية مبلغ',
  opening: 'رصيد افتتاحي'
};
const displayMoney = new Intl.NumberFormat('ar-EG', {
  style: 'currency', currency: 'EGP', minimumFractionDigits: 2
});
const displayTime = new Intl.DateTimeFormat('ar-EG', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Cairo'
});

const arithmetic = cents => (cents / 100).toFixed(2);
const currency = cents => displayMoney.format(cents / 100);

export function buildMonthly(state, month) {
  const names = new Map(state.members.map(member => [member.id, member.name]));
  const payments = state.payments.filter(payment => payment.date.startsWith(month + '-')).map(payment => ({
    date: payment.date, label: labels[payment.kind] || payment.kind,
    detail: names.get(payment.memberId) || '#' + payment.memberId,
    amount: piasters(payment.amount), type: 'income', id: payment.id
  }));
  const expenses = [], undated = [];
  for (const expense of state.expenses) {
    const date = accountingDate(expense.date);
    if (!date) undated.push(expense);
    if (date.startsWith(month + '-')) expenses.push({
      date, label: 'مصروف', detail: expense.title, amount: piasters(expense.amount),
      type: 'expense', id: expense.id
    });
  }
  const income = payments.reduce((sum, row) => sum + row.amount, 0);
  const outgo = expenses.reduce((sum, row) => sum + row.amount, 0);
  const activity = state.audit.filter(entry => today(new Date(entry.at)).startsWith(month + '-'))
    .sort((a, b) => b.at.localeCompare(a.at));
  const rows = [...payments, ...expenses].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  return {rows, income, outgo, net: income - outgo, undated, activity};
}

function appendRow(container, values) {
  const row = document.createElement('tr');
  for (const value of values) {
    const cell = document.createElement('td');
    cell.textContent = value;
    row.append(cell);
  }
  container.append(row);
}

function csvCell(value) {
  let text = String(value);
  if (typeof value === 'string' && /^[\t\r\n =@+\-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

function saveReport(report, month) {
  const rows = [
    ['الشهر', month], ['المقبوضات', report.income / 100],
    ['المصروفات', report.outgo / 100], ['الصافي', report.net / 100], [],
    ['التاريخ', 'النوع', 'البيان', 'قيمة الحركة بالجنيه'],
    ...report.rows.map(row => [row.date, row.label, row.detail, Number(arithmetic(row.type === 'expense' ? -row.amount : row.amount))])
  ];
  const csv = rows.map(row => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], {type: 'text/csv;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'elasal-accounts-' + month + '.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function openReport(getState) {
  const dialog = document.getElementById('finance-report');
  if (dialog.open) return;
  const field = document.getElementById('report-month');
  if (!field.value) field.value = today().slice(0, 7);
  field.max = today().slice(0, 7);

  function render() {
    if (!/^\d{4}-\d{2}$/.test(field.value)) field.value = today().slice(0, 7);
    const result = buildMonthly(getState(), field.value);
    document.getElementById('report-period').textContent = 'شهر ' + field.value;
    document.getElementById('report-income').textContent = currency(result.income);
    document.getElementById('report-expenses').textContent = currency(result.outgo);
    document.getElementById('report-net').textContent = currency(result.net);
    document.getElementById('report-undated').textContent = result.undated.length
      ? 'مصروفات قديمة بدون تاريخ صالح مستبعدة من الحساب الشهري: ' + result.undated.length
      : '';
    const ledger = document.getElementById('report-ledger');
    ledger.replaceChildren();
    for (const row of result.rows) appendRow(ledger, [
      row.date, row.label, row.detail, currency(row.type === 'expense' ? -row.amount : row.amount)
    ]);
    document.getElementById('report-empty').hidden = result.rows.length > 0;
    const activity = document.getElementById('report-activity');
    activity.replaceChildren();
    for (const entry of result.activity) appendRow(activity, [displayTime.format(new Date(entry.at)), entry.action, entry.subject || '—']);
    document.getElementById('activity-empty').hidden = result.activity.length > 0;
    return result;
  }

  field.onchange = render;
  document.getElementById('report-close').onclick = () => dialog.close();
  document.getElementById('report-csv').onclick = () => saveReport(render(), field.value);
  document.getElementById('report-print').onclick = () => window.print();
  document.getElementById('report-email').onclick = () => {
    const report = render();
    const message = [
      'حسابات أكاديمية العسال لشهر ' + field.value,
      'المقبوضات ' + currency(report.income), 'المصروفات ' + currency(report.outgo),
      'الصافي ' + currency(report.net)
    ].join('\n');
    location.href = 'mailto:?subject=' + encodeURIComponent('حسابات الأكاديمية · ' + field.value) +
      '&body=' + encodeURIComponent(message);
  };
  render();
  dialog.showModal();
}

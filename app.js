import {API_BASE, DEPLOY_TARGET} from './config.js';
import {emptyState, normalize, expired, expiryDate, today, uid, MAX_BYTES} from './model.js';
import {readLocal, writeLocal, localSnapshot, localBackups} from './storage.js';

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => Number(n).toLocaleString('ar-EG', {maximumFractionDigits: 2}) + ' ج.م';
const photo = value => value || './assets/avatar.svg';
let state = emptyState(), revision = 0, mode = '', token = '', base = '', busy = false, currentFilter = 'all', activeQrMember = null;
let backups = [], lastBackupError = '';
const pagesDemo = DEPLOY_TARGET === 'github-pages-demo' || location.hostname.endsWith('.github.io');
const show = id => { $(id).style.display = 'flex'; };
const close = id => { $(id).style.display = 'none'; };
function dataBlob(value) { const [header,encoded]=value.split(',');const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));return new Blob([bytes],{type:header.slice(5).split(';')[0]}); }
function status(message, error = false) { $('operation-status').textContent = message; $('operation-status').dataset.error = error; }
function error(e) { status(e.message || 'تعذر إتمام العملية', true); alert(e.message || 'تعذر إتمام العملية'); }
async function api(path, options = {}) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(base + path, {...options, signal: controller.signal, cache: 'no-store', credentials: 'omit', headers: {'Content-Type':'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {}), ...options.headers}});
    let data;
    try { data = await response.json(); } catch { throw Error('الخادم لم يُرجع بيانات النظام؛ راجع رابط Cloudflare'); }
    if (!response.ok) {
      if (response.status === 401 && path !== '/api/login') lock('انتهت الجلسة؛ سجّل الدخول');
      throw Object.assign(Error(data.error || 'تعذر تنفيذ الطلب'), {status: response.status});
    }
    return data;
  } catch (e) { if (e.name === 'AbortError') throw Error('انتهت مهلة الاتصال؛ اضغط تحديث البيانات للتحقق قبل تكرار العملية'); throw e; }
  finally { clearTimeout(timeout); }
}
function lock(message = '') {
  token = ''; state = emptyState(); revision = 0; backups = []; activeQrMember = null;
  render(); $('expenses-list').replaceChildren(); $('backup-list').replaceChildren(); $('large-view-img').src = ''; $('qrcode-container').replaceChildren();
  document.querySelectorAll('.modal-gold-overlay').forEach(el => el.style.display = 'none');
  close('modal-img-viewer'); $('app').hidden = true; $('entry-screen').hidden = false;
  $('login-form').hidden = false; $('setup-options').hidden = true; $('change-server-btn').hidden = Boolean(API_BASE);
  $('entry-status').textContent = message + ' · ' + (base || location.origin); $('admin-password').value = '';
}
function enter() {
  $('entry-screen').hidden = true; $('app').hidden = false; $('logout-btn').hidden = mode !== 'cloud';
  $('storage-status').textContent = mode === 'cloud' ? 'حفظ مركزي · ' + (base || location.origin) : 'محلي على هذا المتصفح · النسخ التلقائي أثناء فتح الصفحة فقط';
  $('manager-img').src = photo(state.managerPhoto); setDefaultDate(); checkPackageSelection(); render();
  window.scrollTo(0, 0);
}
async function initApp() {
  changeTheme(localStorage.getItem('elasal_theme') || 'black');
  if (API_BASE) base = validOrigin(API_BASE);
  else base = localStorage.getItem('elasal_api_base') || '';
  if (pagesDemo) {
    if(localStorage.getItem('elasal_mode')==='local'){await startLocal();return;}
    showConnectionSettings();
    return;
  }
  if (!API_BASE && localStorage.getItem('elasal_mode') === 'local') { await startLocal(); return; }
  try {
    const health = await api('/api/health');
    if (health.service !== 'elasal-academy') throw Error('خادم غير متوافق');
    mode = 'cloud'; lock('دخول المدير');
  } catch {
    if (base || API_BASE || localStorage.getItem('elasal_mode') === 'cloud') {
      mode = 'cloud'; lock('تعذر الوصول إلى الخادم. راجع الاتصال قبل الدخول');
    } else showConnectionSettings();
  }
}
function validOrigin(value) {
  let u;
  try { u = new URL(value); }
  catch { throw Error('أدخل رابطًا كاملًا لخادم Cloudflare يبدأ بـ https://.'); }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost','127.0.0.1'].includes(u.hostname))) throw Error('يلزم رابط HTTPS');
  if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) throw Error('أدخل أصل الرابط فقط دون مسار أو بيانات دخول');
  return u.origin;
}
function showConnectionSettings() {
  if(token) lock();
  $('app').hidden = true; $('entry-screen').hidden = false; $('login-form').hidden = true; $('setup-options').hidden = false; $('change-server-btn').hidden = true;
  $('entry-status').textContent = pagesDemo ? 'نسخة GitHub Pages للعرض والتجربة' : 'اختر طريقة تخزين البيانات';
  $('api-url').value = base;
  $('server-options').open = !pagesDemo || Boolean(base);
  $('connection-status').textContent = '';
  if (pagesDemo) {
    $('connect-server-btn').textContent = 'فتح النظام على Cloudflare';
    $('setup-hint').textContent = 'استخدم بيانات تجريبية. تُحفظ البيانات في هذا المتصفح.';
  }
  window.scrollTo(0, 0);
}
async function connectServer() {
  const feedback = $('connection-status');
  feedback.textContent = '';
  try {
    const serverUrl = $('api-url').value.trim();
    if (!serverUrl) throw Error('أدخل رابط خادم Cloudflare، أو افتح الوضع المحلي لتجربة الموقع.');
    const proposed = validOrigin(serverUrl);
    // A token is never sent while checking a newly entered server.
    token = ''; base = proposed;
    const h = await api('/api/health'); if (h.service !== 'elasal-academy') throw Error('الرابط لا يشغّل خادم الأكاديمية');
    if(pagesDemo){localStorage.setItem('elasal_api_base',base);location.assign(base);return;}
    localStorage.setItem('elasal_api_base', base); localStorage.setItem('elasal_mode', 'cloud'); mode = 'cloud'; lock('دخول المدير');
  } catch (e) { feedback.textContent = e.message; }
}
async function startLocal() {
  try {
    ({state, revision} = readLocal()); mode = 'local'; token = ''; localStorage.setItem('elasal_mode', 'local'); enter();
    await tryLocalSnapshot();
  } catch (e) { $('entry-status').textContent = 'تعذر فتح البيانات المحلية: ' + e.message; }
}
async function login() {
  if(pagesDemo){showConnectionSettings();return;}
  const button = $('login-form').querySelector('button'); button.disabled = true;
  try {
    const result = await api('/api/login', {method:'POST', body:JSON.stringify({password:$('admin-password').value})});
    token = result.token; $('admin-password').value = ''; mode = 'cloud';
    localStorage.setItem('elasal_mode', 'cloud'); await refreshData(); enter();
  } catch (e) { token = ''; $('entry-status').textContent = e.message; }
  finally { button.disabled = false; }
}
async function logout() {
  if (busy) return;
  try { await api('/api/logout', {method:'POST', body:'{}'}); } catch {} finally { lock('تم الخروج'); }
}
async function refreshData() {
  if (busy) return;
  try {
    const result = mode === 'cloud' ? await api('/api/state') : readLocal();
    state = normalize(result.state); revision = result.revision; render(); $('manager-img').src = photo(state.managerPhoto);
    status('تم تحميل أحدث بيانات');
  } catch (e) { error(e); throw e; }
}
async function commit(next, restore = false) {
  if (busy) throw Error('انتظر انتهاء الحفظ');
  const validated = normalize(next); busy = true; $('app').dataset.busy = 'true'; status('جارٍ الحفظ');
  try {
    let nextRevision;
    if (mode === 'cloud') {
      const result = await api(restore ? '/api/restore' : '/api/state', {method:restore ? 'POST':'PUT', body:JSON.stringify({state:validated, revision})});
      nextRevision = result.revision;
    } else {
      if (restore) await localSnapshot(state, revision, 'before-restore');
      nextRevision = await writeLocal(validated, revision);
    }
    state = validated; revision = nextRevision; render(); $('manager-img').src = photo(state.managerPhoto);
    status(mode === 'cloud' ? 'تم الحفظ على السيرفر' : 'تم الحفظ على هذا الجهاز');
    if (mode === 'local') await tryLocalSnapshot();
    return true;
  } finally { busy = false; $('app').dataset.busy = 'false'; }
}
async function mutate(fn) { const next = structuredClone(state); fn(next); await commit(next); }
async function tryLocalSnapshot() {
  try { await localSnapshot(state, revision); lastBackupError = ''; }
  catch { lastBackupError = 'تعذر إنشاء النسخة المحلية؛ نزّل نسخة على جهازك وتحقق من مساحة المتصفح'; status(lastBackupError, true); }
}
function changeTheme(name) {
  const theme = ['black','blue','red','green'].includes(name) ? name : 'black';
  document.body.dataset.theme = theme; $('brand-theme').value = theme; localStorage.setItem('elasal_theme', theme);
}
function setDefaultDate() { $('start-date').value = today(); }
function readPackage(prefix = '') {
  const sel = $(prefix + 'package');
  return sel.value === 'custom' ? {packageType:'custom', totalPrice:Number($(prefix + 'custom-price').value), totalSessions:Number($(prefix + 'custom-sessions').value), validityDays:30} : {
    packageType:sel.value, totalPrice:Number(sel.selectedOptions[0].dataset.price), totalSessions:Number(sel.selectedOptions[0].dataset.sessions), validityDays:Number(sel.selectedOptions[0].dataset.days)};
}
function checkPackageSelection(prefix = '') {
  $(prefix + 'custom-pkg-box').style.display = $(prefix + 'package').value === 'custom' ? 'block':'none';
  $(prefix + 'price').value = readPackage(prefix).totalPrice; calcRemaining(prefix);
}
function calcRemaining(prefix = '') { const carried = prefix ? state.members.find(m=>m.id===Number($('edit-id').value))?.debtCarried ?? 0 : 0; $(prefix + 'remaining').value = Math.max(0, carried + Number($(prefix+'price').value) - Number($(prefix+'paid').value)); }
async function compressPhoto(file) {
  if (!file) return '';
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) throw Error('اختر JPG أو PNG أو WebP أصغر من 8 MB');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 160 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#111214'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const data = canvas.toDataURL('image/jpeg', .7); if (data.length > 40_000) throw Error('الصورة أكبر من الحد بعد الضغط'); return data;
  } finally { bitmap.close(); }
}
async function updateManagerPhoto(e) {
  try { const image = await compressPhoto(e.target.files[0]); if (image) await mutate(s => s.managerPhoto = image); } catch(e) { error(e); }
  finally { e.target.value = ''; }
}
function addPayment(s, memberId, amount, kind) { if (amount) s.payments.push({id:uid(), memberId, amount, date:today(), kind}); }
async function handleAddMember() {
  try {
    const newMember = {id:uid(), name:$('name').value.trim(), phone:$('phone').value.trim(), startDate:$('start-date').value, ...readPackage(), paid:Number($('paid').value), debtCarried:0, photo:await compressPhoto($('photo').files[0])};
    newMember.remainingSessions = newMember.totalSessions;
    await mutate(s => { s.members.unshift(newMember); addPayment(s,newMember.id,newMember.paid,'subscription'); });
    close('modal-add'); for (const id of ['name','phone','paid','remaining','photo']) $(id).value = '';
  } catch (e) { error(e); }
}
function render() {
  const query = $('search-input').value.trim().toLowerCase(), counts = {active:0,expired:0,debts:0};
  const containers = {active:$('list-active'),expired:$('list-expired'),debts:$('list-debts')};
  Object.values(containers).forEach(c => c.replaceChildren());
  for (const m of state.members) {
    const category = expired(m) ? 'expired':'active', debt = m.remaining > 0;
    counts[category]++; if(debt) counts.debts++;
    if (query && !m.name.toLowerCase().includes(query) && !m.phone.includes(query) && !String(m.id).includes(query)) continue;
    if (currentFilter === 'active' && category !== 'active' || currentFilter === 'debts' && !debt) continue;
    const attended = m.totalSessions - m.remainingSessions;
    const button = (action,label) => `<button class="gold-action-btn" data-action="${action}" data-id="${m.id}">${label}</button>`;
    const card = `<article class="member-gold-card"><div class="member-gold-top"><img src="${esc(photo(m.photo))}" class="member-gold-avatar" alt="صورة ${esc(m.name)}" data-action="photo" data-id="${m.id}"><div class="member-gold-info"><h4>${esc(m.name)}</h4><p>${esc(m.phone)}</p><div class="tags-gold-row"><span class="gold-status-badge ${category === 'active' ? 'badge-active':'badge-expired'}">${category === 'active' ? 'نشط':'منتهي'}</span><span class="gold-status-badge badge-neutral">المتبقي ${m.remainingSessions} / ${m.totalSessions}</span>${debt ? `<span class="gold-status-badge badge-debt">مستحق ${money(m.remaining)}</span>`:''}</div></div></div><div class="progress-gold-container"><div class="progress-gold-meta"><span>حضر ${attended} حصة</span><span>البداية ${m.startDate} | الانتهاء ${expiryDate(m)}</span></div><div class="progress-gold-line"><div class="progress-gold-fill" style="width:${attended/m.totalSessions*100}%"></div></div></div><div class="card-gold-actions">${button('attend','حضور')}${button('whatsapp','واتساب')}${button('alert','تنبيه تجديد')}${debt ? button('settle','سداد مبلغ')+button('debt','مطالبة'):''}${button('renew','تجديد')}${button('qr','QR')}${button('edit','تعديل')}${button('correct','تصحيح الحصص')}${button('delete','حذف')}</div></article>`;
    containers[category].insertAdjacentHTML('beforeend',card); if(debt) containers.debts.insertAdjacentHTML('beforeend',card);
  }
  for (const [kind, container] of Object.entries(containers)) {
    if (!container.children.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-gold-notice';
      empty.textContent = query ? 'لا يوجد مشتركون يطابقون البحث.' : 'لا توجد سجلات في هذه القائمة.';
      container.append(empty);
    }
    $('count-' + kind).textContent = counts[kind];
  }
  $('total-members').textContent = state.members.length; $('active-members').textContent = counts.active;
  const income = state.payments.reduce((n,p)=>n+p.amount,0), spent = state.expenses.reduce((n,e)=>n+e.amount,0);
  $('total-income').textContent = money(income); $('total-debts').textContent = money(state.members.reduce((n,m)=>n+m.remaining,0)); $('net-profit').textContent = money(income-spent);
}
function setFilter(type, selected) {
  currentFilter = type;
  for (const chip of document.querySelectorAll('.filter-chip')) {
    chip.classList.toggle('active', chip === selected);
    chip.setAttribute('aria-pressed', String(chip === selected));
  }
  render();
}
function toggleAccordion(id) {
  const accordion = $(id);
  const expanded = accordion.classList.toggle('open');
  accordion.querySelector('.accordion-gold-trigger').setAttribute('aria-expanded', String(expanded));
}
function renderExpenses() {
  const list = $('expenses-list'); list.replaceChildren();
  if (!state.expenses.length) { list.textContent = 'لا توجد مصروفات مسجلة'; return; }
  for (const e of state.expenses) { const row = document.createElement('p'); row.textContent = `${e.title} · ${e.date} · ${money(e.amount)}`; list.append(row); }
}
async function addExpense() {
  try { await mutate(s => s.expenses.unshift({id:uid(),title:$('expense-title').value.trim(),amount:Number($('expense-amount').value),date:today()})); $('expense-title').value = ''; $('expense-amount').value = ''; renderExpenses(); } catch(e) { error(e); }
}
async function saveSettings() { try { await mutate(s=>s.adminWhatsApp=$('admin-whatsapp').value.trim()); close('modal-settings'); } catch(e) { error(e); } }
function openEditModal(id) {
  const m=state.members.find(m=>m.id===id); if(!m)return;
  $('edit-id').value=id; $('edit-name').value=m.name; $('edit-phone').value=m.phone; $('edit-package').value=m.packageType; $('edit-custom-sessions').value=m.totalSessions; $('edit-custom-price').value=m.totalPrice; $('edit-photo').value='';
  checkPackageSelection('edit-'); $('edit-paid').value=m.paid; $('edit-remaining').value=m.remaining; show('modal-edit');
}
async function saveEditedMember() {
  try {
    const id=Number($('edit-id').value), image=await compressPhoto($('edit-photo').files[0]);
    await mutate(s=>{
      const m=s.members.find(x=>x.id===id), pkg=readPackage('edit-'), attended=m.totalSessions-m.remainingSessions, delta=Number($('edit-paid').value)-m.paid;
      m.name=$('edit-name').value.trim(); m.phone=$('edit-phone').value.trim();
      if(image)m.photo=image;
      Object.assign(m,pkg); m.remainingSessions=Math.max(0,pkg.totalSessions-attended); m.paid=Number($('edit-paid').value); addPayment(s,id,delta,'adjustment');
    }); close('modal-edit');
  } catch(e) { error(e); }
}
async function attendSession(id) {
  const m=state.members.find(m=>m.id===id); if(!m || expired(m)) { alert('الاشتراك منتهٍ أو لا توجد حصص متاحة'); return; }
  if(!confirm(`تسجيل حضور ${m.name} وخصم حصة؟`))return;
  try { await mutate(s=>s.members.find(m=>m.id===id).remainingSessions--); } catch(e) { error(e); }
}
async function correctSessions(id) {
  const m=state.members.find(m=>m.id===id), value=prompt(`عدد الحصص المتبقية من ${m.totalSessions}`,m.remainingSessions); if(value===null)return;
  try { await mutate(s=>s.members.find(m=>m.id===id).remainingSessions=Number(value)); } catch(e) { error(e); }
}
async function renew(id) {
  const m=state.members.find(m=>m.id===id), value=prompt(`تجديد ${m.name}. سعر الباقة ${money(m.totalPrice)} والمستحق السابق ${money(m.remaining)}. أدخل المبلغ المقبوض الآن؛ صفر للتجديد دون سداد:`, '0'); if(value===null)return;
  try { await mutate(s=>{ const m=s.members.find(m=>m.id===id); m.debtCarried=m.remaining; m.paid=Number(value); m.remainingSessions=m.totalSessions; m.startDate=today(); addPayment(s,id,m.paid,'renewal'); }); } catch(e) { error(e); }
}
async function settle(id) {
  const m=state.members.find(m=>m.id===id), value=prompt(`المستحق ${money(m.remaining)}. المبلغ المقبوض:`, String(m.remaining)); if(value===null)return;
  const amount=Number(value); if(!Number.isFinite(amount)||amount<=0||amount>m.remaining){alert('أدخل مبلغًا موجبًا لا يتجاوز المستحق');return;}
  try { await mutate(s=>{s.members.find(m=>m.id===id).paid+=amount;addPayment(s,id,amount,'settlement');}); } catch(e) { error(e); }
}
async function deleteMember(id) {
  if(!confirm('حذف العضو؟ ستبقى المقبوضات السابقة في الإجمالي المالي.'))return;
  try { await mutate(s=>s.members=s.members.filter(m=>m.id!==id)); } catch(e) { error(e); }
}
function viewLargeImage(src) { $('large-view-img').src=src; show('modal-img-viewer'); }
function openQrModal(id) {
  const m=state.members.find(x=>x.id===id); activeQrMember=m; $('qr-member-name').textContent=m.name; $('qrcode-container').replaceChildren();
  new QRCode($('qrcode-container'), {text:'ELASAL-MEMBER:'+m.id,width:180,height:180,colorDark:'#111214',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M}); show('modal-qr');
}
function viewQrImageFullSize() { const canvas=$('qrcode-container').querySelector('canvas'); if(canvas)viewLargeImage(canvas.toDataURL('image/png')); }
function whatsapp(id,kind='summary') {
  const m=state.members.find(x=>x.id===id); if(!m)return;
  let digits=m.phone.replace(/\D/g,''); if(digits.startsWith('00'))digits=digits.slice(2); if(digits.startsWith('0'))digits='2'+digits;
  if(!/^\d{10,15}$/.test(digits)){alert('رقم واتساب غير صالح');return;}
  const detail=kind==='debt'?`المبلغ المستحق: ${money(m.remaining)}`:kind==='alert'?`تذكير بتجديد الاشتراك. ينتهي في ${expiryDate(m)}`:kind==='qr'?`كود العضوية: ${m.id}. الكود للتعريف فقط، ويُسجّل الحضور يدويًا بواسطة الإدارة.`:`الحصص المتبقية: ${m.remainingSessions} من ${m.totalSessions}. تاريخ الانتهاء: ${expiryDate(m)}`;
  const text=`أكاديمية العسال للملاكمة\n${m.name}\n${detail}${state.adminWhatsApp?'\nتواصل الإدارة: '+state.adminWhatsApp:''}`;
  window.open('https://wa.me/'+digits+'?text='+encodeURIComponent(text),'_blank','noopener,noreferrer');
}
async function checksum(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join(''); }
async function envelope(value) { return {format:'elasal-backup',schemaVersion:2,createdAt:new Date().toISOString(),checksum:await checksum(JSON.stringify(value)),state:value}; }
function download(value,name) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})), a=document.createElement('a'); a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function exportData() {
  try { if(mode==='cloud') await refreshData(); download(await envelope(state),'elasal-backup-'+today()+'.json'); } catch(e) { error(e); }
}
async function restoreData(raw) {
  if(raw.format==='elasal-backup' && (!raw.checksum || await checksum(JSON.stringify(raw.state))!==raw.checksum))throw Error('فشل التحقق من سلامة ملف النسخة');
  // Compress legacy inline photos before strict validation. Remote photos are discarded.
  const incoming=structuredClone(raw.state??raw);
  for(const m of incoming.members??[]) if(typeof m.photo==='string'&&m.photo.length>40000&&/^data:image\/(jpeg|png|webp);base64,/.test(m.photo))m.photo=await compressPhoto(dataBlob(m.photo));
  if(typeof incoming.managerPhoto==='string'&&incoming.managerPhoto.length>40000&&/^data:image\/(jpeg|png|webp);base64,/.test(incoming.managerPhoto))incoming.managerPhoto=await compressPhoto(dataBlob(incoming.managerPhoto));
  const validated=normalize(incoming);
  if(!confirm(`استبدال البيانات بـ ${validated.members.length} عضو و${validated.expenses.length} مصروف؟ ستُحفظ نسخة من الوضع الحالي قبل الاستعادة.`))return;
  await commit(validated,true); close('modal-backups');
}
async function importData(e) {
  const file=e.target.files[0]; if(!file)return;
  try { if(file.size>10*1024*1024)throw Error('حد ملف الاستيراد 10 MB؛ قلل الصور أولًا'); await restoreData(JSON.parse(await file.text())); } catch(e){error(e);}finally{e.target.value='';}
}
async function openBackups() {
  show('modal-backups'); $('backup-policy').textContent=mode==='cloud'?'نسخة يومية تلقائية حتى مع إغلاق المتصفح. الاحتفاظ 30 يومًا. النسخة اليدوية لليوم تُحدّث عند الضغط.':'نسخ محلية في هذا المتصفح أثناء فتح الصفحة فقط. الاحتفاظ 30 يومًا يُطبّق عند فتح النظام؛ مسح بيانات المتصفح يمسحها.';
  try { await listBackups(); } catch(e){$('backup-result').textContent=e.message;$('backup-result').dataset.error='true';}
}
async function listBackups() {
  backups=mode==='cloud'?(await api('/api/backups')).backups:await localBackups();
  const list=$('backup-list'); list.replaceChildren(); $('backup-result').textContent=lastBackupError||`${backups.length} نسخة متاحة`;
  for(let i=0;i<backups.length;i++) {
    const b=backups[i],row=document.createElement('div');row.className='backup-row';
    const title=document.createElement('p');title.textContent=({daily:'تلقائية',manual:'يدوية','before-restore':'قبل الاستعادة'}[b.kind]||b.kind)+' · مراجعة '+b.revision;
    const time=document.createElement('time');time.textContent=new Intl.DateTimeFormat('ar-EG',{timeZone:'Africa/Cairo',dateStyle:'medium',timeStyle:'short',hour12:true}).format(b.created_at);row.append(title,time);
    for(const [action,label] of [['download','تنزيل'],['restore','استعادة']]){const button=document.createElement('button');button.className='gold-tool-btn';button.textContent=label;button.dataset.backupAction=action;button.dataset.index=i;row.append(button);}
    list.append(row);
  }
}
async function createBackup() {
  try { if(mode==='cloud')await api('/api/backups',{method:'POST',body:'{}'});else await localSnapshot(state,revision,'manual'); await listBackups(); $('backup-result').textContent='تم حفظ نسخة اليوم'; }catch(e){error(e);}
}
document.addEventListener('click',async event=>{
  if(event.target.closest('[data-settings="connection"]'))showConnectionSettings();
  const b=event.target.closest('[data-action]');
  if(b){
    const id=Number(b.dataset.id),actions={attend:attendSession,whatsapp:id=>whatsapp(id),alert:id=>whatsapp(id,'alert'),debt:id=>whatsapp(id,'debt'),settle,renew,qr:openQrModal,edit:openEditModal,correct:correctSessions,delete:deleteMember,photo:id=>viewLargeImage(photo(state.members.find(m=>m.id===id).photo))};
    if(!busy&&actions[b.dataset.action])await actions[b.dataset.action](id);
  }
  const backupButton=event.target.closest('[data-backup-action]');
  if(backupButton){
    try { const b=backups[Number(backupButton.dataset.index)],value=mode==='cloud'?await api('/api/backups/'+encodeURIComponent(b.id)):await envelope(b.state); if(backupButton.dataset.backupAction==='download')download(value,'elasal-'+b.id.replace(/:/g,'-')+'.json');else await restoreData(value); }catch(e){error(e);}
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-gold-overlay').forEach(el => el.style.display = 'none');
    close('modal-img-viewer');
  }
});
window.addEventListener('storage',e=>{if(mode==='local'&&e.key==='elasal_state_v2')status('تم تعديل البيانات من تبويب آخر؛ اضغط تحديث البيانات',true);});
window.addEventListener('offline',()=>status(mode==='cloud'?'انقطع الاتصال؛ التعديلات تحتاج اتصالًا بالخادم':'الوضع المحلي يعمل دون إنترنت',true));
setInterval(()=>{if(mode==='local'&&!busy)tryLocalSnapshot();},3600000);
Object.assign(window,{initApp,render,login,logout,startLocal,connectServer,showConnectionSettings,refreshData,changeTheme,
  setFilter,toggleAccordion,openAddMemberModal:()=>{setDefaultDate();checkPackageSelection();show('modal-add');},closeAddMemberModal:()=>close('modal-add'),
  openSettingsModal:()=>{$('admin-whatsapp').value=state.adminWhatsApp;show('modal-settings');},closeSettingsModal:()=>close('modal-settings'),saveSettings,
  checkPackageSelection:()=>checkPackageSelection(),calcCustomPrice:()=>checkPackageSelection(),calcRemaining:()=>calcRemaining(),checkEditPackageSelection:()=>checkPackageSelection('edit-'),calcEditCustomPrice:()=>checkPackageSelection('edit-'),calcEditRemaining:()=>calcRemaining('edit-'),
  handleAddMember,updateManagerPhoto,openEditModal,saveEditedMember,closeEditModal:()=>close('modal-edit'),openExpenseModal:()=>{renderExpenses();show('modal-expense');},closeExpenseModal:()=>close('modal-expense'),addExpense,
  viewLargeImage,closeLargeImageViewer:()=>close('modal-img-viewer'),closeQrModal:()=>close('modal-qr'),viewQrImageFullSize,sendQrWhatsApp:()=>activeQrMember&&whatsapp(activeQrMember.id,'qr'),
  exportData,importData,openBackups,closeBackups:()=>close('modal-backups'),createBackup});
initApp().catch(e=>{$('entry-status').textContent=e.message;});

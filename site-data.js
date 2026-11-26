import {SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY} from './supabase-config.js';

export const CONTENT_PATH = 'assets/site-content.json';
export const mediaKeys = ['logo', 'home', 'training'];
const identifier = /^[a-zA-Z0-9-]{1,80}$/;
const copyKey = /^[a-z][a-zA-Z0-9]{0,59}$/;
const imagePath = /^(?:\.\/)?assets\/(?:site-media\/)?[a-zA-Z0-9_-]+\.(?:webp|jpe?g|png)$/;
const dataImage = /^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/;
const phoneNumber = /^\+[1-9][0-9]{6,14}$/;

function text(value, title, max = 400, optional = false) {
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) {
    throw Error('راجع حقل ' + title + '.');
  }
  return value.trim();
}

function number(value, title, optional = false) {
  const clean = text(value, title, 30, optional).replace(/[\s()-]/g, '');
  if (!clean && optional) return '';
  if (!phoneNumber.test(clean)) throw Error('اكتب ' + title + ' بالصيغة الدولية، مثل +20 ثم الرقم.');
  return clean;
}

function remoteImage(value) {
  if (!value.startsWith(SUPABASE_URL + '/')) return false;
  const url = new URL(value);
  return !url.search && !url.hash && /^\/storage\/v1\/object\/public\/academy-media\/[a-f0-9]{64}\.webp$/.test(url.pathname);
}

function source(value, draft) {
  if (typeof value === 'string' && (imagePath.test(value) || remoteImage(value) || (draft && value.length < 3_000_000 && dataImage.test(value)))) return value;
  throw Error('اختر صورة صالحة من محرر الصور.');
}

function image(value, draft) {
  return {src: source(value?.src, draft), alt: text(value?.alt, 'وصف الصورة', 180, true)};
}

function rows(values, title, max, transform) {
  if (!Array.isArray(values) || values.length > max) throw Error('راجع عدد ' + title + '.');
  const ids = new Set();
  return values.map(value => {
    if (typeof value?.id !== 'string' || !identifier.test(value.id) || ids.has(value.id)) {
      throw Error('معرّف متكرر أو غير صالح في ' + title + '.');
    }
    ids.add(value.id);
    return {id: value.id, ...transform(value)};
  });
}

export function validateContent(raw, draft = false) {
  if (raw?.version !== 1 || !raw.copy || Object.keys(raw.copy).length > 100) throw Error('ملف محتوى الموقع غير صالح.');
  const copy = Object.fromEntries(Object.entries(raw.copy).map(([key, value]) => {
    if (!copyKey.test(key)) throw Error('مفتاح نص غير صالح.');
    return [key, text(value, key, 800, true)];
  }));
  const contact = {
    phone: number(raw.contact?.phone, 'رقم الاتصال'),
    whatsapp: number(raw.contact?.whatsapp, 'رقم واتساب')
  };
  const media = Object.fromEntries(mediaKeys.map(key => [key, image(raw.media?.[key], draft)]));
  const branches = rows(raw.branches, 'الفروع', 50, value => ({
    name: text(value.name, 'اسم الفرع', 120),
    venue: text(value.venue, 'اسم المكان', 120, true),
    address: text(value.address, 'عنوان الفرع', 260),
    map: text(value.map, 'بحث الخريطة', 260, true),
    phone: number(value.phone, 'رقم الفرع', true),
    whatsapp: number(value.whatsapp, 'واتساب الفرع', true)
  }));
  const gallery = rows(raw.gallery, 'صور المعرض', 200, value => ({
    ...image(value, draft), caption: text(value.caption, 'عنوان الصورة', 180, true)
  }));
  return {version: 1, copy, contact, media, branches, gallery};
}

export const photoSource = value => value.startsWith('data:') || remoteImage(value) ? value : './' + value.replace(/^\.\//, '');

export function whatsappLink(phone, inquiry) {
  const link = new URL('https://wa.me/' + phone.slice(1));
  link.searchParams.set('text', 'مرحبًا، عندي استفسار عن ' + inquiry + '، لو سمحت.');
  return link.href;
}

export async function readPublished() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(SUPABASE_URL + '/rest/v1/site_content?select=revision,content&id=eq.true&limit=1', {
      headers: {apikey: SUPABASE_PUBLISHABLE_KEY}, cache: 'no-store', signal: controller.signal
    });
    if (response.ok) {
      const [row] = await response.json();
      if (row) return {content: validateContent(row.content), revision: row.revision};
    }
  } catch (error) {
    // Keep the tracked public content if the project is unavailable.
  } finally {
    clearTimeout(timer);
  }
  const response = await fetch('./' + CONTENT_PATH, {cache: 'no-store'});
  if (!response.ok) throw Error('تعذر تحميل محتوى الموقع المنشور.');
  return {content: validateContent(await response.json()), revision: null};
}

function openDraftDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('elasal-site-content', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function draftOperation(mode, operation) {
  const db = await openDraftDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', mode);
      const request = operation(tx.objectStore('drafts'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error || Error('تعذر حفظ المسودة.'));
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export const readDraft = () => draftOperation('readonly', drafts => drafts.get('site'));
export const saveDraft = value => draftOperation('readwrite', drafts => drafts.put(value, 'site'));

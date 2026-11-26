import {mediaKeys, photoSource, readDraft, readPublished, saveDraft, validateContent} from './site-data.js';
import {publishContent} from './site-publish.js';

const $ = id => document.getElementById(id);
const dialog = $('site-editor');
const form = $('site-editor-fields');
const feedback = $('site-editor-status');
const labels = {logo: 'شعار الموقع', home: 'صورة الرئيسية', training: 'صورة التدريب'};
const branchFields = [
  ['name', 'اسم الفرع'], ['venue', 'اسم المكان'], ['address', 'عنوان الفرع'],
  ['map', 'عبارة البحث في الخرائط'], ['phone', 'هاتف الفرع الدولي (اختياري)'], ['whatsapp', 'واتساب الفرع الدولي (اختياري)']
];
let draft, fieldGroups, timer, saving = Promise.resolve(), publishing = false, loading = false, pendingImages = 0;

function node(tag, text, className) {
  const control = document.createElement(tag);
  if (text) control.textContent = text;
  if (className) control.className = className;
  return control;
}

function status(message, failed = false) {
  feedback.textContent = message;
  feedback.dataset.error = failed;
}

function textField(label, value, change, wide = false) {
  const wrapper = node('label', null, 'editor-field');
  const control = node(wide ? 'textarea' : 'input');
  control.value = value;
  control.maxLength = wide ? 800 : 400;
  control.addEventListener('input', () => {
    change(control.value);
    queueSave();
  });
  wrapper.append(node('span', label), control);
  return wrapper;
}

function button(label, action, className = 'gold-tool-btn') {
  const control = node('button', label, className);
  control.type = 'button';
  control.addEventListener('click', action);
  return control;
}

function section(label, open = false) {
  const panel = node('details', null, 'editor-section');
  const fields = node('div', null, 'editor-section-body');
  panel.append(node('summary', label), fields);
  panel.open = open;
  form.append(panel);
  return fields;
}

function saveNow() {
  clearTimeout(timer);
  if (!draft) return saving;
  const snapshot = structuredClone(draft);
  saving = saving.catch(() => {}).then(() => saveDraft(snapshot));
  return saving;
}

function queueSave() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    saveNow().then(() => status('تم حفظ المسودة على هذا الجهاز.')).catch(error => status(error.message, true));
  }, 350);
}

function inputPhotos(label, pick, multiple = false) {
  const wrapper = node('label', null, 'editor-field');
  const input = node('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp';
  input.multiple = multiple;
  input.addEventListener('change', async () => {
    const images = [...input.files];
    if (!images.length) return;
    input.disabled = true;
    pendingImages++;
    try {
      await pick(images);
      await saveNow();
      status('حُفظت الصور في المسودة.');
    } catch (error) {
      status(error.message, true);
    } finally {
      input.value = '';
      input.disabled = false;
      pendingImages--;
    }
  });
  wrapper.append(node('span', label), input);
  return wrapper;
}

async function prepareImage(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) {
    throw Error('اختر JPG أو PNG أو WebP بحجم 20 MB أو أقل.');
  }
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/webp', .86);
    if (!data.startsWith('data:image/webp;') || data.length >= 3_000_000) throw Error('تعذر تجهيز الصورة بهذا الحجم.');
    return data;
  } finally {
    bitmap.close();
  }
}

function picture(record) {
  const preview = node('img', null, 'editor-thumbnail');
  preview.src = photoSource(record.src);
  preview.alt = '';
  preview.loading = 'lazy';
  return preview;
}

function listActions(rows, index, rerender, noun) {
  const actions = node('div', null, 'editor-actions');
  const move = offset => {
    [rows[index], rows[index + offset]] = [rows[index + offset], rows[index]];
    rerender();
    queueSave();
  };
  const earlier = button('لأعلى', () => move(-1));
  const later = button('لأسفل', () => move(1));
  earlier.disabled = index === 0;
  later.disabled = index === rows.length - 1;
  actions.append(earlier, later, button('حذف ' + noun, () => {
    if (!confirm('حذف ' + noun + ' من المسودة؟')) return;
    rows.splice(index, 1);
    rerender();
    queueSave();
  }));
  return actions;
}

function renderEditor() {
  form.replaceChildren();
  for (const [label, fields] of Object.entries(fieldGroups)) {
    const body = section(label, false);
    for (const [key, fieldLabel] of fields) {
      const value = draft.content.copy[key] ?? '';
      body.append(textField(fieldLabel, value, next => { draft.content.copy[key] = next; }, value.length > 65));
    }
  }
  const numbers = section('أرقام الاتصال والحجز', true);
  numbers.append(
    textField('رقم الاتصال الدولي', draft.content.contact.phone, value => { draft.content.contact.phone = value; }),
    textField('رقم واتساب الدولي', draft.content.contact.whatsapp, value => { draft.content.contact.whatsapp = value; })
  );
  const identity = section('الشعار وصور الصفحات');
  for (const key of mediaKeys) {
    const photo = draft.content.media[key];
    const card = node('article', null, 'editor-row');
    const preview = picture(photo);
    card.append(node('h3', labels[key]), preview,
      textField('وصف الصورة', photo.alt, value => { photo.alt = value; }),
      inputPhotos('استبدال الصورة', async ([file]) => {
        photo.src = await prepareImage(file);
        preview.src = photo.src;
      }));
    identity.append(card);
  }

  const branches = section('إدارة الفروع', true);
  const branchList = node('div', null, 'editor-list');
  const drawBranches = () => {
    branchList.replaceChildren();
    draft.content.branches.forEach((branch, index, rows) => {
      const card = node('article', null, 'editor-row');
      card.append(node('h3', branch.name || 'فرع جديد'));
      for (const [key, label] of branchFields) {
        card.append(textField(label, branch[key], value => { branch[key] = value; }));
      }
      card.append(listActions(rows, index, drawBranches, 'الفرع'));
      branchList.append(card);
    });
  };
  branches.append(branchList, button('إضافة فرع', () => {
    if (draft.content.branches.length >= 50) return status('وصلت للحد الأقصى للفروع.', true);
    draft.content.branches.push({id: crypto.randomUUID(), name: '', venue: '', address: '', map: '', phone: '', whatsapp: ''});
    drawBranches();
    queueSave();
    branchList.lastElementChild.querySelector('input').focus();
  }));
  drawBranches();

  const gallery = section('إدارة معرض الصور', true);
  const photoList = node('div', null, 'editor-list');
  const drawGallery = () => {
    photoList.replaceChildren();
    draft.content.gallery.forEach((photo, index, rows) => {
      const card = node('article', null, 'editor-row');
      const preview = picture(photo);
      card.append(preview,
        textField('عنوان الصورة', photo.caption, value => { photo.caption = value; }),
        textField('وصف الصورة', photo.alt, value => { photo.alt = value; }),
        inputPhotos('استبدال الصورة', async ([file]) => {
          photo.src = await prepareImage(file);
          preview.src = photo.src;
        }),
        listActions(rows, index, drawGallery, 'الصورة')
      );
      photoList.append(card);
    });
  };
  gallery.append(inputPhotos('رفع صور للمعرض', async files => {
    if (draft.content.gallery.length + files.length > 200) throw Error('الحد الأقصى للمعرض 200 صورة.');
    const uploads = [];
    for (const file of files) {
      uploads.push({id: crypto.randomUUID(), src: await prepareImage(file), alt: 'صورة من الأكاديمية', caption: 'صورة من الأكاديمية'});
    }
    draft.content.gallery.push(...uploads);
    drawGallery();
  }, true), photoList);
  drawGallery();
}

async function freshDraft() {
  return readPublished();
}

export async function openEditor() {
  if (dialog.open || loading) return;
  dialog.showModal();
  if (draft) return;
  loading = true;
  status('جارٍ تحميل محتوى الموقع');
  try {
    const saved = await readDraft();
    const fieldsResponse = await fetch('./assets/site-fields.json');
    if (!fieldsResponse.ok) throw Error('تعذّر تحميل محرر الموقع.');
    fieldGroups = await fieldsResponse.json();
    draft = saved && Object.hasOwn(saved, 'revision') ? saved : await freshDraft();
    renderEditor();
    status(saved ? 'تم فتح المسودة المحلية.' : 'تم تحميل المحتوى المنشور.');
  } catch (error) {
    status(error.message, true);
  } finally {
    loading = false;
  }
}

$('site-editor-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('cancel', event => { if (publishing) event.preventDefault(); });
dialog.addEventListener('close', () => {
  if (!publishing && draft) saveNow().catch(error => status(error.message, true));
});
$('site-editor-save').addEventListener('click', async () => {
  if (!draft || publishing) return;
  try {
    validateContent(draft.content, true);
    await saveNow();
    status('تم حفظ المسودة على هذا الجهاز.');
  } catch (error) { status(error.message, true); }
});
$('site-editor-preview').addEventListener('click', async event => {
  event.preventDefault();
  if (!draft || publishing) return;
  if (pendingImages) return status('انتظر تجهيز الصور أولًا.', true);
  let tab;
  try {
    validateContent(draft.content, true);
    tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    await saveNow();
    const preview = new URL('./?preview=1', location.href);
    if (tab) tab.location.replace(preview.href);
    else location.assign(preview.href);
  } catch (error) {
    tab?.close();
    status(error.message, true);
  }
});
$('site-editor-reload').addEventListener('click', async () => {
  if (pendingImages) return status('انتظر تجهيز الصور أولًا.', true);
  if (publishing || !confirm('استبدال المسودة بالمحتوى المنشور؟')) return;
  clearTimeout(timer);
  try {
    draft = await freshDraft();
    renderEditor();
    await saveNow();
    status('تم تحميل المحتوى المنشور.');
  } catch (error) { status(error.message, true); }
});
$('site-editor-publish').addEventListener('click', async event => {
  if (!draft || publishing) return;
  if (pendingImages) return status('انتظر تجهيز الصور أولًا.', true);
  publishing = true;
  const submit = event.currentTarget;
  submit.disabled = $('site-editor-close').disabled = true;
  form.inert = true;
  status('جارٍ نشر المحتوى على Supabase');
  clearTimeout(timer);
  try {
    await saveNow();
    draft = await publishContent(draft);
    renderEditor();
    status('تم نشر المحتوى للزوار.');
    try { await saveNow(); }
    catch { status('تم النشر. تعذّر تحديث نسخة المسودة في هذا المتصفح.', true); }
  } catch (error) {
    status(error.message, true);
  } finally {
    publishing = false;
    submit.disabled = $('site-editor-close').disabled = false;
    form.inert = false;
  }
});

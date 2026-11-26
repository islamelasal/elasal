import {readDraft, readPublished, validateContent, photoSource, whatsappLink} from './site-data.js';

function element(tag, options = {}) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text) node.textContent = options.text;
  return node;
}

function icon(kind) {
  const image = element('img', {className: 'contact-icon'});
  image.src = './assets/' + kind + '.svg';
  image.alt = '';
  image.width = image.height = 23;
  return image;
}

function branchLink(text, href, kind) {
  const link = element('a', {className: 'text-link'});
  link.href = href;
  if (kind) link.append(icon(kind));
  link.append(document.createTextNode(text));
  return link;
}

function renderBranches(container, data) {
  const {branches, contact, copy} = data;
  const cards = branches.map(branch => {
    const card = element('article', {className: 'public-panel branch-panel'});
    const address = element('p');
    const topic = 'فرع ' + branch.name;
    const maps = new URL('https://www.google.com/maps/search/');
    maps.searchParams.set('api', '1');
    maps.searchParams.set('query', branch.map || branch.venue + ' ' + branch.address);
    if (branch.venue) address.append(element('bdi', {text: branch.venue}), document.createElement('br'));
    address.append(document.createTextNode(branch.address));
    const actions = element('div', {className: 'branch-actions'});
    actions.append(
      branchLink(copy.branchMap, maps.href),
      branchLink(copy.branchWhatsApp, whatsappLink(branch.whatsapp || contact.whatsapp, topic), 'whatsapp'),
      branchLink(copy.branchPhone, 'tel:' + (branch.phone || contact.phone), 'phone')
    );
    card.append(element('h3', {text: branch.name}), address, actions);
    return card;
  });
  container.replaceChildren(...cards);
}

function renderGallery(container, photos) {
  const cards = photos.map(item => {
    const card = element('figure', {className: 'photo-card'});
    const link = element('a', {className: 'gallery-photo'});
    const image = element('img');
    image.src = photoSource(item.src);
    image.alt = item.alt || item.caption;
    image.loading = 'lazy';
    image.decoding = 'async';
    link.href = image.src;
    link.setAttribute('aria-label', 'افتح الصورة: ' + (item.caption || item.alt || 'صورة من المعرض'));
    link.append(image);
    card.append(link, element('figcaption', {text: item.caption || item.alt}));
    return card;
  });
  container.replaceChildren(...cards);
}

function localPreview() {
  const intro = document.createElement('p');
  intro.className = 'draft-preview';
  intro.textContent = 'معاينة المسودة المحفوظة على هذا الجهاز';
  document.querySelector('.public-header').after(intro);
  const base = new URL('./', location.href);
  const pages = new Set(['', 'index.html', 'training.html', 'gallery.html', 'contact.html']);
  for (const link of document.querySelectorAll('a[href]')) {
    const url = new URL(link.href);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || !pages.has(url.pathname.slice(base.pathname.length))) continue;
    url.searchParams.set('preview', '1');
    link.href = url.href;
  }
}

function render(data) {
  const {copy, contact, media} = data;
  for (const node of document.querySelectorAll('[data-copy]')) {
    if (Object.hasOwn(copy, node.dataset.copy)) node.textContent = copy[node.dataset.copy];
  }
  for (const node of document.querySelectorAll('[data-description]')) {
    if (Object.hasOwn(copy, node.dataset.description)) node.content = copy[node.dataset.description];
  }
  for (const node of document.querySelectorAll('[data-media]')) {
    const image = media[node.dataset.media];
    if (!image) continue;
    node.src = photoSource(image.src);
    node.alt = image.alt;
  }
  for (const node of document.querySelectorAll('[data-home-label]')) {
    node.setAttribute('aria-label', copy.academy + '، ' + copy.navHome);
  }
  const page = location.pathname.split('/').pop().replace(/\.html$/, '') || 'index';
  for (const node of document.querySelectorAll('[data-contact]')) {
    const topic = copy[node.dataset.inquiryKey || page + 'Inquiry'] || node.dataset.inquiry || copy.academy;
    if (node.dataset.contact === 'whatsapp') node.href = whatsappLink(contact.whatsapp, topic);
    else {
      node.href = 'tel:' + contact.phone;
      node.setAttribute('aria-label', 'اتصال للاستفسار عن ' + topic);
    }
  }
  for (const node of document.querySelectorAll('[data-phone-number]')) node.textContent = contact.phone;
  const branches = document.querySelector('[data-branches]');
  const gallery = document.querySelector('[data-gallery]');
  if (branches) renderBranches(branches, data);
  if (gallery) renderGallery(gallery, data.gallery);
}

async function init() {
  const isPreview = new URLSearchParams(location.search).get('preview') === '1';
  try {
    const draft = isPreview ? await readDraft() : null;
    render(draft ? validateContent(draft.content, true) : (await readPublished()).content);
    if (draft) localPreview();
  } catch (error) {
    if (isPreview) console.warn(error.message);
  } finally {
    window.dispatchEvent(new Event('site-content-ready'));
  }
}
init();

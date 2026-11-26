const viewer = document.getElementById('photo-viewer');
const grid = document.querySelector('.photo-grid');
const photo = document.getElementById('photo-full');
const description = document.getElementById('photo-description');
const position = document.getElementById('photo-position');
const previous = document.getElementById('photo-prev');
const next = document.getElementById('photo-next');
const format = new Intl.NumberFormat('ar-EG');
let active = -1;
let opener;

const links = () => Array.from(grid.querySelectorAll('.gallery-photo'));

function render(index) {
    const images = links();
    const link = images[index];
    if (!link) return;
    active = index;
    photo.src = link.href;
    photo.alt = link.querySelector('img').alt;
    description.textContent = link.closest('figure').querySelector('figcaption').textContent;
    position.textContent = format.format(index + 1) + ' / ' + format.format(images.length);
    previous.disabled = index === 0;
    next.disabled = index === images.length - 1;
    if (!viewer.open) viewer.showModal();
}

function openAt(index) {
    if (!links()[index]) return;
    const key = '#photo-' + (index + 1);
    if (viewer.open) history.replaceState(history.state, '', key);
    else history.pushState({ gallery: true }, '', key);
    render(index);
}

function syncLocation() {
    const matched = /^#photo-([1-9][0-9]*)$/.exec(location.hash);
    const index = matched ? Number(matched[1]) - 1 : -1;
    if (links()[index]) {
        render(index);
    } else if (viewer.open) {
        viewer.close();
        active = -1;
        photo.removeAttribute('src');
        opener?.focus();
    }
}

function dismiss() {
    if (history.state?.gallery) history.back();
    else {
        history.replaceState(history.state, '', location.pathname + location.search);
        syncLocation();
    }
}

grid.addEventListener('click', event => {
    const link = event.target.closest('.gallery-photo');
    if (!link || event.button !== 0 || event.ctrlKey || event.shiftKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    opener = link;
    openAt(links().indexOf(link));
});
document.getElementById('photo-back').addEventListener('click', dismiss);
previous.addEventListener('click', () => openAt(active - 1));
next.addEventListener('click', () => openAt(active + 1));
viewer.addEventListener('cancel', event => {
    event.preventDefault();
    dismiss();
});
viewer.addEventListener('keydown', event => {
    if (event.key === 'ArrowRight') openAt(active - 1);
    if (event.key === 'ArrowLeft') openAt(active + 1);
});
window.addEventListener('popstate', syncLocation);
window.addEventListener('site-content-ready', syncLocation);
syncLocation();

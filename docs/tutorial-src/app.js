/* Copyright (C) 2026 Brclio. GPL-2.0-only. No network requests. */
(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const toast = $('#toast');
  let toastTimer;
  function notify(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, 2800);
  }

  const progressKey = 'brclio-edge-tutorial:v1:steps';
  const steps = $$('[data-step]');
  let canStore = true;
  try {
    const saved = JSON.parse(localStorage.getItem(progressKey) || '{}');
    steps.forEach(input => { input.checked = saved?.[input.dataset.step] === true; });
  } catch { canStore = false; }
  function updateProgress(persist = false) {
    const count = steps.filter(input => input.checked).length;
    $('#progress-label').textContent = `${count} / ${steps.length}`;
    $('#mobile-progress').textContent = `已完成 ${count} / ${steps.length}`;
    $('#setup-progress').value = count;
    if (persist) {
      try {
        localStorage.setItem(progressKey, JSON.stringify(Object.fromEntries(steps.map(input => [input.dataset.step, input.checked]))));
      } catch { canStore = false; }
    }
    if (!canStore) $('#progress-hint').textContent = '浏览器未允许存储，勾选仅保留到关闭页面。';
  }
  steps.forEach(input => input.addEventListener('change', () => updateProgress(true)));
  $('#reset-progress').addEventListener('click', () => {
    steps.forEach(input => { input.checked = false; });
    updateProgress(true);
    notify('已重置搭建进度');
  });
  updateProgress();

  async function copyText(value) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Use fallback');
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      const field = document.createElement('textarea');
      field.value = value;
      field.readOnly = true;
      field.style.cssText = 'position:fixed;left:-10000px;top:0;';
      document.body.append(field);
      field.select();
      let success = false;
      try { success = document.execCommand('copy'); } catch { /* Manual selection remains available. */ }
      field.remove();
      return success;
    }
  }
  $$('[data-copy]').forEach(button => button.addEventListener('click', async () => {
    const target = document.getElementById(button.dataset.copy);
    if (!target) return;
    const success = await copyText(target.textContent.trim());
    notify(success ? '命令已复制，可粘贴到终端' : '浏览器未允许复制，请选中命令后手动复制');
    button.focus({ preventScroll: true });
  }));

  // Generate a fresh UUID v4 locally so deployment does not require Node.js.
  $('#generate-uuid')?.addEventListener('click', () => {
    if (!globalThis.crypto?.getRandomValues) {
      notify('当前浏览器不支持安全随机数，请使用新版浏览器');
      return;
    }
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    $('#generated-uuid').textContent = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    $('[data-copy="generated-uuid"]').disabled = false;
    notify('UUID 已在当前浏览器生成，请复制并妥善保存');
  });

  const navShell = $('#toc-shell');
  const navShade = $('#nav-shade');
  const menuButton = $('#mobile-menu');
  let menuOpen = false;
  function setMenu(open, restoreFocus = true) {
    menuOpen = open;
    navShell.classList.toggle('is-open', open);
    navShade.classList.toggle('is-open', open);
    navShade.hidden = !open;
    menuButton.setAttribute('aria-expanded', String(open));
    if (open) {
      navShell.setAttribute('role', 'dialog');
      navShell.setAttribute('aria-modal', 'true');
      document.body.style.overflow = 'hidden';
      $('#nav-close').focus();
    } else {
      navShell.removeAttribute('role');
      navShell.removeAttribute('aria-modal');
      document.body.style.overflow = '';
      if (restoreFocus && getComputedStyle(menuButton).display !== 'none') menuButton.focus({ preventScroll: true });
    }
  }
  menuButton.addEventListener('click', () => setMenu(!menuOpen));
  $('#nav-close').addEventListener('click', () => setMenu(false));
  navShade.addEventListener('click', () => setMenu(false));
  const tocLinks = $$('#toc a');
  tocLinks.forEach(link => link.addEventListener('click', () => {
    if (!menuOpen) return;
    setMenu(false, false);
    const section = document.getElementById(link.hash.slice(1));
    if (section) {
      section.setAttribute('tabindex', '-1');
      section.focus({ preventScroll: true });
      section.addEventListener('blur', () => section.removeAttribute('tabindex'), { once: true });
    }
  }));
  document.addEventListener('keydown', event => {
    if (!menuOpen) return;
    if (event.key === 'Escape') { event.preventDefault(); setMenu(false); }
    if (event.key === 'Tab') {
      const focusable = [...navShell.querySelectorAll('a,button')].filter(el => getComputedStyle(el).display !== 'none');
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  const mobileMedia = matchMedia('(max-width:900px)');
  mobileMedia.addEventListener('change', event => { if (!event.matches && menuOpen) setMenu(false, false); });

  const sections = $$('.chapter');
  let scrollPending = false;
  function syncReadingPosition() {
    scrollPending = false;
    let active = sections[0];
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= 160) active = section;
      else break;
    }
    tocLinks.forEach(link => {
      if (link.hash === `#${active.id}`) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
    const range = document.documentElement.scrollHeight - innerHeight;
    $('#reading-progress').style.width = `${range > 0 ? Math.min(100, Math.max(0, scrollY / range * 100)) : 0}%`;
  }
  addEventListener('scroll', () => { if (!scrollPending) { scrollPending = true; requestAnimationFrame(syncReadingPosition); } }, { passive: true });
  addEventListener('resize', syncReadingPosition);
  syncReadingPosition();

  const faqs = $$('#faq details');
  const faqSearch = $('#faq-search');
  const searchable = new Map(faqs.map(item => [item, item.textContent.toLocaleLowerCase()]));
  function searchFaq() {
    const query = faqSearch.value.trim().toLocaleLowerCase();
    let count = 0;
    faqs.forEach(item => {
      const match = !query || searchable.get(item).includes(query);
      item.hidden = !match;
      if (match) count++;
    });
    $('#no-results').hidden = count > 0;
    $('#faq-count').textContent = query ? `找到 ${count} 个相关问题` : `共 ${faqs.length} 个常见问题`;
    syncReadingPosition();
  }
  faqSearch.addEventListener('input', searchFaq);
  searchFaq();

  const lightbox = $('#lightbox');
  const lightboxImg = $('#lightbox-img');
  const stage = $('#lightbox-stage');
  const fitButton = $('#image-fit');
  const actualButton = $('#image-actual');
  let imageTrigger;
  function imageMode(actual) {
    stage.classList.toggle('actual', actual);
    fitButton.setAttribute('aria-pressed', String(!actual));
    actualButton.setAttribute('aria-pressed', String(actual));
    stage.scrollTop = stage.scrollLeft = 0;
  }
  $$('[data-image]').forEach(button => button.addEventListener('click', () => {
    const image = button.querySelector('img');
    if (!image) return;
    imageTrigger = button;
    lightboxImg.src = image.src;
    lightboxImg.alt = image.alt;
    lightboxImg.width = image.naturalWidth || image.width;
    lightboxImg.height = image.naturalHeight || image.height;
    $('#lightbox-title').textContent = image.alt;
    $('#lightbox-meta').textContent = `${image.naturalWidth || image.width} × ${image.naturalHeight || image.height} px · PNG`;
    $('#image-download').href = image.src;
    $('#image-download').download = `brclio-edge-${button.dataset.image}-original.png`;
    imageMode(false);
    lightbox.showModal();
    document.body.style.overflow = 'hidden';
    $('#image-close').focus();
  }));
  fitButton.addEventListener('click', () => imageMode(false));
  actualButton.addEventListener('click', () => imageMode(true));
  $('#image-close').addEventListener('click', () => lightbox.close());
  lightbox.addEventListener('click', event => {
    if (event.target !== lightbox) return;
    const bounds = lightbox.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) lightbox.close();
  });
  lightbox.addEventListener('close', () => {
    document.body.style.overflow = '';
    imageTrigger?.focus({ preventScroll: true });
  });

  let printOpenState;
  addEventListener('beforeprint', () => {
    printOpenState = $$('details').map(item => [item, item.open, item.hidden]);
    printOpenState.forEach(([item]) => { item.open = true; item.hidden = false; });
  });
  addEventListener('afterprint', () => {
    printOpenState?.forEach(([item, open, hidden]) => { item.open = open; item.hidden = hidden; });
    printOpenState = undefined;
    syncReadingPosition();
  });
  $('#print-guide').addEventListener('click', () => window.print());
})();

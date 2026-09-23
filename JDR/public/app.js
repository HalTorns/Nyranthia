import { BookEditors, hasWriting } from './rich-editor.js';

const $ = selector => document.querySelector(selector);
const state = { book: null, revision: 0, updatedAt: null, chapterId: '', change: 0, saved: 0, sending: false, request: null, blocked: false, timer: null, draftKey: '', recovery: null };
const uid = () => crypto.randomUUID();
const wordCount = text => text.trim().split(/\s+/u).filter(Boolean).length;
const label = text => text.trim() || 'Sans titre';
const chapter = () => state.book.chapters.find(c => c.id === state.chapterId);
const stats = c => ({ written: c.sections.filter(hasWriting).length, words: c.sections.reduce((sum, s) => sum + wordCount(s.text), 0) });
const content = book => JSON.stringify(book);
let draftAvailable = true;
const rich = new BookEditors({
  getChapter: () => state.book ? chapter() : null,
  onError: message => showError(message, false),
  onEdit: section => {
    const wrapper = document.getElementById(`section-${section.id}`);
    const empty = !hasWriting(section);
    const wasEmpty = wrapper?.classList.contains('is-empty');
    wrapper?.classList.toggle('is-empty', empty);
    if (wrapper?.querySelector('.section-flag')) wrapper.querySelector('.section-flag').hidden = !empty;
    if (wasEmpty !== empty) renderContents();
    changed();
  }
});

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function autoSize(input) { input.style.height = 'auto'; input.style.height = `${input.scrollHeight + 2}px`; }
function status(kind, message) {
  $('.save-indicator').dataset.state = kind;
  $('#save-status').textContent = message;
  $('#save-icon').textContent = { saved: '✓', saving: '◷', error: '!' }[kind] || '○';
}
function savedStatus() {
  const time = state.updatedAt ? new Intl.DateTimeFormat('fr', { hour: '2-digit', minute: '2-digit' }).format(new Date(state.updatedAt)) : '';
  status('saved', time ? `Enregistré à ${time}` : 'Enregistré sur le serveur');
}
function showError(message, retry = true) {
  const node = $('#notice'); node.replaceChildren(element('p', '', message)); node.hidden = false;
  if (retry) { const b = element('button', '', 'Réessayer'); b.addEventListener('click', () => flush()); node.append(b); }
}
function storeDraft() {
  if (!state.book || !state.draftKey) return;
  try {
    localStorage.setItem(state.draftKey, JSON.stringify({ book: state.book, baseRevision: state.revision, writtenAt: Date.now() }));
    draftAvailable = true;
  } catch {
    draftAvailable = false;
    showError('La copie de secours du navigateur est indisponible. Gardez cet onglet ouvert jusqu’à l’indication « Enregistré ».', false);
  }
}
function clearDraft() {
  try { localStorage.removeItem(state.draftKey); } catch { /* La copie sur le serveur reste la référence. */ }
}
function enableWriting(enabled) {
  document.querySelectorAll('#book-title, #book-subtitle, #manuscript textarea, #manuscript select, #add-chapter, #add-section').forEach(input => { input.disabled = !enabled; });
  rich.setEditable(enabled);
}
function changed() {
  state.change++;
  state.invalid = false;
  storeDraft();
  if (!state.blocked) {
    status('saving', 'Modifications en attente…');
    clearTimeout(state.timer); state.timer = setTimeout(flush, 450);
  }
  updateCounts();
}
async function flush() {
  clearTimeout(state.timer);
  if (state.sending || state.blocked || !state.book || state.saved === state.change) return;
  state.sending = true;
  status('saving', 'Enregistrement…');
  if (!state.request) state.request = { sequence: state.change, payload: { book: structuredClone(state.book), baseRevision: state.revision, changeId: uid(), clientVersion: 2 } };
  const pending = state.request;
  try {
    const response = await fetch('/api/book', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending.payload), signal: AbortSignal.timeout(10000) });
    const result = await response.json();
    if (response.status === 409) {
      state.blocked = true;
      showConflict(result.error);
      return;
    }
    if (!response.ok) {
      if (response.status === 400 || response.status === 413 || response.status === 415) { state.request = null; state.invalid = true; }
      throw new Error(result.error || 'La sauvegarde a échoué.');
    }
    state.revision = result.revision;
    state.updatedAt = result.updatedAt;
    state.saved = pending.sequence;
    state.request = null;
    $('#notice').hidden = true;
    if (state.saved === state.change) { clearDraft(); savedStatus(); }
    else { storeDraft(); status('saving', 'Modifications en attente…'); }
  } catch (error) {
    status('error', 'Sauvegarde à reprendre');
    showError(`${error.name === 'TimeoutError' || error.name === 'TypeError' ? 'Le serveur ne répond pas. Vérifiez votre connexion, puis réessayez.' : error.message} Vos textes sont conservés ${draftAvailable ? 'dans un brouillon de cet onglet' : 'dans cet onglet'}.`);
    if (!state.invalid) state.timer = setTimeout(flush, 5000);
  } finally {
    state.sending = false;
    if (!state.blocked && !state.invalid && !state.request && state.saved < state.change) queueMicrotask(flush);
  }
}
function downloadDraft(book = state.book) {
  const blob = new Blob([JSON.stringify(book, null, 2)], { type: 'application/json;charset=utf-8' });
  const href = URL.createObjectURL(blob); const a = element('a');
  a.href = href; a.download = 'Nyranthia-brouillon.json'; a.click(); setTimeout(() => URL.revokeObjectURL(href), 1000);
}
function showConflict(message) {
  enableWriting(false);
  status('error', 'Deux versions à conserver');
  showError(`${message} Téléchargez votre brouillon avant de charger la version enregistrée.`, false);
  const download = element('button', '', 'Télécharger mon brouillon');
  const reload = element('button', '', 'Charger la version enregistrée');
  download.addEventListener('click', () => downloadDraft());
  reload.addEventListener('click', async () => {
    if (!confirm('Votre brouillon restera conservé dans le navigateur. Charger maintenant la version enregistrée sur le serveur ?')) return;
    try { localStorage.setItem(`${state.draftKey}-conflit-${Date.now()}`, JSON.stringify({ book: state.book, baseRevision: state.revision })); }
    catch { return showError('Téléchargez votre brouillon avant de fermer cet onglet : la copie de secours est indisponible.', false); }
    clearDraft(); state.saved = state.change; location.reload();
  });
  $('#notice').append(download, reload);
}

function renderContents() {
  const fragment = document.createDocumentFragment();
  state.book.chapters.forEach((c, index) => {
    const link = element('a', `toc-entry${c.id === state.chapterId ? ' active' : ''}`);
    link.href = `#/chapitre/${c.id}`; link.dataset.chapter = c.id;
    if (c.id === state.chapterId) link.setAttribute('aria-current', 'page');
    link.append(element('span', 'toc-number', String(index + 1).padStart(2, '0')), element('span', 'toc-title', label(c.title)));
    const empty = c.sections.filter(s => !hasWriting(s)).length;
    if (empty) { const count = element('span', 'toc-empty', `${empty}`); count.title = `${empty} section${empty > 1 ? 's' : ''} à écrire`; link.append(count); }
    fragment.append(link);
    if (c.id === state.chapterId) {
      const subs = element('div', 'toc-sections');
      for (const s of c.sections) {
        const sub = element('a', 'toc-section', label(s.title));
        sub.href = `#/chapitre/${c.id}/section/${s.id}`;
        subs.append(sub);
      }
      fragment.append(subs);
    }
  });
  const scroll = $('#contents').scrollTop;
  $('#contents').replaceChildren(fragment); $('#contents').scrollTop = scroll;
  $('#chapter-count').textContent = String(state.book.chapters.length).padStart(2, '0');
}
function updateCounts() {
  if (!state.book) return;
  const sections = state.book.chapters.flatMap(c => c.sections);
  const written = sections.filter(hasWriting).length;
  $('#book-progress-label').textContent = `${written} / ${sections.length} sections renseignées`;
  $('#book-progress-bar').style.width = `${sections.length ? written / sections.length * 100 : 0}%`;
  const c = chapter(); if (!c) return;
  const value = stats(c);
  if ($('#chapter-section-count')) $('#chapter-section-count').textContent = `${c.sections.length} section${c.sections.length > 1 ? 's' : ''}`;
  if ($('#chapter-word-count')) $('#chapter-word-count').textContent = `${value.words.toLocaleString('fr')} mots`;
  if ($('#chapter-empty-count')) $('#chapter-empty-count').textContent = `${c.sections.length - value.written} à écrire`;
}
function field(tag, className, value, aria, max, onInput) {
  const input = element(tag, className);
  input.value = value; input.setAttribute('aria-label', aria); input.spellcheck = true;
  if (max) input.maxLength = max;
  if (tag === 'textarea') input.rows = 1;
  input.addEventListener('input', () => { if (tag === 'textarea') autoSize(input); onInput(input.value); changed(); });
  return input;
}
function renderChapter() {
  const c = chapter(); const paper = $('#manuscript');
  rich.dispose();
  if (!c) { paper.replaceChildren(element('p', '', 'Ajoutez un chapitre pour commencer votre livre.')); updateNavigation(); return; }
  const index = state.book.chapters.indexOf(c);
  const runningHead = element('div', 'running-head');
  runningHead.append(element('span', 'running-title', label(state.book.title)), element('span', '', 'Univers & règles'));
  const meta = element('div', 'chapter-meta');
  meta.append(element('span', '', `CHAPITRE ${String(index + 1).padStart(2, '0')}`));
  const audience = element('label', 'audience', 'Lecture');
  const select = element('select'); select.setAttribute('aria-label', 'Public du chapitre');
  for (const [value, title] of [['Tous', 'Tous'], ['MJ', 'MJ uniquement']]) { const option = element('option', '', title); option.value = value; select.append(option); }
  select.value = c.audience; select.addEventListener('change', () => { c.audience = select.value; changed(); });
  audience.append(select); meta.append(audience);
  const title = field('textarea', 'chapter-title', c.title, 'Titre du chapitre', 500, value => {
    c.title = value; $('#breadcrumb-chapter').textContent = label(value); renderContents();
  });
  title.id = 'chapter-title'; title.placeholder = 'Titre du chapitre';
  const summary = element('div', 'chapter-summary');
  for (const id of ['chapter-section-count', 'chapter-word-count', 'chapter-empty-count']) { const node = element('span'); node.id = id; summary.append(node); }
  paper.replaceChildren(runningHead, meta, title, summary);
  for (const s of c.sections) {
    const wrapper = element('section', `writing-section${hasWriting(s) ? '' : ' is-empty'}`); wrapper.id = `section-${s.id}`;
    const head = element('div', 'section-head');
    const sectionTitle = field('textarea', 'section-title', s.title, 'Titre de la section', 500, value => { s.title = value; document.getElementById(`text-${s.id}`)?.setAttribute('aria-label', `Contenu de la section ${label(value)}`); renderContents(); });
    sectionTitle.id = `title-${s.id}`; sectionTitle.placeholder = 'Titre de la section';
    const flag = element('span', 'section-flag', 'À écrire'); flag.hidden = hasWriting(s);
    head.append(sectionTitle, flag);
    const host = element('div', 'rich-host');
    wrapper.append(head, host); paper.append(wrapper); rich.mount(s, host);
    if (s.prompt && hasWriting(s)) {
      const hint = element('details', 'section-hint');
      hint.append(element('summary', '', 'Piste d’écriture'), element('p', '', s.prompt));
      wrapper.append(hint);
    }
  }
  const add = element('button', 'add-section', '＋ Ajouter une section');
  add.id = 'add-section'; add.addEventListener('click', addSection); paper.append(add);
  paper.append(element('div', 'folio', `— ${String(index + 1).padStart(2, '0')} —`));
  $('#breadcrumb-chapter').textContent = label(c.title);
  renderContents(); updateCounts(); updateNavigation();
  rich.renderNotes();
  enableWriting(!state.blocked);
  requestAnimationFrame(() => paper.querySelectorAll('textarea').forEach(autoSize));
}
function updateNavigation() {
  const index = state.book.chapters.findIndex(c => c.id === state.chapterId);
  $('#previous-chapter').disabled = index <= 0;
  $('#next-chapter').disabled = index < 0 || index === state.book.chapters.length - 1;
  $('#page-position').textContent = `${Math.max(0, index + 1)} / ${state.book.chapters.length}`;
}
function route() {
  if (!state.book) return;
  const match = location.hash.match(/^#\/chapitre\/([a-zA-Z0-9_-]+)(?:\/section\/([a-zA-Z0-9_-]+))?$/);
  const id = state.book.chapters.some(c => c.id === match?.[1]) ? match[1] : state.book.chapters[0]?.id;
  const newPage = id !== state.chapterId;
  state.chapterId = id || '';
  if (newPage || !$('#chapter-title')) renderChapter();
  if (match?.[2]) requestAnimationFrame(() => document.getElementById(`section-${match[2]}`)?.scrollIntoView({ block: 'start' }));
  else if (newPage) window.scrollTo({ top: 0 });
  closeSidebar();
}
function go(id) { location.hash = `/chapitre/${id}`; }
function addChapter() {
  if (!state.book || state.blocked) return;
  const c = { id: uid(), title: 'Nouveau chapitre', audience: 'Tous', sections: [{ id: uid(), title: 'Première section', text: '', prompt: '' }] };
  state.book.chapters.push(c); changed(); go(c.id);
  requestAnimationFrame(() => { route(); $('#chapter-title')?.focus(); $('#chapter-title')?.select(); });
}
function addSection() {
  const c = chapter(); if (!c || state.blocked) return;
  const section = { id: uid(), title: 'Nouvelle section', text: '', prompt: '' };
  c.sections.push(section); changed(); renderChapter();
  requestAnimationFrame(() => {
    const input = document.getElementById(`title-${section.id}`);
    input.scrollIntoView({ block: 'center' }); input.focus(); input.select();
  });
}
function syncSidebarAccess() { $('#sidebar').inert = matchMedia('(max-width:820px)').matches && !$('#sidebar').classList.contains('open'); }
function closeSidebar() { $('#sidebar').classList.remove('open'); $('#shade').classList.remove('visible'); $('#toggle-sidebar').setAttribute('aria-expanded', 'false'); syncSidebarAccess(); }
$('#toggle-sidebar').addEventListener('click', () => { const open = $('#sidebar').classList.toggle('open'); $('#shade').classList.toggle('visible', open); $('#toggle-sidebar').setAttribute('aria-expanded', String(open)); syncSidebarAccess(); });
$('#shade').addEventListener('click', closeSidebar);
window.addEventListener('keydown', event => { if (event.key === 'Escape') closeSidebar(); if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); flush(); } });
$('#add-chapter').addEventListener('click', addChapter);
$('#previous-chapter').addEventListener('click', () => { const index = state.book.chapters.findIndex(c => c.id === state.chapterId); if (index > 0) go(state.book.chapters[index - 1].id); });
$('#next-chapter').addEventListener('click', () => { const index = state.book.chapters.findIndex(c => c.id === state.chapterId); if (index < state.book.chapters.length - 1) go(state.book.chapters[index + 1].id); });
$('#book-title').addEventListener('input', event => { if (!state.book) return; state.book.title = event.target.value; document.title = `${label(state.book.title)} · Atelier du livre`; if ($('.running-title')) $('.running-title').textContent = label(state.book.title); autoSize(event.target); changed(); });
$('#book-subtitle').addEventListener('input', event => { if (!state.book) return; state.book.subtitle = event.target.value; changed(); });
window.addEventListener('hashchange', route);
window.addEventListener('resize', () => { document.querySelectorAll('textarea').forEach(autoSize); syncSidebarAccess(); });
window.addEventListener('beforeunload', event => { if (state.saved !== state.change) { storeDraft(); event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && state.saved !== state.change) { storeDraft(); flush(); } });

function offerRecovery(drafts) {
  state.recovery = drafts; state.blocked = true;
  enableWriting(false);
  const recovery = $('#recovery'); recovery.hidden = false;
  recovery.replaceChildren(element('p', '', 'Des textes non enregistrés sur le serveur ont été retrouvés. Si un autre onglet est ouvert, terminez-y la sauvegarde avant de continuer ici.'));
  const archive = () => {
    try {
      for (const { key, draft } of drafts) {
        localStorage.setItem(`nyranthia-archive-${uid()}`, JSON.stringify(draft));
        // N’efface pas un brouillon qui aurait évolué dans un autre onglet.
        if (localStorage.getItem(key) === JSON.stringify(draft)) localStorage.removeItem(key);
      }
      return true;
    } catch { showError('Téléchargez vos brouillons avant de continuer : la copie de secours est indisponible.', false); return false; }
  };
  for (const { draft } of drafts) {
    const row = element('div', 'recovery-row');
    const date = new Date(draft.writtenAt || Date.now()).toLocaleString('fr');
    row.append(element('span', '', `${label(draft.book.title)} · ${date}`));
    const download = element('button', '', 'Télécharger le brouillon'); download.onclick = () => downloadDraft(draft.book); row.append(download);
    if (draft.baseRevision === state.revision) {
      const restore = element('button', '', 'Reprendre ce brouillon');
      restore.onclick = () => {
        if (!archive()) return;
        state.book = draft.book; state.blocked = false; recovery.hidden = true;
        $('#book-title').value = state.book.title; $('#book-subtitle').value = state.book.subtitle;
        document.title = `${label(state.book.title)} · Atelier du livre`;
        state.chapterId = ''; route(); autoSize($('#book-title')); enableWriting(true); changed();
      };
      row.append(restore);
    } else row.append(element('p', '', 'Le livre a évolué depuis ce brouillon. Téléchargez-le pour conserver les deux versions.'));
    recovery.append(row);
  }
  const keep = element('button', '', 'Continuer avec la version enregistrée');
  keep.onclick = () => { if (!archive()) return; state.blocked = false; recovery.hidden = true; enableWriting(true); savedStatus(); };
  recovery.append(keep);
  status('error', 'Un brouillon à récupérer');
}
function registerAgentTools() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const lifecycle = new AbortController();
  const register = tool => { try { Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); } catch {} };
  register({ name: 'read_book_outline', title: 'Lire le sommaire', description: 'Lire la structure actuelle et le nombre de sections vides du livre, sans le modifier.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute() { return { title: state.book.title, chapters: state.book.chapters.map(c => ({ id: c.id, title: c.title, audience: c.audience, sections: c.sections.map(s => ({ id: s.id, title: s.title, empty: !s.text.trim() })) })) }; } });
  register({ name: 'navigate_to_chapter', title: 'Ouvrir un chapitre', description: 'Afficher un chapitre existant dans l’atelier sans modifier son contenu.', inputSchema: { type: 'object', properties: { chapterId: { type: 'string' } }, required: ['chapterId'], additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute(input) { if (!input || typeof input.chapterId !== 'string' || !state.book.chapters.some(c => c.id === input.chapterId)) throw new Error('Chapitre inconnu.'); go(input.chapterId); route(); return { chapterId: state.chapterId }; } });
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
}
async function start() {
  try {
    const response = await fetch('/api/book');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Le livre ne peut pas être ouvert.');
    if (result.editorVersion !== 2) throw new Error('Le serveur doit être mis à jour pour ouvrir cet éditeur. Vos textes sont conservés.');
    state.book = result.book; state.revision = result.revision; state.updatedAt = result.updatedAt;
    const draftPrefix = `nyranthia-draft-${result.instance}-`;
    state.draftKey = draftPrefix + uid();
    $('#book-title').value = state.book.title; $('#book-subtitle').value = state.book.subtitle;
    document.title = `${label(state.book.title)} · Atelier du livre`;
    autoSize($('#book-title')); route(); savedStatus();
    try {
      const drafts = [];
      for (const key of Object.keys(localStorage).filter(key => key.startsWith(draftPrefix))) {
        const draft = JSON.parse(localStorage.getItem(key) || 'null');
        if (draft?.book && content(draft.book) !== content(state.book)) drafts.push({ key, draft });
        else if (draft?.book) localStorage.removeItem(key);
      }
      drafts.sort((a, b) => b.draft.writtenAt - a.draft.writtenAt);
      if (drafts.length) offerRecovery(drafts);
    } catch { showError('Le brouillon de secours du navigateur est illisible. Le livre enregistré sur le serveur est ouvert.', false); }
    registerAgentTools();
  } catch (error) {
    status('error', 'Ouverture impossible');
    $('#manuscript').replaceChildren(element('p', 'loading', 'Le livre n’a pas pu être chargé. Aucun contenu n’a été remplacé.'));
    showError(error.message, false);
    const retry = element('button', '', 'Réessayer l’ouverture'); retry.addEventListener('click', () => location.reload()); $('#notice').append(retry);
  }
}
start();

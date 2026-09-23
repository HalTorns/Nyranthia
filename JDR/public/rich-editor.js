import { Editor, Mark } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Highlight from '@tiptap/extension-highlight';
import { Placeholder } from '@tiptap/extensions';

const $ = selector => document.querySelector(selector);
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const localImage = /^\/media\/[a-f0-9]{64}\.(png|jpg|webp)$/;
export const hasWriting = section => !!section.text.trim() || JSON.stringify(section.content || {}).includes('"type":"image"');
export function textDocument(text) {
  return { type: 'doc', content: text.split('\n\n').map(paragraph => ({ type: 'paragraph', ...(paragraph ? { content: paragraph.split('\n').flatMap((line, index) => [...(index ? [{ type: 'hardBreak' }] : []), ...(line ? [{ type: 'text', text: line }] : [])]) } : {}) })) };
}
const Annotation = Mark.create({
  name: 'annotation', inclusive: false, excludes: 'annotation',
  addAttributes() { return { id: { default: null } }; },
  parseHTML() { return []; }, // Coller un extrait ne duplique pas les ancrages de notes.
  renderHTML({ mark }) { return ['mark', { 'data-note-id': mark.attrs.id, class: 'annotated-passage', title: 'Voir l’annotation' }, 0]; }
});
const BookImage = Image.extend({
  addAttributes() { return { ...this.parent(), size: { default: 100 } }; },
  parseHTML() {
    return [{ tag: 'figure[data-book-image]', getAttrs: node => {
      const image = node.querySelector('img');
      if (!localImage.test(image?.getAttribute('src') || '')) return false;
      return { src: image.getAttribute('src'), alt: image.getAttribute('alt'), title: node.querySelector('figcaption')?.textContent || '', size: [50,75,100].includes(Number(node.dataset.size)) ? Number(node.dataset.size) : 100 };
    } }, { tag: 'img[src]', getAttrs: node => localImage.test(node.getAttribute('src') || '') ? { src: node.getAttribute('src'), alt: node.getAttribute('alt') } : false }];
  },
  renderHTML({ node }) {
    const { src, alt, title, size } = node.attrs;
    return ['figure', { 'data-book-image': '', 'data-size': size || 100 }, ['img', { src, alt: alt || '', draggable: 'false' }], ...(title ? [['figcaption', {}, title]] : [])];
  }
});

export class BookEditors {
  constructor({ onEdit, onError, getChapter }) {
    this.onEdit = onEdit; this.onError = onError; this.getChapter = getChapter;
    this.editors = new Map(); this.active = null; this.disabled = false; this.pendingNote = null; this.pendingImage = null; this.imageBusy = false;
    const commands = { bold: 'toggleBold', italic: 'toggleItalic', underline: 'toggleUnderline', strike: 'toggleStrike', bulletList: 'toggleBulletList', orderedList: 'toggleOrderedList', highlight: 'toggleHighlight', undo: 'undo', redo: 'redo' };
    for (const button of document.querySelectorAll('[data-edit-command]')) {
      button.addEventListener('mousedown', e => e.preventDefault());
      button.addEventListener('click', () => {
        const editor = this.active?.editor; if (!editor || this.disabled) return;
        const command = button.dataset.editCommand;
        if (commands[command]) editor.chain().focus()[commands[command]]().run();
        else if (command === 'annotation') this.newNote();
        else if (command === 'image') this.imageDialog();
        this.toolbar();
      });
    }
    $('#text-style').addEventListener('change', event => {
      if (!this.active || this.disabled) return;
      const editor = this.active.editor, style = event.target.value;
      const chain = editor.chain().focus();
      if (style === 'quote') chain.toggleBlockquote().run();
      else { if (editor.isActive('blockquote')) chain.lift('blockquote'); if (style === 'heading') chain.setHeading({ level: 3 }).run(); else chain.setParagraph().run(); }
      this.toolbar();
    });
    $('#image-size').addEventListener('change', event => this.active?.editor.chain().focus().updateAttributes('image', { size: Number(event.target.value) }).run());
    $('#notes-toggle').addEventListener('click', () => this.openNotes(!document.body.classList.contains('notes-open')));
    $('#close-notes').addEventListener('click', () => this.openNotes(false));
    $('#note-form').addEventListener('submit', event => { event.preventDefault(); this.saveNote(); });
    $('#cancel-note').addEventListener('click', () => $('#note-dialog').close());
    $('#image-form').addEventListener('submit', event => { event.preventDefault(); this.saveImage(); });
    $('#cancel-image').addEventListener('click', () => { if (!this.imageBusy) $('#image-dialog').close(); });
    $('#image-dialog').addEventListener('cancel', event => { if (this.imageBusy) event.preventDefault(); });
    $('#image-file').addEventListener('change', () => { if (this.pendingImage) this.pendingImage.file = $('#image-file').files[0] || null; this.previewImage(); });
    $('#image-dialog').addEventListener('close', () => { if (this.previewUrl) URL.revokeObjectURL(this.previewUrl); this.previewUrl = null; this.pendingImage = null; });
    this.toolbar();
  }
  mount(section, host) {
    const editor = new Editor({
      element: host, injectCSS: false,
      extensions: [StarterKit.configure({ heading: { levels: [2,3] }, link: false, code: false, codeBlock: false }), BookImage, Highlight.extend({ parseHTML() { return [{ tag: 'mark:not([data-note-id])' }]; } }), Annotation, Placeholder.configure({ placeholder: section.prompt || 'Écrivez ici la suite de votre livre…' })],
      content: section.content || textDocument(section.text),
      editable: !this.disabled,
      editorProps: {
        attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': `Contenu de la section ${section.title || 'Sans titre'}`, spellcheck: 'true', class: 'book-text' },
        handleClick: (_view, _pos, event) => {
          const mark = event.target.closest?.('[data-note-id]');
          if (mark) { this.selectedNote = mark.dataset.noteId; this.openNotes(true); this.renderNotes(); requestAnimationFrame(() => document.getElementById(`note-${this.selectedNote}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })); }
          return false;
        },
        handlePaste: (_view, event) => {
          const file = [...(event.clipboardData?.files || [])].find(file => file.type.startsWith('image/'));
          if (file) { event.preventDefault(); this.active = { editor, section }; this.imageDialog(file); return true; }
          return false;
        },
        handleDrop: (_view, event) => {
          const files = [...(event.dataTransfer?.files || [])];
          if (!files.length) return false;
          event.preventDefault(); const file = files.find(f => f.type.startsWith('image/'));
          if (file) { this.active = { editor, section }; this.imageDialog(file); }
          else this.onError('Choisissez une image PNG, JPEG ou WebP.');
          return true;
        }
      },
      onFocus: ({ editor }) => { this.active = { editor, section }; this.toolbar(); },
      onSelectionUpdate: ({ editor }) => { this.active = { editor, section }; this.toolbar(); },
      onUpdate: ({ editor }) => {
        section.content = editor.getJSON(); section.text = editor.getText({ blockSeparator: '\n\n' });
        this.onEdit(section); this.toolbar(); this.renderNotes();
      },
      onTransaction: () => this.toolbar()
    });
    editor.view.dom.id = `text-${section.id}`;
    this.editors.set(section.id, { editor, section });
    if (!this.active) this.active = { editor, section };
    this.toolbar(); return editor;
  }
  dispose() {
    this.active = null;
    for (const { editor } of this.editors.values()) editor.destroy();
    this.editors.clear(); this.toolbar();
  }
  setEditable(enabled) {
    this.disabled = !enabled;
    for (const { editor } of this.editors.values()) editor.setEditable(enabled, false);
    $('#notes-list').querySelectorAll('textarea,button').forEach(input => { input.disabled = !enabled; });
    this.toolbar();
  }
  toolbar() {
    const editor = this.active?.editor; const available = editor && !editor.isDestroyed && !this.disabled;
    for (const button of document.querySelectorAll('[data-edit-command]')) {
      const command = button.dataset.editCommand;
      button.disabled = !available;
      if (available && command === 'annotation') button.disabled = editor.state.selection.empty || !editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, ' ').trim();
      if (available && command === 'undo') button.disabled = !editor.can().undo();
      if (available && command === 'redo') button.disabled = !editor.can().redo();
      if (!['annotation', 'image', 'undo', 'redo'].includes(command)) button.setAttribute('aria-pressed', String(!!available && editor.isActive(command)));
    }
    $('#text-style').disabled = !available;
    if (available) $('#text-style').value = editor.isActive('blockquote') ? 'quote' : editor.isActive('heading') ? 'heading' : 'paragraph';
    const imageSelected = available && editor.isActive('image');
    $('#image-size-label').hidden = !imageSelected;
    if (imageSelected) $('#image-size').value = editor.getAttributes('image').size || 100;
  }
  openNotes(open) {
    document.body.classList.toggle('notes-open', open); $('#notes-toggle').setAttribute('aria-expanded', String(open)); $('#annotations').inert = !open;
    if (open) requestAnimationFrame(() => this.resizeNotes());
  }
  resizeNotes() { $('#notes-list').querySelectorAll('textarea').forEach(input => { input.style.height = 'auto'; input.style.height = `${input.scrollHeight + 2}px`; }); }
  newNote() {
    const { editor, section } = this.active || {}; if (!editor || this.disabled) return;
    const { from, to } = editor.state.selection;
    const quote = editor.state.doc.textBetween(from, to, ' ').trim();
    if (!quote) return;
    const overlaps = new Set(); editor.state.doc.nodesBetween(from, to, node => node.marks?.forEach(mark => { if (mark.type.name === 'annotation') overlaps.add(mark.attrs.id); }));
    if (overlaps.size) { this.selectedNote = [...overlaps][0]; this.openNotes(true); this.renderNotes(); return; }
    if (quote.length > 10000) return this.onError('Sélectionnez un passage plus court pour l’annoter.');
    this.pendingNote = { editor, section, from, to, quote };
    $('#note-quote').textContent = quote; $('#note-body').value = '';
    $('#note-dialog').showModal(); $('#note-body').focus();
  }
  saveNote() {
    const pending = this.pendingNote, text = $('#note-body').value.trim();
    if (!pending || !text || this.disabled || pending.editor.isDestroyed) return;
    const note = { id: crypto.randomUUID(), quote: pending.quote, text, resolved: false, createdAt: new Date().toISOString() };
    pending.section.annotations ??= []; pending.section.annotations.push(note);
    pending.editor.chain().focus().setTextSelection({ from: pending.from, to: pending.to }).setMark('annotation', { id: note.id }).run();
    this.selectedNote = note.id; $('#note-dialog').close(); this.pendingNote = null; this.openNotes(true); this.renderNotes();
  }
  ranges(editor, id) {
    const ranges = [];
    editor.state.doc.descendants((node, pos) => { if (node.marks?.some(mark => mark.type.name === 'annotation' && mark.attrs.id === id)) ranges.push({ from: pos, to: pos + node.nodeSize }); });
    return ranges;
  }
  renderNotes() {
    const chapter = this.getChapter(); if (!chapter) return;
    const notes = chapter.sections.flatMap(section => (section.annotations || []).map(note => ({ section, note })));
    const active = notes.filter(({ note }) => !note.resolved);
    $('#note-count').textContent = active.length || '';
    $('#notes-summary').textContent = `${active.length} note${active.length > 1 ? 's' : ''} à reprendre`;
    const list = $('#notes-list'); list.replaceChildren();
    const append = (section, note, target) => {
      const instance = this.editors.get(section.id); const ranges = instance ? this.ranges(instance.editor, note.id) : [];
      const card = el('article', `margin-note${note.resolved ? ' is-resolved' : ''}${note.id === this.selectedNote ? ' is-selected' : ''}`); card.id = `note-${note.id}`;
      const heading = el('div', 'note-heading', section.title || 'Sans titre');
      const quote = el('button', 'note-quote', `« ${note.quote} »`); quote.title = 'Revenir au passage'; quote.disabled = !ranges.length;
      quote.onclick = () => {
        if (!ranges.length || !instance) return;
        this.active = instance; this.selectedNote = note.id;
        instance.editor.chain().focus().setTextSelection({ from: ranges[0].from, to: ranges.at(-1).to }).scrollIntoView().run();
        this.paintNotes();
      };
      const input = el('textarea', 'note-text'); input.value = note.text; input.maxLength = 50000; input.setAttribute('aria-label', `Annotation sur ${note.quote.slice(0, 65)}`);
      const resize = () => { input.style.height = 'auto'; input.style.height = `${input.scrollHeight + 2}px`; };
      input.oninput = () => { note.text = input.value; resize(); this.onEdit(section); };
      const resolve = el('button', 'resolve-note', note.resolved ? '↶ Rouvrir la note' : '✓ Marquer comme traité');
      resolve.onclick = () => { note.resolved = !note.resolved; this.onEdit(section); this.renderNotes(); };
      card.append(heading, quote, input);
      if (!ranges.length) card.append(el('p', 'orphan-note', 'Passage supprimé · note conservée'));
      card.append(resolve); target.append(card); requestAnimationFrame(resize);
    };
    for (const { section, note } of active) append(section, note, list);
    const resolved = notes.filter(({ note }) => note.resolved);
    if (resolved.length) { const details = el('details', 'resolved-notes'); details.append(el('summary', '', `${resolved.length} note${resolved.length > 1 ? 's' : ''} traitée${resolved.length > 1 ? 's' : ''}`)); for (const { section, note } of resolved) append(section, note, details); details.addEventListener('toggle', () => this.resizeNotes()); list.append(details); }
    if (!notes.length) { const empty = el('div', 'notes-empty'); empty.append(el('span', 'note-monogram', '✎'), el('p', '', 'Gardez une idée dans la marge.'), el('p', 'notes-instruction', 'Sélectionnez un passage du livre, puis cliquez sur « Annoter ». Vous le retrouverez ici.')); list.append(empty); }
    list.querySelectorAll('textarea,button').forEach(input => { if (this.disabled) input.disabled = true; });
    this.paintNotes();
  }
  paintNotes() {
    for (const { editor, section } of this.editors.values()) for (const mark of editor.view.dom.querySelectorAll('[data-note-id]')) {
      const note = section.annotations?.find(note => note.id === mark.dataset.noteId);
      mark.classList.toggle('note-resolved', !!note?.resolved); mark.classList.toggle('note-active', note?.id === this.selectedNote);
    }
  }
  imageDialog(file = null) {
    if (!this.active || this.disabled) return;
    const { editor, section } = this.active;
    const existing = !file && editor.isActive('image') ? editor.getAttributes('image') : null;
    this.pendingImage = { editor, section, selection: editor.state.selection.toJSON(), file, existing };
    $('#image-form').reset(); $('#image-error').textContent = '';
    $('#image-caption').value = existing?.title || '';
    $('#image-alt').value = existing?.alt || '';
    $('#image-display-size').value = existing?.size || 100;
    $('#image-submit').textContent = existing ? 'Mettre à jour l’image' : 'Insérer dans le livre';
    this.previewImage(); $('#image-dialog').showModal();
  }
  previewImage() {
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    const file = this.pendingImage?.file;
    this.previewUrl = file ? URL.createObjectURL(file) : null;
    const src = this.previewUrl || this.pendingImage?.existing?.src;
    const preview = $('#image-preview'); preview.hidden = !src;
    if (src) preview.src = src; else preview.removeAttribute('src');
    $('#image-file-name').textContent = file?.name || (src ? 'Image déjà présente dans le livre' : 'PNG, JPEG ou WebP · 10 Mo maximum');
  }
  async saveImage() {
    const pending = this.pendingImage; if (!pending || this.disabled || pending.editor.isDestroyed) return;
    const error = $('#image-error'); error.textContent = '';
    if (!pending.file && !pending.existing) { error.textContent = 'Choisissez une image sur votre ordinateur.'; return; }
    this.imageBusy = true; $('#image-form').querySelectorAll('button,input,select').forEach(node => { node.disabled = true; });
    $('#image-submit').textContent = 'Insertion…';
    try {
      let src = pending.existing?.src;
      if (pending.file) {
        if (!['image/png','image/jpeg','image/webp'].includes(pending.file.type) || pending.file.size > 10 * 1024 * 1024) throw new Error('Choisissez une image PNG, JPEG ou WebP de moins de 10 Mo.');
        const bitmap = await createImageBitmap(pending.file).catch(() => { throw new Error('Ce fichier image est illisible.'); }); bitmap.close();
        const response = await fetch('/api/images', { method: 'POST', headers: { 'Content-Type': pending.file.type }, body: pending.file, signal: AbortSignal.timeout(30000) });
        const result = await response.json(); if (!response.ok) throw new Error(result.error || 'L’image n’a pas pu être copiée.'); src = result.src;
      }
      const attrs = { src, alt: $('#image-alt').value, title: $('#image-caption').value, size: Number($('#image-display-size').value) };
      if (this.disabled) throw new Error('L’écriture est suspendue. Conservez le brouillon puis rouvrez le livre avant d’insérer l’image.');
      if (pending.editor.isDestroyed) throw new Error('Le chapitre a changé. Rouvrez cette section pour insérer l’image.');
      if (pending.existing) pending.editor.chain().focus().updateAttributes('image', attrs).run();
      else pending.editor.chain().focus().setImage(attrs).run();
      $('#image-dialog').close();
    } catch (problem) { error.textContent = problem.name === 'TypeError' ? 'L’atelier ne répond pas. Votre texte est conservé ; réessayez l’insertion.' : problem.message; }
    finally {
      this.imageBusy = false; $('#image-form').querySelectorAll('button,input,select').forEach(node => { node.disabled = false; });
      $('#image-submit').textContent = pending.existing ? 'Mettre à jour l’image' : 'Insérer dans le livre';
    }
  }
}

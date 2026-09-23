import { mkdir, readFile, open, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateRichSection } from './rich-format.mjs';

export class StoreError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function validateBook(book) {
  const text = (value, max) => typeof value === 'string' && value.length <= max;
  const id = value => text(value, 100) && /^[a-zA-Z0-9_-]+$/.test(value);
  if (!book || !text(book.title, 500) || !text(book.subtitle, 1000) || !Array.isArray(book.chapters) || book.chapters.length > 200) throw new StoreError('Le format du livre est invalide.');
  const ids = new Set();
  const unique = value => { if (!id(value) || ids.has(value)) throw new StoreError('Un identifiant du livre est invalide ou dupliqué.'); ids.add(value); };
  for (const chapter of book.chapters) {
    if (!chapter || !text(chapter.title, 500) || !['Tous', 'MJ'].includes(chapter.audience) || !Array.isArray(chapter.sections) || chapter.sections.length > 300) throw new StoreError('Un chapitre est invalide.');
    unique(chapter.id);
    for (const section of chapter.sections) {
      if (!section || !text(section.title, 500) || !text(section.text, 1_000_000) || !text(section.prompt, 3000)) throw new StoreError('Une section est invalide.');
      unique(section.id);
      validateRichSection(section, message => { throw new StoreError(message); });
    }
  }
  return {
    title: book.title, subtitle: book.subtitle,
    chapters: book.chapters.map(c => ({ id: c.id, title: c.title, audience: c.audience, sections: c.sections.map(s => ({ id: s.id, title: s.title, text: s.text, prompt: s.prompt, ...(s.content !== undefined ? { content: structuredClone(s.content) } : {}), ...(s.annotations !== undefined ? { annotations: structuredClone(s.annotations) } : {}) })) }))
  };
}

export async function createStore(directory, seedPath) {
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'livre.json');
  try {
    await readFile(path, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const book = validateBook(JSON.parse(await readFile(seedPath, 'utf8')));
    await writeFile(path, JSON.stringify({ revision: 0, updatedAt: null, lastWrite: null, book }, null, 2), { flag: 'wx' });
  }
  async function read() {
    const record = JSON.parse(await readFile(path, 'utf8'));
    validateBook(record.book);
    if (!Number.isSafeInteger(record.revision)) throw new Error('La version du fichier est invalide. Le fichier existant a été conservé.');
    return record;
  }
  await read(); // Refuse de remplacer un livre existant illisible.
  let queue = Promise.resolve();
  function save(request) {
    const execute = async () => {
      if (!request || !Number.isSafeInteger(request.baseRevision) || typeof request.changeId !== 'string' || request.changeId.length > 160) throw new StoreError('La demande de sauvegarde est invalide.');
      const book = validateBook(request.book);
      const current = await read();
      if (current.formatVersion >= 2 && request.clientVersion !== 2) throw new StoreError('Cet onglet utilise l’ancien éditeur. Conservez son brouillon puis rechargez la page pour protéger la mise en forme et les annotations.', 409);
      if (current.lastWrite === request.changeId) return current;
      if (current.revision !== request.baseRevision) throw new StoreError('Ce livre a été modifié dans un autre onglet. Vos modifications restent conservées dans cet onglet.', 409);
      const previous = JSON.stringify(current, null, 2);
      const stamp = new Date().toISOString().slice(0, 16).replaceAll(':', '-');
      const backupDir = join(directory, 'sauvegardes');
      await mkdir(backupDir, { recursive: true });
      try { await writeFile(join(backupDir, `${stamp}.json`), previous, { flag: 'wx' }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      const record = { revision: current.revision + 1, updatedAt: new Date().toISOString(), lastWrite: request.changeId, ...(request.clientVersion === 2 || current.formatVersion >= 2 ? { formatVersion: 2 } : {}), book };
      const temporary = join(directory, 'livre.en-cours.json');
      const handle = await open(temporary, 'w');
      try { await handle.writeFile(JSON.stringify(record, null, 2), 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temporary, path);
      return record;
    };
    const next = queue.then(execute);
    queue = next.catch(() => {});
    return next;
  }
  return { read, save, path };
}

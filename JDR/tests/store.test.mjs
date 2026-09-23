import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, validateBook } from '../store.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const testRoot = join(root, 'tmp', 'tests');
await mkdir(testRoot, { recursive: true });
async function setup() {
  const dir = await mkdtemp(join(testRoot, 'store-'));
  return { dir, store: await createStore(dir, join(root, 'seed.json')) };
}
test('Les titres, textes et ajouts survivent à une réouverture du stockage', async () => {
  const { dir, store } = await setup(); const original = await store.read();
  const book = structuredClone(original.book); book.title = 'Titre modifié';
  book.chapters[0].title = 'Chapitre réécrit'; book.chapters[0].sections[0].text = 'Texte avec accents : cœur, Résonnant.\n\nDeuxième paragraphe.';
  book.chapters.push({ id: 'test-chapitre', title: 'Nouveau', audience: 'MJ', sections: [{ id: 'test-section', title: 'Titre', text: 'Contenu', prompt: '' }] });
  const saved = await store.save({ book, baseRevision: 0, changeId: 'first-write' });
  assert.equal(saved.revision, 1);
  const reopened = await createStore(dir, join(root, 'seed.json'));
  assert.deepEqual((await reopened.read()).book, book);
  const backups = await readdir(join(dir, 'sauvegardes'));
  assert.ok(backups.length >= 1); assert.equal(JSON.parse(await readFile(join(dir, 'sauvegardes', backups[0]), 'utf8')).revision, 0);
});
test('Deux écritures concurrentes ne peuvent pas effacer une nouvelle version', async () => {
  const { store } = await setup(); const { book } = await store.read();
  const a = structuredClone(book), b = structuredClone(book); a.title = 'A'; b.title = 'B';
  const results = await Promise.allSettled([store.save({ book: a, baseRevision: 0, changeId: 'a' }), store.save({ book: b, baseRevision: 0, changeId: 'b' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
  assert.equal((await store.read()).book.title, 'A');
});
test('Une réponse perdue peut être retentée sans seconde écriture', async () => {
  const { store } = await setup(); const { book } = await store.read();
  const request = { book, baseRevision: 0, changeId: 'same-write' };
  const a = await store.save(request); const b = await store.save(request);
  assert.deepEqual(a, b); assert.equal((await store.read()).revision, 1);
});
test('Un livre existant illisible est conservé et ne devient jamais le modèle initial', async () => {
  const { store, dir } = await setup(); await writeFile(store.path, '{fragment');
  await assert.rejects(createStore(dir, join(root, 'seed.json')));
  assert.equal(await readFile(store.path, 'utf8'), '{fragment');
});
test('Un contenu incorrect est refusé avant modification du disque', async () => {
  const { store } = await setup(); const before = await store.read();
  const invalid = structuredClone(before.book); invalid.chapters[0].sections[0].text = null;
  assert.throws(() => validateBook(invalid));
  await assert.rejects(store.save({ book: invalid, baseRevision: 0, changeId: 'invalid' }));
  assert.deepEqual(await store.read(), before);
});
test('Texte riche, image et annotations restent intacts après sauvegarde et réouverture', async () => {
  const { store, dir } = await setup(); const { book } = await store.read();
  const untouched = structuredClone(book.chapters[1]);
  const section = book.chapters[0].sections[0];
  section.text = 'Les Résonnants';
  section.content = { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: section.text, marks: [{ type: 'bold' }, { type: 'annotation', attrs: { id: 'note-1' } }] }] },
    { type: 'image', attrs: { src: `/media/${'a'.repeat(64)}.png`, alt: 'Une plante', title: 'Nyranthia', size: 75, width: null, height: null } }
  ] };
  section.annotations = [{ id: 'note-1', quote: section.text, text: 'À préciser', resolved: false, createdAt: new Date().toISOString() }];
  await store.save({ book, baseRevision: 0, changeId: 'rich', clientVersion: 2 });
  const reopened = await createStore(dir, join(root, 'seed.json'));
  const record = await reopened.read();
  assert.deepEqual(record.book, book); assert.equal(record.formatVersion, 2);
  assert.deepEqual(record.book.chapters[1], untouched);
  const oldClient = structuredClone(book); delete oldClient.chapters[0].sections[0].content;
  delete oldClient.chapters[0].sections[0].annotations;
  await assert.rejects(reopened.save({ book: oldClient, baseRevision: 1, changeId: 'old-tab' }), error => error.status === 409);
  assert.deepEqual(await reopened.read(), record);
});
test('Une image distante ou une marque inconnue ne peut pas remplacer le livre', async () => {
  const { store } = await setup(); const before = await store.read();
  for (const content of [
    { type: 'doc', content: [{ type: 'image', attrs: { src: 'https://example.com/tracker.png', size: 100 } }] },
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Texte', marks: [{ type: 'html' }] }] }] }
  ]) {
    const book = structuredClone(before.book); book.chapters[0].sections[0].content = content;
    await assert.rejects(store.save({ book, baseRevision: 0, changeId: 'invalid-rich', clientVersion: 2 }));
    assert.deepEqual(await store.read(), before);
  }
});

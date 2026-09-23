import test from 'node:test';
import assert from 'node:assert/strict';
import { getSchema, getText } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { textDocument } from '../public/rich-editor.js';
import { imageKind } from '../rich-format.mjs';

test('La conversion du texte existant conserve accents et sauts de ligne', () => {
  const schema = getSchema([StarterKit]);
  for (const text of ['', 'Cœur, Résonnants et Nyranthia.', 'Un paragraphe.\nUne ligne.\n\nUn autre paragraphe.', '\n\nEspace avant.\n\n', 'Un\n\n\n\nDeux']) {
    const doc = schema.nodeFromJSON(textDocument(text)); doc.check();
    assert.equal(getText(doc, { blockSeparator: '\n\n', textSerializers: { hardBreak: () => '\n' } }), text);
  }
});
test('Les fichiers non image sont refusés même si leur nom ressemble à une image', () => {
  assert.equal(imageKind(Buffer.from('<svg onload="x"/>')), null);
  assert.equal(imageKind(Buffer.from('not a picture')), null);
  assert.deepEqual(imageKind(Buffer.from([137,80,78,71,13,10,26,10])), { ext: 'png', type: 'image/png' });
});

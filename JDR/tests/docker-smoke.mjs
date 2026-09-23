import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

if (process.env.NYRANTHIA_DOCKER_TEST !== '1' || !process.env.COMPOSE_PROJECT_NAME?.startsWith('nyranthia-test-')) throw new Error('Ce test écrit uniquement dans un projet Compose de test isolé.');
const url = process.env.NYRANTHIA_PUBLIC_URL;
assert.equal(url, 'http://127.0.0.1:4319');
const authorization = `Basic ${Buffer.from(`${process.env.NYRANTHIA_AUTH_USER}:${process.env.NYRANTHIA_AUTH_PASSWORD}`).toString('base64')}`;
const headers = { authorization, origin: url };
const compose = (...args) => execFileSync('docker', ['compose', '-f', 'docker-compose.yaml', '-f', 'compose.local.yaml', ...args], { stdio: 'pipe', timeout: 120000 }).toString().trim();
assert.equal(compose('exec', '-T', 'jdr', 'node', '-p', 'process.getuid()'), '1000');
assert.equal((await fetch(`${url}/api/health`)).status, 200);
assert.equal((await fetch(url)).status, 401);
assert.equal((await fetch(`${url}/api/book`)).status, 401);
assert.equal((await fetch(url, { headers })).status, 200);
assert.equal((await fetch(`${url}/editor.bundle.js`, { headers })).status, 200);
assert.equal((await fetch(`${url}/api/book`, { headers: { ...headers, origin: 'https://foreign.example' } })).status, 403);
const initial = await (await fetch(`${url}/api/book`, { headers })).json();
assert.equal(initial.revision, 0, 'Le volume du test doit être neuf.');
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/1xkAAAAASUVORK5CYII=', 'base64');
const uploaded = await fetch(`${url}/api/images`, { method: 'POST', headers: { ...headers, 'content-type': 'image/png' }, body: image });
assert.equal(uploaded.status, 201); const { src } = await uploaded.json();
const section = initial.book.chapters[0].sections[0];
section.text = 'Texte de vérification Docker.';
section.content = { type: 'doc', content: [
  { type: 'paragraph', content: [{ type: 'text', text: section.text, marks: [{ type: 'bold' }, { type: 'annotation', attrs: { id: 'note-docker' } }] }] },
  { type: 'image', attrs: { src, alt: 'Image de test', title: 'Légende', size: 75 } }
] };
section.annotations = [{ id: 'note-docker', quote: section.text, text: 'Une note persistante', resolved: false, createdAt: new Date().toISOString() }];
const saved = await fetch(`${url}/api/book`, { method: 'PUT', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ book: initial.book, baseRevision: 0, changeId: 'docker-test-save', clientVersion: 2 }) });
assert.equal(saved.status, 200, await saved.text());
assert.equal((await fetch(url + src)).status, 401);
compose('up', '-d', '--force-recreate', '--wait', '--wait-timeout', '90');
const reopened = await (await fetch(`${url}/api/book`, { headers })).json();
assert.equal(reopened.revision, 1);
assert.deepEqual(reopened.book, initial.book);
assert.deepEqual(Buffer.from(await (await fetch(url + src, { headers })).arrayBuffer()), image);
assert.equal(compose('exec', '-T', 'jdr', 'node', '-e', "const f=require('node:fs');if(!f.readdirSync('/app/data/sauvegardes').some(x=>x.endsWith('.json')))process.exit(1);console.log('ok')"), 'ok');
console.log('Docker validé : utilisateur non privilégié, accès protégé, texte riche, notes, images et sauvegardes conservés après recréation.');

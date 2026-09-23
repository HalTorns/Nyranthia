import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer as createSocketServer } from 'node:net';
import { request } from 'node:http';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const publicHost = 'livre.example.test:9443';
const publicOrigin = `https://${publicHost}`;
const user = 'auteur';
const password = 'mot-de-passe-de-test-uniquement';
const authorization = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/1xkAAAAASUVORK5CYII=', 'base64');

async function freePort() {
  const socket = createSocketServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return port;
}

async function startServer(port, directory) {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, NODE_ENV: 'production', NYRANTHIA_HOST: '0.0.0.0',
      NYRANTHIA_PORT: String(port), NYRANTHIA_DATA_DIR: directory,
      NYRANTHIA_PUBLIC_URL: publicOrigin, NYRANTHIA_AUTH_USER: user, NYRANTHIA_AUTH_PASSWORD: password
    }
  });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  await new Promise((resolve, reject) => {
    const fail = error => { clearTimeout(timer); child.kill(); reject(error); };
    const timer = setTimeout(() => fail(new Error(`Démarrage trop long : ${errors}`)), 10000);
    child.once('error', fail);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Serveur arrêté (${code}) : ${errors}`)); });
    child.stdout.once('data', () => { clearTimeout(timer); resolve(); });
  });
  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.kill();
  });
}

function call(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, headers: { Host: publicHost, ...headers } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.once('error', reject);
      response.once('end', () => {
        const bytes = Buffer.concat(chunks);
        resolve({ status: response.statusCode, headers: response.headers, bytes, json: () => JSON.parse(bytes.toString('utf8')) });
      });
    });
    req.once('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('La requête de test a expiré.')));
    req.end(body);
  });
}

test('Le serveur hébergé protège le livre, vérifie les origines et conserve les écritures autorisées', { timeout: 60000 }, async t => {
  const testRoot = join(root, 'tmp', 'tests');
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(join(testRoot, 'hosted-'));
  const port = await freePort();
  let child;
  try {
    child = await startServer(port, directory);
    const initial = JSON.parse(await readFile(join(directory, 'livre.json'), 'utf8'));

    await t.test('La santé est publique et ne révèle ni instance, ni livre, ni chemin', async () => {
      for (const host of [publicHost, `127.0.0.1:${port}`]) {
        const response = await call(port, '/api/health', { headers: { Host: host } });
        assert.equal(response.status, 200);
        assert.deepEqual(response.json(), { application: 'nyranthia-atelier', editorVersion: 2 });
      }
    });

    const uploaded = await call(port, '/api/images', { method: 'POST', headers: { Authorization: authorization, Origin: publicOrigin, 'Content-Type': 'image/png' }, body: image });
    assert.equal(uploaded.status, 201);
    const { src } = uploaded.json();
    assert.match(src, /^\/media\/[a-f0-9]{64}\.png$/);

    await t.test('Chaque route de lecture et écriture exige les bons identifiants', async () => {
      const routes = [
        ['GET', '/'], ['GET', '/styles.css'], ['GET', '/editor.bundle.js'], ['GET', '/favicon.svg'],
        ['GET', '/api/book'], ['GET', src], ['PUT', '/api/book'], ['POST', '/api/images']
      ];
      for (const [method, path] of routes) {
        for (const credentials of [undefined, `Basic ${Buffer.from(`${user}:incorrect`).toString('base64')}`]) {
          const response = await call(port, path, { method, headers: credentials ? { Authorization: credentials } : {} });
          assert.equal(response.status, 401, `${method} ${path}`);
          assert.match(response.headers['www-authenticate'], /^Basic /);
          assert.match(response.headers['content-type'], /application\/json/);
          assert.equal(typeof response.json().error, 'string');
        }
      }
      assert.deepEqual(JSON.parse(await readFile(join(directory, 'livre.json'), 'utf8')), initial);
      for (const path of ['/', '/styles.css', '/editor.bundle.js', '/favicon.svg', '/api/book', src]) {
        const response = await call(port, path, { headers: { Authorization: authorization } });
        assert.equal(response.status, 200, path);
      }
    });

    await t.test('Les domaines et origines non autorisés sont refusés même avec une authentification valide', async () => {
      const rejected = [
        { Host: 'autre.example.test' },
        { Host: 'livre.example.test' },
        { Host: 'autre.example.test', 'X-Forwarded-Host': publicHost },
        { Origin: 'https://autre.example.test' },
        { Origin: `http://${publicHost}` },
        { Origin: 'null' },
        { Origin: `http://127.0.0.1:${port}` }
      ];
      for (const headers of rejected) {
        const response = await call(port, '/api/book', { headers: { Authorization: authorization, ...headers } });
        assert.equal(response.status, 403, JSON.stringify(headers));
      }
      const forwarded = await call(port, '/api/book', { headers: { Authorization: authorization, Origin: publicOrigin, 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'autre.example.test' } });
      assert.equal(forwarded.status, 200);
      const crossSite = await call(port, '/api/book', { method: 'PUT', headers: { Authorization: authorization, 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(crossSite.status, 403);
    });

    let expectedBook;
    await t.test('Une sauvegarde authentifiée derrière HTTPS conserve texte riche, annotation et image', async () => {
      const current = await call(port, '/api/book', { headers: { Authorization: authorization, Origin: publicOrigin } });
      const record = current.json();
      expectedBook = structuredClone(record.book);
      expectedBook.title = 'Livre hébergé — vérification';
      const section = expectedBook.chapters[0].sections[0];
      section.text = 'Un passage à reprendre';
      section.annotations = [{ id: 'hosted-note', quote: section.text, text: 'Une note conservée', resolved: false, createdAt: new Date().toISOString() }];
      section.content = { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: section.text, marks: [{ type: 'bold' }, { type: 'annotation', attrs: { id: 'hosted-note' } }] }] },
        { type: 'image', attrs: { src, alt: 'Illustration de test', title: 'Une image', size: 75 } }
      ] };
      const payload = JSON.stringify({ book: expectedBook, baseRevision: record.revision, changeId: 'hosted-write', clientVersion: 2 });
      const options = { method: 'PUT', headers: { Authorization: authorization, Origin: publicOrigin, 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' }, body: payload };
      const saved = await call(port, '/api/book', options);
      assert.equal(saved.status, 200);
      assert.equal(saved.json().revision, record.revision + 1);
      const retry = await call(port, '/api/book', options);
      assert.equal(retry.status, 200);
      assert.deepEqual(retry.json(), saved.json());
      const stale = await call(port, '/api/book', { ...options, body: JSON.stringify({ book: record.book, baseRevision: record.revision, changeId: 'stale-write', clientVersion: 2 }) });
      assert.equal(stale.status, 409);
      assert.deepEqual(JSON.parse(await readFile(join(directory, 'livre.json'), 'utf8')).book, expectedBook);
    });

    await t.test('Le redémarrage sur le même stockage garde le manuscrit et ses images', async () => {
      await stopServer(child);
      child = await startServer(port, directory);
      const response = await call(port, '/api/book', { headers: { Authorization: authorization } });
      assert.equal(response.status, 200);
      assert.deepEqual(response.json().book, expectedBook);
      const media = await call(port, src, { headers: { Authorization: authorization } });
      assert.equal(media.status, 200);
      assert.deepEqual(media.bytes, image);
    });
  } finally {
    await stopServer(child);
  }
});

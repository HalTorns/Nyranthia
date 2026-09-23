import { createServer } from 'node:http';
import { readFile, open, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createStore, StoreError } from './store.mjs';
import { imageKind } from './rich-format.mjs';
import { loadConfig } from './config.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const config = loadConfig();
const { port } = config;
const instance = createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0, 16);
const dataDirectory = process.env.NYRANTHIA_DATA_DIR || join(root, 'data');
const store = await createStore(dataDirectory, join(root, 'seed.json'));
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/editor.bundle.js', ['editor.bundle.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']]
]);

const server = createServer(async (req, res) => {
  const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'");
  try {
    if (!config.hosts.has(req.headers.host?.toLowerCase())) return json(403, { error: 'Domaine non autorisé. Vérifiez NYRANTHIA_PUBLIC_URL.' });
    if (req.headers.origin && !config.origins.has(req.headers.origin)) return json(403, { error: 'Origine non autorisée.' });
    if (!['GET', 'HEAD'].includes(req.method) && req.headers['sec-fetch-site'] === 'cross-site') return json(403, { error: 'Requête externe non autorisée.' });
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (req.method === 'GET' && url.pathname === '/api/health') return json(200, { application: 'nyranthia-atelier', editorVersion: 2 });
    if (!config.authenticated(req.headers.authorization)) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Nyranthia", charset="UTF-8"');
      return json(401, { error: 'Identifiez-vous pour ouvrir le livre. Rechargez la page après avoir conservé votre brouillon.' });
    }
    if (req.method === 'GET' && url.pathname === '/api/book') {
      const record = await store.read();
      return json(200, { ...record, instance, editorVersion: 2 });
    }
    if (req.method === 'POST' && url.pathname === '/api/images') {
      let size = 0; const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 10 * 1024 * 1024) throw new StoreError('Choisissez une image de moins de 10 Mo.', 413);
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks); const kind = imageKind(bytes);
      if (!kind || req.headers['content-type'] !== kind.type) throw new StoreError('Formats acceptés : PNG, JPEG et WebP.', 415);
      const name = `${createHash('sha256').update(bytes).digest('hex')}.${kind.ext}`;
      await mkdir(join(dataDirectory, 'media'), { recursive: true });
      const destination = join(dataDirectory, 'media', name);
      let existing;
      try { existing = await readFile(destination); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!existing?.equals(bytes)) {
        const temporary = join(dataDirectory, 'media', `${name}.${randomUUID()}.en-cours`);
        const handle = await open(temporary, 'wx');
        try { await handle.writeFile(bytes); await handle.sync(); }
        finally { await handle.close(); }
        await rename(temporary, destination);
      }
      return json(201, { src: `/media/${name}` });
    }
    const media = url.pathname.match(/^\/media\/([a-f0-9]{64}\.(png|jpg|webp))$/);
    if (req.method === 'GET' && media) {
      let bytes;
      try { bytes = await readFile(join(dataDirectory, 'media', media[1])); }
      catch (error) { if (error.code === 'ENOENT') return json(404, { error: 'Image introuvable.' }); throw error; }
      res.writeHead(200, { 'Content-Type': { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[media[2]] });
      return res.end(bytes);
    }
    if (req.method === 'PUT' && url.pathname === '/api/book') {
      if (!req.headers['content-type']?.startsWith('application/json')) return json(415, { error: 'Format JSON requis.' });
      let size = 0; const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 12_000_000) throw new StoreError('Le livre dépasse la limite de sauvegarde de 12 Mo.', 413);
        chunks.push(chunk);
      }
      let request;
      try { request = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new StoreError('La sauvegarde reçue est illisible.'); }
      const saved = await store.save(request);
      return json(200, { revision: saved.revision, updatedAt: saved.updatedAt, lastWrite: saved.lastWrite });
    }
    if (req.method === 'GET' && assets.has(url.pathname)) {
      const [file, type] = assets.get(url.pathname);
      const body = await readFile(join(root, 'public', file));
      res.writeHead(200, { 'Content-Type': type }); return res.end(body);
    }
    return json(404, { error: 'Page introuvable.' });
  } catch (error) {
    console.error(error.message);
    return json(error.status || 500, { error: error.status ? error.message : 'Le stockage du livre est indisponible. Vos textes restent dans cet onglet. Réessayez.' });
  }
});
server.listen(port, config.host, () => console.log(`Atelier Nyranthia : ${config.host}:${port}\nLivre : ${store.path}`));
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Le port ${port} est déjà utilisé. Ouvrez l’atelier existant.` : error.message); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  server.close(error => { if (error) console.error(error.message); process.exitCode = error ? 1 : 0; });
});

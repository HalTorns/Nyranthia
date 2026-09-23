import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
test('Les images importées survivent au redémarrage et ne sont pas réécrites en double', async () => {
  const testRoot = join(root, 'tmp', 'tests'); await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(join(testRoot, 'media-'));
  const port = 4500 + process.pid % 1000;
  const url = `http://127.0.0.1:${port}`;
  const start = async () => {
    const process = spawn(globalThis.process.execPath, ['server.mjs'], { cwd: root, windowsHide: true, env: { ...globalThis.process.env, NYRANTHIA_PORT: String(port), NYRANTHIA_DATA_DIR: directory }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { process.kill(); reject(new Error('Démarrage trop long')); }, 10000);
      process.stdout.once('data', () => { clearTimeout(timer); resolve(); });
      process.once('error', error => { clearTimeout(timer); reject(error); });
      process.once('exit', code => { clearTimeout(timer); reject(new Error(`Serveur arrêté : ${code}`)); });
    });
    return process;
  };
  const stop = async process => { const ended = once(process, 'exit'); process.kill(); await ended; };
  let server = await start();
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/1xkAAAAASUVORK5CYII=', 'base64');
  try {
    const upload = () => fetch(`${url}/api/images`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: bytes });
    const response = await upload(); assert.equal(response.status, 201);
    const { src } = await response.json();
    const path = join(directory, 'media', src.split('/').at(-1));
    const before = await stat(path);
    assert.deepEqual(await (await upload()).json(), { src });
    assert.equal((await stat(path)).mtimeMs, before.mtimeMs);
    assert.deepEqual(Buffer.from(await (await fetch(url + src)).arrayBuffer()), bytes);
    const invalid = await fetch(`${url}/api/images`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: '<svg>pas une image PNG</svg>' });
    assert.equal(invalid.status, 415);
    await stop(server); server = await start();
    assert.deepEqual(Buffer.from(await (await fetch(url + src)).arrayBuffer()), bytes);
  } finally { await stop(server); }
});

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const application = dirname(dirname(fileURLToPath(import.meta.url)));
const repository = dirname(application);
const env = { ...process.env, COMPOSE_PROJECT_NAME: 'nyranthia-path-check', NYRANTHIA_PUBLIC_URL: 'http://127.0.0.1:4319', NYRANTHIA_AUTH_USER: 'test', NYRANTHIA_AUTH_PASSWORD: randomUUID() };
for (const cwd of [repository, application]) {
  for (const local of [false, true]) {
    const args = ['compose', '--project-directory', repository, '-f', join(application, 'docker-compose.yaml')];
    if (local) args.push('-f', join(application, 'compose.local.yaml'));
    args.push('config', '--format', 'json');
    const config = JSON.parse(execFileSync('docker', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 }));
    const build = config.services.jdr.build;
    assert.equal(realpathSync(build.context), realpathSync(application), 'Coolify doit construire uniquement le dossier JDR.');
    assert.ok(existsSync(join(build.context, build.dockerfile)), 'Le Dockerfile doit exister dans le contexte résolu.');
    for (const file of ['package-lock.json', 'server.mjs', 'public/app.js']) assert.ok(existsSync(join(build.context, file)), `Source de construction manquante : ${file}`);
  }
}
console.log('Chemins Compose validés avec --project-directory à la racine, depuis la racine et JDR, avec et sans les ports locaux.');

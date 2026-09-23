import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../config.mjs';

const credentials = {
  NYRANTHIA_AUTH_USER: 'auteur',
  NYRANTHIA_AUTH_PASSWORD: 'mot-de-passe-de-test-uniquement'
};
const deployed = {
  NODE_ENV: 'production',
  NYRANTHIA_HOST: '0.0.0.0',
  NYRANTHIA_PUBLIC_URL: 'https://livre.example.test',
  ...credentials
};
const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

test('Le mode local conserve son accès limité aux hôtes de boucle locale', () => {
  const config = loadConfig({});
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 4317);
  assert.equal(config.hosted, false);
  assert.equal(config.authenticated(), true);
  assert.deepEqual([...config.hosts], ['127.0.0.1:4317', 'localhost:4317', '[::1]:4317']);
  assert.equal(config.origins.has('https://autre.example.test'), false);
});

test('La production et toute écoute non locale refusent une configuration sans domaine ou identifiants', () => {
  for (const exposure of [{ NODE_ENV: 'production' }, { NYRANTHIA_HOST: '0.0.0.0' }, { NYRANTHIA_HOST: '192.0.2.10' }, { NYRANTHIA_HOST: '::' }]) {
    assert.throws(() => loadConfig(exposure), /NYRANTHIA_PUBLIC_URL/);
    assert.throws(() => loadConfig({ ...exposure, ...credentials }), /NYRANTHIA_PUBLIC_URL/);
    assert.throws(() => loadConfig({ ...exposure, NYRANTHIA_PUBLIC_URL: 'https://livre.example.test' }), /NYRANTHIA_AUTH/);
  }
  const config = loadConfig(deployed);
  assert.equal(config.hosted, true);
  assert.equal(config.host, '0.0.0.0');
});

test('Le domaine public impose HTTPS et une origine sans sous-chemin ni secret', () => {
  for (const publicUrl of [
    'pas-une-url', 'http://livre.example.test', 'ftp://livre.example.test',
    'https://livre.example.test/JDR', 'https://livre.example.test/?mode=livre',
    'https://livre.example.test/#chapitre', 'https://auteur:secret@livre.example.test'
  ]) assert.throws(() => loadConfig({ ...deployed, NYRANTHIA_PUBLIC_URL: publicUrl }), undefined, publicUrl);
  const config = loadConfig({ ...deployed, NYRANTHIA_PUBLIC_URL: 'https://LIVRE.example.test:9443/' });
  assert.ok(config.hosts.has('livre.example.test:9443'));
  assert.deepEqual([...config.origins], ['https://livre.example.test:9443']);
  assert.equal(config.origins.has('http://livre.example.test:9443'), false);
});

test('HTTP reste possible pour les essais sur localhost avec authentification en production', () => {
  for (const publicUrl of ['http://localhost:4317', 'http://127.0.0.1:4317', 'http://[::1]:4317']) {
    const config = loadConfig({ ...deployed, NYRANTHIA_PUBLIC_URL: publicUrl });
    assert.ok(config.origins.has(publicUrl));
    assert.equal(config.authenticated(), false);
  }
});

test('Les identifiants incomplets ou faibles sont refusés même pour un accès local optionnel', () => {
  for (const invalid of [
    { NYRANTHIA_AUTH_USER: '' },
    { NYRANTHIA_AUTH_USER: 'auteur:autre' },
    { NYRANTHIA_AUTH_USER: 'auteur\n' },
    { NYRANTHIA_AUTH_PASSWORD: '' },
    { NYRANTHIA_AUTH_PASSWORD: 'trop-court' }
  ]) assert.throws(() => loadConfig({ ...deployed, ...invalid }), /NYRANTHIA_AUTH/);
  assert.throws(() => loadConfig({ NYRANTHIA_AUTH_USER: 'auteur' }), /NYRANTHIA_AUTH/);
  assert.throws(() => loadConfig({ NYRANTHIA_AUTH_PASSWORD: credentials.NYRANTHIA_AUTH_PASSWORD }), /NYRANTHIA_AUTH/);
});

test('Seule une authentification Basic exacte est reconnue', () => {
  const config = loadConfig(deployed);
  const valid = basic(credentials.NYRANTHIA_AUTH_USER, credentials.NYRANTHIA_AUTH_PASSWORD);
  assert.equal(config.authenticated(valid), true);
  assert.equal(config.authenticated(valid.replace('Basic ', 'basic ')), true);
  for (const invalid of [undefined, '', 'Basic ', 'Bearer secret', 'Basic !!!', ['Basic invalide'], 'Basic ' + 'a'.repeat(9000), basic('autre', credentials.NYRANTHIA_AUTH_PASSWORD), basic(credentials.NYRANTHIA_AUTH_USER, 'incorrect')]) {
    assert.equal(config.authenticated(invalid), false);
  }
});

test('Un port invalide empêche le démarrage', () => {
  for (const port of ['0', '-1', '65536', '4317.5', 'invalide']) {
    assert.throws(() => loadConfig({ NYRANTHIA_PORT: port }), /NYRANTHIA_PORT/);
  }
});

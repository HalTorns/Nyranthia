import { createHash, timingSafeEqual } from 'node:crypto';

export function loadConfig(env = process.env) {
  const port = Number(env.NYRANTHIA_PORT || 4317);
  const host = env.NYRANTHIA_HOST || '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('NYRANTHIA_PORT doit être un port valide.');
  const hosted = env.NODE_ENV === 'production' || !['127.0.0.1', '::1', 'localhost'].includes(host);
  let publicUrl;
  if (env.NYRANTHIA_PUBLIC_URL) {
    try { publicUrl = new URL(env.NYRANTHIA_PUBLIC_URL); }
    catch { throw new Error('NYRANTHIA_PUBLIC_URL doit être une URL complète.'); }
    if (!['https:', 'http:'].includes(publicUrl.protocol) || publicUrl.username || publicUrl.password || publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash) throw new Error('NYRANTHIA_PUBLIC_URL doit contenir uniquement le domaine et son protocole, sans chemin.');
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(publicUrl.hostname);
    if (publicUrl.protocol !== 'https:' && !local) throw new Error('Utilisez une adresse HTTPS pour le domaine public.');
  }
  const user = env.NYRANTHIA_AUTH_USER || '';
  const password = env.NYRANTHIA_AUTH_PASSWORD || '';
  if (hosted && !publicUrl) throw new Error('NYRANTHIA_PUBLIC_URL est obligatoire pour le déploiement.');
  if (hosted || user || password) {
    if (!user || user.includes(':') || /[\r\n]/.test(user) || password.length < 16) throw new Error('Configurez NYRANTHIA_AUTH_USER et NYRANTHIA_AUTH_PASSWORD (au moins 16 caractères).');
  }
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  if (publicUrl) hosts.add(publicUrl.host);
  const origins = new Set(publicUrl ? [publicUrl.origin] : [`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`]);
  const digest = text => createHash('sha256').update(text).digest();
  const expected = user ? digest(`${user}:${password}`) : null;
  return {
    host, port, hosted, hosts, origins,
    authenticated(header) {
      if (!expected) return true;
      if (typeof header !== 'string' || header.length > 8192 || !/^Basic [A-Za-z0-9+/]+={0,2}$/i.test(header)) return false;
      return timingSafeEqual(expected, digest(Buffer.from(header.slice(6), 'base64').toString('utf8')));
    }
  };
}

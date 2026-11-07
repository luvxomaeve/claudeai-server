// Вход через VRoid Hub и загрузка своих моделей (OAuth 2.0 + PKCE).
// Секрет приложения хранится только в Cloudflare Worker (см. worker/vroid-hub-proxy.js).

import { VROID_HUB } from './config.js';

const HUB = 'https://hub.vroid.com';
const TOKEN_KEY = 'vroid-hub-token';
const PKCE_KEY = 'vroid-hub-pkce';

export const configured = () => !!(VROID_HUB.clientId && VROID_HUB.workerUrl);

// Адрес, куда VRoid Hub вернёт после входа: текущая страница без параметров.
export const redirectUri = () => VROID_HUB.redirectUri || `${location.origin}${location.pathname}`;

const store = {
  get(key, storage = localStorage) {
    try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; }
  },
  set(key, value, storage = localStorage) {
    try { storage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  },
  del(key, storage = localStorage) {
    try { storage.removeItem(key); } catch { /* ignore */ }
  },
};

function randomString(len = 64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

async function sha256base64url(text) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function isLoggedIn() {
  return !!store.get(TOKEN_KEY)?.access_token;
}

export async function login() {
  const verifier = randomString(64);
  const state = randomString(24);
  store.set(PKCE_KEY, { verifier, state }, sessionStorage);
  const url = new URL(`${HUB}/oauth/authorize`);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: VROID_HUB.clientId,
    redirect_uri: redirectUri(),
    scope: 'default',
    state,
    code_challenge: await sha256base64url(verifier),
    code_challenge_method: 'S256',
  }).toString();
  location.href = url.toString();
}

export function logout() {
  store.del(TOKEN_KEY);
}

async function requestToken(body) {
  const res = await fetch(`${VROID_HUB.workerUrl}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(data.error_description || data.error || `token ${res.status}`);
  store.set(TOKEN_KEY, { ...data, obtained_at: Date.now() });
  return data;
}

// Вызывается при загрузке страницы: если вернулись из VRoid Hub с ?code=…
export async function handleRedirect() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const error = params.get('error');
  if (!code && !error) return null;
  // Убираем параметры из адресной строки.
  history.replaceState(null, '', location.pathname + location.hash);
  if (error) throw new Error(params.get('error_description') || error);
  const pkce = store.get(PKCE_KEY, sessionStorage);
  store.del(PKCE_KEY, sessionStorage);
  if (!pkce || pkce.state !== params.get('state')) throw new Error('Вход прерван (state не совпал), попробуй ещё раз');
  return requestToken({ grant_type: 'authorization_code', code, code_verifier: pkce.verifier, redirect_uri: redirectUri() });
}

async function accessToken() {
  const t = store.get(TOKEN_KEY);
  if (!t?.access_token) throw new Error('Нужно войти через VRoid Hub');
  const expiresAt = t.obtained_at + (t.expires_in ?? 3600) * 1000 - 60_000;
  if (Date.now() < expiresAt || !t.refresh_token) return t.access_token;
  return (await requestToken({ grant_type: 'refresh_token', refresh_token: t.refresh_token })).access_token;
}

async function authed(path) {
  const res = await fetch(`${VROID_HUB.workerUrl}${path}`, {
    headers: { Authorization: `Bearer ${await accessToken()}` },
  });
  if (res.status === 401) {
    logout();
    throw new Error('Сессия VRoid Hub истекла, войди заново');
  }
  return res;
}

// Список своих моделей: [{ id, name, image }]
export async function listModels() {
  const res = await authed('/models');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error?.message || `models ${res.status}`);
  return (data.data ?? []).map((m) => ({
    id: m.id,
    name: m.name || m.character?.name || 'Без имени',
    image: m.portrait_image?.sq150?.url ?? m.portrait_image?.w300?.url ?? m.portrait_image?.original?.url ?? '',
  }));
}

// Скачивает .vrm модели для использования в игре (не сохраняется на устройстве).
export async function fetchModel(id, onProgress) {
  const res = await authed(`/vrm?id=${encodeURIComponent(id)}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || data.message || `vrm ${res.status}`);
  }
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !onProgress) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out.buffer;
}

// Cloudflare Worker: посредник между игрой и VRoid Hub API.
//
// Зачем нужен: обмен кода на токен требует секрет приложения (его нельзя
// держать в коде страницы), а VRoid Hub API не отвечает браузеру напрямую.
//
// Настройки воркера (Settings → Variables and Secrets):
//   CLIENT_ID      — Application ID из VRoid Hub
//   CLIENT_SECRET  — Secret из VRoid Hub (тип: Secret)
//   ALLOWED_ORIGIN — адрес игры, например https://luvxomaeve.github.io
//
// Эндпоинты:
//   POST /token   { grant_type, code, code_verifier, redirect_uri } или { grant_type: 'refresh_token', refresh_token }
//   GET  /models  — модели аккаунта (заголовок Authorization: Bearer <access_token>)
//   GET  /vrm?id= — файл .vrm выбранной модели (для использования в игре)

const HUB = 'https://hub.vroid.com';
const API_VERSION = '11';

function cors(env, res) {
  const headers = new Headers(res.headers);
  headers.set('Access-Control-Allow-Origin', env.ALLOWED_ORIGIN || '*');
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Vary', 'Origin');
  return new Response(res.body, { status: res.status, headers });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

async function token(request, env) {
  const body = await request.json();
  const params = new URLSearchParams({ client_id: env.CLIENT_ID, client_secret: env.CLIENT_SECRET });
  if (body.grant_type === 'refresh_token') {
    params.set('grant_type', 'refresh_token');
    params.set('refresh_token', body.refresh_token || '');
  } else {
    params.set('grant_type', 'authorization_code');
    params.set('code', body.code || '');
    params.set('code_verifier', body.code_verifier || '');
    params.set('redirect_uri', body.redirect_uri || '');
  }
  const res = await fetch(`${HUB}/oauth/token`, {
    method: 'POST',
    headers: { 'X-Api-Version': API_VERSION, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json' } });
}

function hubHeaders(request) {
  return {
    'X-Api-Version': API_VERSION,
    Authorization: request.headers.get('Authorization') || '',
  };
}

async function models(request) {
  const res = await fetch(`${HUB}/api/account/character_models?count=50`, { headers: hubHeaders(request) });
  return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json' } });
}

async function vrm(request, url) {
  const id = url.searchParams.get('id');
  if (!id) return json({ message: 'id is required' }, 400);

  // 1. Берём лицензию на загрузку модели.
  const license = await fetch(`${HUB}/api/download_licenses`, {
    method: 'POST',
    headers: { ...hubHeaders(request), 'Content-Type': 'application/json' },
    body: JSON.stringify({ character_model_id: id }),
  });
  if (!license.ok) return json({ message: 'download_licenses failed', status: license.status, detail: await license.text() }, license.status);
  const licenseId = (await license.json())?.data?.id;
  if (!licenseId) return json({ message: 'no license id' }, 502);

  // 2. Узнаём временную ссылку на файл (приходит редиректом).
  const dl = await fetch(`${HUB}/api/download_licenses/${licenseId}/download`, {
    headers: hubHeaders(request),
    redirect: 'manual',
  });
  const location = dl.headers.get('location');
  if (!location) return json({ message: 'no download location', status: dl.status }, 502);

  // 3. Отдаём сам файл игре.
  const file = await fetch(location);
  return new Response(file.body, {
    status: file.status,
    headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return cors(env, new Response(null, { status: 204 }));
    const url = new URL(request.url);
    let res;
    try {
      if (url.pathname === '/token' && request.method === 'POST') res = await token(request, env);
      else if (url.pathname === '/models') res = await models(request);
      else if (url.pathname === '/vrm') res = await vrm(request, url);
      else res = json({ ok: true, message: 'VRoid Hub proxy for Waifu Touch' });
    } catch (err) {
      res = json({ message: String(err) }, 500);
    }
    return cors(env, res);
  },
};

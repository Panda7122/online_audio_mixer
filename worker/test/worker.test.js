/* Worker integration tests: runs the real Worker in Miniflare with an in-memory R2 bucket
 * and a mocked Replicate API. Run with `npm test`. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Miniflare } from 'miniflare';

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'http://mixer.test';
const TOKEN = 's3cret';

// Fake Replicate: one prediction that goes starting -> processing -> succeeded.
const replicate = { predictions: new Map(), polls: 0, lastInput: null };
async function outbound(request) {
  const url = new URL(request.url);
  if (url.hostname === 'api.replicate.com') {
    if (request.method === 'POST' && url.pathname === '/v1/predictions') {
      const body = await request.json();
      replicate.lastInput = body.input;
      replicate.predictions.set('p1', { id: 'p1', status: 'starting' });
      return Response.json({ id: 'p1', status: 'starting' }, { status: 201 });
    }
    const m = /^\/v1\/predictions\/(\w+)(\/cancel)?$/.exec(url.pathname);
    if (m) {
      const p = replicate.predictions.get(m[1]);
      if (m[2]) { p.status = 'canceled'; return Response.json(p); }
      replicate.polls++;
      if (replicate.polls === 1) p.status = 'processing', p.logs = ' 10%|█\n 55%|█████';
      else if (replicate.polls >= 2) {
        p.status = 'succeeded';
        p.output = { stems: ['vocals', 'drums', 'bass', 'other'].map(n => ({ name: n, audio: `https://replicate.delivery/x/${n}.flac` })) };
      }
      return Response.json(p);
    }
  }
  if (url.hostname === 'replicate.delivery') {
    const data = new TextEncoder().encode('fLaC-stem-' + url.pathname);
    return new Response(data, { headers: { 'Content-Type': 'audio/flac', 'Content-Length': String(data.length) } });
  }
  return new Response('unexpected outbound fetch: ' + request.url, { status: 599 });
}

let mf;
test.before(async () => {
  mf = new Miniflare({
    modules: true,
    scriptPath: path.join(here, '..', 'src', 'index.js'),
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    compatibilityDate: '2026-07-01',
    r2Buckets: ['BUCKET'],
    bindings: { API_TOKEN: TOKEN, REPLICATE_API_TOKEN: 'r8_test', MAX_UPLOAD_MB: '1', MAX_JSON_MB: '1' },
    outboundService: outbound,
  });
  await mf.ready;
});
test.after(() => mf.dispose());

const auth = { Authorization: `Bearer ${TOKEN}` };
const call = (p, init = {}) => mf.dispatchFetch(BASE + p, { ...init, headers: { ...auth, ...(init.headers || {}) } });
const jsonInit = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const upload = (name, bytes, type = 'audio/wav') => call('/api/audio', { method: 'POST', headers: { 'Content-Type': type, 'X-File-Name': encodeURIComponent(name) }, body: bytes });

test('health and access key', async () => {
  const h = await (await mf.dispatchFetch(BASE + '/api/health')).json();
  assert.equal(h.ok, true);
  assert.equal(h.auth, true);
  assert.equal(h.runtime, 'cloudflare-workers');
  assert.equal((await mf.dispatchFetch(BASE + '/api/projects')).status, 401);
  assert.equal((await mf.dispatchFetch(BASE + '/api/projects', { headers: { Authorization: 'Bearer nope' } })).status, 401);
  assert.equal((await call('/api/projects')).status, 200);
});

test('audio upload, range download, limits', async () => {
  const bytes = new Uint8Array(1000).map((_, i) => i % 256);
  const r = await upload('人聲 Lead.wav', bytes);
  assert.equal(r.status, 201);
  const a = await r.json();
  assert.equal(a.name, '人聲 Lead.wav');
  const full = await call(a.url);
  assert.equal(full.status, 200);
  assert.equal((await full.arrayBuffer()).byteLength, 1000);
  const part = await call(a.url, { headers: { Range: 'bytes=10-19' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 10-19/1000');
  assert.deepEqual([...new Uint8Array(await part.arrayBuffer())], [...bytes.slice(10, 20)]);
  assert.equal((await upload('notes.txt', new Uint8Array(4), 'text/plain')).status, 415);
  assert.equal((await upload('big.wav', new Uint8Array(2 * 1024 * 1024))).status, 413);
  assert.equal((await call('/api/audio/not-an-id')).status, 404);
  assert.equal((await call('/api/audio/%2e%2e%2fprojects')).status, 404);
});

test('projects lifecycle and audio cleanup', async () => {
  const sample = await (await upload('Piano C4.wav', new Uint8Array(64))).json();
  const track = await (await upload('Mix.wav', new Uint8Array(64))).json();
  const settings = { tracks: [
    { name: 'Mix', audioId: track.id },
    { name: 'Keys', kind: 'notes', sampler: { zones: [{ name: 'Piano C4.wav', root: 60, audioId: sample.id }] } },
  ] };
  const a = await (await call('/api/projects', jsonInit('POST', { name: '歌曲 A', settings }))).json();
  const b = await (await call('/api/projects', jsonInit('POST', { name: 'B', settings: { tracks: [settings.tracks[1]] } }))).json();
  const list = (await (await call('/api/projects')).json()).projects;
  assert.equal(list.length, 2);
  assert.equal(list.find(p => p.id === a.id).name, '歌曲 A');
  assert.equal(list.find(p => p.id === a.id).trackCount, 2);
  const upd = await (await call(`/api/projects/${a.id}`, jsonInit('PUT', { name: 'A2' }))).json();
  assert.equal(upd.name, 'A2');
  assert.equal((await call('/api/projects', jsonInit('POST', { name: 'x', settings: {} }))).status, 400);

  assert.equal((await call(`/api/projects/${a.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await call(track.url)).status, 404, 'track audio only used by A is deleted');
  assert.equal((await call(sample.url)).status, 200, 'sample still used by B is kept');
  await call(`/api/projects/${b.id}`, { method: 'DELETE' });
  assert.equal((await call(sample.url)).status, 404);
});

test('strip presets', async () => {
  const r = await call('/api/strip-presets', jsonInit('POST', { name: 'Vox', role: 'vocal', strip: { eq: {}, comp: {}, junk: 1 } }));
  assert.equal(r.status, 201);
  const p = await r.json();
  assert.equal(p.strip.junk, undefined);
  assert.equal((await (await call('/api/strip-presets')).json()).presets.length, 1);
  assert.equal((await call(`/api/strip-presets/${p.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await call(`/api/strip-presets/${p.id}`, { method: 'DELETE' })).status, 404);
});

test('source separation through Replicate', async () => {
  const info = await (await call('/api/separation')).json();
  assert.equal(info.available, true);
  const song = await (await upload('Song.mp3', new Uint8Array(128), 'audio/mpeg')).json();
  const start = await call('/api/separation/jobs', jsonInit('POST', { audioId: song.id, model: 'htdemucs', stems: ['vocals', 'drums'] }));
  assert.equal(start.status, 202);
  const job = await start.json();
  assert.equal(job.status, 'queued');

  // Replicate downloads the input through a signed link that works without the access key.
  const signed = new URL(replicate.lastInput.audio);
  assert.equal(replicate.lastInput.model, 'htdemucs');
  assert.equal((await mf.dispatchFetch(BASE + signed.pathname + signed.search)).status, 200);
  assert.equal((await mf.dispatchFetch(BASE + signed.pathname + '?exp=9999999999&sig=bad')).status, 401);

  const p1 = await (await call(`/api/separation/jobs/${job.id}`)).json();
  assert.equal(p1.status, 'running');
  assert.equal(p1.progress, 0.55);
  const p2 = await (await call(`/api/separation/jobs/${job.id}`)).json();
  assert.equal(p2.status, 'done', p2.error);
  assert.deepEqual(p2.stems.map(s => s.name), ['vocals', 'drums']);
  const stem = await call(p2.stems[0].url);
  assert.equal(stem.headers.get('content-type'), 'audio/flac');
  assert.match(await stem.text(), /vocals\.flac$/);

  // Validation
  assert.equal((await call('/api/separation/jobs', jsonInit('POST', { audioId: song.id, model: 'nope' }))).status, 400);
  assert.equal((await call('/api/separation/jobs', jsonInit('POST', { audioId: song.id, model: 'htdemucs', stems: ['guitar'] }))).status, 400);
  assert.equal((await call('/api/separation/jobs', jsonInit('POST', { audioId: '00000000-0000-4000-8000-000000000000' }))).status, 404);
  assert.equal((await call('/api/separation/jobs/unknown')).status, 404);
});

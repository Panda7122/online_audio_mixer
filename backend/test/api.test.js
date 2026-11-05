'use strict';

/* API integration tests (run with `npm test`). Uses a temporary storage directory. */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createApp } = require('../src/server');

let server, base, storageDir;

test.before(async () => {
  storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oam-test-'));
  const app = await createApp({
    storageDir, serveFrontend: false, frontendDir: '', corsOrigins: [], maxUploadMb: 1, maxJsonMb: 1,
    separator: {
      python: process.execPath, // run the fake worker with node
      script: path.join(__dirname, 'fake-separator.js'),
      modelsDir: storageDir,
      device: 'auto',
      timeoutMin: 1,
    },
  });
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  await fs.rm(storageDir, { recursive: true, force: true });
});

const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function tinyWav() {
  const n = 100, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}

async function uploadWav(name) {
  const fd = new FormData();
  fd.append('name', name);
  fd.append('file', new Blob([tinyWav()], { type: 'audio/wav' }), 'x.wav');
  return fetch(`${base}/api/audio`, { method: 'POST', body: fd });
}

test('health', async () => {
  const r = await fetch(`${base}/api/health`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});

test('project + audio lifecycle', async () => {
  const up = await uploadWav('人聲 Lead.wav');
  assert.equal(up.status, 201);
  const audio = await up.json();
  assert.equal(audio.name, '人聲 Lead.wav');

  const dl = await fetch(`${base}${audio.url}`);
  assert.equal(dl.status, 200);
  assert.equal(Buffer.from(await dl.arrayBuffer()).length, tinyWav().length);

  const settings = { app: 'online-audio-mixer', tracks: [{ name: 'Lead', audioId: audio.id, volumeDb: -3 }] };
  const created = await fetch(`${base}/api/projects`, json('POST', { name: 'Song A', settings }));
  assert.equal(created.status, 201);
  const p = await created.json();

  const list = await (await fetch(`${base}/api/projects`)).json();
  assert.equal(list.projects.length, 1);
  assert.equal(list.projects[0].trackCount, 1);

  const upd = await fetch(`${base}/api/projects/${p.id}`, json('PUT', { name: 'Song B' }));
  assert.equal((await upd.json()).name, 'Song B');

  const got = await (await fetch(`${base}/api/projects/${p.id}`)).json();
  assert.equal(got.settings.tracks[0].volumeDb, -3);

  // Deleting the project also removes audio no other project uses.
  assert.equal((await fetch(`${base}/api/projects/${p.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await fetch(`${base}/api/projects/${p.id}`)).status, 404);
  assert.equal((await fetch(`${base}${audio.url}`)).status, 404);
});

test('validation and errors', async () => {
  assert.equal((await fetch(`${base}/api/projects`, json('POST', { name: 'x', settings: {} }))).status, 400);
  assert.equal((await fetch(`${base}/api/projects/not-an-id`)).status, 404);
  assert.equal((await fetch(`${base}/api/projects/../../etc/passwd`)).status, 404);

  const fd = new FormData();
  fd.append('file', new Blob(['hello'], { type: 'text/plain' }), 'notes.txt');
  assert.equal((await fetch(`${base}/api/audio`, { method: 'POST', body: fd })).status, 415);

  const big = new FormData();
  big.append('file', new Blob([Buffer.alloc(2 * 1024 * 1024)], { type: 'audio/wav' }), 'big.wav');
  assert.equal((await fetch(`${base}/api/audio`, { method: 'POST', body: big })).status, 413);
});

async function waitForJob(id) {
  for (let i = 0; i < 100; i++) {
    const job = await (await fetch(`${base}/api/separation/jobs/${id}`)).json();
    if (!['queued', 'running'].includes(job.status)) return job;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('job did not finish');
}

test('source separation jobs', async () => {
  const info = await (await fetch(`${base}/api/separation`)).json();
  assert.equal(info.available, true);
  assert.deepEqual(info.models.htdemucs_6s.stems.length, 6);

  const audio = await (await uploadWav('Song.wav')).json();
  const start = await fetch(`${base}/api/separation/jobs`, json('POST', { audioId: audio.id, model: 'htdemucs', stems: ['vocals', 'drums'] }));
  assert.equal(start.status, 202);
  const job = await waitForJob((await start.json()).id);
  assert.equal(job.status, 'done', job.error);
  assert.deepEqual(job.stems.map(s => s.name), ['vocals', 'drums']);
  const stem = await fetch(`${base}${job.stems[0].url}`);
  assert.equal(stem.status, 200);
  assert.equal(Buffer.from(await stem.arrayBuffer()).length, tinyWav().length);

  // Validation
  const post = body => fetch(`${base}/api/separation/jobs`, json('POST', body));
  assert.equal((await post({ audioId: audio.id, model: 'nope' })).status, 400);
  assert.equal((await post({ audioId: audio.id, shifts: 0 })).status, 400);
  assert.equal((await post({ audioId: audio.id, model: 'htdemucs', stems: ['guitar'] })).status, 400);
  assert.equal((await post({ audioId: '00000000-0000-4000-8000-000000000000' })).status, 404);
  assert.equal((await fetch(`${base}/api/separation/jobs/unknown`)).status, 404);
});

test('raw streamed upload', async () => {
  const r = await fetch(`${base}/api/audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav', 'X-File-Name': encodeURIComponent('鋼琴 C4.wav') },
    body: tinyWav(),
  });
  assert.equal(r.status, 201);
  const a = await r.json();
  assert.equal(a.name, '鋼琴 C4.wav');
  assert.equal(Buffer.from(await (await fetch(`${base}${a.url}`)).arrayBuffer()).length, tinyWav().length);
  const bad = await fetch(`${base}/api/audio`, { method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-File-Name': 'a.txt' }, body: 'hi' });
  assert.equal(bad.status, 415);
  const big = await fetch(`${base}/api/audio`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: Buffer.alloc(2 * 1024 * 1024) });
  assert.equal(big.status, 413);
});

test('deleting a project keeps samples used by another project', async () => {
  const sample = await (await uploadWav('Piano C4.wav')).json();
  const zoneTrack = { name: 'Keys', kind: 'notes', sampler: { zones: [{ name: 'Piano C4.wav', root: 60, audioId: sample.id }] } };
  const a = await (await fetch(`${base}/api/projects`, json('POST', { name: 'A', settings: { tracks: [zoneTrack] } }))).json();
  const b = await (await fetch(`${base}/api/projects`, json('POST', { name: 'B', settings: { tracks: [zoneTrack] } }))).json();
  await fetch(`${base}/api/projects/${a.id}`, { method: 'DELETE' });
  assert.equal((await fetch(`${base}${sample.url}`)).status, 200, 'still used by B');
  await fetch(`${base}/api/projects/${b.id}`, { method: 'DELETE' });
  assert.equal((await fetch(`${base}${sample.url}`)).status, 404, 'removed with the last project');
});

test('access key', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oam-auth-'));
  const app = await createApp({
    storageDir: dir, serveFrontend: false, frontendDir: '', corsOrigins: [], maxUploadMb: 1, maxJsonMb: 1, apiToken: 's3cret',
    separator: { python: process.execPath, script: path.join(__dirname, 'fake-separator.js'), modelsDir: dir, device: 'auto', timeoutMin: 1 },
  });
  const srv = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const b2 = `http://127.0.0.1:${srv.address().port}`;
  try {
    const health = await (await fetch(`${b2}/api/health`)).json();
    assert.equal(health.auth, true);
    assert.equal((await fetch(`${b2}/api/projects`)).status, 401);
    assert.equal((await fetch(`${b2}/api/projects`, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await fetch(`${b2}/api/projects`, { headers: { Authorization: 'Bearer s3cret' } })).status, 200);
  } finally {
    await new Promise(resolve => srv.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('strip presets', async () => {
  const strip = { volumeDb: 0, pan: 0, eq: { enabled: true }, comp: { enabled: false }, junk: 1 };
  const r = await fetch(`${base}/api/strip-presets`, json('POST', { name: 'My vocal', role: 'vocal', strip }));
  assert.equal(r.status, 201);
  const p = await r.json();
  assert.equal(p.strip.junk, undefined);
  const list = await (await fetch(`${base}/api/strip-presets`)).json();
  assert.equal(list.presets.length, 1);
  assert.equal((await fetch(`${base}/api/strip-presets/${p.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await fetch(`${base}/api/strip-presets/${p.id}`, { method: 'DELETE' })).status, 404);
});

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

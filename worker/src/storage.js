/*
 * R2 storage layout (one bucket):
 *   projects/<id>.json   { id, name, createdAt, updatedAt, settings }   (listing data in customMetadata)
 *   audio/<id>           audio bytes (contentType + original name in metadata)
 *   presets/<id>.json    personal channel-strip presets
 *   jobs/<id>.json       source-separation jobs
 */
import { HttpError, isId, cleanName } from './http.js';

const enc = s => encodeURIComponent(s);
const dec = s => {
  try { return decodeURIComponent(s || ''); } catch (e) { return s || ''; }
};

async function listAll(bucket, prefix, include) {
  const out = [];
  let cursor;
  do {
    const r = await bucket.list({ prefix, cursor, include });
    out.push(...r.objects);
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
  return out;
}

/* ---------- Projects ---------- */
const projectKey = id => {
  if (!isId(id)) throw new HttpError(404, 'Project not found');
  return `projects/${id}.json`;
};

const trackCount = p => (Array.isArray(p.settings && p.settings.tracks) ? p.settings.tracks.length : 0);

async function writeProject(bucket, p) {
  await bucket.put(projectKey(p.id), JSON.stringify(p), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { name: enc(p.name), createdAt: p.createdAt, updatedAt: p.updatedAt, trackCount: String(trackCount(p)) },
  });
}

export async function listProjects(bucket) {
  const objects = await listAll(bucket, 'projects/', ['customMetadata']);
  return objects
    .map(o => {
      const m = o.customMetadata || {};
      return { id: o.key.slice('projects/'.length, -'.json'.length), name: dec(m.name), createdAt: m.createdAt, updatedAt: m.updatedAt, trackCount: Number(m.trackCount) || 0 };
    })
    .filter(p => isId(p.id))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function getProject(bucket, id) {
  const obj = await bucket.get(projectKey(id));
  if (!obj) throw new HttpError(404, 'Project not found');
  return obj.json();
}

export async function createProject(bucket, { name, settings }) {
  const now = new Date().toISOString();
  const p = { id: crypto.randomUUID(), name: cleanName(name, 'Untitled mix'), createdAt: now, updatedAt: now, settings };
  await writeProject(bucket, p);
  return p;
}

export async function updateProject(bucket, id, { name, settings }) {
  const p = await getProject(bucket, id);
  if (name !== undefined) p.name = cleanName(name, p.name);
  if (settings !== undefined) p.settings = settings;
  p.updatedAt = new Date().toISOString();
  await writeProject(bucket, p);
  return p;
}

// Audio referenced by a project: track audio and uploaded instrument samples.
export function audioIdsOf(p) {
  const ids = new Set();
  const tracks = p && p.settings && Array.isArray(p.settings.tracks) ? p.settings.tracks : [];
  for (const t of tracks) {
    if (t && isId(t.audioId)) ids.add(t.audioId);
    const zones = t && t.sampler && Array.isArray(t.sampler.zones) ? t.sampler.zones : [];
    for (const z of zones) if (z && isId(z.audioId)) ids.add(z.audioId);
  }
  return ids;
}

// Delete a project and the audio no other project uses.
export async function deleteProject(bucket, id) {
  const p = await getProject(bucket, id);
  await bucket.delete(projectKey(id));
  const ids = audioIdsOf(p);
  if (!ids.size) return;
  const others = await listProjects(bucket);
  const stillUsed = new Set();
  for (const s of others) for (const a of audioIdsOf(await getProject(bucket, s.id))) stillUsed.add(a);
  const unused = [...ids].filter(a => !stillUsed.has(a)).map(a => `audio/${a}`);
  if (unused.length) await bucket.delete(unused);
}

/* ---------- Audio ---------- */
const audioKey = id => {
  if (!isId(id)) throw new HttpError(404, 'Audio not found');
  return `audio/${id}`;
};

export async function putAudio(bucket, id, body, { name, mimeType }) {
  await bucket.put(audioKey(id), body, {
    httpMetadata: { contentType: mimeType || 'application/octet-stream' },
    customMetadata: { name: enc(cleanName(name, 'audio')), createdAt: new Date().toISOString() },
  });
}

export async function headAudio(bucket, id) {
  const obj = await bucket.head(audioKey(id));
  if (!obj) throw new HttpError(404, 'Audio not found');
  return { size: obj.size, name: dec((obj.customMetadata || {}).name), mimeType: (obj.httpMetadata || {}).contentType };
}

export async function getAudio(bucket, id, range) {
  const obj = await bucket.get(audioKey(id), range ? { range } : {});
  if (!obj) throw new HttpError(404, 'Audio not found');
  return obj;
}

export async function deleteAudio(bucket, id) {
  const key = audioKey(id);
  if (!(await bucket.head(key))) throw new HttpError(404, 'Audio not found');
  await bucket.delete(key);
}

/* ---------- Personal channel-strip presets ---------- */
const presetKey = id => {
  if (!isId(id)) throw new HttpError(404, 'Preset not found');
  return `presets/${id}.json`;
};

export async function listPresets(bucket) {
  const objects = await listAll(bucket, 'presets/');
  const presets = await Promise.all(objects.map(async o => {
    const obj = await bucket.get(o.key);
    return obj ? obj.json() : null;
  }));
  return presets.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}

export async function createPreset(bucket, { name, role, strip }) {
  const p = {
    id: crypto.randomUUID(),
    name: cleanName(name, 'My preset'),
    role: typeof role === 'string' ? role.slice(0, 40) : 'other',
    createdAt: new Date().toISOString(),
    strip,
  };
  await bucket.put(presetKey(p.id), JSON.stringify(p), { httpMetadata: { contentType: 'application/json' } });
  return p;
}

export async function deletePreset(bucket, id) {
  const key = presetKey(id);
  if (!(await bucket.head(key))) throw new HttpError(404, 'Preset not found');
  await bucket.delete(key);
}

/* ---------- Separation jobs ---------- */
const jobKey = id => {
  if (!isId(id)) throw new HttpError(404, 'Job not found');
  return `jobs/${id}.json`;
};

export async function loadJob(bucket, id) {
  const obj = await bucket.get(jobKey(id));
  if (!obj) throw new HttpError(404, 'Job not found');
  return { job: await obj.json(), etag: obj.etag };
}

// Save a job; with `etag`, only if nobody changed it since it was read (returns false otherwise).
export async function saveJob(bucket, job, etag) {
  const res = await bucket.put(jobKey(job.id), JSON.stringify(job), {
    httpMetadata: { contentType: 'application/json' },
    ...(etag ? { onlyIf: { etagMatches: etag } } : {}),
  });
  return res !== null;
}

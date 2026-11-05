/*
 * Source separation for the Worker, run on Replicate's cloud GPUs (HTDemucs cannot run inside Workers).
 *
 * There is no background process: the job advances whenever the client polls it.
 * Each poll reads the Replicate prediction; when it has succeeded the stems are copied into R2
 * (guarded by an R2 conditional write so concurrent polls import only once).
 */
import { HttpError, hmacHex, safeEqual } from './http.js';
import { headAudio, putAudio, loadJob, saveJob } from './storage.js';

export const MODELS = {
  htdemucs: { stems: ['drums', 'bass', 'other', 'vocals'] },
  htdemucs_ft: { stems: ['drums', 'bass', 'other', 'vocals'] },
  htdemucs_6s: { stems: ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'] },
};

const REPLICATE_API = 'https://api.replicate.com/v1';
// Pinned version of https://replicate.com/ryan5453/demucs (override with REPLICATE_VERSION).
const DEFAULT_VERSION = 'b26a4313b4d75983d60657f80dfa93b9beb354f6e4fa29ecd27ffe14d60117f6';
const MIME = { flac: 'audio/flac', wav: 'audio/wav', mp3: 'audio/mpeg', aac: 'audio/aac' };
const IMPORT_STALE_MS = 2 * 60 * 1000;

export function info(env) {
  const available = !!env.REPLICATE_API_TOKEN;
  return {
    available,
    reason: available ? undefined : 'REPLICATE_API_TOKEN is not set on the Worker (wrangler secret put REPLICATE_API_TOKEN)',
    device: available ? 'cloud' : null,
    gpu: available ? 'Replicate' : null,
    models: MODELS,
  };
}

async function replicate(env, path, init = {}) {
  const res = await fetch(REPLICATE_API + path, {
    ...init,
    headers: { Authorization: `Bearer ${env.REPLICATE_API_TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, `Replicate: ${body.detail || body.title || 'HTTP ' + res.status}`);
  return body;
}

// Time-limited signed URL so Replicate can download the input even when the API needs an access key.
const signingSecret = env => env.API_TOKEN || env.REPLICATE_API_TOKEN || 'unsigned';
export async function signedAudioUrl(env, origin, id, ttlSec = 6 * 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = await hmacHex(signingSecret(env), `${id}.${exp}`);
  return `${origin}/api/audio/${id}?exp=${exp}&sig=${sig}`;
}
export async function validAudioSignature(env, id, url) {
  const exp = Number(url.searchParams.get('exp'));
  const sig = url.searchParams.get('sig') || '';
  if (!exp || exp < Date.now() / 1000) return false;
  return safeEqual(sig, await hmacHex(signingSecret(env), `${id}.${exp}`));
}

// Public view of a job (no provider ids).
function view(job) {
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    model: job.model,
    shifts: job.shifts,
    audioId: job.audioId,
    inputName: job.inputName,
    stems: job.stems,
    error: job.error,
    queuePosition: job.status === 'queued' ? 1 : 0,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

export async function createJob(env, origin, { audioId, model = 'htdemucs', shifts = 1, stems }) {
  if (!MODELS[model]) throw new HttpError(400, `Unknown model "${model}"`);
  const s = Number(shifts);
  if (!Number.isInteger(s) || s < 1 || s > 10) throw new HttpError(400, '"shifts" must be an integer 1-10');
  const all = MODELS[model].stems;
  const wanted = stems == null ? all : stems;
  if (!Array.isArray(wanted) || !wanted.length || wanted.some(x => !all.includes(x))) {
    throw new HttpError(400, `"stems" must be a non-empty subset of: ${all.join(', ')}`);
  }
  if (!env.REPLICATE_API_TOKEN) throw new HttpError(503, 'Source separation unavailable: ' + info(env).reason);
  const input = await headAudio(env.BUCKET, audioId); // 404 if missing

  const pred = await replicate(env, '/predictions', {
    method: 'POST',
    body: JSON.stringify({
      version: env.REPLICATE_VERSION || DEFAULT_VERSION,
      input: {
        audio: await signedAudioUrl(env, origin, audioId),
        model,
        shifts: s,
        output_format: env.REPLICATE_OUTPUT_FORMAT || 'flac',
      },
    }),
  });
  const job = {
    id: crypto.randomUUID(),
    predictionId: pred.id,
    status: 'queued',
    stage: 'starting',
    progress: 0,
    model,
    shifts: s,
    requestedStems: wanted,
    audioId,
    inputName: input.name,
    stems: [],
    error: null,
    importing: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
  };
  await saveJob(env.BUCKET, job);
  return view(job);
}

// Last tqdm percentage printed by demucs in the prediction logs.
function logProgress(logs) {
  const all = [...String(logs || '').matchAll(/(\d{1,3})%\|/g)];
  return all.length ? Math.min(1, Number(all[all.length - 1][1]) / 100) : 0;
}

// Prediction output -> [{ name, url }]; handles both output shapes used by the model's versions.
function outputStems(output) {
  if (output && Array.isArray(output.stems)) return output.stems.map(s => ({ name: s.name, url: s.audio }));
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    return Object.entries(output).filter(([, v]) => typeof v === 'string' && /^https?:/.test(v)).map(([name, url]) => ({ name, url }));
  }
  if (Array.isArray(output)) {
    return output.filter(u => typeof u === 'string').map(url => ({ name: url.split('/').pop().replace(/\.[^.]+$/, ''), url }));
  }
  return [];
}

async function importStems(env, job, output) {
  const base = job.inputName.replace(/\.[^.]+$/, '');
  const found = outputStems(output).filter(s => job.requestedStems.includes(s.name));
  if (!found.length) throw new Error('The separation service returned no stems');
  const stems = [];
  for (const stem of found) {
    const res = await fetch(stem.url);
    if (!res.ok) throw new Error(`Could not download stem "${stem.name}" (HTTP ${res.status})`);
    const ext = (new URL(stem.url).pathname.split('.').pop() || 'flac').toLowerCase();
    // R2 needs a known length to stream; otherwise buffer the stem.
    const body = res.headers.get('content-length') ? res.body : await res.arrayBuffer();
    const id = crypto.randomUUID();
    await putAudio(env.BUCKET, id, body, { name: `${base} - ${stem.name}.${ext}`, mimeType: MIME[ext] || res.headers.get('content-type') || 'application/octet-stream' });
    stems.push({ name: stem.name, audioId: id, url: `/api/audio/${id}` });
  }
  return stems;
}

export async function getJob(env, id) {
  const { job, etag } = await loadJob(env.BUCKET, id);
  if (!['queued', 'running'].includes(job.status)) return view(job);
  const importBusy = job.importing && Date.now() - Date.parse(job.importing) < IMPORT_STALE_MS;
  if (importBusy || !env.REPLICATE_API_TOKEN) return view(job);

  const before = JSON.stringify(job);
  const pred = await replicate(env, `/predictions/${job.predictionId}`);
  if (pred.started_at && !job.startedAt) job.startedAt = pred.started_at;
  switch (pred.status) {
    case 'starting':
      job.status = 'queued';
      job.stage = 'starting';
      break;
    case 'processing':
      job.status = 'running';
      job.stage = 'separating';
      job.progress = Math.max(job.progress, Math.min(0.97, logProgress(pred.logs)));
      break;
    case 'succeeded': {
      job.status = 'running';
      job.stage = 'encoding';
      job.importing = new Date().toISOString();
      if (!(await saveJob(env.BUCKET, job, etag))) return view(job); // another poll is importing
      try {
        job.stems = await importStems(env, job, pred.output);
        job.status = 'done';
        job.stage = 'done';
        job.progress = 1;
      } catch (e) {
        job.status = 'error';
        job.error = e.message;
      }
      job.importing = null;
      job.finishedAt = new Date().toISOString();
      await saveJob(env.BUCKET, job);
      return view(job);
    }
    case 'failed':
      job.status = 'error';
      job.error = String(pred.error || 'Separation failed').slice(0, 500);
      job.finishedAt = new Date().toISOString();
      break;
    case 'canceled':
      job.status = 'cancelled';
      job.finishedAt = new Date().toISOString();
      break;
  }
  if (JSON.stringify(job) !== before) await saveJob(env.BUCKET, job);
  return view(job);
}

export async function cancelJob(env, id) {
  const { job } = await loadJob(env.BUCKET, id);
  if (['queued', 'running'].includes(job.status)) {
    if (env.REPLICATE_API_TOKEN) {
      await replicate(env, `/predictions/${job.predictionId}/cancel`, { method: 'POST' }).catch(() => {});
    }
    job.status = 'cancelled';
    job.importing = null;
    job.finishedAt = new Date().toISOString();
    await saveJob(env.BUCKET, job);
  }
  return view(job);
}

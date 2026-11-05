/*
 * Online Audio Mixer - Cloudflare Worker backend.
 *
 * Same REST API as the Node.js backend (backend/), so the frontend works with either:
 *   /api/health, /api/projects, /api/audio, /api/strip-presets, /api/separation
 * Data lives in one R2 bucket (binding BUCKET); the frontend is served as static assets.
 *
 * Environment:
 *   API_TOKEN            (secret, optional)  access key required for every /api call except /api/health
 *   REPLICATE_API_TOKEN  (secret, optional)  enables HTDemucs source separation on Replicate
 *   REPLICATE_VERSION, REPLICATE_OUTPUT_FORMAT, MAX_UPLOAD_MB, MAX_JSON_MB, CORS_ORIGIN (vars)
 */
import { HttpError, json, readJson, decodeName, safeEqual } from './http.js';
import * as store from './storage.js';
import * as separation from './separation.js';

const ALLOWED_EXT = ['.wav', '.mp3', '.ogg', '.oga', '.opus', '.flac', '.m4a', '.aac', '.webm', '.mp4'];
const STRIP_KEYS = ['volumeDb', 'pan', 'eq', 'comp', 'reverb', 'delay', 'presetSel'];

const maxUploadBytes = env => (Number(env.MAX_UPLOAD_MB) || 95) * 1024 * 1024;
const maxJsonBytes = env => (Number(env.MAX_JSON_MB) || 5) * 1024 * 1024;

function extOf(name) {
  const m = /\.[^./\\]+$/.exec(name || '');
  return m ? m[0].toLowerCase() : '';
}
const isAudioType = (mime, name) => /^audio\//.test(mime || '') || mime === 'video/webm' || ALLOWED_EXT.includes(extOf(name));

function validateSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new HttpError(400, '"settings" must be an object');
  if (!Array.isArray(settings.tracks)) throw new HttpError(400, '"settings.tracks" must be an array');
  if (settings.tracks.length > 256) throw new HttpError(400, 'Too many tracks (max 256)');
  return settings;
}

async function isAuthorized(request, env) {
  if (!env.API_TOKEN) return true;
  const h = request.headers.get('authorization') || '';
  return safeEqual(h.startsWith('Bearer ') ? h.slice(7) : '', env.API_TOKEN);
}

/* ---------- CORS (only for origins listed in CORS_ORIGIN) ---------- */
function corsHeaders(request, env) {
  const origin = request.headers.get('origin');
  const allowed = String(env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-File-Name',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/* ---------- Audio ---------- */
async function uploadAudio(request, env) {
  const max = maxUploadBytes(env);
  const type = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  let body, name, mime, size;
  if (type === 'multipart/form-data') {
    const fd = await request.formData();
    const file = fd.get('file');
    if (!file || typeof file === 'string') throw new HttpError(400, 'Missing "file" field');
    name = fd.get('name') || file.name || 'audio';
    mime = file.type;
    size = file.size;
    body = file;
  } else {
    // Raw streamed body: the file goes straight to R2 without being buffered.
    name = decodeName(request.headers.get('x-file-name')) || 'audio';
    mime = type || 'application/octet-stream';
    size = Number(request.headers.get('content-length'));
    if (size) {
      body = request.body;
    } else {
      // Chunked upload without a length: R2 needs a known size, so buffer it (still capped).
      if (!isAudioType(mime, name)) throw new HttpError(415, 'Only audio files are accepted');
      body = await request.arrayBuffer();
      size = body.byteLength;
      if (!size) throw new HttpError(400, 'Empty upload');
    }
  }
  if (!isAudioType(mime, name)) throw new HttpError(415, 'Only audio files are accepted');
  if (size > max) throw new HttpError(413, 'File too large');
  const id = crypto.randomUUID();
  await store.putAudio(env.BUCKET, id, body, { name, mimeType: mime });
  return json({ id, name, size, mimeType: mime, url: `/api/audio/${id}` }, 201);
}

// "bytes=a-b" | "bytes=a-" | "bytes=-n" -> R2 range option (single ranges only).
function parseRange(header) {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return undefined;
  if (m[1] === '') return { suffix: Number(m[2]) };
  const offset = Number(m[1]);
  return m[2] === '' ? { offset } : { offset, length: Math.max(0, Number(m[2]) - offset + 1) };
}

async function downloadAudio(request, env, id) {
  const range = parseRange(request.headers.get('range'));
  const obj = await store.getAudio(env.BUCKET, id, range);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('ETag', obj.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'private, max-age=31536000, immutable'); // audio never changes
  if (range) {
    const offset = 'suffix' in range ? Math.max(0, obj.size - range.suffix) : Math.min(range.offset, obj.size);
    const length = Math.max(0, Math.min('suffix' in range ? range.suffix : range.length ?? obj.size - offset, obj.size - offset));
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set('Content-Length', String(length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('Content-Length', String(obj.size));
  return new Response(obj.body, { headers });
}

/* ---------- Router ---------- */
async function route(request, env, url) {
  const method = request.method;
  const parts = url.pathname.replace(/\/+$/, '').split('/').slice(2); // after "/api"
  const [section, id, sub] = parts;

  if (section === 'health' && method === 'GET') {
    return json({ ok: true, name: 'online-audio-mixer', version: 1, maxUploadMb: Number(env.MAX_UPLOAD_MB) || 95, auth: !!env.API_TOKEN, runtime: 'cloudflare-workers' });
  }

  if (!(await isAuthorized(request, env))) {
    // Signed, time-limited audio links (used by the separation service) work without the key.
    const signedAudio = method === 'GET' && section === 'audio' && id && parts.length === 2 && (await separation.validAudioSignature(env, id, url));
    if (!signedAudio) throw new HttpError(401, 'Access key required');
  }

  if (section === 'projects') {
    if (!id && method === 'GET') return json({ projects: await store.listProjects(env.BUCKET) });
    if (!id && method === 'POST') {
      const { name, settings } = await readJson(request, maxJsonBytes(env));
      return json(await store.createProject(env.BUCKET, { name, settings: validateSettings(settings) }), 201);
    }
    if (id && parts.length === 2) {
      if (method === 'GET') return json(await store.getProject(env.BUCKET, id));
      if (method === 'PUT') {
        const { name, settings } = await readJson(request, maxJsonBytes(env));
        return json(await store.updateProject(env.BUCKET, id, { name, settings: settings === undefined ? undefined : validateSettings(settings) }));
      }
      if (method === 'DELETE') {
        await store.deleteProject(env.BUCKET, id);
        return new Response(null, { status: 204 });
      }
    }
  }

  if (section === 'audio') {
    if (!id && method === 'POST') return uploadAudio(request, env);
    if (id && parts.length === 2) {
      if (method === 'GET') return downloadAudio(request, env, id);
      if (method === 'DELETE') {
        await store.deleteAudio(env.BUCKET, id);
        return new Response(null, { status: 204 });
      }
    }
  }

  if (section === 'strip-presets') {
    if (!id && method === 'GET') return json({ presets: await store.listPresets(env.BUCKET) });
    if (!id && method === 'POST') {
      const { name, role, strip } = await readJson(request, maxJsonBytes(env));
      if (!strip || typeof strip !== 'object' || Array.isArray(strip)) throw new HttpError(400, '"strip" must be an object');
      const clean = {};
      for (const k of STRIP_KEYS) if (k in strip) clean[k] = strip[k];
      if (!clean.eq || !clean.comp) throw new HttpError(400, '"strip" needs at least eq and comp');
      return json(await store.createPreset(env.BUCKET, { name, role, strip: clean }), 201);
    }
    if (id && parts.length === 2 && method === 'DELETE') {
      await store.deletePreset(env.BUCKET, id);
      return new Response(null, { status: 204 });
    }
  }

  if (section === 'separation') {
    if (!id && method === 'GET') return json(separation.info(env));
    if (id === 'jobs') {
      if (!sub && method === 'POST') {
        const body = await readJson(request, maxJsonBytes(env));
        return json(await separation.createJob(env, url.origin, body), 202);
      }
      if (sub && parts.length === 3 && method === 'GET') return json(await separation.getJob(env, sub));
      if (sub && parts.length === 3 && method === 'DELETE') return json(await separation.cancelJob(env, sub));
    }
  }

  throw new HttpError(404, 'Not found');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      // Static frontend (Workers static assets).
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    }
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: cors ? 204 : 403, headers: cors || {} });
    let res;
    try {
      res = await route(request, env, url);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status >= 500 && !(e instanceof HttpError)) console.error(e);
      res = json({ error: status === 500 && !(e instanceof HttpError) ? 'Internal server error' : e.message }, status);
    }
    if (cors) {
      res = new Response(res.body, res);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    }
    return res;
  },
};

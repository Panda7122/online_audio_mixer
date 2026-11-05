/* HTTP helpers shared by the Worker routes. */

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

export const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isId = id => typeof id === 'string' && ID_RE.test(id);

// Parse a JSON request body with a size limit.
export async function readJson(request, maxBytes) {
  if (Number(request.headers.get('content-length') || 0) > maxBytes) throw new HttpError(413, 'Request body too large');
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'Request body too large');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new HttpError(400, 'Invalid JSON');
  }
}

export function decodeName(v) {
  try { return decodeURIComponent(v || ''); } catch (e) { return v || ''; }
}

export function cleanName(s, fallback) {
  const v = typeof s === 'string' ? s.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 100) : '';
  return v || fallback;
}

const encoder = new TextEncoder();

async function sha256(text) {
  return crypto.subtle.digest('SHA-256', encoder.encode(text));
}

// Constant-time string comparison (hashing first gives equal-length inputs).
export async function safeEqual(a, b) {
  const [x, y] = await Promise.all([sha256(String(a)), sha256(String(b))]);
  return crypto.subtle.timingSafeEqual(x, y);
}

export async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

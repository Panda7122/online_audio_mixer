/* Backend API client. All functions return promises and throw ApiError on failure. */
(function (global) {
  'use strict';

  const base = String((global.MIXER_CONFIG && global.MIXER_CONFIG.apiBase) || '').replace(/\/+$/, '');

  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }

  // Optional access key (servers started with API_TOKEN); kept in this browser only.
  const KEY_STORE = 'oam-api-key';
  let apiKey = '';
  try { apiKey = localStorage.getItem(KEY_STORE) || ''; } catch (e) { /* storage unavailable */ }

  async function request(path, opts = {}) {
    let res;
    const headers = new Headers(opts.headers || {});
    if (apiKey) headers.set('Authorization', 'Bearer ' + apiKey);
    try {
      res = await fetch(base + '/api' + path, { ...opts, headers });
    } catch (e) {
      throw new ApiError('Network error: ' + e.message, 0);
    }
    if (res.status === 204) return null;
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    if (!res.ok) {
      const body = isJson ? await res.json().catch(() => ({})) : {};
      throw new ApiError(body.error || `HTTP ${res.status}`, res.status);
    }
    return isJson ? res.json() : res;
  }

  const jsonOpts = (method, body) => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  global.API = {
    ApiError,

    // Returns server info, or null when the backend is unreachable (offline mode).
    async health() {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 2500);
        const r = await request('/health', { signal: ctl.signal });
        clearTimeout(timer);
        return r && r.ok ? r : null;
      } catch (e) {
        return null;
      }
    },

    listProjects: () => request('/projects').then(r => r.projects),
    getProject: id => request('/projects/' + encodeURIComponent(id)),
    createProject: (name, settings) => request('/projects', jsonOpts('POST', { name, settings })),
    updateProject: (id, name, settings) => request('/projects/' + encodeURIComponent(id), jsonOpts('PUT', { name, settings })),
    deleteProject: id => request('/projects/' + encodeURIComponent(id), { method: 'DELETE' }),

    hasKey: () => !!apiKey,
    setKey(key) {
      apiKey = String(key || '').trim();
      try {
        if (apiKey) localStorage.setItem(KEY_STORE, apiKey);
        else localStorage.removeItem(KEY_STORE);
      } catch (e) { /* storage unavailable */ }
    },
    // Returns true when the server accepts the current key (or needs none).
    async checkAccess() {
      try {
        await request('/strip-presets');
        return true;
      } catch (e) {
        if (e.status === 401) return false;
        throw e;
      }
    },

    // Raw streamed upload; the file name travels URI-encoded in a header.
    uploadAudio(blob, name) {
      return request('/audio', {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(name) },
        body: blob,
      });
    },
    async fetchAudio(id) {
      const res = await request('/audio/' + encodeURIComponent(id));
      return res.arrayBuffer();
    },

    separationInfo: (refresh) => request('/separation' + (refresh ? '?refresh=1' : '')),
    startSeparation: (audioId, model, shifts, stems) => request('/separation/jobs', jsonOpts('POST', { audioId, model, shifts, stems })),
    getSeparationJob: id => request('/separation/jobs/' + encodeURIComponent(id)),
    cancelSeparationJob: id => request('/separation/jobs/' + encodeURIComponent(id), { method: 'DELETE' }),

    listStripPresets:() => request('/strip-presets').then(r => r.presets),
    createStripPreset: (name, role, strip) => request('/strip-presets', jsonOpts('POST', { name, role, strip })),
    deleteStripPreset: id => request('/strip-presets/' + encodeURIComponent(id), { method: 'DELETE' }),
  };
})(window);

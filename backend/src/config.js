'use strict';

/* Runtime configuration, read from environment variables. */
const path = require('node:path');

const bool = (v, def) => (v == null || v === '' ? def : /^(1|true|yes|on)$/i.test(v));

module.exports = {
  // Bind to localhost by default: the API has no authentication.
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT) || 3000,
  // Where projects, audio files and presets are stored.
  storageDir: path.resolve(process.env.STORAGE_DIR || path.join(__dirname, '..', 'storage')),
  // Static frontend served by the backend (set SERVE_FRONTEND=false to host it separately).
  serveFrontend: bool(process.env.SERVE_FRONTEND, true),
  frontendDir: path.resolve(process.env.FRONTEND_DIR || path.join(__dirname, '..', '..', 'frontend')),
  // Comma-separated list of allowed cross-origin frontends, e.g. "http://localhost:8080".
  // Empty = same-origin only.
  corsOrigins: (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB) || 200,
  maxJsonMb: Number(process.env.MAX_JSON_MB) || 5,
  // Optional access key. When set, every /api request except /api/health needs "Authorization: Bearer <key>".
  apiToken: process.env.API_TOKEN || '',

  // HTDemucs source separation (Python worker, see backend/separator/).
  separator: {
    python: process.env.SEPARATOR_PYTHON || path.join(__dirname, '..', 'separator', '.venv', 'bin', 'python'),
    script: process.env.SEPARATOR_SCRIPT || path.join(__dirname, '..', 'separator', 'separate.py'),
    // Model weights cache (TORCH_HOME); downloaded on first use of each model.
    modelsDir: path.resolve(process.env.SEPARATOR_MODELS_DIR || path.join(__dirname, '..', 'separator', 'models')),
    device: process.env.DEMUCS_DEVICE || 'auto', // auto | cuda | cpu | mps
    timeoutMin: Number(process.env.SEPARATION_TIMEOUT_MIN) || 60,
  },
};

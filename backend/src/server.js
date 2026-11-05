'use strict';

/* Online Audio Mixer backend: REST API + (optionally) the static frontend. */
const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const config = require('./config');
const { Storage } = require('./storage');
const projectsRouter = require('./routes/projects');
const audioRouter = require('./routes/audio');
const presetsRouter = require('./routes/presets');
const separationRouter = require('./routes/separation');
const { SeparationService } = require('./separation');

// Reject API requests without the configured access key (constant-time comparison).
function requireToken(token) {
  const expected = crypto.createHash('sha256').update(token).digest();
  return (req, res, next) => {
    const header = req.get('authorization') || '';
    const given = crypto.createHash('sha256').update(header.startsWith('Bearer ') ? header.slice(7) : '').digest();
    if (crypto.timingSafeEqual(given, expected)) return next();
    res.status(401).json({ error: 'Access key required' });
  };
}

async function createApp(cfg = config) {
  const storage = new Storage(cfg.storageDir);
  await storage.init();

  const app = express();
  app.disable('x-powered-by');

  // Cross-origin access only for explicitly configured frontends.
  if (cfg.corsOrigins.length) app.use('/api', cors({ origin: cfg.corsOrigins }));

  app.use('/api', express.json({ limit: `${cfg.maxJsonMb}mb` }));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, name: 'online-audio-mixer', version: 1, maxUploadMb: cfg.maxUploadMb, auth: !!cfg.apiToken, runtime: 'node' });
  });
  if (cfg.apiToken) app.use('/api', requireToken(cfg.apiToken));
  app.use('/api/projects', projectsRouter(storage));
  app.use('/api/audio', audioRouter(storage, cfg));
  app.use('/api/strip-presets', presetsRouter(storage));
  app.use('/api/separation', separationRouter(new SeparationService(storage, cfg.separator)));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  if (cfg.serveFrontend) app.use(express.static(cfg.frontendDir));

  // JSON error responses for the API.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let status = err.status || err.statusCode || 500;
    if (err instanceof multer.MulterError) status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    if (err.type === 'entity.too.large') status = 413;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
  });

  return app;
}

if (require.main === module) {
  createApp().then(app => {
    app.listen(config.port, config.host, () => {
      console.log(`Online Audio Mixer backend listening on http://${config.host}:${config.port}`);
      console.log(`Storage: ${config.storageDir}`);
      if (config.serveFrontend) console.log(`Serving frontend from ${config.frontendDir}`);
    });
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { createApp };

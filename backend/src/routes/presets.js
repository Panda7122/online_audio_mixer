'use strict';

/* /api/strip-presets - personal channel-strip presets (volume, pan, EQ, compressor, reverb, delay). */
const express = require('express');

const STRIP_KEYS = ['volumeDb', 'pan', 'eq', 'comp', 'reverb', 'delay', 'presetSel'];

module.exports = function presetsRouter(storage) {
  const r = express.Router();

  r.get('/', async (req, res) => {
    res.json({ presets: await storage.listPresets() });
  });

  r.post('/', async (req, res) => {
    const { name, role, strip } = req.body || {};
    if (!strip || typeof strip !== 'object' || Array.isArray(strip)) {
      throw Object.assign(new Error('"strip" must be an object'), { status: 400 });
    }
    // Keep only known channel-strip fields.
    const clean = {};
    for (const k of STRIP_KEYS) if (k in strip) clean[k] = strip[k];
    if (!clean.eq || !clean.comp) throw Object.assign(new Error('"strip" needs at least eq and comp'), { status: 400 });
    res.status(201).json(await storage.createPreset({ name, role, strip: clean }));
  });

  r.delete('/:id', async (req, res) => {
    await storage.deletePreset(req.params.id);
    res.status(204).end();
  });

  return r;
};

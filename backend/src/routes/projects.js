'use strict';

/* /api/projects - save and load complete mixer projects (settings + references to uploaded audio). */
const express = require('express');

const badRequest = msg => Object.assign(new Error(msg), { status: 400 });

// Settings must look like a mixer settings document: an object with a tracks array.
function validateSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw badRequest('"settings" must be an object');
  if (!Array.isArray(settings.tracks)) throw badRequest('"settings.tracks" must be an array');
  if (settings.tracks.length > 256) throw badRequest('Too many tracks (max 256)');
  return settings;
}

module.exports = function projectsRouter(storage) {
  const r = express.Router();

  r.get('/', async (req, res) => {
    res.json({ projects: await storage.listProjects() });
  });

  r.get('/:id', async (req, res) => {
    res.json(await storage.getProject(req.params.id));
  });

  r.post('/', async (req, res) => {
    const { name, settings } = req.body || {};
    const p = await storage.createProject({ name, settings: validateSettings(settings) });
    res.status(201).json(p);
  });

  r.put('/:id', async (req, res) => {
    const { name, settings } = req.body || {};
    const p = await storage.updateProject(req.params.id, {
      name,
      settings: settings === undefined ? undefined : validateSettings(settings),
    });
    res.json(p);
  });

  r.delete('/:id', async (req, res) => {
    await storage.deleteProject(req.params.id);
    res.status(204).end();
  });

  return r;
};

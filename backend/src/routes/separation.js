'use strict';

/* /api/separation - HTDemucs source separation of uploaded audio. */
const express = require('express');

module.exports = function separationRouter(service) {
  const r = express.Router();

  // Availability, device and supported models. ?refresh=1 re-runs the environment check.
  r.get('/', async (req, res) => {
    res.json(await service.info(req.query.refresh === '1'));
  });

  // Start a job: { audioId, model?, shifts?, stems? } -> 202 job
  r.post('/jobs', async (req, res) => {
    const { audioId, model, shifts, stems } = req.body || {};
    res.status(202).json(await service.createJob({ audioId, model, shifts, stems }));
  });

  r.get('/jobs/:id', (req, res) => {
    res.json(service.get(req.params.id));
  });

  // Cancel a queued or running job.
  r.delete('/jobs/:id', (req, res) => {
    res.json(service.cancel(req.params.id));
  });

  return r;
};

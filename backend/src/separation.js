'use strict';

/*
 * HTDemucs separation jobs.
 *
 * Jobs run one at a time (a single GPU is shared) by spawning the Python worker
 * (backend/separator/separate.py), which reports progress as JSON lines on stdout.
 * Finished stems are moved into audio storage and exposed as regular audio ids.
 */
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');

const MODELS = {
  htdemucs: { stems: ['drums', 'bass', 'other', 'vocals'] },
  htdemucs_ft: { stems: ['drums', 'bass', 'other', 'vocals'] },
  htdemucs_6s: { stems: ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'] },
};
const MAX_JOBS_KEPT = 50;
const STEM_MIME = { '.flac': 'audio/flac', '.wav': 'audio/wav' };

const httpError = (status, message) => Object.assign(new Error(message), { status });

class SeparationService {
  constructor(storage, cfg) {
    this.storage = storage;
    this.cfg = cfg; // config.separator
    this.tmpRoot = path.join(storage.root, 'tmp');
    this.jobs = new Map();
    this.queue = [];
    this.running = null;
    this.infoCache = null;
  }

  /* ---------- Environment check ---------- */

  // Run the worker with --check (cached once it succeeds) to see whether separation is possible.
  async info(force = false) {
    if (this.infoCache && this.infoCache.available && !force) return this.infoCache;
    const base = { models: MODELS, device: null, gpu: null };
    try {
      await fs.access(this.cfg.python);
    } catch (e) {
      return (this.infoCache = { ...base, available: false, reason: 'Python environment not installed (run backend/separator/setup.sh)' });
    }
    const result = await new Promise(resolve => {
      const proc = spawn(this.cfg.python, [this.cfg.script, '--check'], { env: this.env() });
      let out = '', err = '';
      const timer = setTimeout(() => proc.kill('SIGKILL'), 120000);
      proc.stdout.on('data', d => { out += d; });
      proc.stderr.on('data', d => { err = (err + d).slice(-2000); });
      proc.on('error', e => { clearTimeout(timer); resolve({ error: e.message }); });
      proc.on('close', () => {
        clearTimeout(timer);
        const ev = out.trim().split('\n').map(parseLine).filter(Boolean).pop();
        resolve(ev || { error: err.trim() || 'No output from separator' });
      });
    });
    if (result.event === 'check' && result.ok) {
      this.infoCache = { ...base, available: true, device: result.device, gpu: result.gpu, torch: result.torch, demucs: result.demucs };
    } else {
      const reason = result.event === 'check' ? 'ffmpeg not found on PATH' : (result.message || result.error || 'Separator check failed');
      this.infoCache = { ...base, available: false, reason };
    }
    return this.infoCache;
  }

  env() {
    return { ...process.env, TORCH_HOME: this.cfg.modelsDir, PYTHONUNBUFFERED: '1' };
  }

  /* ---------- Jobs ---------- */

  async createJob({ audioId, model = 'htdemucs', shifts = 1, stems }) {
    if (!MODELS[model]) throw httpError(400, `Unknown model "${model}"`);
    const s = Number(shifts);
    if (!Number.isInteger(s) || s < 1 || s > 10) throw httpError(400, '"shifts" must be an integer 1-10');
    const all = MODELS[model].stems;
    const wanted = stems == null ? all : stems;
    if (!Array.isArray(wanted) || !wanted.length || wanted.some(x => !all.includes(x))) {
      throw httpError(400, `"stems" must be a non-empty subset of: ${all.join(', ')}`);
    }
    const info = await this.info();
    if (!info.available) throw httpError(503, `Source separation unavailable: ${info.reason}`);
    const { meta, filePath } = await this.storage.getAudio(audioId); // 404 if missing

    const job = {
      id: crypto.randomUUID(),
      status: 'queued',
      stage: null,
      progress: 0,
      model,
      shifts: s,
      requestedStems: wanted,
      audioId,
      inputName: meta.name,
      inputPath: filePath,
      stems: [],
      error: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      proc: null,
      cancelRequested: false,
    };
    this.jobs.set(job.id, job);
    this.queue.push(job);
    this.prune();
    this.pump();
    return this.view(job);
  }

  get(id) {
    const job = this.jobs.get(id);
    if (!job) throw httpError(404, 'Job not found');
    return this.view(job);
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job) throw httpError(404, 'Job not found');
    if (job.status === 'queued') {
      this.queue = this.queue.filter(j => j !== job);
      this.finish(job, 'cancelled');
    } else if (job.status === 'running') {
      job.cancelRequested = true;
      if (job.proc) job.proc.kill('SIGTERM');
    }
    return this.view(job);
  }

  // Public representation of a job (no internal paths or process handles).
  view(job) {
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
      queuePosition: job.status === 'queued' ? this.queue.indexOf(job) + 1 : 0,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    };
  }

  finish(job, status, error = null) {
    job.status = status;
    job.error = error;
    job.finishedAt = new Date().toISOString();
    job.proc = null;
  }

  // Forget the oldest finished jobs (their stems stay in audio storage).
  prune() {
    const finished = [...this.jobs.values()].filter(j => !['queued', 'running'].includes(j.status));
    for (const j of finished.slice(0, Math.max(0, this.jobs.size - MAX_JOBS_KEPT))) this.jobs.delete(j.id);
  }

  pump() {
    if (this.running || !this.queue.length) return;
    const job = this.queue.shift();
    this.running = job;
    this.run(job)
      .catch(e => this.finish(job, 'error', e.message))
      .finally(() => {
        this.running = null;
        this.pump();
      });
  }

  async run(job) {
    job.status = 'running';
    job.stage = 'starting';
    job.startedAt = new Date().toISOString();
    const outDir = path.join(this.tmpRoot, job.id);
    await fs.mkdir(outDir, { recursive: true });
    try {
      const args = [
        this.cfg.script,
        '--input', job.inputPath,
        '--outdir', outDir,
        '--model', job.model,
        '--shifts', String(job.shifts),
        '--stems', job.requestedStems.join(','),
        '--device', this.cfg.device,
        '--format', 'flac',
      ];
      const { done, errorMessage, stderrTail, code } = await this.spawnWorker(job, args);

      if (job.cancelRequested) return this.finish(job, 'cancelled');
      if (!done || code !== 0) {
        return this.finish(job, 'error', errorMessage || stderrTail || `Separator exited with code ${code}`);
      }
      const base = job.inputName.replace(/\.[^.]+$/, '');
      for (const stem of done.stems) {
        const src = path.resolve(stem.path);
        if (path.dirname(src) !== outDir) throw new Error('Separator wrote outside its output directory');
        const meta = await this.storage.importAudioFile(src, {
          name: `${base} - ${stem.name}${path.extname(src)}`,
          mimeType: STEM_MIME[path.extname(src)] || 'application/octet-stream',
        });
        job.stems.push({ name: stem.name, audioId: meta.id, url: `/api/audio/${meta.id}` });
      }
      job.progress = 1;
      job.stage = 'done';
      this.finish(job, 'done');
    } finally {
      await fs.rm(outDir, { recursive: true, force: true });
    }
  }

  spawnWorker(job, args) {
    return new Promise(resolve => {
      const proc = spawn(this.cfg.python, args, { env: this.env() });
      job.proc = proc;
      let done = null, errorMessage = null, stderrTail = '';
      const timer = setTimeout(() => {
        errorMessage = `Timed out after ${this.cfg.timeoutMin} min`;
        proc.kill('SIGKILL');
      }, this.cfg.timeoutMin * 60000);

      readline.createInterface({ input: proc.stdout }).on('line', line => {
        const ev = parseLine(line);
        if (!ev) return;
        if (ev.event === 'progress' && Number.isFinite(ev.value)) job.progress = Math.max(job.progress, Math.min(1, ev.value));
        else if (ev.event === 'status') job.stage = ev.stage;
        else if (ev.event === 'done' && Array.isArray(ev.stems)) done = ev;
        else if (ev.event === 'error') errorMessage = ev.message;
      });
      proc.stderr.on('data', d => { stderrTail = (stderrTail + d).slice(-1500); });
      proc.on('error', e => { errorMessage = e.message; });
      proc.on('close', code => {
        clearTimeout(timer);
        resolve({ done, errorMessage, stderrTail: stderrTail.trim().split('\n').pop(), code });
      });
    });
  }
}

function parseLine(line) {
  try {
    const v = JSON.parse(line);
    return v && typeof v === 'object' ? v : null;
  } catch (e) {
    return null;
  }
}

module.exports = { SeparationService, MODELS };

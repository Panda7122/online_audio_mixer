'use strict';

/*
 * File-system storage.
 *
 *   <root>/projects/<id>.json        project metadata + mixer settings
 *   <root>/audio/<id>.<ext>          uploaded audio file
 *   <root>/audio/<id>.json           audio metadata (original name, mime type, size)
 *   <root>/strip-presets.json        personal channel-strip presets
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isId = id => typeof id === 'string' && ID_RE.test(id);

class NotFoundError extends Error {
  constructor(what) {
    super(`${what} not found`);
    this.status = 404;
  }
}

// Write a file atomically (temp file + rename) so a crash never leaves half-written JSON.
async function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

const cleanName = (s, fallback) => {
  const v = typeof s === 'string' ? s.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 100) : '';
  return v || fallback;
};

class Storage {
  constructor(root) {
    this.root = root;
    this.projectsDir = path.join(root, 'projects');
    this.audioDir = path.join(root, 'audio');
    this.presetsFile = path.join(root, 'strip-presets.json');
    this.presetLock = Promise.resolve(); // serializes read-modify-write of the presets file
  }

  async init() {
    await fs.mkdir(this.projectsDir, { recursive: true });
    await fs.mkdir(this.audioDir, { recursive: true });
  }

  /* ---------- Projects ---------- */
  projectFile(id) {
    if (!isId(id)) throw new NotFoundError('Project');
    return path.join(this.projectsDir, `${id}.json`);
  }

  static summary(p) {
    return {
      id: p.id,
      name: p.name,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      trackCount: Array.isArray(p.settings && p.settings.tracks) ? p.settings.tracks.length : 0,
    };
  }

  async listProjects() {
    const files = (await fs.readdir(this.projectsDir)).filter(f => f.endsWith('.json'));
    const out = [];
    for (const f of files) {
      const p = await readJson(path.join(this.projectsDir, f));
      if (p && isId(p.id)) out.push(Storage.summary(p));
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getProject(id) {
    const p = await readJson(this.projectFile(id));
    if (!p) throw new NotFoundError('Project');
    return p;
  }

  async createProject({ name, settings }) {
    const now = new Date().toISOString();
    const p = { id: crypto.randomUUID(), name: cleanName(name, 'Untitled mix'), createdAt: now, updatedAt: now, settings };
    await writeJsonAtomic(this.projectFile(p.id), p);
    return p;
  }

  async updateProject(id, { name, settings }) {
    const p = await this.getProject(id);
    if (name !== undefined) p.name = cleanName(name, p.name);
    if (settings !== undefined) p.settings = settings;
    p.updatedAt = new Date().toISOString();
    await writeJsonAtomic(this.projectFile(id), p);
    return p;
  }

  // Delete a project and any audio files that no other project references.
  async deleteProject(id) {
    const p = await this.getProject(id);
    await fs.unlink(this.projectFile(id));
    const ids = Storage.audioIdsOf(p);
    if (!ids.size) return;
    const stillUsed = new Set();
    for (const s of await this.listProjects()) {
      for (const a of Storage.audioIdsOf(await this.getProject(s.id))) stillUsed.add(a);
    }
    for (const a of ids) if (!stillUsed.has(a)) await this.deleteAudio(a).catch(() => {});
  }

  static audioIdsOf(p) {
    const ids = new Set();
    const tracks = p && p.settings && Array.isArray(p.settings.tracks) ? p.settings.tracks : [];
    for (const t of tracks) if (t && isId(t.audioId)) ids.add(t.audioId);
    return ids;
  }

  /* ---------- Audio ---------- */
  audioMetaFile(id) {
    if (!isId(id)) throw new NotFoundError('Audio');
    return path.join(this.audioDir, `${id}.json`);
  }

  // Register a file that multer already wrote into the audio directory.
  async addAudio({ id, fileName, originalName, mimeType, size }) {
    const meta = {
      id,
      fileName,
      name: cleanName(originalName, 'audio'),
      mimeType: mimeType || 'application/octet-stream',
      size,
      createdAt: new Date().toISOString(),
    };
    await writeJsonAtomic(this.audioMetaFile(id), meta);
    return meta;
  }

  async getAudio(id) {
    const meta = await readJson(this.audioMetaFile(id));
    if (!meta) throw new NotFoundError('Audio');
    return { meta, filePath: path.join(this.audioDir, path.basename(meta.fileName)) };
  }

  async deleteAudio(id) {
    const { filePath } = await this.getAudio(id);
    await fs.unlink(filePath).catch(() => {});
    await fs.unlink(this.audioMetaFile(id));
  }

  /* ---------- Personal channel-strip presets ---------- */
  withPresets(fn) {
    const run = this.presetLock.then(async () => {
      const list = (await readJson(this.presetsFile)) || [];
      const { result, changed } = await fn(list);
      if (changed) await writeJsonAtomic(this.presetsFile, list);
      return result;
    });
    this.presetLock = run.catch(() => {});
    return run;
  }

  listPresets() {
    return this.withPresets(list => ({ result: list.slice().sort((a, b) => a.name.localeCompare(b.name)), changed: false }));
  }

  createPreset({ name, role, strip }) {
    return this.withPresets(list => {
      const p = {
        id: crypto.randomUUID(),
        name: cleanName(name, 'My preset'),
        role: typeof role === 'string' ? role.slice(0, 40) : 'other',
        createdAt: new Date().toISOString(),
        strip,
      };
      list.push(p);
      return { result: p, changed: true };
    });
  }

  deletePreset(id) {
    return this.withPresets(list => {
      const i = list.findIndex(p => p.id === id);
      if (i < 0) throw new NotFoundError('Preset');
      list.splice(i, 1);
      return { result: true, changed: true };
    });
  }
}

module.exports = { Storage, NotFoundError, isId };

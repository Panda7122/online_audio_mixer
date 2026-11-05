'use strict';

/* /api/audio - upload, download and delete audio files referenced by projects. */
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const express = require('express');
const multer = require('multer');

const ALLOWED_EXT = ['.wav', '.mp3', '.ogg', '.oga', '.opus', '.flac', '.m4a', '.aac', '.webm', '.mp4'];

module.exports = function audioRouter(storage, { maxUploadMb }) {
  const r = express.Router();

  const upload = multer({
    storage: multer.diskStorage({
      destination: storage.audioDir,
      filename: (req, file, cb) => {
        const id = crypto.randomUUID();
        const ext = path.extname(file.originalname || '').toLowerCase();
        req.audioId = id;
        cb(null, id + (ALLOWED_EXT.includes(ext) ? ext : '.bin'));
      },
    }),
    limits: { fileSize: maxUploadMb * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const ok = /^audio\//.test(file.mimetype) || file.mimetype === 'video/webm' || ALLOWED_EXT.includes(ext);
      cb(ok ? null : Object.assign(new Error('Only audio files are accepted'), { status: 415 }), ok);
    },
  });

  r.post('/', upload.single('file'), async (req, res) => {
    if (!req.file) throw Object.assign(new Error('Missing "file" field'), { status: 400 });
    try {
      // Browsers decode by content, so a missing or generic mime type is fine; keep what we got.
      const meta = await storage.addAudio({
        id: req.audioId,
        fileName: req.file.filename,
        // Prefer the explicit UTF-8 "name" field; multipart filenames may arrive latin1-encoded.
        originalName: (req.body && req.body.name) || Buffer.from(req.file.originalname || 'audio', 'latin1').toString('utf8'),
        mimeType: req.file.mimetype,
        size: req.file.size,
      });
      res.status(201).json({ id: meta.id, name: meta.name, size: meta.size, mimeType: meta.mimeType, url: `/api/audio/${meta.id}` });
    } catch (e) {
      await fs.unlink(req.file.path).catch(() => {});
      throw e;
    }
  });

  r.get('/:id', async (req, res) => {
    const { meta, filePath } = await storage.getAudio(req.params.id);
    res.type(meta.mimeType);
    res.set('Cache-Control', 'private, max-age=31536000, immutable'); // audio files never change
    res.sendFile(filePath);
  });

  r.delete('/:id', async (req, res) => {
    await storage.deleteAudio(req.params.id);
    res.status(204).end();
  });

  return r;
};

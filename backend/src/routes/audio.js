'use strict';

/* /api/audio - upload, download and delete audio files referenced by projects.
 *
 * Uploads are accepted in two forms:
 *   - raw body (preferred, streamed): Content-Type audio/*, header X-File-Name (URI-encoded)
 *   - multipart/form-data with a "file" field and an optional "name" field
 */
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { Transform, pipeline } = require('node:stream');
const express = require('express');
const multer = require('multer');

const ALLOWED_EXT = ['.wav', '.mp3', '.ogg', '.oga', '.opus', '.flac', '.m4a', '.aac', '.webm', '.mp4'];
const httpError = (status, message) => Object.assign(new Error(message), { status });

const isAudioType = (mime, name) => {
  const ext = path.extname(name || '').toLowerCase();
  return /^audio\//.test(mime || '') || mime === 'video/webm' || ALLOWED_EXT.includes(ext);
};

function decodeName(v) {
  try { return decodeURIComponent(v || ''); } catch (e) { return v || ''; }
}

module.exports = function audioRouter(storage, { maxUploadMb }) {
  const r = express.Router();
  const maxBytes = maxUploadMb * 1024 * 1024;

  const multipart = multer({
    storage: multer.diskStorage({
      destination: storage.audioDir,
      filename: (req, file, cb) => {
        const id = crypto.randomUUID();
        const ext = path.extname(file.originalname || '').toLowerCase();
        req.audioId = id;
        cb(null, id + (ALLOWED_EXT.includes(ext) ? ext : '.bin'));
      },
    }),
    limits: { fileSize: maxBytes, files: 1 },
    fileFilter: (req, file, cb) => {
      const ok = isAudioType(file.mimetype, file.originalname);
      cb(ok ? null : httpError(415, 'Only audio files are accepted'), ok);
    },
  }).single('file');

  // Stream a raw request body to disk, enforcing the size limit while it arrives.
  function rawUpload(req, res, next) {
    const name = decodeName(req.get('x-file-name')) || 'audio';
    const mime = (req.get('content-type') || 'application/octet-stream').split(';')[0].trim();
    if (!isAudioType(mime, name)) return next(httpError(415, 'Only audio files are accepted'));
    if (Number(req.get('content-length')) > maxBytes) return next(httpError(413, 'File too large'));
    const id = crypto.randomUUID();
    const ext = path.extname(name).toLowerCase();
    const fileName = id + (ALLOWED_EXT.includes(ext) ? ext : '.bin');
    const dest = path.join(storage.audioDir, fileName);
    let size = 0;
    const counter = new Transform({
      transform(chunk, enc, cb) {
        size += chunk.length;
        cb(size > maxBytes ? httpError(413, 'File too large') : null, chunk);
      },
    });
    pipeline(req, counter, fs.createWriteStream(dest), err => {
      if (err) {
        fsp.unlink(dest).catch(() => {});
        return next(err.status ? err : httpError(400, 'Upload interrupted'));
      }
      req.audioId = id;
      req.file = { filename: fileName, originalname: name, mimetype: mime, size, path: dest };
      req.body = { name };
      next();
    });
  }

  r.post('/', (req, res, next) => (req.is('multipart/form-data') ? multipart(req, res, next) : rawUpload(req, res, next)), async (req, res) => {
    if (!req.file) throw httpError(400, 'Missing audio data');
    try {
      const meta = await storage.addAudio({
        id: req.audioId,
        fileName: req.file.filename,
        // Prefer the explicit UTF-8 name; multipart filenames may arrive latin1-encoded.
        originalName: (req.body && req.body.name) || Buffer.from(req.file.originalname || 'audio', 'latin1').toString('utf8'),
        mimeType: req.file.mimetype,
        size: req.file.size,
      });
      res.status(201).json({ id: meta.id, name: meta.name, size: meta.size, mimeType: meta.mimeType, url: `/api/audio/${meta.id}` });
    } catch (e) {
      await fsp.unlink(req.file.path).catch(() => {});
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

'use strict';

/* Stand-in for separator/separate.py used by the tests: same CLI and JSON-lines protocol,
 * but it just copies the input file for every requested stem. */
const fs = require('node:fs');
const path = require('node:path');

const emit = o => process.stdout.write(JSON.stringify(o) + '\n');
const argv = process.argv.slice(2);
const arg = name => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : undefined; };

if (argv.includes('--check')) {
  emit({ event: 'check', ok: true, device: 'cpu', gpu: null, torch: 'fake', demucs: 'fake' });
  process.exit(0);
}

const stems = arg('stems').split(',');
if (stems.includes('fail')) {
  emit({ event: 'error', message: 'RuntimeError: simulated failure' });
  process.exit(1);
}
emit({ event: 'status', stage: 'separating' });
const delay = Number(process.env.FAKE_SEPARATOR_DELAY_MS || 0);
setTimeout(() => {
  emit({ event: 'progress', value: 0.5 });
  const out = stems.map(name => {
    const p = path.join(arg('outdir'), `${name}.wav`);
    fs.copyFileSync(arg('input'), p);
    return { name, path: p };
  });
  emit({ event: 'progress', value: 1 });
  emit({ event: 'done', samplerate: 44100, stems: out });
}, delay);

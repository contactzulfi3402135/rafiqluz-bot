'use strict';
// Extract an untrusted ZIP into an empty private staging directory. No links,
// traversal, overwrites or unlimited decompression. Nothing is installed live.
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream');
const yauzl = require('yauzl');
const MAX_ENTRIES = 50000;
const MAX_FILE = 256 * 1024 * 1024;
const MAX_TOTAL = 512 * 1024 * 1024;
const crcTable = new Uint32Array(256);
for (let i=0; i<256; i++) { let n=i; for (let k=0;k<8;k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; crcTable[i]=n >>> 0; }


function extract(zipPath, root) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (err, zip) => {
      if (err) return reject(err);
      let count = 0, total = 0, failed = false;
      const seen = new Set();
      const fail = e => { if (failed) return; failed = true; try { zip.close(); } catch {} reject(e); };
      zip.on('error', fail);
      zip.on('end', () => { if (!failed) resolve(); });
      zip.on('entry', entry => {
        if (failed) return;
        const name = entry.fileName;
        const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
        const type = mode & 0o170000;
        const isDir = name.endsWith('/');
        if (++count > MAX_ENTRIES || entry.uncompressedSize > MAX_FILE || (total += entry.uncompressedSize) > MAX_TOTAL)
          return fail(new Error('Cloud backup exceeds extraction limits.'));
        if ((type && type !== 0o100000 && type !== 0o040000) || (type === 0o040000 && !isDir) || (type === 0o100000 && isDir))
          return fail(new Error('Cloud backup contains a link or unsupported file type.'));
        if (!name || name.includes('\\') || name.startsWith('/') || /^[a-zA-Z]:/.test(name) || name.split('/').some(part => part === '..' || part === '.'))
          return fail(new Error('Cloud backup contains an unsafe path.'));
        const normalized = name.replace(/\/$/, '');
        if (seen.has(normalized)) return fail(new Error('Cloud backup has duplicate paths.'));
        seen.add(normalized);
        const target = path.resolve(root, normalized);
        if (!target.startsWith(path.resolve(root) + path.sep)) return fail(new Error('Cloud backup path escapes its staging directory.'));
        try {
          if (isDir) { fs.mkdirSync(target, { recursive: true }); zip.readEntry(); return; }
          fs.mkdirSync(path.dirname(target), { recursive: true });
          zip.openReadStream(entry, (e, input) => {
            if (e) return fail(e);
            const output = fs.createWriteStream(target, { flags:'wx', mode:0o600 });
            let crc = 0xffffffff;
            input.on('data', chunk => { for (const b of chunk) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8); });
            pipeline(input, output, e2 => {
              if (e2) return fail(e2);
              if (((crc ^ 0xffffffff) >>> 0) !== entry.crc32) return fail(new Error('Cloud backup entry failed integrity check.'));
              zip.readEntry();
            });
          });
        } catch (e) { fail(e); }
      });
      zip.readEntry();
    });
  });
}
module.exports = { extract };

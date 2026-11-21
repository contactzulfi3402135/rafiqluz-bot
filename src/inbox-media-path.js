'use strict';
// Saved inbox references are untrusted database data. Only generated filenames
// under the real inbox directory may be read or removed, and no symlinks.
const fs=require('node:fs'),path=require('node:path');
function resolveInboxMedia(root,relative) {
  const rel=String(relative || '');
  if(!/^inbox\/[1-9][0-9]*\.(jpg|bin)$/.test(rel))return null;
  const dir=path.join(root,'inbox'),file=path.join(root,rel);
  try {
    const d=fs.lstatSync(dir); if(!d.isDirectory() || d.isSymbolicLink())return null;
    const s=fs.lstatSync(file); if(!s.isFile() || s.isSymbolicLink())return null;
    return file;
  } catch(e) {
    // A missing file is still a valid local reference; callers decide whether
    // to clear a dangling record. Any other error is treated as unsafe.
    if(e.code==='ENOENT') {
      try {const d=fs.lstatSync(dir);return d.isDirectory()&&!d.isSymbolicLink()?file:null;} catch {return null;}
    }
    return null;
  }
}
module.exports={resolveInboxMedia};

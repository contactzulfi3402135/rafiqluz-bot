'use strict';
// Process-local shutdown gate; never persisted as a user pause setting.
let stopping = false, ready = false;
module.exports = {
  begin: () => { stopping = true; ready = false; },
  isStopping: () => stopping,
  markReady: () => { if (!stopping) ready = true; },
  isReady: () => ready && !stopping
};

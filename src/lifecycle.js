'use strict';
// Process-local shutdown gate; never persisted as a user pause setting.
let stopping = false;
module.exports = { begin: () => { stopping = true; }, isStopping: () => stopping };

'use strict';
// CSV quoting is not spreadsheet formula protection. Spreadsheet programs may
// interpret text beginning with a formula operator or control character as an
// instruction even when the field is correctly quoted. Prefix dangerous values
// with an apostrophe and always quote/escape fields to preserve column boundaries.
// This changes the exported representation only; stored data remain untouched.
// Consumers should still import untrusted CSV as text; no encoding can promise
// identical behavior across all spreadsheet versions and import settings.
function csvCell(value) {
  let s = String(value == null ? '' : value);
  if (/^[\s\uFEFF\u0000-\u001F\u007F]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]/u.test(s) || /^[ \u00A0\uFEFF]*[\u0000-\u001F\u007F]/u.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
module.exports = { csvCell };

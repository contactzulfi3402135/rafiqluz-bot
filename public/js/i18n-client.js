/* Client-side i18n plumbing (spec §10):
   - numbers / charts / mono stay LTR (CSS .num/.mono handle direction)
   - full page language switch = cookie + server re-render (app.js setLang)
   - this module keeps data-i18n elements in sync on dynamic re-renders */
import { t, $, $$ } from './app.js';

export function bindI18nClient() {
  const apply = () => {
    $$('[data-i18n]').forEach((el) => {
      const key = el.dataset.i18n;
      const v = t(key);
      if (v !== key) el.textContent = v;
    });
    $$('[data-i18n-ph]').forEach((el) => {
      const key = el.dataset.i18nPh;
      const v = t(key);
      if (v !== key) el.setAttribute('placeholder', v);
    });
  };
  window.__applyI18n = apply;
  setTimeout(apply, 50);
  document.addEventListener('i18n:load', apply);
}

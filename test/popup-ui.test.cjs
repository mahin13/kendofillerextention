/* The popup shell: the Settings view, the theme picker and the home summary.
 *
 * This is a real load of popup.html + popup.js in jsdom against a stubbed chrome API — the
 * cheapest way to catch the class of mistake that breaks the whole panel silently (a handler
 * wired to an element that no longer exists throws during boot and every control goes dead).
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const POPUP = path.join(__dirname, '..', 'src', 'popup');

let fail = 0;
const t = (n, c, x) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (x !== undefined ? '  -> ' + x : '')); if (!c) fail++; };

const DEFAULT_CONFIG = {
  mode: 'all',
  onlyEmpty: false,
  highlight: false,
  theme: 'light',
  categories: {
    dropdown: { enabled: true },
    tree: { enabled: true },
    checkbox: { enabled: true, state: 'checked' },
    toggle: { enabled: true, default: 'yes' },
    radio: { enabled: true, default: 'yes' },
    numeric: { enabled: true, min: 1, max: 999 },
    decimal: { enabled: true, min: 1, max: 999, decimals: 2 },
    freeform: { enabled: true },
    conditional: { enabled: true }
  }
};

const sent = [];

function installChrome(w, config) {
  w.chrome = {
    runtime: {
      lastError: null,
      sendMessage(msg, cb) {
        sent.push(msg);
        if (msg.action === 'getConfig') return cb({ ok: true, config: JSON.parse(JSON.stringify(config)) });
        if (msg.action === 'resetConfig') return cb({ ok: true, config: JSON.parse(JSON.stringify(DEFAULT_CONFIG)) });
        return cb({ ok: true });
      }
    },
    tabs: { query: () => Promise.resolve([{ id: 1, title: 'Client Info', url: 'https://app.example/Leads' }]) }
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async function () {
  const html = fs.readFileSync(path.join(POPUP, 'popup.html'), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://kendo-filler.test/popup.html',
    resources: undefined,
    beforeParse(w) { installChrome(w, DEFAULT_CONFIG); }
  });
  const w = dom.window;
  const doc = w.document;
  const errors = [];
  w.addEventListener('error', (e) => errors.push(e.message || String(e.error)));

  // popup.html loads its scripts with <script src>; jsdom does not fetch them, so run them
  // here in the same order the browser would.
  w.eval(fs.readFileSync(path.join(POPUP, 'theme-boot.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(POPUP, 'popup.js'), 'utf8'));
  await wait(30);

  const el = (id) => doc.getElementById(id);

  t('no script error during boot', errors.length === 0, errors[0]);
  t('the theme is stamped before the markup is parsed (no inline script under MV3 CSP)',
    html.indexOf('<script src="theme-boot.js">') !== -1 && !/<script>[^<]/.test(html));
  t('the demo-page option is gone', !el('demo') && !/openDemo/.test(fs.readFileSync(path.join(POPUP, 'popup.js'), 'utf8')));

  /* ---------------- views ---------------- */
  t('starts on the home view', el('settingsView').hidden === true && el('homeView').hidden === false);
  t('home states the fill mode', el('summaryMode').textContent === 'All supported fields',
    el('summaryMode').textContent);
  t('home states the category count', /All 9 control categories on/.test(el('summaryCats').textContent),
    el('summaryCats').textContent);
  t('the settings button says Settings', el('settingsBtnText').textContent === 'Settings');

  el('settingsBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  t('Settings opens the list', el('settingsView').hidden === false && el('homeView').hidden === true);
  t('the list holds all 9 category rows',
    el('categories').querySelectorAll('.kf-row[data-cat]').length === 9,
    el('categories').querySelectorAll('.kf-row[data-cat]').length);
  t('every category row carries an icon chip',
    el('categories').querySelectorAll('.kf-row[data-cat] .kf-chip').length === 9);
  t('the button becomes Done while open', el('settingsBtnText').textContent === 'Done');
  t('aria-expanded reflects the open panel', el('settingsBtn').getAttribute('aria-expanded') === 'true');

  el('closeSettings').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  t('Done returns to home', el('settingsView').hidden === true && el('homeView').hidden === false);

  el('openSettings').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  t('the home link opens Settings too', el('settingsView').hidden === false);

  /* ---------------- theme ---------------- */
  t('light is the default theme', doc.documentElement.dataset.theme === 'light',
    doc.documentElement.dataset.theme);
  t('Light is the selected segment',
    doc.querySelector('[data-theme-choice="light"]').getAttribute('aria-checked') === 'true');

  doc.querySelector('[data-theme-choice="dark"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  t('choosing Dark repaints the popup', doc.documentElement.dataset.theme === 'dark');
  t('the segment follows the choice',
    doc.querySelector('[data-theme-choice="dark"]').getAttribute('aria-checked') === 'true' &&
      doc.querySelector('[data-theme-choice="light"]').getAttribute('aria-checked') === 'false');
  t('the theme is mirrored for the next paint', w.localStorage.getItem('kfTheme') === 'dark',
    w.localStorage.getItem('kfTheme'));

  doc.querySelector('[data-theme-choice="system"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  t('Auto follows the operating system', doc.documentElement.dataset.theme === 'system');

  await wait(260); // the persist() debounce
  const saved = sent.filter((m) => m.action === 'setConfig').pop();
  t('the theme is persisted with the configuration', saved && saved.config.theme === 'system',
    saved && saved.config.theme);

  /* ---------------- settings still drive the summary ---------------- */
  const dropdownToggle = doc.querySelector('[data-toggle="dropdown"]');
  dropdownToggle.checked = false;
  dropdownToggle.dispatchEvent(new w.Event('change', { bubbles: true }));
  t('switching a category off greys its row',
    dropdownToggle.closest('.kf-row').classList.contains('kf-off'));
  t('the home summary notices', /8 of 9 categories on — off: dropdown/.test(el('summaryCats').textContent),
    el('summaryCats').textContent);

  el('mode').value = 'required';
  el('mode').dispatchEvent(new w.Event('change', { bubbles: true }));
  t('fill mode reaches the summary', el('summaryMode').textContent === 'Required fields only',
    el('summaryMode').textContent);

  el('highlight').checked = true;
  el('highlight').dispatchEvent(new w.Event('change', { bubbles: true }));
  t('highlight reaches the summary', /filled fields highlighted/.test(el('summaryFlags').textContent),
    el('summaryFlags').textContent);

  /* ---------------- reset ---------------- */
  el('reset').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(30);
  t('reset restores the defaults everywhere',
    el('mode').value === 'all' && doc.documentElement.dataset.theme === 'light' &&
      /All 9 control categories on/.test(el('summaryCats').textContent),
    el('mode').value + ' / ' + doc.documentElement.dataset.theme);
  t('the AUTOFILL button is still the primary action',
    el('autofill').classList.contains('kf-btn-primary') && el('autofill').textContent.trim() === 'AUTOFILL');
  t('no script error at any point', errors.length === 0, errors[0]);

  console.log(fail ? '\n' + fail + ' CHECK(S) FAILED' : '\nAll popup UI checks passed.');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });

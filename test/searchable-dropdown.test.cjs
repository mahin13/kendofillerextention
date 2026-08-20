/* Dropdowns WITH A SEARCH BOX — the case that reported "no selectable options" (or was
 * skipped as hidden) while the tester could plainly see records in the list.
 *
 * Four situations, all real:
 *   A. widget API, stale filter   — dataSource.view() is empty, data() still holds records
 *   B. widget API, search-driven  — nothing loads until a term is typed (serverFiltering)
 *   C. markup only, search-driven — the popup list is empty until the search box is used
 *   D. markup only, hidden input  — the Kendo original is type="hidden" (MVC DropDownListFor)
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', 'src', 'content');
const FILES = ['utils.js','required-detector.js','value-generator.js','kendo-adapter.js','native-adapter.js','classifier.js','scanner.js','dependency-watcher.js','filler.js'];

let fail = 0;
const t = (n, c, x) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (x !== undefined ? '  -> ' + x : '')); if (!c) fail++; };

function boot(html) {
  // 'dangerously' is also what lets the harness eval the content scripts into this window.
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.Element.prototype.getBoundingClientRect = function () {
    return { width: 140, height: 24, top: 0, left: 0, right: 140, bottom: 24, x: 0, y: 0 };
  };
  w.Element.prototype.getClientRects = function () { return [{ width: 140, height: 24 }]; };
  if (!w.crypto || !w.crypto.getRandomValues) {
    w.crypto = { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 4294967295) >>> 0; return a; } };
  }
  return { dom, w };
}

function loadEngine(w) {
  FILES.forEach((f) => w.eval(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  return w.__KENDO_FILLER__;
}

/* --------------------------------------------------------------------------- *
 * A minimal but honest stand-in for jQuery + kendo, enough for the adapter to
 * reach a widget instance the way it does on a real page.
 * --------------------------------------------------------------------------- */
function installKendo(w) {
  const $ = function (target) {
    const node = target && target.nodeType ? target : null;
    const api = {
      0: node,
      length: node ? 1 : 0,
      data: () => (node && node.__kdata) || {},
      trigger(type) {
        if (node) node.dispatchEvent(new w.Event(type, { bubbles: true }));
        return api;
      }
    };
    return api;
  };
  $.fn = {};
  w.jQuery = $;
  w.$ = $;
  w.kendo = {
    widgetInstance: (jq) => (jq && jq[0] && jq[0].__widget) || null,
    toString: (v) => String(v)
  };
}

/** A DropDownList stub: filterable, with a face the widget updates like Kendo does. */
function makeDDL(w, el, face, records, opts) {
  const o = opts || {};
  const state = { loaded: o.preloaded ? records.slice() : [], view: o.preloaded && !o.staleFilter ? records.slice() : [] };
  const widget = {
    searches: [],
    opened: 0,
    options: {
      name: 'DropDownList',
      dataTextField: 'text',
      dataValueField: 'value',
      optionLabel: '-- Select --',
      filter: 'contains',
      serverFiltering: !!o.serverFiltering,
      minLength: o.minLength || 0
    },
    element: { 0: el, length: 1 },
    dataSource: { view: () => state.view, data: () => state.loaded },
    _val: '',
    value(v) {
      if (arguments.length) {
        const rec = records.filter((r) => String(r.value) === String(v))[0];
        if (!rec) return; // Kendo ignores a value it cannot resolve
        widget._val = String(v);
        el.value = String(v);
        face.textContent = rec.text;
        return;
      }
      return widget._val;
    },
    open() {
      widget.opened++;
      if (o.loadOnOpen) { state.loaded = records.slice(); state.view = records.slice(); }
    },
    close() {},
    one() {},
    trigger() {},
    search(word) {
      widget.searches.push(word);
      const term = String(word || '');
      if (o.needsTerm && term.length < (o.minLength || 1)) { state.view = []; return; }
      const hits = records.filter((r) => !term || r.text.toLowerCase().indexOf(term.toLowerCase()) !== -1);
      state.loaded = hits;
      state.view = hits;
    },
    select() { throw new Error('index selection not used in this test'); }
  };
  el.__widget = widget;
  el.__kdata = { kendoDropDownList: widget };
  return widget;
}

const RACES = [
  { value: 'U', text: 'Unknown-U' },
  { value: 'B', text: 'Black-B' },
  { value: 'I', text: 'Am Indian-I' },
  { value: 'A', text: 'Asian-A' },
  { value: 'W', text: 'White-W' }
];

/* --------------------------------------------------------------------------- *
 * A + B: the widget API is reachable
 * --------------------------------------------------------------------------- */
const API_HTML = `<!DOCTYPE html><html><body><form id="f">
  <div class="form-group">
    <label for="Race">Race <span class="required">*</span></label>
    <span class="k-widget k-dropdown" id="Race_wrapper">
      <span class="k-dropdown-wrap"><span class="k-input" id="RaceFace">-- Select Race --</span>
      <span class="k-select"></span></span>
      <input id="Race" name="Race" style="display:none" value="">
    </span>
  </div>
  <div class="form-group">
    <label for="Payer">Payer <span class="required">*</span></label>
    <span class="k-widget k-dropdown" id="Payer_wrapper">
      <span class="k-dropdown-wrap"><span class="k-input" id="PayerFace">-- Select Payer --</span>
      <span class="k-select"></span></span>
      <input id="Payer" name="Payer" style="display:none" value="">
    </span>
  </div>
</form></body></html>`;

/* --------------------------------------------------------------------------- *
 * C + D: Kendo markup only — no jQuery/kendo on window. The list is empty until
 * the search box is used, and the original input is type="hidden".
 * --------------------------------------------------------------------------- */
const DOM_HTML = `<!DOCTYPE html><html><body><form id="f">
  <div class="form-group">
    <label for="Race">Race <span class="required">*</span></label>
    <span class="k-widget k-dropdown" id="Race_wrapper" aria-owns="Race_listbox">
      <span class="k-dropdown-wrap"><span class="k-input">-- Select Race --</span>
      <span class="k-select"><span class="k-icon k-i-arrow-60-down"></span></span></span>
      <input id="Race" name="Race" type="hidden" data-role="dropdownlist" value="">
    </span>
  </div>
  <!-- a genuinely hidden input must stay skipped -->
  <input type="hidden" id="__RequestVerificationToken" name="__RequestVerificationToken" value="abc" />
</form>

<div class="k-animation-container" id="raceAnim" style="display:none">
  <div class="k-list-container k-popup">
    <div class="k-list-filter"><input class="k-textbox" placeholder="Search" /></div>
    <ul id="Race_listbox" class="k-list">
      <li class="k-item k-list-optionlabel">-- Select Race --</li>
    </ul>
  </div>
</div>

<script>
  var RECORDS = [
    { v: 'U', t: 'Unknown-U' }, { v: 'B', t: 'Black-B' }, { v: 'I', t: 'Am Indian-I' },
    { v: 'A', t: 'Asian-A' }, { v: 'W', t: 'White-W' }
  ];
  var anim = document.getElementById('raceAnim');
  var wrap = document.getElementById('Race_wrapper');
  var ul = document.getElementById('Race_listbox');
  var filter = anim.querySelector('.k-textbox');
  window.__typed = [];

  wrap.addEventListener('mousedown', function () {
    anim.style.display = anim.style.display === 'none' ? 'block' : 'none';
  });

  // serverFiltering with minLength 1: the list holds nothing until a term is typed.
  filter.addEventListener('input', function () {
    window.__typed.push(filter.value);
    ul.querySelectorAll('li:not(.k-list-optionlabel)').forEach(function (li) { li.remove(); });
    if (!filter.value) return;
    RECORDS.filter(function (r) {
      return r.t.toLowerCase().indexOf(filter.value.toLowerCase()) !== -1;
    }).forEach(function (r) {
      var li = document.createElement('li');
      li.className = 'k-item';
      li.setAttribute('data-value', r.v);
      li.textContent = r.t;
      li.addEventListener('click', function () {
        wrap.querySelector('.k-input').textContent = r.t;
        var orig = document.getElementById('Race');
        orig.value = r.v;
        orig.dispatchEvent(new Event('change', { bubbles: true }));
        anim.style.display = 'none';
      });
      ul.appendChild(li);
    });
  });
</script>
</body></html>`;

(async function () {
  /* ---------------- A: stale filter, records only in data() ---------------- */
  {
    const { w } = boot(API_HTML);
    installKendo(w);
    const KF = loadEngine(w);
    const doc = w.document;
    const race = makeDDL(w, doc.getElementById('Race'), doc.getElementById('RaceFace'), RACES, {
      preloaded: true,
      staleFilter: true // view() empty, data() full — what a previous search leaves behind
    });
    const payer = makeDDL(w, doc.getElementById('Payer'), doc.getElementById('PayerFace'), RACES, {
      preloaded: true
    });

    t('kendo API is reachable in this document', KF.kendo.available() === true);
    t('an empty search result does not hide the records',
      KF.kendo.dataItems(race).length === 5, KF.kendo.dataItems(race).length);

    const res = await KF.filler.run({ mode: 'all' });
    t('A: dropdown with a stale filter still filled', doc.getElementById('Race').value === 'U',
      'value=' + doc.getElementById('Race').value + ' shown="' + doc.getElementById('RaceFace').textContent + '"');
    t('A: the placeholder record was not chosen', doc.getElementById('RaceFace').textContent === 'Unknown-U');
    t('A: no popup was opened for a list that already had records', race.opened === 0 && payer.opened === 0,
      'opened=' + race.opened + '/' + payer.opened);
    t('A: both dropdowns filled', res.counts.filled === 2, JSON.stringify(res.counts));
    t('A: a loaded list is filled without any searching', race.searches.length === 0, JSON.stringify(race.searches));
    t('A: fast — no fixed per-field waiting', res.durationMs < 1600, res.durationMs + 'ms');
  }

  /* ---------------- B: nothing loads until a term is typed ---------------- */
  {
    const { w } = boot(API_HTML);
    installKendo(w);
    const KF = loadEngine(w);
    const doc = w.document;
    const race = makeDDL(w, doc.getElementById('Race'), doc.getElementById('RaceFace'), RACES, {
      serverFiltering: true,
      minLength: 1,
      needsTerm: true // open() loads nothing at all
    });
    makeDDL(w, doc.getElementById('Payer'), doc.getElementById('PayerFace'), RACES, { preloaded: true });

    const res = await KF.filler.run({ mode: 'all' });
    t('B: search-driven dropdown was opened like a user would', race.opened >= 1, 'opened=' + race.opened);
    t('B: the search box was used', race.searches.length > 0, JSON.stringify(race.searches));
    t('B: a record was selected', ['U', 'B', 'I', 'A', 'W'].indexOf(doc.getElementById('Race').value) !== -1,
      'value=' + doc.getElementById('Race').value + ' shown="' + doc.getElementById('RaceFace').textContent + '"');
    t('B: nothing failed', res.counts.failed === 0, (res.failures[0] || {}).reason);
    t('B: both dropdowns filled', res.counts.filled === 2, JSON.stringify(res.counts));
  }

  /* ---------------- C + D: markup only, hidden original ---------------- */
  {
    const { w } = boot(DOM_HTML);
    const KF = loadEngine(w);
    const doc = w.document;

    t('C: no kendo API in this document', KF.kendo.available() === false);
    t('D: a Kendo widget on a hidden input counts as a visible field',
      KF.utils.isVisible(doc.getElementById('Race')) === true);
    t('D: a real hidden input is still not a field',
      KF.utils.isVisible(doc.getElementById('__RequestVerificationToken')) === false);

    const field = KF.classifier.build(doc.getElementById('Race'));
    t('D: classified as a dropdown, not skipped as hidden',
      field.type === 'dropdown' && !field.skipReason, field.type + ' / ' + field.skipReason);
    t('D: the antiforgery token is hard-skipped',
      KF.classifier.hardSkip(doc.getElementById('__RequestVerificationToken')) === 'hidden input');

    const res = await KF.filler.run({ mode: 'all' });
    const shown = doc.querySelector('#Race_wrapper .k-input').textContent.trim();
    t('C: the search box was typed into', w.__typed.length > 0, JSON.stringify(w.__typed));
    t('C: a record from the search result was picked', doc.getElementById('Race').value !== '',
      'value=' + doc.getElementById('Race').value + ' shown="' + shown + '"');
    t('C: the widget face shows the picked record', /-[A-Z]$/.test(shown), shown);
    t('C: exactly one field detected and filled', res.counts.detected === 1 && res.counts.filled === 1,
      JSON.stringify(res.counts));
    t('C: nothing failed', res.counts.failed === 0, (res.failures[0] || {}).reason);
    console.log('\n' + res.summary + '  (' + res.durationMs + 'ms)');
  }

  console.log(fail ? '\n' + fail + ' CHECK(S) FAILED' : '\nAll searchable-dropdown checks passed.');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });

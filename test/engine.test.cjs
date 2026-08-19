/* End-to-end test of the Kendo Filler engine in jsdom (native-control paths).
 * jsdom has no layout engine, so getBoundingClientRect is stubbed to a real box —
 * visibility via computed style (display:none) is still exercised for real. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = require('path').join(__dirname, '..', 'src', 'content');
const FILES = [
  'utils.js',
  'required-detector.js',
  'value-generator.js',
  'kendo-adapter.js',
  'native-adapter.js',
  'classifier.js',
  'scanner.js',
  'dependency-watcher.js',
  'filler.js'
];

const HTML = `<!DOCTYPE html><html><body>
<nav class="navbar">
  <input type="text" id="navSearch" name="navSearch" placeholder="Search...">
  <select id="navCompany" name="navCompany"><option value="">-- Select --</option><option value="1">Acme</option></select>
</nav>
<aside class="sidebar">
  <label for="sideFilter">Quick Filter</label>
  <input type="text" id="sideFilter" name="sideFilter">
  <input type="checkbox" id="sideToggle" name="sideToggle">
</aside>
<header class="app-header">
  <input type="text" id="headerRef" name="headerRef">
</header>
<div class="content">
  <label for="pageSearch">Search</label>
  <input type="text" id="pageSearch" name="pageSearch">
</div>
<form id="f">
  <div class="form-group"><label for="pname">Portfolio Name <span class="required">*</span></label>
    <input type="text" id="pname" name="pname"></div>
  <div class="form-group"><label for="cref">Client Reference *</label>
    <input type="text" id="cref" name="cref"></div>
  <div class="form-group"><label for="entity">Legal Entity</label>
    <input type="text" id="entity" name="entity" aria-required="true"></div>
  <div class="form-group"><label for="deal">Deal Code</label>
    <input type="text" id="deal" name="deal" required></div>
  <div class="form-group"><label for="mandate">Mandate Id</label>
    <input type="text" id="mandate" name="mandate" data-val-required="req"></div>
  <div class="form-group"><label for="comment">Internal Comment</label>
    <input type="text" id="comment" name="comment"></div>
  <p class="note">* Footnote asterisk that belongs to prose, not a field.</p>

  <div class="form-group"><label for="region">Region *</label>
    <select id="region" name="region">
      <option value="">-- Select --</option>
      <option value="" disabled>Please select a region</option>
      <option value="emea">EMEA</option>
      <option value="apac">APAC</option>
    </select></div>

  <div class="form-group"><label><input type="checkbox" id="cb1" name="cb1"> Include Cash</label></div>
  <div class="form-group"><label><input type="checkbox" id="cb2" name="cb2" checked> Netting</label></div>
  <div class="form-group"><label><input type="checkbox" id="cb3" name="cb3" disabled> Locked</label></div>

  <fieldset><legend>Is Benchmarked *</legend>
    <label><input type="radio" name="bm" value="Yes"> Yes</label>
    <label><input type="radio" name="bm" value="No"> No</label></fieldset>
  <fieldset><legend>Valuation Basis</legend>
    <label><input type="radio" name="basis" value="dirty"> Dirty Price</label>
    <label><input type="radio" name="basis" value="clean"> Clean Price</label></fieldset>
  <fieldset><legend>On Duplicate Key</legend>
    <label><input type="radio" name="dup" value="delete"> Delete existing rows</label>
    <label><input type="radio" name="dup" value="keep"> Keep existing rows</label></fieldset>

  <div class="form-group"><label for="days">Settlement Days</label>
    <input type="number" id="days" name="days" min="1" max="9" step="2"></div>
  <div class="form-group"><label for="notional">Notional Amount</label>
    <input type="number" id="notional" name="notional" min="0.5" max="99.5" step="0.01"></div>

  <div class="form-group"><label for="short">A Very Long Label For A Small Field</label>
    <input type="text" id="short" name="short" maxlength="10"></div>
  <div class="form-group"><label for="mail">Contact Email *</label>
    <input type="email" id="mail" name="mail"></div>
  <div class="form-group"><label for="site">Fund Website</label>
    <input type="url" id="site" name="site"></div>
  <div class="form-group"><label for="tdate">Trade Date</label>
    <input type="date" id="tdate" name="tdate"></div>
  <div class="form-group"><label for="notes">Review Notes</label>
    <textarea id="notes" name="notes" maxlength="120"></textarea></div>

  <div class="form-group"><label for="itype">Instrument Type *</label>
    <select id="itype" name="itype"><option value="">-- Select --</option>
      <option value="bond">Bond</option></select></div>
  <div id="level1"></div><div id="level2"></div>

  <div class="form-group"><label for="hidden1">Hidden By CSS</label>
    <input type="text" id="hidden1" name="hidden1" style="display:none"></div>
  <div class="form-group"><label for="dis1">Disabled Field</label>
    <input type="text" id="dis1" name="dis1" disabled></div>
  <div class="form-group"><label for="ro1">Readonly Field</label>
    <input type="text" id="ro1" name="ro1" readonly value="system"></div>
  <div class="form-group"><label for="pwd">Password *</label>
    <input type="password" id="pwd" name="pwd"></div>
  <div class="form-group"><label for="akey">API Key</label>
    <input type="text" id="akey" name="akey"></div>
  <input type="hidden" id="h1" name="h1" value="do-not-touch">
  <button type="submit" id="save">Save</button>
  <button type="reset" id="rst">Reset</button>
</form>
<script>
  window.__submitted = false;
  document.getElementById('f').addEventListener('submit', function (e) {
    e.preventDefault(); window.__submitted = true;
  });
  document.getElementById('itype').addEventListener('change', function () {
    var l1 = document.getElementById('level1');
    l1.innerHTML = '';
    if (!this.value) return;
    setTimeout(function () {
      l1.innerHTML = '<div class="form-group"><label for="issuer">Issuer Name ' +
        '<span class="required">*</span></label><input type="text" id="issuer" name="issuer"></div>' +
        '<div class="form-group"><label for="rating">Credit Rating <span class="required">*</span></label>' +
        '<select id="rating" name="rating"><option value="">-- Select --</option>' +
        '<option value="aaa">AAA</option></select></div>';
      document.getElementById('rating').addEventListener('change', function () {
        var l2 = document.getElementById('level2');
        if (!this.value) return;
        setTimeout(function () {
          l2.innerHTML = '<div class="form-group"><label for="rdate">Review Date ' +
            '<span class="required">*</span></label><input type="date" id="rdate" name="rdate"></div>';
        }, 250);
      });
    }, 300);
  });
</script>
</body></html>`;

let fail = 0;
const t = (name, cond, extra) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra !== undefined ? '  -> ' + extra : ''));
  if (!cond) fail++;
};

async function main() {
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;

  // jsdom has no layout: give every element a real box so isVisible() can work.
  w.Element.prototype.getBoundingClientRect = function () {
    return { width: 120, height: 22, top: 0, left: 0, right: 120, bottom: 22, x: 0, y: 0 };
  };
  w.Element.prototype.getClientRects = function () {
    return [{ width: 120, height: 22 }];
  };
  if (!w.crypto || !w.crypto.getRandomValues) {
    w.crypto = { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 4294967295) >>> 0; return a; } };
  }

  FILES.forEach((f) => w.eval(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  const KF = w.__KENDO_FILLER__;
  t('engine modules loaded', !!(KF.utils && KF.filler && KF.scanner));

  /* ---------- required detection ---------- */
  const req = (id) => KF.required.detect(w.document.getElementById(id)).required;
  t('required via marker element', req('pname'));
  t('required via "*" in label text', req('cref'));
  t('required via aria-required', req('entity'));
  t('required via required attribute', req('deal'));
  t('required via mvc metadata', req('mandate'));
  t('optional field not required (footnote asterisk ignored)', !req('comment'));

  /* ---------- navigation shell + search boxes are skipped ---------- */
  const skipReasonOf = (id) => KF.classifier.hardSkip(w.document.getElementById(id));
  t('navbar text input skipped', /navigation/.test(skipReasonOf('navSearch') || ''), skipReasonOf('navSearch'));
  t('navbar dropdown skipped', /navigation/.test(skipReasonOf('navCompany') || ''), skipReasonOf('navCompany'));
  t('sidebar text input skipped', /navigation/.test(skipReasonOf('sideFilter') || ''), skipReasonOf('sideFilter'));
  t('sidebar checkbox skipped', /navigation/.test(skipReasonOf('sideToggle') || ''), skipReasonOf('sideToggle'));
  t('header input skipped', /navigation/.test(skipReasonOf('headerRef') || ''), skipReasonOf('headerRef'));
  t('a Search box in page content skipped', /search/.test(skipReasonOf('pageSearch') || ''), skipReasonOf('pageSearch'));

  /* ---------- classification ---------- */
  const cls = (id) => KF.classifier.build(w.document.getElementById(id));
  t('native select -> dropdown', cls('region').type === 'dropdown');
  t('number with step 2 -> numeric', cls('days').type === 'numeric', cls('days').type);
  t('number with step 0.01 -> decimal', cls('notional').type === 'decimal', cls('notional').type);
  t('email -> email', cls('mail').type === 'email');
  t('date -> date', cls('tdate').type === 'date');
  t('textarea -> textarea', cls('notes').type === 'textarea');
  t('password hard-skipped', /safety rules/.test(cls('pwd').skipReason || ''), cls('pwd').skipReason);
  t('api key hard-skipped', /safety rules/.test(cls('akey').skipReason || ''), cls('akey').skipReason);
  t('hidden input hard-skipped', /hidden/.test(cls('h1').skipReason || ''), cls('h1').skipReason);
  t('css-hidden field skipped', cls('hidden1').skipReason === 'Field is hidden', cls('hidden1').skipReason);
  t('disabled field skipped', cls('dis1').skipReason === 'Field is disabled');
  t('readonly field skipped', cls('ro1').skipReason === 'Field is readonly');
  t('submit button skipped', /never filled|button/.test(KF.classifier.hardSkip(w.document.getElementById('save')) || ''));

  /* ---------- scanner de-duplication / radio grouping ---------- */
  const scanned = KF.scanner.scan({});
  const radios = scanned.filter((f) => f.type === 'radio');
  t('3 radio groups seen as 3 logical fields', radios.length === 3, 'got ' + radios.length);
  t('radio group keeps all its members', radios[0].groupInputs.length === 2);

  /* ---------- full fill session, All Fields ---------- */
  const result = await KF.filler.run({ mode: 'all', categories: { radio: { default: 'yes' } } });
  const val = (id) => { const e = w.document.getElementById(id); return e ? e.value : null; };
  const filledIds = result.filled.map((f) => f.label + '=' + f.value);

  t('session completed', result.ok === true, result.summary);
  t('summary shape matches spec §22', /^Detected \d+ fields? • Filled \d+ • Skipped \d+$/.test(result.summary), result.summary);
  t('text field = label + random number', /^Portfolio Name \d{5}$/.test(val('pname')), val('pname'));
  t('maxlength respected', val('short').length <= 10, JSON.stringify(val('short')));
  t('email valid', /^[^@\s]+@[^@\s]+\.[a-z]+$/.test(val('mail')), val('mail'));
  t('url valid', /^https:\/\//.test(val('site')), val('site'));
  t('date valid ISO', /^\d{4}-\d{2}-\d{2}$/.test(val('tdate')), val('tdate'));
  t('textarea filled', val('notes').length > 0, val('notes'));
  t('select skipped placeholder + disabled option', val('region') === 'emea', val('region'));
  t('checkbox checked', w.document.getElementById('cb1').checked);
  t('pre-checked checkbox still checked', w.document.getElementById('cb2').checked);
  t('disabled checkbox untouched', !w.document.getElementById('cb3').checked);
  t('radio Yes chosen', w.document.querySelector('input[name=bm][value=Yes]').checked);
  t('radio without Yes/No uses first safe option', w.document.querySelector('input[name=basis][value=dirty]').checked);
  t('destructive radio option not chosen', !w.document.querySelector('input[name=dup][value=delete]').checked, 'keep=' + w.document.querySelector('input[name=dup][value=keep]').checked);
  const days = Number(val('days'));
  t('numeric honours min/max/step', Number.isInteger(days) && days >= 1 && days <= 9 && (days - 1) % 2 === 0, val('days'));
  const notional = Number(val('notional'));
  t('decimal honours min/max + 2dp', notional >= 0.5 && notional <= 99.5 && (val('notional').split('.')[1] || '').length <= 2, val('notional'));
  t('readonly field untouched', val('ro1') === 'system');
  t('hidden field untouched', val('h1') === 'do-not-touch');
  t('password untouched', val('pwd') === '');
  t('api key untouched', val('akey') === '');
  t('form was never submitted', w.__submitted === false);
  t('navbar/sidebar/search fields left untouched',
    ['navSearch', 'navCompany', 'sideFilter', 'headerRef', 'pageSearch'].every((id) => val(id) === '') &&
      !w.document.getElementById('sideToggle').checked);
  t('shell fields never appear in the report',
    !result.filled.concat(result.skipped, result.failures).some((r) => /quick filter|nav ?company|search/i.test(r.label || '')),
    'detected=' + result.counts.detected);

  /* ---------- conditional / dependent fields ---------- */
  t('level-1 dependent field appeared and was filled', !!w.document.getElementById('issuer') && /^Issuer Name \d{5}$/.test(val('issuer')), val('issuer'));
  t('level-1 dependent dropdown filled', val('rating') === 'aaa', val('rating'));
  t('level-2 dependent field appeared and was filled', !!w.document.getElementById('rdate') && /^\d{4}-\d{2}-\d{2}$/.test(val('rdate')), val('rdate'));
  t('used more than one pass', result.passes > 1, 'passes=' + result.passes);
  t('no duplicate fills', new Set(result.filled.map((f) => f.id)).size === result.filled.length);
  t('skip reasons are reported', result.skipped.length > 0, result.skipped.map((s) => s.label + ': ' + s.reason).slice(0, 4).join(' | '));

  /* ---------- Required Only mode on a fresh document ---------- */
  const dom2 = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true });
  const w2 = dom2.window;
  w2.Element.prototype.getBoundingClientRect = w.Element.prototype.getBoundingClientRect;
  w2.Element.prototype.getClientRects = w.Element.prototype.getClientRects;
  if (!w2.crypto || !w2.crypto.getRandomValues) w2.crypto = w.crypto;
  FILES.forEach((f) => w2.eval(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  const r2 = await w2.__KENDO_FILLER__.filler.run({ mode: 'required' });
  const v2 = (id) => { const e = w2.document.getElementById(id); return e ? e.value : null; };
  t('required-only filled the required text field', /^Portfolio Name \d{5}$/.test(v2('pname')), v2('pname'));
  t('required-only left the optional field empty', v2('comment') === '', JSON.stringify(v2('comment')));
  t('required-only left optional website empty', v2('site') === '');
  t('required-only still filled required email', /@/.test(v2('mail')), v2('mail'));
  t('required-only never fills password', v2('pwd') === '');
  t('required-only reports non-required as skipped', r2.skipped.some((s) => /Required Only mode/.test(s.reason)));

  /* ---------- repeated session on the same page ---------- */
  const before = w.document.getElementById('pname').value;
  const r3 = await KF.filler.run({ mode: 'all' });
  t('second session runs again and refills', r3.ok && w.document.getElementById('pname').value !== before, r3.summary);

  console.log('\nSession 1: ' + result.summary + ' (passes ' + result.passes + ', ' + result.durationMs + 'ms)');
  console.log('Session required-only: ' + r2.summary);
  console.log(fail ? '\n' + fail + ' CHECK(S) FAILED' : '\nAll DOM engine checks passed.');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('TEST HARNESS ERROR', e);
  process.exit(2);
});

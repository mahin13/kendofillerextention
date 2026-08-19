/* Kendo-shaped markup WITHOUT a reachable widget instance (no jQuery/kendo on window).
 * Reproduces the Asset Master layout: hidden original inputs behind visible Kendo wrappers,
 * a DropDownList whose popup only appears on click, a NumericTextBox showing "0.000000",
 * a Switch, and a DatePicker already displaying dd/MM/yyyy. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = require('path').join(__dirname, '..', 'src', 'content');
const FILES = ['utils.js','required-detector.js','value-generator.js','kendo-adapter.js','native-adapter.js','classifier.js','scanner.js','dependency-watcher.js','filler.js'];

const HTML = `<!DOCTYPE html><html><body>
<form id="f">
  <!-- Kendo DropDownList, old-theme markup: original <select> hidden inside the wrapper -->
  <div class="form-group">
    <label for="PutCall">Put Call <span class="required">*</span></label>
    <span class="k-widget k-dropdown k-header" id="PutCall_wrapper" aria-owns="PutCall_listbox">
      <span class="k-dropdown-wrap k-state-default">
        <span class="k-input">- Select -</span>
        <span class="k-select"><span class="k-icon k-i-arrow-60-down"></span></span>
      </span>
      <select id="PutCall" name="PutCall" style="display:none">
        <option value="">- Select -</option><option value="P">Put</option><option value="C">Call</option>
      </select>
    </span>
  </div>

  <!-- Kendo NumericTextBox, old-theme markup: visible formatted input + hidden original -->
  <div class="form-group">
    <label for="Strike">Strike <span class="required">*</span></label>
    <span class="k-widget k-numerictextbox">
      <span class="k-numeric-wrap k-state-default">
        <input class="k-formatted-value k-input" value="0.000000">
        <input id="Strike" name="Strike" class="k-input" value="0.000000" style="display:none">
        <span class="k-select"></span>
      </span>
    </span>
  </div>

  <!-- Kendo Switch: hidden checkbox inside a visible switch container -->
  <div class="form-group">
    <label for="Payoff">Payoff Relative To Initial Fix</label>
    <span class="k-switch k-switch-off" id="Payoff_wrapper" aria-checked="false">
      <span class="k-switch-container"><span class="k-switch-handle"></span></span>
      <input type="checkbox" id="Payoff" name="Payoff" style="display:none">
    </span>
  </div>

  <!-- Kendo DatePicker already displaying dd/MM/yyyy -->
  <div class="form-group">
    <label for="Maturity">Maturity <span class="required">*</span></label>
    <span class="k-widget k-datepicker">
      <span class="k-picker-wrap k-state-default">
        <input class="k-input" value="07/11/2039">
        <input id="Maturity" name="Maturity" style="display:none" value="07/11/2039">
        <span class="k-select"></span>
      </span>
    </span>
  </div>

  <!-- regression guard: a Kendo control inside a genuinely hidden container stays skipped -->
  <div class="form-group" id="hiddenTab" style="display:none">
    <label for="HiddenNum">Hidden Tab Number</label>
    <span class="k-widget k-numerictextbox"><span class="k-numeric-wrap">
      <input class="k-formatted-value k-input" value="0.00">
      <input id="HiddenNum" name="HiddenNum" style="display:none" value="0.00">
    </span></span>
  </div>
</form>

<!-- The popup list Kendo would create on open, hidden until the widget is clicked -->
<div class="k-animation-container" id="anim" style="display:none">
  <div class="k-list-container k-popup">
    <ul id="PutCall_listbox" class="k-list">
      <li class="k-item k-list-optionlabel">- Select -</li>
      <li class="k-item k-state-disabled k-disabled">Unavailable</li>
      <li class="k-item" data-value="P">Put</li>
      <li class="k-item" data-value="C">Call</li>
    </ul>
  </div>
</div>

<script>
  // Minimal stand-in for Kendo's own popup behaviour: open on mousedown, select on click.
  var anim = document.getElementById('anim');
  var wrap = document.getElementById('PutCall_wrapper');
  wrap.addEventListener('mousedown', function () {
    anim.style.display = anim.style.display === 'none' ? 'block' : 'none';
  });
  anim.querySelectorAll('li.k-item').forEach(function (li) {
    li.addEventListener('click', function () {
      if (li.classList.contains('k-disabled') || li.classList.contains('k-list-optionlabel')) return;
      wrap.querySelector('.k-input').textContent = li.textContent;
      var sel = document.getElementById('PutCall');
      sel.value = li.getAttribute('data-value');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      anim.style.display = 'none';
    });
  });
  // Kendo copies the visible formatted value into the hidden original on change.
  document.querySelectorAll('.k-numerictextbox').forEach(function (w) {
    var vis = w.querySelector('.k-formatted-value');
    var orig = w.querySelector('input[style*="display:none"]');
    if (vis && orig) vis.addEventListener('change', function () { orig.value = vis.value; });
  });
</script>
</body></html>`;

let fail = 0;
const t = (n, c, x) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (x !== undefined ? '  -> ' + x : '')); if (!c) fail++; };

(async function () {
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  // jsdom has no layout; give visible elements a box but keep display:none authoritative.
  w.Element.prototype.getBoundingClientRect = function () {
    return { width: 120, height: 22, top: 0, left: 0, right: 120, bottom: 22, x: 0, y: 0 };
  };
  w.Element.prototype.getClientRects = function () { return [{ width: 120, height: 22 }]; };
  if (!w.crypto || !w.crypto.getRandomValues) {
    w.crypto = { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 4294967295) >>> 0; return a; } };
  }
  FILES.forEach((f) => w.eval(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  const KF = w.__KENDO_FILLER__;
  const doc = w.document;
  const $ = (id) => doc.getElementById(id);

  t('no kendo API on window (fallback path under test)', KF.kendo.available() === false);

  /* the core bug: hidden originals behind visible Kendo wrappers */
  t('hidden Kendo <select> counts as visible', KF.utils.isVisible($('PutCall')));
  t('hidden Kendo numeric original counts as visible', KF.utils.isVisible($('Strike')));
  t('hidden Kendo switch input counts as visible', KF.utils.isVisible($('Payoff')));
  t('hidden Kendo date original counts as visible', KF.utils.isVisible($('Maturity')));
  t('control in a display:none container stays hidden', !KF.utils.isVisible($('HiddenNum')));

  t('wrapper lookup ignores k-input on the element itself',
    KF.utils.kendoWrapper($('Strike')).classList.contains('k-numerictextbox'),
    KF.utils.kendoWrapper($('Strike')).className);

  /* classification from markup alone */
  const cls = (id) => KF.classifier.build($(id));
  t('kendo select -> dropdown', cls('PutCall').type === 'dropdown', cls('PutCall').kendoWidgetType);
  t('numeric showing 0.000000 -> decimal, 6 dp',
    cls('Strike').type === 'decimal' && cls('Strike').constraints.decimals === 6,
    cls('Strike').type + '/' + cls('Strike').constraints.decimals);
  t('switch markup -> toggle', cls('Payoff').type === 'toggle', cls('Payoff').kendoWidgetType);
  t('datepicker markup -> date', cls('Maturity').type === 'date', cls('Maturity').kendoWidgetType);
  t('required detected on these fields', cls('PutCall').required && cls('Strike').required);
  t('no field reported as hidden', !['PutCall','Strike','Payoff','Maturity'].some((id) => cls(id).skipReason));

  /* the fill session */
  const res = await KF.filler.run({ mode: 'all', categories: { toggle: { default: 'yes' } } });
  const visText = doc.querySelector('#PutCall_wrapper .k-input').textContent.trim();
  const strikeVis = doc.querySelector('.k-numerictextbox .k-formatted-value').value;

  t('session ok', res.ok, res.summary);
  t('dropdown was opened and a record clicked', $('PutCall').value === 'P', 'value=' + $('PutCall').value + ' shown="' + visText + '"');
  t('placeholder + disabled list items were skipped', visText === 'Put', visText);
  t('numeric filled in the VISIBLE input', /^\d+(\.\d{1,6})?$/.test(strikeVis) && strikeVis !== '0.000000', strikeVis);
  t('numeric reached the hidden original too', $('Strike').value === strikeVis, $('Strike').value);
  t('6-dp precision respected', (strikeVis.split('.')[1] || '').length <= 6, strikeVis);
  t('switch toggled on', $('Payoff').checked === true || doc.getElementById('Payoff_wrapper').getAttribute('aria-checked') === 'true');
  t('date written in the displayed dd/MM/yyyy format',
    /^\d{2}\/\d{2}\/\d{4}$/.test(doc.querySelector('.k-datepicker .k-input').value),
    doc.querySelector('.k-datepicker .k-input').value);
  t('hidden-tab numeric left alone', $('HiddenNum').value === '0.00');
  t('4 of 4 visible Kendo fields filled', res.counts.filled === 4, JSON.stringify(res.counts));
  t('nothing failed', res.counts.failed === 0, (res.failures[0] || {}).reason);

  console.log('\n' + res.summary + '  (passes ' + res.passes + ', ' + res.durationMs + 'ms)');
  console.log('filled: ' + res.filled.map((f) => f.label + '=' + f.value + ' [' + f.kendo + ']').join(' | '));
  if (res.skipped.length) console.log('skipped: ' + res.skipped.map((s) => s.label + ': ' + s.reason).join(' | '));
  console.log(fail ? '\n' + fail + ' CHECK(S) FAILED' : '\nAll Kendo-markup fallback checks passed.');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });

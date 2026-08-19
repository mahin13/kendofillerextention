/* Kendo Editor ("HTML box") support, and the switch/toggle timing fix.
 *
 * Editor markup as `Html.Kendo().Editor()` renders it:
 *   classic mode -> <div class="k-editor"><ul class="k-editor-toolbar"><iframe><textarea hidden>
 *   inline  mode -> <div class="k-editor">…<div contenteditable="true">…<textarea hidden>
 * The hidden textarea is what the form posts; the visible surface is what the tester sees.
 * Both must be written, and the editor's own editing surface must never be picked up as an
 * extra field.
 *
 * Timing: toggling a Kendo Switch mutates its own markup (class flip + animating handle).
 * That must NOT be read as "a dependent field may be rendering", or every switch pays a full
 * quiet-period wait. A switch that really does reveal a field must still be waited for.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', 'src', 'content');
const FILES = [
  'utils.js', 'required-detector.js', 'value-generator.js', 'kendo-adapter.js',
  'native-adapter.js', 'classifier.js', 'scanner.js', 'dependency-watcher.js', 'filler.js'
];

const HTML = `<!DOCTYPE html><html><body>
<div class="page-content-wrapper"><div class="page-content">
<form id="f">

  <!-- inline-mode editor: contenteditable div + hidden textarea, with a character counter -->
  <div class="form-group">
    <label for="Objective">Portfolio Objective <span class="text-danger">*</span></label>
    <div class="k-widget k-editor" id="Objective_wrapper">
      <ul class="k-editor-toolbar"><li><button type="button">B</button></li></ul>
      <div class="k-editor-content" contenteditable="true" id="Objective_body"></div>
      <textarea id="Objective" name="Objective" style="display:none"></textarea>
    </div>
    <label class="pull-right" id="Objective_counter">0/60</label>
  </div>

  <!-- classic-mode editor: iframe body + hidden textarea -->
  <div class="form-group">
    <label for="FundRisks">Fund Risks <span class="text-danger">*</span></label>
    <div class="k-widget k-editor" id="FundRisks_wrapper">
      <ul class="k-editor-toolbar"><li><button type="button">B</button></li></ul>
      <iframe class="k-editor-content" id="FundRisks_frame" srcdoc="<html><body contenteditable='true'></body></html>"></iframe>
      <textarea id="FundRisks" name="FundRisks" style="display:none"></textarea>
    </div>
    <label class="pull-right">0/4000</label>
  </div>

  <!-- three switches: none of them reveals anything -->
  <div class="form-group">
    <label for="sw1">Payoff Relative To Initial Fix</label>
    <span class="k-switch k-switch-off" id="sw1_wrapper" aria-checked="false">
      <span class="k-switch-container"><span class="k-switch-handle"></span></span>
      <input type="checkbox" id="sw1" name="sw1" style="display:none">
    </span>
  </div>
  <div class="form-group">
    <label for="sw2">Netting Enabled</label>
    <span class="k-switch k-switch-off" id="sw2_wrapper" aria-checked="false">
      <span class="k-switch-container"><span class="k-switch-handle"></span></span>
      <input type="checkbox" id="sw2" name="sw2" style="display:none">
    </span>
  </div>
  <div class="form-group">
    <label for="sw3">Auto Reconcile</label>
    <span class="k-switch k-switch-off" id="sw3_wrapper" aria-checked="false">
      <span class="k-switch-container"><span class="k-switch-handle"></span></span>
      <input type="checkbox" id="sw3" name="sw3" style="display:none">
    </span>
  </div>

  <!-- a switch that DOES reveal a dependent field: the wait must still happen -->
  <div class="form-group">
    <label for="swDriver">Use Custom Limit</label>
    <span class="k-switch k-switch-off" id="swDriver_wrapper" aria-checked="false">
      <span class="k-switch-container"><span class="k-switch-handle"></span></span>
      <input type="checkbox" id="swDriver" name="swDriver" style="display:none">
    </span>
  </div>
  <div id="revealed"></div>

</form>
</div></div>

<script>
  /* Stand-in for Kendo Switch behaviour, including the animation churn that used to be
     mistaken for a dependency rendering. */
  ['sw1', 'sw2', 'sw3', 'swDriver'].forEach(function (id) {
    var input = document.getElementById(id);
    var wrap = document.getElementById(id + '_wrapper');
    function apply() {
      wrap.classList.toggle('k-switch-on', input.checked);
      wrap.classList.toggle('k-switch-off', !input.checked);
      wrap.setAttribute('aria-checked', String(input.checked));
      // simulate the handle animating: repeated mutations INSIDE the widget
      var handle = wrap.querySelector('.k-switch-handle');
      var n = 0;
      var t = setInterval(function () {
        handle.style.left = (n * 4) + 'px';
        if (++n > 6) clearInterval(t);
      }, 25);
    }
    wrap.addEventListener('mousedown', function () { input.checked = !input.checked; apply();
      input.dispatchEvent(new Event('change', { bubbles: true })); });
    input.addEventListener('change', apply);
  });

  document.getElementById('swDriver').addEventListener('change', function () {
    var host = document.getElementById('revealed');
    host.innerHTML = '';
    if (!this.checked) return;
    setTimeout(function () {
      host.innerHTML = '<div class="form-group"><label for="CustomLimit">Custom Limit ' +
        '<span class="text-danger">*</span></label><input type="text" id="CustomLimit" name="CustomLimit"></div>';
    }, 200);
  });
</script>
</body></html>`;

let fail = 0;
const t = (n, c, x) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (x !== undefined ? '  -> ' + x : '')); if (!c) fail++; };

(async function () {
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.Element.prototype.getBoundingClientRect = function () {
    return { width: 200, height: 40, top: 0, left: 0, right: 200, bottom: 40, x: 0, y: 0 };
  };
  w.Element.prototype.getClientRects = function () { return [{ width: 200, height: 40 }]; };
  if (!w.crypto || !w.crypto.getRandomValues) {
    w.crypto = { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 4294967295) >>> 0; return a; } };
  }
  await new Promise((r) => setTimeout(r, 60)); // let the srcdoc iframe load
  FILES.forEach((f) => w.eval(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  const KF = w.__KENDO_FILLER__;
  const doc = w.document;
  const $ = (id) => doc.getElementById(id);

  /* ---------- classification ---------- */
  const objective = KF.classifier.build($('Objective'));
  t('inline editor classified as editor', objective.type === 'editor', objective.type + '/' + objective.kendoWidgetType);
  t('editor is in the free-form category', KF.classifier.categoryOf(objective) === 'freeform');
  t('editor not reported hidden', !objective.skipReason, objective.skipReason);
  t('editor required detected', objective.required);
  t('character counter limit picked up', objective.constraints.maxLength === 60, JSON.stringify(objective.constraints));

  const risks = KF.classifier.build($('FundRisks'));
  t('classic (iframe) editor classified as editor', risks.type === 'editor', risks.type);
  t('editor body found through the iframe', !!KF.kendo.editorBody($('FundRisks')));

  /* the editing surface itself must not become a second field */
  t('inline editing surface skipped',
    /rich text editor body/.test(KF.classifier.hardSkip($('Objective_body')) || ''),
    KF.classifier.hardSkip($('Objective_body')));
  const frameBody = $('FundRisks_frame').contentDocument && $('FundRisks_frame').contentDocument.body;
  t('iframe editing surface skipped', !frameBody || /rich text editor body/.test(KF.classifier.hardSkip(frameBody) || ''),
    frameBody ? KF.classifier.hardSkip(frameBody) : 'no frame body');

  /* ---------- the session ---------- */
  const t0 = Date.now();
  const res = await KF.filler.run({ mode: 'all', categories: { toggle: { default: 'yes' } } });
  const elapsed = Date.now() - t0;

  t('session ok', res.ok, res.summary);

  /* editors */
  const objText = $('Objective_body').innerHTML;
  t('inline editor visible surface filled', /Portfolio Objective \d{5}/.test(objText), objText.slice(0, 70));
  t('inline editor hidden textarea filled', /Portfolio Objective \d{5}/.test($('Objective').value), $('Objective').value.slice(0, 70));
  t('editor content is HTML', /<p>/i.test($('Objective').value));
  t('editor respected the 60-char counter limit',
    KF.values.textLength($('Objective').value) <= 60, 'text length ' + KF.values.textLength($('Objective').value));
  t('classic editor textarea filled', /Fund Risks \d{5}/.test($('FundRisks').value), $('FundRisks').value.slice(0, 70));
  if (frameBody) {
    t('classic editor iframe body filled', /Fund Risks \d{5}/.test(frameBody.innerHTML), frameBody.innerHTML.slice(0, 70));
  }
  t('editors reported as filled', res.filled.filter((f) => f.type === 'editor').length === 2,
    res.filled.filter((f) => f.type === 'editor').map((f) => f.label).join(', '));

  /* switches */
  t('all four switches turned on',
    ['sw1', 'sw2', 'sw3', 'swDriver'].every((id) => $(id).checked === true));
  t('switch wrappers show the on state',
    ['sw1', 'sw2', 'sw3'].every((id) => $(id + '_wrapper').getAttribute('aria-checked') === 'true'));

  /* the dependent field behind the driver switch still gets found and filled */
  t('field revealed by a switch was filled',
    !!$('CustomLimit') && /^Custom Limit \d{5}$/.test($('CustomLimit').value),
    $('CustomLimit') ? $('CustomLimit').value : 'not revealed');

  /* timing: 4 switches + 2 editors + 1 revealed field must not take seconds.
     Before the fix each switch cost a full probe + quiet wait (~300-1500ms each). */
  t('session is fast despite 4 animating switches', elapsed < 2500, elapsed + 'ms');

  console.log('\n' + res.summary + '  (passes ' + res.passes + ', ' + res.durationMs + 'ms, wall ' + elapsed + 'ms)');
  console.log('filled: ' + res.filled.map((f) => f.label + ' [' + f.type + ']').join(' | '));
  if (res.skipped.length) console.log('skipped: ' + res.skipped.map((s) => s.label + ': ' + s.reason).join(' | '));
  if (res.failures.length) console.log('failed: ' + res.failures.map((s) => s.label + ': ' + s.reason).join(' | '));
  console.log(fail ? '\n' + fail + ' CHECK(S) FAILED' : '\nAll editor + toggle checks passed.');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });

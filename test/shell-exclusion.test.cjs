/* Application-shell exclusion, using the real RiskMonitor layout structure:
 *   .page-header.navbar#nav-bar-section  -> top bar, holds #UniversalSearchDropdown
 *   .sidebar-container#sidbar            -> left menu (.sidemenu-container > .left-sidemenu)
 *   .chat-sidebar-container              -> right settings panel (theme radios/checkboxes)
 *   .page-content-wrapper > .page-content#page-body-content -> the actual form
 * Plus: a dropdown popup appended to <body> must never be treated as a form, while a modal
 * appended to <body> must still be filled.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', 'src', 'content');
const FILES = [
  'utils.js', 'required-detector.js', 'value-generator.js', 'kendo-adapter.js',
  'native-adapter.js', 'classifier.js', 'scanner.js', 'dependency-watcher.js', 'filler.js'
];

const HTML = `<!DOCTYPE html><html>
<body class="page-header-fixed sidemenu-closed-hidelogo page-content-white">
<div class="page-wrapper">

  <div class="page-header navbar navbar-fixed-top" id="nav-bar-section">
    <div class="page-header-inner">
      <div class="page-logo"><a href="#"><img alt="RiskMonitor"></a></div>
      <ul class="nav navbar-nav list-group-horizontal float-start">
        <li><a href="#" class="menu-toggler sidebar-toggler"></a></li>
      </ul>
      <div class="top-menu">
        <ul class="nav navbar-nav pull-right">
          <li class="mt-3 list-unstyled li-responsive">
            <input id="UniversalSearchDropdown" class="form-control w-100" placeholder="Search..." />
          </li>
          <li id="domain-period" class="dropdown mr-3">
            <select id="domainPeriod" name="domainPeriod">
              <option value="">-- Select --</option><option value="1">Q1 2026</option>
            </select>
          </li>
          <li class="dropdown dropdown-notification">
            <ul class="dropdown-menu">
              <li><input type="text" id="notifyFilter" name="notifyFilter"></li>
            </ul>
          </li>
        </ul>
      </div>
    </div>
  </div>

  <div class="page-container" id="body">
    <div class="sidebar-container" id="sidbar">
      <div class="sidemenu-container navbar-collapse collapse fixed-menu">
        <div id="remove-scroll" class="left-sidemenu">
          <ul class="sidemenu">
            <li><a href="#">RiskMonitor</a></li>
            <li><a href="#">Jobs</a>
              <input type="text" id="menuFilter" name="menuFilter" placeholder="Filter menu">
              <select id="menuJump" name="menuJump"><option value="">-</option><option value="a">Admin</option></select>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <div class="page-content-wrapper">
      <div class="page-content" id="page-body-content">
        <form id="amForm">
          <div class="form-group">
            <label for="Underlying">Underlying <span class="required">*</span></label>
            <input type="text" id="Underlying" name="Underlying" maxlength="50">
          </div>
          <div class="form-group">
            <label for="PutCall">Put Call <span class="required">*</span></label>
            <select id="PutCall" name="PutCall">
              <option value="">- Select -</option><option value="P">Put</option><option value="C">Call</option>
            </select>
          </div>
          <div class="form-group">
            <label for="DivYield">Div Yield</label>
            <input type="number" id="DivYield" name="DivYield" step="0.000001">
          </div>
          <div class="form-group">
            <label>Payoff Relative To Initial Fix</label>
            <input type="checkbox" id="Payoff" name="Payoff" role="switch">
          </div>
        </form>
      </div>
    </div>

    <!-- right-hand theme/settings panel: real inputs that must never be touched -->
    <div class="chat-sidebar-container" data-close-on-body-click="false">
      <div class="chat-sidebar">
        <div class="tab-content">
          <div class="tab-pane chat-sidebar-settings" id="quick_sidebar_tab_1">
            <div class="quick-setting">
              <ul id="themecolors">
                <li><label><input type="radio" name="themeColor" value="Yes"> Blue</label></li>
                <li><label><input type="radio" name="themeColor" value="No"> Dark</label></li>
              </ul>
              <input type="checkbox" id="sidebarFixed" name="sidebarFixed">
              <input type="text" id="themeName" name="themeName">
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <footer id="sticky-footer">
    <div class="page-footer-inner"><input type="text" id="footerNote" name="footerNote"></div>
  </footer>
</div>

<!-- a Kendo DropDownTree popup, appended to <body> like Kendo does -->
<div class="k-animation-container" id="ddtPopup">
  <div class="k-popup k-content">
    <div class="k-treeview" id="UniversalSearchDropdown_treeview">
      <ul class="k-treeview-lines">
        <li class="k-item"><div><span class="k-in">Asset Master</span></div></li>
        <li class="k-item"><div><span class="k-in">Portfolios</span></div></li>
      </ul>
    </div>
  </div>
</div>

<!-- a Kendo Window with a real form, also at <body> level: MUST still be filled -->
<div class="k-widget k-window" id="editWindow">
  <div class="k-window-content k-content">
    <form id="popupForm">
      <div class="form-group">
        <label for="LimitValue">Limit Value <span class="required">*</span></label>
        <input type="text" id="LimitValue" name="LimitValue">
      </div>
    </form>
  </div>
</div>
</body></html>`;

let fail = 0;
const t = (n, c, x) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (x !== undefined ? '  -> ' + x : '')); if (!c) fail++; };

(async function () {
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
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
  const reasonOf = (id) => KF.classifier.hardSkip($(id));

  /* content region resolution */
  const main = KF.classifier.mainRegion(doc);
  t('content region found', !!main && main.classList.contains('page-content-wrapper'),
    main ? main.className : 'none');

  /* navbar */
  t('universal search dropdown skipped', !!reasonOf('UniversalSearchDropdown'), reasonOf('UniversalSearchDropdown'));
  t('navbar period dropdown skipped', !!reasonOf('domainPeriod'), reasonOf('domainPeriod'));
  t('notification dropdown input skipped', !!reasonOf('notifyFilter'), reasonOf('notifyFilter'));

  /* left sidebar */
  t('sidebar menu filter skipped', !!reasonOf('menuFilter'), reasonOf('menuFilter'));
  t('sidebar jump dropdown skipped', !!reasonOf('menuJump'), reasonOf('menuJump'));

  /* right settings panel */
  t('theme radio skipped', !!reasonOf('themeName') && !!KF.classifier.hardSkip(doc.querySelector('input[name=themeColor]')),
    KF.classifier.hardSkip(doc.querySelector('input[name=themeColor]')));
  t('settings checkbox skipped', !!reasonOf('sidebarFixed'), reasonOf('sidebarFixed'));

  /* footer */
  t('footer input skipped', !!reasonOf('footerNote'), reasonOf('footerNote'));

  /* widget popup vs dialog, both at <body> level */
  const treeNode = doc.querySelector('#UniversalSearchDropdown_treeview');
  // Either rule may fire first (structural "outside the content area" or the popup rule);
  // what matters is that a widget popup is never treated as a fillable tree.
  t('dropdown-tree popup is never a tree field',
    /chrome|outside the page content/.test(KF.classifier.hardSkip(treeNode) || ''),
    KF.classifier.hardSkip(treeNode));
  t('Kendo Window form field NOT skipped', !reasonOf('LimitValue'), reasonOf('LimitValue') || 'in scope');

  /* real form fields */
  ['Underlying', 'PutCall', 'DivYield', 'Payoff'].forEach((id) => {
    t('form field "' + id + '" in scope', !reasonOf(id), reasonOf(id) || 'in scope');
  });

  /* full session */
  const res = await KF.filler.run({ mode: 'all', categories: { radio: { default: 'yes' } } });
  const val = (id) => { const e = $(id); return e ? e.value : null; };

  t('session ok', res.ok, res.summary);
  t('form text filled', /^Underlying \d{5}$/.test(val('Underlying')), val('Underlying'));
  t('form dropdown filled', val('PutCall') === 'P', val('PutCall'));
  t('form decimal filled', Number(val('DivYield')) > 0, val('DivYield'));
  t('form switch turned on', $('Payoff').checked === true);
  t('window form field filled', /^Limit Value \d{5}$/.test(val('LimitValue')), val('LimitValue'));

  t('universal search untouched', val('UniversalSearchDropdown') === '', JSON.stringify(val('UniversalSearchDropdown')));
  t('navbar dropdown untouched', val('domainPeriod') === '', val('domainPeriod'));
  t('sidebar inputs untouched', val('menuFilter') === '' && val('menuJump') === '');
  t('theme radios untouched', !doc.querySelector('input[name=themeColor]:checked'));
  t('settings panel untouched', $('sidebarFixed').checked === false && val('themeName') === '');
  t('footer untouched', val('footerNote') === '');
  t('tree in the search popup was not selected',
    !doc.querySelector('#UniversalSearchDropdown_treeview .k-state-selected, #UniversalSearchDropdown_treeview .k-selected'));

  t('only the 5 real fields counted as detected', res.counts.detected === 5, JSON.stringify(res.counts));
  t('no shell field appears in the report',
    !res.filled.concat(res.skipped, res.failures).some((r) =>
      /theme|menu|notify|footer|universal|period/i.test((r.label || '') + ' ' + (r.element || ''))),
    res.filled.map((f) => f.label).join(' | '));

  console.log('\n' + res.summary + '  (passes ' + res.passes + ', ' + res.durationMs + 'ms)');
  console.log('filled: ' + res.filled.map((f) => f.label + '=' + f.value).join(' | '));
  console.log(fail ? '\n' + fail + ' CHECK(S) FAILED' : '\nAll shell-exclusion checks passed.');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });

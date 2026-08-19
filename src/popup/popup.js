/* Kendo Filler — popup.js
 *
 * Owns the configuration UI (spec §3, §22), persists preferences (spec §18) and drives a
 * fill session through the service worker (spec §23). The popup stays responsive: all work
 * happens in the page, and the button is locked while a session is in flight.
 */
(function () {
  'use strict';

  const CATEGORIES = [
    'dropdown',
    'tree',
    'checkbox',
    'toggle',
    'radio',
    'numeric',
    'decimal',
    'freeform',
    'conditional'
  ];

  const el = (id) => document.getElementById(id);
  let config = null;
  let busy = false;
  let lastResult = null;

  function sw(action, payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        Object.assign({ target: 'kendo-filler-sw', action }, payload || {}),
        (res) => {
          const err = chrome.runtime.lastError;
          if (err) {
            resolve({ ok: false, error: err.message });
            return;
          }
          resolve(res || { ok: false, error: 'No response from the extension background' });
        }
      );
    });
  }

  /* ---------------- config <-> UI ---------------- */

  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  }

  function setPath(obj, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    const target = keys.reduce((o, k) => (o[k] = o[k] || {}), obj);
    target[last] = value;
  }

  function render() {
    el('mode').value = config.mode || 'all';
    el('modeHint').textContent =
      config.mode === 'required'
        ? 'Fills only fields marked required (by the label “*” or required metadata).'
        : 'Fills every supported field detected on the page.';

    CATEGORIES.forEach((cat) => {
      const box = document.querySelector('[data-toggle="' + cat + '"]');
      if (!box) return;
      const on = !!(config.categories[cat] && config.categories[cat].enabled);
      box.checked = on;
      const row = box.closest('.kf-row');
      if (row) row.classList.toggle('kf-off', !on);
    });

    document.querySelectorAll('[data-config]').forEach((input) => {
      const path = 'categories.' + input.getAttribute('data-config');
      const value = getPath(config, path);
      if (value !== undefined && value !== null) input.value = value;
    });

    el('onlyEmpty').checked = !!config.onlyEmpty;
    el('highlight').checked = !!config.highlight;
  }

  const persist = (function () {
    let timer = null;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(() => sw('setConfig', { config }), 200);
    };
  })();

  function wireInputs() {
    el('mode').addEventListener('change', (e) => {
      config.mode = e.target.value;
      render();
      persist();
    });

    document.querySelectorAll('[data-toggle]').forEach((box) => {
      box.addEventListener('change', () => {
        const cat = box.getAttribute('data-toggle');
        config.categories[cat] = config.categories[cat] || {};
        config.categories[cat].enabled = box.checked;
        const row = box.closest('.kf-row');
        if (row) row.classList.toggle('kf-off', !box.checked);
        persist();
      });
    });

    document.querySelectorAll('[data-config]').forEach((input) => {
      input.addEventListener('change', () => {
        const path = 'categories.' + input.getAttribute('data-config');
        let value = input.value;
        if (input.type === 'number') {
          value = Number(value);
          if (!isFinite(value)) return;
          if (/decimals$/.test(path)) value = Math.max(0, Math.min(6, Math.round(value)));
        }
        setPath(config, path, value);
        // Keep min <= max so a generator can never receive an impossible range.
        ['numeric', 'decimal'].forEach((cat) => {
          const c = config.categories[cat];
          if (c && isFinite(c.min) && isFinite(c.max) && c.max < c.min) {
            if (/\.max$/.test(path)) c.min = c.max;
            else c.max = c.min;
          }
        });
        render();
        persist();
      });
    });

    el('onlyEmpty').addEventListener('change', (e) => {
      config.onlyEmpty = e.target.checked;
      persist();
    });
    el('highlight').addEventListener('change', (e) => {
      config.highlight = e.target.checked;
      persist();
    });

    el('reset').addEventListener('click', async () => {
      const res = await sw('resetConfig');
      if (res.ok) {
        config = res.config;
        render();
        setStatus('Configuration reset to defaults.');
      }
    });

    el('demo').addEventListener('click', () => sw('openDemo'));
    el('autofill').addEventListener('click', runAutofill);
    el('scan').addEventListener('click', runScan);
    el('toggleDiag').addEventListener('click', () => {
      const diag = el('diag');
      diag.hidden = !diag.hidden;
      el('toggleDiag').textContent = diag.hidden ? 'Show diagnostics' : 'Hide diagnostics';
    });
  }

  /* ---------------- status + diagnostics ---------------- */

  function setStatus(text, isError) {
    const line = el('statusLine');
    line.textContent = text;
    line.classList.toggle('kf-error', !!isError);
  }

  function setCounts(counts) {
    if (!counts) {
      el('counts').hidden = true;
      return;
    }
    el('cDetected').textContent = counts.detected;
    el('cFilled').textContent = counts.filled;
    el('cSkipped').textContent = counts.skipped;
    el('cFailed').textContent = counts.failed;
    el('counts').hidden = false;
  }

  function escapeHtml(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderDiagnostics(result) {
    const parts = [];
    const list = (items, render) =>
      '<ul>' + items.map((i) => '<li>' + render(i) + '</li>').join('') + '</ul>';

    // Reason summary first: with dozens of skips, the grouped counts are what actually
    // explain a disappointing run.
    const reasons = {};
    (result.skipped || []).concat(result.failures || []).forEach((r) => {
      const key = String(r.reason || 'unknown').replace(/"[^"]*"/g, '"…"');
      reasons[key] = (reasons[key] || 0) + 1;
    });
    const reasonRows = Object.keys(reasons).sort((a, b) => reasons[b] - reasons[a]);
    if (reasonRows.length) {
      parts.push(
        '<h3>Why fields were not filled</h3>' +
          list(reasonRows, (r) => '<span class="kf-r">' + reasons[r] + '×</span> ' + escapeHtml(r))
      );
    }

    const meta = [];
    meta.push('Passes: ' + result.passes);
    meta.push('Duration: ' + Math.round(result.durationMs) + ' ms');
    meta.push('Kendo: ' + (result.kendoDetected ? 'yes' + (result.kendoVersion ? ' v' + result.kendoVersion : '') : 'not detected'));
    if (result.aborted) meta.push('Stopped early: ' + result.aborted);
    parts.push('<h3>Session</h3>' + list(meta, (m) => escapeHtml(m)));

    if (result.failures && result.failures.length) {
      parts.push(
        '<h3>Failed (' + result.failures.length + ')</h3>' +
          list(
            result.failures,
            (f) =>
              '<span class="kf-t' +
              (f.required ? ' kf-req' : '') +
              '">' +
              escapeHtml(f.label) +
              '</span> <em>' +
              escapeHtml(f.type) +
              '</em> — <span class="kf-f">' +
              escapeHtml(f.reason) +
              '</span>'
          )
      );
    }
    if (result.skipped && result.skipped.length) {
      parts.push(
        '<h3>Skipped (' + result.skipped.length + ')</h3>' +
          list(
            result.skipped,
            (s) =>
              '<span class="kf-t">' +
              escapeHtml(s.label) +
              '</span> <em>' +
              escapeHtml(s.type) +
              '</em> — <span class="kf-r">' +
              escapeHtml(s.reason) +
              '</span>'
          )
      );
    }
    if (result.filled && result.filled.length) {
      parts.push(
        '<h3>Filled (' + result.filled.length + ')</h3>' +
          list(
            result.filled,
            (f) =>
              '<span class="kf-t' +
              (f.required ? ' kf-req' : '') +
              '">' +
              escapeHtml(f.label) +
              '</span> <em>' +
              escapeHtml(f.kendo || f.type) +
              '</em> → <span class="kf-v">' +
              escapeHtml(f.value) +
              '</span>'
          )
      );
    }

    el('diag').innerHTML = parts.join('');
    el('toggleDiag').hidden = false;
  }

  /* ---------------- actions ---------------- */

  function setBusy(on) {
    busy = on;
    const btn = el('autofill');
    btn.disabled = on;
    el('scan').disabled = on;
    btn.classList.toggle('kf-busy', on);
    btn.textContent = on ? 'FILLING' : 'AUTOFILL';
  }

  async function runAutofill() {
    if (busy) return; // spec §23: no duplicate sessions
    setBusy(true);
    setStatus('Scanning and filling…');
    setCounts(null);
    el('toggleDiag').hidden = true;
    el('diag').hidden = true;
    el('toggleDiag').textContent = 'Show diagnostics';

    const res = await sw('autofill', { config });
    setBusy(false);

    if (!res.ok) {
      setStatus(res.error || 'The fill session failed.', true);
      if (res.result) renderDiagnostics(res.result);
      return;
    }
    const result = res.result;
    lastResult = result;
    if (!result || result.ok === false) {
      setStatus((result && result.error) || 'The fill session failed.', true);
      return;
    }
    setStatus(result.summary + (result.aborted ? ' — ' + result.aborted : ''));
    setCounts(result.counts);
    renderDiagnostics(result);
    updateKendoBadge(result.kendoDetected, result.kendoVersion);
  }

  async function runScan() {
    if (busy) return;
    setBusy(true);
    setStatus('Scanning the page…');
    const res = await sw('inspect', { config });
    setBusy(false);
    if (!res.ok) {
      setStatus(res.error || 'Scan failed.', true);
      return;
    }
    const r = res.result;
    const bits = Object.keys(r.byCategory || {})
      .map((k) => k + ': ' + r.byCategory[k])
      .join(' • ');
    setStatus(
      'Detected ' + r.detected + ' supported field' + (r.detected === 1 ? '' : 's') +
        ' (' + r.required + ' required)' + (bits ? ' — ' + bits : '')
    );
    setCounts(null);
    updateKendoBadge(r.kendoDetected, r.kendoVersion);
  }

  function updateKendoBadge(detected, version) {
    const badge = el('kendoBadge');
    badge.classList.remove('kf-badge-on', 'kf-badge-off');
    if (detected) {
      badge.textContent = 'Kendo' + (version ? ' ' + version : '');
      badge.classList.add('kf-badge-on');
    } else {
      badge.textContent = 'No Kendo';
      badge.classList.add('kf-badge-off');
    }
  }

  /* ---------------- boot ---------------- */

  (async function init() {
    const stored = await sw('getConfig');
    config = (stored.ok && stored.config) || {};
    config.categories = config.categories || {};
    render();
    wireInputs();

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        el('scope').textContent = tab.title || tab.url || 'Current page';
        el('scope').title = tab.url || '';
      }
    } catch (e) {
      /* ignore */
    }

    /* Deliberately NOT scanning here. Opening the popup must not touch the page at all:
     * no script is injected and nothing is read until the user clicks Autofill (which
     * fills) or Scan (which only counts). That is what guarantees that landing on a page —
     * or opening the popup to check a setting — can never change a single field. */
    el('kendoBadge').textContent = 'not scanned';
    el('kendoBadge').title = 'Click Scan or Autofill to inspect this page';
    setStatus('Ready. Nothing is touched until you click Autofill.');
  })();
})();

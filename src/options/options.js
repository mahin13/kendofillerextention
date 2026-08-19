/* Kendo Filler — options.js: persistent advanced settings (spec §18). */
(function () {
  'use strict';

  const el = (id) => document.getElementById(id);
  let config = null;

  function sw(action, payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        Object.assign({ target: 'kendo-filler-sw', action }, payload || {}),
        (res) => resolve(res || { ok: false, error: chrome.runtime.lastError && chrome.runtime.lastError.message })
      );
    });
  }

  function render() {
    el('maxPasses').value = config.maxPasses || 10;
    el('timeBudget').value = Math.round((config.timeBudgetMs || 60000) / 1000);
    el('onlyEmpty').checked = !!config.onlyEmpty;
    el('highlight').checked = !!config.highlight;
  }

  function save(note) {
    sw('setConfig', { config }).then(() => {
      el('saved').textContent = note || 'Saved.';
      setTimeout(() => (el('saved').textContent = 'Changes are saved automatically.'), 1500);
    });
  }

  (async function init() {
    const res = await sw('getConfig');
    config = (res.ok && res.config) || {};
    render();

    el('maxPasses').addEventListener('change', (e) => {
      config.maxPasses = Math.max(1, Math.min(25, Number(e.target.value) || 10));
      render();
      save();
    });
    el('timeBudget').addEventListener('change', (e) => {
      const secs = Math.max(5, Math.min(600, Number(e.target.value) || 60));
      config.timeBudgetMs = secs * 1000;
      render();
      save();
    });
    el('onlyEmpty').addEventListener('change', (e) => {
      config.onlyEmpty = e.target.checked;
      save();
    });
    el('highlight').addEventListener('change', (e) => {
      config.highlight = e.target.checked;
      save();
    });
    el('reset').addEventListener('click', async () => {
      const r = await sw('resetConfig');
      if (r.ok) {
        config = r.config;
        render();
        el('saved').textContent = 'All settings reset to defaults.';
      }
    });
  })();
})();

/* Kendo Filler — service-worker.js  (MV3 background)
 *
 * Owns extension lifecycle and script injection (spec §18, §23).
 *
 * Injection order matters: the page-world engine modules must be injected in dependency
 * order, and content.js (the message listener) last. The isolated-world bridge is injected
 * afterwards so it can relay popup messages into the page world.
 *
 * Nothing is injected until the user acts, and only into the active tab, so the extension
 * needs no host permissions at all — activeTab + scripting is enough.
 */

const ENGINE_FILES = [
  'src/content/utils.js',
  'src/content/required-detector.js',
  'src/content/value-generator.js',
  'src/content/kendo-adapter.js',
  'src/content/native-adapter.js',
  'src/content/classifier.js',
  'src/content/scanner.js',
  'src/content/dependency-watcher.js',
  'src/content/filler.js',
  'src/content/content.js'
];

const BRIDGE_FILE = 'src/content/bridge.js';

const DEFAULT_CONFIG = {
  mode: 'all',
  onlyEmpty: false,
  highlight: false,
  theme: 'light', // popup appearance: 'light' | 'dark' | 'system'
  maxPasses: 10,
  timeBudgetMs: 60000,
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

const RESTRICTED = /^(chrome|edge|about|devtools|chrome-extension|view-source|moz-extension):/i;

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    const stored = await readConfig();
    await writeConfig(Object.assign({}, DEFAULT_CONFIG, stored || {}));
  }
});

async function readConfig() {
  try {
    const sync = await chrome.storage.sync.get('config');
    if (sync && sync.config) return sync.config;
  } catch (e) {
    /* sync may be unavailable */
  }
  const local = await chrome.storage.local.get('config');
  return (local && local.config) || null;
}

async function writeConfig(config) {
  try {
    await chrome.storage.sync.set({ config });
  } catch (e) {
    /* fall through to local */
  }
  await chrome.storage.local.set({ config });
}

async function ensureInjected(tabId) {
  // Idempotent: each engine module returns immediately if already present.
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    injectImmediately: true,
    files: ENGINE_FILES
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'ISOLATED',
    injectImmediately: true,
    files: [BRIDGE_FILE]
  });
}

function callBridge(tabId, action, config, timeoutMs) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tabId,
      { target: 'kendo-filler-bridge', action, config, timeoutMs },
      (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          resolve({ ok: false, error: err.message });
          return;
        }
        resolve(response || { ok: false, error: 'No response from the page' });
      }
    );
  });
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) throw new Error('No active tab');
  if (!tab.url || RESTRICTED.test(tab.url)) {
    throw new Error('Kendo Filler cannot run on this page (' + (tab.url || 'unknown') + ')');
  }
  return tab;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'kendo-filler-sw') return false;

  (async () => {
    try {
      switch (msg.action) {
        case 'getConfig': {
          const config = (await readConfig()) || DEFAULT_CONFIG;
          sendResponse({ ok: true, config, defaults: DEFAULT_CONFIG });
          return;
        }
        case 'setConfig': {
          await writeConfig(msg.config);
          sendResponse({ ok: true });
          return;
        }
        case 'resetConfig': {
          await writeConfig(DEFAULT_CONFIG);
          sendResponse({ ok: true, config: DEFAULT_CONFIG });
          return;
        }
        case 'inspect': {
          const tab = await activeTab();
          await ensureInjected(tab.id);
          const res = await callBridge(tab.id, 'inspect', msg.config, 15000);
          sendResponse(res);
          return;
        }
        case 'autofill': {
          const tab = await activeTab();
          await ensureInjected(tab.id);
          const res = await callBridge(tab.id, 'autofill', msg.config, 180000);
          sendResponse(res);
          return;
        }
        default:
          sendResponse({ ok: false, error: 'Unknown action "' + msg.action + '"' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  })();

  return true; // keep the message channel open for the async work above
});

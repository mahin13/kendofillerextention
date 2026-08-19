/* Kendo Filler — bridge.js  (ISOLATED world)
 *
 * Relays chrome.runtime messages from the popup to the page-world engine and back.
 * Injected on demand with the activeTab permission, so Kendo Filler holds no standing
 * access to any site (spec §18: request the minimum permissions required).
 */
(function () {
  'use strict';

  if (window.__KENDO_FILLER_BRIDGE__) return; // survive repeated injection
  window.__KENDO_FILLER_BRIDGE__ = true;

  const REQUEST = 'kendo-filler:request';
  const RESPONSE = 'kendo-filler:response';
  const pending = new Map();
  let seq = 0;

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__kf !== RESPONSE) return;
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    clearTimeout(entry.timer);
    entry.resolve(data);
  });

  function callEngine(action, config, timeoutMs) {
    return new Promise((resolve) => {
      seq += 1;
      const id = 'kf-' + Date.now().toString(36) + '-' + seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({
          ok: false,
          error:
            'The page did not respond in time. The engine may not be injected, or the ' +
            'fill session is taking longer than expected.'
        });
      }, timeoutMs || 120000);
      pending.set(id, { resolve: resolve, timer: timer });
      window.postMessage({ __kf: REQUEST, id: id, action: action, config: config }, '*');
    });
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.target !== 'kendo-filler-bridge') return false;
    callEngine(msg.action, msg.config, msg.timeoutMs).then(sendResponse);
    return true; // async response
  });
})();

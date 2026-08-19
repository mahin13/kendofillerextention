/* Kendo Filler — content.js  (PAGE / MAIN world entry point)
 *
 * This is the last engine file injected into the page world. It exposes the engine over
 * window.postMessage so the isolated-world bridge (bridge.js) can drive it from the popup.
 *
 * Why a bridge at all: chrome.* messaging is not available in the page world, and Kendo
 * widget instances are not reachable from the isolated world. Each side does the half it
 * is allowed to do.
 */
(function () {
  'use strict';

  const KF = (window.__KENDO_FILLER__ = window.__KENDO_FILLER__ || {});
  if (KF.engineReady) return; // do not register a second listener on re-injection

  const REQUEST = 'kendo-filler:request';
  const RESPONSE = 'kendo-filler:response';

  function reply(id, payload) {
    window.postMessage(Object.assign({ __kf: RESPONSE, id: id }, payload), '*');
  }

  window.addEventListener('message', async function (event) {
    // Only same-window messages carrying our own tag are considered.
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__kf !== REQUEST || typeof data.id !== 'string') return;

    try {
      switch (data.action) {
        case 'ping':
          reply(data.id, {
            ok: true,
            result: {
              engine: '1.0.0',
              kendoDetected: KF.kendo.available(),
              kendoVersion: (KF.utils.kendo() && KF.utils.kendo().version) || null,
              url: location.href,
              title: document.title,
              running: !!KF.filler.running
            }
          });
          break;

        case 'inspect':
          reply(data.id, { ok: true, result: KF.filler.inspect(data.config) });
          break;

        case 'autofill': {
          const result = await KF.filler.run(data.config);
          reply(data.id, { ok: result.ok !== false, result: result });
          break;
        }

        default:
          reply(data.id, { ok: false, error: 'Unknown action "' + data.action + '"' });
      }
    } catch (e) {
      reply(data.id, {
        ok: false,
        error: (e && e.message ? e.message : String(e)),
        stack: e && e.stack ? String(e.stack).split('\n').slice(0, 4).join('\n') : null
      });
    }
  });

  KF.engineReady = true;
  // Let the bridge know the engine is live even if it was injected first.
  window.postMessage({ __kf: 'kendo-filler:ready' }, '*');
})();

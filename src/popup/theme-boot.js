/* Kendo Filler — theme-boot.js
 *
 * Runs before the popup's markup is parsed and stamps the chosen theme on <html>, so the
 * panel is painted in the right colours on its very first frame.
 *
 * Why a file and not an inline <script>: an MV3 extension page runs under
 * `script-src 'self'`, which blocks inline script outright — an inline version of this would
 * silently never run.
 *
 * Why localStorage and not the real config: the configuration lives in chrome.storage, which
 * can only be read asynchronously. popup.js mirrors the theme here every time it applies one,
 * so this synchronous read is always in step and a light-theme user never sees a dark flash.
 */
(function () {
  var theme = 'light';
  try {
    theme = localStorage.getItem('kfTheme') || 'light';
  } catch (e) {
    /* storage disabled: fall back to the default theme */
  }
  document.documentElement.dataset.theme = theme;
})();

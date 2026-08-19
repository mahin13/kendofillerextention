/* Kendo Filler — utils.js
 * Runs in the PAGE (MAIN) world so that window.jQuery / window.kendo are reachable.
 * Every engine module hangs off one namespace object to keep page pollution minimal.
 */
(function () {
  'use strict';

  const KF = (window.__KENDO_FILLER__ = window.__KENDO_FILLER__ || {});
  if (KF.utils) return; // already injected into this document

  /* Only genuine "no choice made yet" entries belong here. Values such as None, N/A or
   * All are deliberately NOT treated as placeholders — on real forms they are frequently
   * legitimate records, and skipping them would break "select the first valid record". */
  const PLACEHOLDER_TEXTS = [
    'select', 'select...', 'select ...', '-- select --', '--select--', '- select -',
    'select one', 'select an option', 'please select', 'choose', 'choose...',
    'choose one', '--', '---', '-', ''
  ];

  const SENSITIVE_PATTERN =
    /(pass(word|phrase)?|pwd|secret|token|api[-_ ]?key|apikey|otp|mfa|2fa|cvv|cvc|card[-_ ]?number|ssn|security[-_ ]?(answer|question)|captcha|\bpin\b)/i;

  const utils = {
    PLACEHOLDER_TEXTS,
    SENSITIVE_PATTERN,

    sleep(ms) {
      return new Promise((r) => setTimeout(r, ms));
    },

    /** jQuery instance of the page, if it uses Kendo UI for jQuery. */
    jq() {
      return window.jQuery || window.$ || null;
    },

    kendo() {
      return window.kendo || null;
    },

    hasKendo() {
      const $ = this.jq();
      return !!(window.kendo && $ && $.fn);
    },

    /** Whitespace-collapsed text of a node. */
    text(el) {
      if (!el) return '';
      return (el.textContent || '').replace(/\s+/g, ' ').trim();
    },

    isPlaceholderText(value) {
      const t = String(value == null ? '' : value).replace(/\s+/g, ' ').trim().toLowerCase();
      if (!t) return true;
      if (PLACEHOLDER_TEXTS.indexOf(t) !== -1) return true;
      // "Select Currency", "-- Choose Portfolio --", "Please select a client"
      return /^(-+\s*)?(please\s+)?(select|choose|pick)\b/.test(t) && t.length <= 40;
    },

    /**
     * True only when the control is actually rendered and reachable.
     *
     * CRITICAL for Kendo: a Kendo widget HIDES its original <input>/<select>
     * (style="display:none") and renders a visible wrapper in its place. Judging the
     * original element on its own layout therefore reports every Kendo DropDownList,
     * NumericTextBox, DatePicker and Switch as "hidden". So when the element itself is not
     * rendered we re-test the element that actually represents the field on screen — see
     * fieldFace(). Fields inside a genuinely hidden container (a closed tab, a collapsed
     * panel) still test false, because the wrapper lives in that same hidden subtree.
     */
    isVisible(el) {
      if (!el || !el.isConnected) return false;
      if (el.type === 'hidden') return false;
      if (el.hasAttribute && el.hasAttribute('hidden')) return false;
      if (this.isRendered(el)) return true;
      const face = this.fieldFace(el);
      return face && face !== el ? this.isRendered(face) : false;
    },

    /**
     * Is this specific node laid out and painted?
     *
     * Performance: Element.checkVisibility() (Chrome 105+) answers the whole
     * display/visibility/opacity chain in ONE native call. Walking ancestors with
     * getComputedStyle() is the fallback, and on a form with dozens of Kendo widgets that
     * walk was the single most expensive thing the scanner did.
     */
    isRendered(node) {
      if (!node || !node.isConnected) return false;

      if (typeof node.checkVisibility === 'function') {
        let visible;
        try {
          visible = node.checkVisibility({
            checkOpacity: true,
            checkVisibilityCSS: true,
            contentVisibilityAuto: true
          });
        } catch (e) {
          visible = node.checkVisibility();
        }
        if (!visible) return false;
      } else {
        // Use the node's OWN window: fields may live in a same-origin iframe.
        const view = (node.ownerDocument && node.ownerDocument.defaultView) || window;
        let n = node;
        while (n && n.nodeType === 1) {
          const cs = view.getComputedStyle(n);
          if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
          if (cs.opacity !== '' && parseFloat(cs.opacity) === 0) return false;
          n = n.parentElement;
        }
      }

      const box = node.getBoundingClientRect();
      return box.width > 0 || box.height > 0 || node.getClientRects().length > 0;
    },

    /**
     * The element that visually represents this control:
     *  1. the Kendo widget's own wrapper (authoritative — taken from the widget instance),
     *  2. otherwise the closest Kendo widget container in the DOM,
     *  3. for checkboxes/radios, the label or parent that renders the styled control.
     */
    fieldFace(el) {
      if (!el || el.nodeType !== 1) return null;
      const KF_ = window.__KENDO_FILLER__ || {};
      try {
        if (KF_.kendo && KF_.kendo.available()) {
          const w = KF_.kendo.widgetOf(el);
          const wrapEl = w && ((w.wrapper && w.wrapper[0]) || w.wrapperElement || null);
          if (wrapEl && wrapEl !== el && wrapEl.nodeType === 1) return wrapEl;
        }
      } catch (e) {
        /* fall through to DOM inspection */
      }
      const wrapper = this.kendoWrapper(el);
      if (wrapper && wrapper !== el) return wrapper;

      const type = (el.getAttribute && el.getAttribute('type')) || '';
      if (type === 'checkbox' || type === 'radio') {
        const doc = el.ownerDocument || document;
        const lbl =
          (el.closest && el.closest('label')) ||
          (el.id ? doc.querySelector('label[for="' + this.cssEscape(el.id) + '"]') : null);
        if (lbl) return lbl;
        if (el.parentElement) return el.parentElement;
      }
      return null;
    },

    isDisabled(el) {
      if (!el) return true;
      if (el.disabled === true) return true;
      if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return true;
      if (el.closest && el.closest('fieldset[disabled]')) return true;
      // Kendo marks the WRAPPER disabled, not the hidden original element.
      for (const wrapper of [this.kendoWrapper(el), this.fieldFace(el)]) {
        if (!wrapper || wrapper === el) continue;
        if (
          wrapper.classList &&
          (wrapper.classList.contains('k-disabled') || wrapper.classList.contains('k-state-disabled'))
        ) {
          return true;
        }
        if (wrapper.getAttribute && wrapper.getAttribute('aria-disabled') === 'true') return true;
      }
      return false;
    },

    /* NOTE: Kendo renders DropDownList / DatePicker with a readonly <input> by design,
     * so this test must only be applied to free-text style controls. */
    isReadonly(el) {
      if (!el) return true;
      if (el.readOnly === true) return true;
      if (el.getAttribute && el.getAttribute('aria-readonly') === 'true') return true;
      const wrapper = this.kendoWrapper(el);
      if (wrapper && wrapper !== el && wrapper.classList.contains('k-readonly')) return true;
      return false;
    },

    /**
     * The visible Kendo chrome wrapping a (possibly hidden) input element.
     *
     * Two things this must get right:
     *  - Start from the PARENT. `closest()` includes the element itself, and in older Kendo
     *    themes `k-input` is a class on the <input> — so searching from the element would
     *    return the element itself and defeat every wrapper-based test.
     *  - Return the OUTERMOST widget container within a few levels (Kendo nests
     *    .k-widget > .k-numeric-wrap > input), because the disabled/hidden state is applied
     *    to the outer container.
     */
    kendoWrapper(el) {
      if (!el || !el.parentElement) return null;
      const SELECTOR =
        '.k-widget, .k-picker, .k-dropdown, .k-dropdown-wrap, .k-dropdownlist, .k-combobox,' +
        '.k-numerictextbox, .k-numeric-wrap, .k-datepicker, .k-datetimepicker, .k-timepicker,' +
        '.k-dateinput, .k-switch, .k-switch-container, .k-checkbox-wrap, .k-radio-wrap,' +
        '.k-dropdowntree, .k-multiselect, .k-autocomplete, .k-maskedtextbox,' +
        '.k-textbox-container, .k-input-wrap, .k-textbox, .k-editor, .k-editor-content';
      let node = el.parentElement;
      let outermost = null;
      let hops = 0;
      while (node && node.nodeType === 1 && hops < 6 && node !== node.ownerDocument.body) {
        if (node.matches && node.matches(SELECTOR)) outermost = node;
        node = node.parentElement;
        hops++;
      }
      return outermost;
    },

    /** Closest sensible field container — scopes label lookups and re-scans. */
    container(el) {
      if (!el || !el.closest) return document.body;
      return (
        el.closest(
          '.k-form-field, .form-group, .form-field, .field, .editor-field, .input-group,' +
            '.form-row, .k-edit-field, .form-item, .mb-3, td, li, fieldset'
        ) ||
        el.parentElement ||
        document.body
      );
    },

    /** Label text for a field, via the usual HTML and Kendo relationships. */
    labelFor(el) {
      const pick = (t) => {
        const clean = String(t || '')
          .replace(/ /g, ' ')
          .replace(/\*/g, ' ')
          .replace(/\s*:\s*$/, '')
          .replace(/\s+/g, ' ')
          .trim();
        return clean.length >= 1 && clean.length <= 120 ? clean : '';
      };

      let t = pick(el.getAttribute && el.getAttribute('aria-label'));
      if (t) return t;

      const labelledBy = el.getAttribute && el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const doc = el.ownerDocument || document;
        const parts = labelledBy
          .split(/\s+/)
          .map((id) => doc.getElementById(id))
          .filter(Boolean)
          .map((n) => this.text(n));
        t = pick(parts.join(' '));
        if (t) return t;
      }

      const doc = el.ownerDocument || document;
      const wrapper = this.kendoWrapper(el);
      const ids = [el.id, wrapper && wrapper.id, el.name].filter(Boolean);
      for (const id of ids) {
        const lbl = doc.querySelector('label[for="' + this.cssEscape(id) + '"]');
        if (lbl) {
          t = pick(this.text(lbl));
          if (t) return t;
        }
      }

      const wrapping = el.closest && el.closest('label');
      if (wrapping) {
        t = pick(this.text(wrapping));
        if (t) return t;
      }

      const cont = this.container(el);
      if (cont) {
        const cand = cont.querySelector(
          'label, .k-label, .control-label, .editor-label, .field-label, .form-label, legend'
        );
        if (cand && !cand.contains(el)) {
          t = pick(this.text(cand));
          if (t) return t;
        }
      }

      // Grid / table editors: fall back to the column header.
      const cell = el.closest && el.closest('td');
      if (cell && cell.parentElement) {
        const table = cell.closest('table');
        const idx = Array.prototype.indexOf.call(cell.parentElement.children, cell);
        const th = table && table.querySelectorAll('th')[idx];
        if (th) {
          t = pick(this.text(th));
          if (t) return t;
        }
      }

      return (
        pick(el.getAttribute && el.getAttribute('placeholder')) ||
        pick(el.getAttribute && el.getAttribute('title')) ||
        pick(this.humanise(el.name || el.id))
      );
    },

    humanise(raw) {
      if (!raw) return '';
      return String(raw)
        .replace(/^.*[.$[\]]/, '')
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim();
    },

    cssEscape(v) {
      if (window.CSS && CSS.escape) return CSS.escape(String(v));
      return String(v).replace(/([^\w-])/g, '\\$1');
    },

    /** Stable-per-session logical identity so a field is never processed twice. */
    logicalId(el, extra) {
      if (!el) return 'null';
      if (!el.__kfId) {
        this._seq = (this._seq || 0) + 1;
        const id = 'kf' + this._seq;
        try {
          Object.defineProperty(el, '__kfId', { value: id, enumerable: false, configurable: true });
        } catch (e) {
          el.__kfId = id;
        }
      }
      return extra ? el.__kfId + '|' + extra : el.__kfId;
    },

    describe(el) {
      if (!el) return '<none>';
      const bits = [el.tagName ? el.tagName.toLowerCase() : '?'];
      if (el.type) bits.push('[' + el.type + ']');
      if (el.id) bits.push('#' + el.id);
      else if (el.name) bits.push('@' + el.name);
      return bits.join('');
    },

    /** Documents we may touch: this one plus same-origin iframes. */
    accessibleDocuments() {
      const docs = [document];
      const walk = (doc, depth) => {
        if (depth > 3) return;
        let frames;
        try {
          frames = doc.querySelectorAll('iframe, frame');
        } catch (e) {
          return;
        }
        frames.forEach((f) => {
          let inner = null;
          try {
            inner = f.contentDocument; // null / throws for cross-origin
          } catch (e) {
            inner = null;
          }
          if (inner && inner.body && docs.indexOf(inner) === -1) {
            docs.push(inner);
            walk(inner, depth + 1);
          }
        });
      };
      walk(document, 0);
      return docs;
    },

    debounce(fn, wait) {
      let t = null;
      return function () {
        const args = arguments;
        clearTimeout(t);
        t = setTimeout(() => fn.apply(null, args), wait);
      };
    },

    /** Is this field currently showing a validation error? */
    hasValidationError(el) {
      if (!el) return false;
      const doc = el.ownerDocument || document;
      const wrapper = this.kendoWrapper(el) || el;
      const flagged = (n) =>
        n && n.classList && (n.classList.contains('k-invalid') || n.classList.contains('input-validation-error'));
      if (flagged(wrapper) || flagged(el)) return true;
      if (el.getAttribute && el.getAttribute('aria-invalid') === 'true') return true;

      const name = el.name || el.id;
      if (name) {
        const key = this.cssEscape(name);
        const msg = doc.querySelector('[data-for="' + key + '"], [data-valmsg-for="' + key + '"]');
        if (msg && this.text(msg) && this.isVisible(msg)) return true;
      }
      const cont = this.container(el);
      if (cont) {
        const err = cont.querySelector(
          '.k-form-error, .field-validation-error, .invalid-feedback, .k-tooltip-validation'
        );
        if (err && this.text(err) && this.isVisible(err)) return true;
      }
      return false;
    }
  };

  KF.utils = utils;
})();

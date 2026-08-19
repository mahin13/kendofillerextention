/* Kendo Filler — required-detector.js
 *
 * Spec §4: required status is decided PRIMARILY by the visible '*' marker that belongs
 * to the field's own label, and secondarily by HTML / ARIA / Kendo validation metadata.
 *
 * The hard part is not finding an asterisk — it is proving the asterisk belongs to THIS
 * field. A '*' in a page footnote ("* all times are UTC") must never mark a field
 * required. So we only look inside the field's own label/container relationship, and we
 * ignore asterisks that sit inside a long sentence.
 */
(function () {
  'use strict';

  const KF = (window.__KENDO_FILLER__ = window.__KENDO_FILLER__ || {});
  if (KF.required) return;
  const U = KF.utils;

  /** An asterisk marker is credible when it is short and standalone, not prose. */
  function isMarkerText(raw) {
    const t = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!t) return false;
    if (t.indexOf('*') === -1) return false;
    // Standalone marker: "*", "* ", "(*)", ":*"
    if (/^[\s:()\-]*\*[\s:()\-]*$/.test(t)) return true;
    // Trailing/leading marker on a short label: "Portfolio Name *", "* Currency"
    if (t.length <= 80 && /(^\s*\*\s*\S)|(\S\s*\*\s*$)/.test(t)) return true;
    return false;
  }

  /** Elements conventionally used to render the marker. */
  const MARKER_SELECTOR =
    '.required, .k-required, .required-indicator, .asterisk, .mandatory,' +
    '.text-danger, .req, sup, abbr[title="required"], span[aria-hidden="true"]';

  function labelElementsFor(el) {
    const doc = el.ownerDocument || document;
    const out = [];
    const push = (n) => {
      if (n && out.indexOf(n) === -1) out.push(n);
    };

    const wrapper = U.kendoWrapper(el);
    [el.id, wrapper && wrapper.id, el.name].filter(Boolean).forEach((id) => {
      doc.querySelectorAll('label[for="' + U.cssEscape(id) + '"]').forEach(push);
    });

    const labelledBy = el.getAttribute && el.getAttribute('aria-labelledby');
    if (labelledBy) {
      labelledBy.split(/\s+/).forEach((id) => push(doc.getElementById(id)));
    }

    push(el.closest && el.closest('label'));

    // Label-ish nodes inside the field's own container only.
    const cont = U.container(el);
    if (cont) {
      cont
        .querySelectorAll('label, .k-label, .control-label, .editor-label, .field-label, .form-label, legend')
        .forEach((n) => {
          if (!n.contains(el)) push(n);
        });
    }
    return out;
  }

  const detector = {
    /**
     * @returns {{required: boolean, evidence: string}}
     */
    detect(el) {
      // ---- 1. Explicit metadata (cheap and unambiguous) -------------------
      if (el.required === true || (el.hasAttribute && el.hasAttribute('required'))) {
        return { required: true, evidence: 'required attribute' };
      }
      if (el.getAttribute && el.getAttribute('aria-required') === 'true') {
        return { required: true, evidence: 'aria-required' };
      }
      // ASP.NET MVC / Kendo unobtrusive validation metadata
      if (el.hasAttribute && (el.hasAttribute('data-val-required') || el.hasAttribute('data-required-msg'))) {
        return { required: true, evidence: 'kendo/mvc validation metadata' };
      }
      const wrapper = U.kendoWrapper(el);
      if (wrapper && wrapper !== el) {
        if (wrapper.getAttribute('aria-required') === 'true') {
          return { required: true, evidence: 'aria-required on kendo wrapper' };
        }
        if (wrapper.hasAttribute('data-val-required') || wrapper.hasAttribute('data-required-msg')) {
          return { required: true, evidence: 'kendo validation metadata on wrapper' };
        }
      }
      // Kendo Validator can also be configured through a hidden mirror input.
      if (el.classList && (el.classList.contains('k-required') || el.classList.contains('required'))) {
        return { required: true, evidence: 'required css class' };
      }

      // ---- 2. The visible '*' marker on the field's own label -------------
      const labels = labelElementsFor(el);
      for (const label of labels) {
        // 2a. A dedicated marker element inside the label.
        const marker = label.querySelector(MARKER_SELECTOR);
        if (marker && isMarkerText(U.text(marker)) && U.isVisible(marker)) {
          return { required: true, evidence: 'asterisk marker element in label' };
        }
        // 2b. The asterisk sits in the label text itself.
        if (isMarkerText(U.text(label)) && U.isVisible(label)) {
          return { required: true, evidence: "'*' in label text" };
        }
        // 2c. A marker element rendered as the label's sibling ("Name" + "*").
        for (const sib of [label.nextElementSibling, label.previousElementSibling]) {
          if (
            sib &&
            !sib.contains(el) &&
            sib.children.length === 0 &&
            isMarkerText(U.text(sib)) &&
            U.isVisible(sib)
          ) {
            return { required: true, evidence: "'*' next to label" };
          }
        }
      }

      // 2d. A marker element inside the field container that is not part of any
      //     other field. Only trusted when the container holds a single control.
      const cont = U.container(el);
      if (cont && cont !== document.body) {
        const controls = cont.querySelectorAll('input, select, textarea, [data-role], .k-input-inner');
        if (controls.length <= 3) {
          const markers = cont.querySelectorAll(MARKER_SELECTOR);
          for (const m of markers) {
            if (m.contains(el)) continue;
            if (isMarkerText(U.text(m)) && U.isVisible(m)) {
              return { required: true, evidence: 'asterisk marker in field container' };
            }
          }
        }
      }

      // ---- 3. Unknown → treated as NOT required (spec §4) -----------------
      return { required: false, evidence: 'no required indicator found' };
    }
  };

  KF.required = detector;
})();

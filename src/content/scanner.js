/* Kendo Filler — scanner.js
 *
 * Finds candidate controls (spec §5), de-duplicates the several DOM elements a single
 * Kendo widget produces, groups radio buttons into one logical field (spec §10), and
 * returns normalised field records in DOM order (spec §15).
 */
(function () {
  'use strict';

  const KF = (window.__KENDO_FILLER__ = window.__KENDO_FILLER__ || {});
  if (KF.scanner) return;
  const U = KF.utils;
  const KA = KF.kendo;
  const C = KF.classifier;

  const CANDIDATE_SELECTOR = [
    'input',
    'select',
    'textarea',
    '[data-role]',
    '.k-treeview',
    '.k-treeview-lines',
    '[contenteditable="true"][role="textbox"]'
  ].join(',');

  /* Kendo's own generated, visible-but-not-authoritative inputs. */
  const KENDO_PROXY_HINTS = [
    'k-input-inner',
    'k-formatted-value',
    'k-input-value-text',
    'k-numeric-wrap',
    'k-multiselect-input'
  ];

  const scanner = {
    CANDIDATE_SELECTOR,

    /**
     * @param {Object} opts {root?: Element|Document, includeIframes?: boolean}
     * @returns {Object[]} normalised field records, DOM order
     */
    scan(opts) {
      const o = opts || {};
      // The page-content region is resolved once per scan, not once per field.
      C.resetScanCache();
      const roots = [];
      if (o.root) {
        roots.push(o.root);
      } else if (o.includeIframes === false) {
        roots.push(document);
      } else {
        U.accessibleDocuments().forEach((d) => roots.push(d));
      }

      const fields = [];
      const seenIds = Object.create(null);
      const radioGroups = new Map();

      roots.forEach((root) => {
        let elements;
        try {
          elements = Array.prototype.slice.call(root.querySelectorAll(CANDIDATE_SELECTOR));
        } catch (e) {
          return;
        }
        // A root that is itself a control (re-scan of a single container) must be included.
        if (root.nodeType === 1 && root.matches && root.matches(CANDIDATE_SELECTOR)) elements.unshift(root);

        elements.forEach((el) => {
          if (this.isDuplicate(el)) return;

          const type = (el.getAttribute && (el.getAttribute('type') || '')).toLowerCase();
          if (el.tagName === 'INPUT' && type === 'radio') {
            const key = this.radioGroupKey(el);
            if (!radioGroups.has(key)) {
              radioGroups.set(key, { inputs: [], anchor: el, key: key });
              // Reserve the group's DOM position with a placeholder.
              fields.push({ __radioGroup: key });
            }
            radioGroups.get(key).inputs.push(el);
            return;
          }

          const field = C.build(el);
          if (!field) return;
          if (seenIds[field.id]) return;
          seenIds[field.id] = true;
          fields.push(field);
        });
      });

      // Materialise radio groups in the position they were first seen.
      const out = [];
      fields.forEach((f) => {
        if (f && f.__radioGroup) {
          const g = radioGroups.get(f.__radioGroup);
          if (!g) return;
          const field = C.build(g.anchor, { groupInputs: g.inputs, groupName: g.key });
          if (field && !seenIds[field.id]) {
            seenIds[field.id] = true;
            out.push(field);
          }
          return;
        }
        out.push(f);
      });

      return out;
    },

    /** Radios sharing a name inside the same form are ONE logical field (spec §10). */
    radioGroupKey(el) {
      const doc = el.ownerDocument || document;
      const formId = el.form ? U.logicalId(el.form) : 'nf';
      if (el.name) return 'radio:' + formId + ':' + el.name;
      // Nameless radios: group by the nearest fieldset / container.
      const holder = (el.closest && el.closest('fieldset, .k-form-field, .form-group, .radio-group')) || el.parentElement;
      return 'radio:' + formId + ':' + U.logicalId(holder || doc.body);
    },

    /**
     * A single Kendo widget can expose 2–3 elements (the original input plus generated
     * visible/formatted inputs). Only the element that OWNS the widget instance is
     * authoritative; the rest must be ignored or the same field is filled twice
     * (spec §5: "avoid duplicate filling of the same logical field").
     */
    isDuplicate(el) {
      if (!el || el.nodeType !== 1) return true;

      // The element that owns a widget is always the authoritative one.
      if (KA.available() && KA.widgetOf(el)) return false;

      const cls = el.className && typeof el.className === 'string' ? el.className : '';
      const looksGenerated =
        KENDO_PROXY_HINTS.some((h) => cls.indexOf(h) !== -1) ||
        (el.getAttribute && el.getAttribute('role') === 'combobox') ||
        (el.getAttribute && el.getAttribute('aria-owns') && cls.indexOf('k-') !== -1) ||
        el.getAttribute('aria-expanded') !== null;

      const wrapper = U.kendoWrapper(el);
      if (wrapper) {
        // Does another element inside the same Kendo wrapper own the widget?
        if (KA.available()) {
          const siblings = wrapper.querySelectorAll('input, select, textarea');
          for (const sib of siblings) {
            if (sib === el) continue;
            if (KA.widgetOf(sib)) return true; // that one is authoritative
          }
        }
        if (looksGenerated) return true;

        /* No widget instance to ask (jQuery/kendo not exposed): decide by form identity.
         * A Kendo wrapper holding several inputs has exactly one the form actually posts —
         * it carries the name/id. The extra visible ones Kendo generates (the formatted
         * value of a NumericTextBox, the display input of a DatePicker) are anonymous, so
         * an anonymous input alongside a named one is generated chrome, not a field. */
        const inputs = Array.prototype.slice.call(wrapper.querySelectorAll('input, select, textarea'));
        if (inputs.length > 1) {
          const named = inputs.filter((i) => i.name || i.id);
          if (named.length && named.indexOf(el) === -1) return true;
        }
      }
      if (looksGenerated && cls.indexOf('k-') !== -1) return true;

      // The TreeView root is the widget; its inner checkboxes/inputs are node state and
      // are driven through the TreeView adapter instead.
      if (el.closest && el.closest('.k-treeview, [data-role="treeview"]') && !C.isTreeRoot(el)) return true;

      return false;
    },

    /** Eligible for filling under the given configuration (spec §4, §17). */
    isEligible(field, config) {
      if (!field || field.skipReason) return false;
      const cat = C.categoryOf(field);
      if (!cat) return false;
      const catCfg = config.categories && config.categories[cat];
      if (!catCfg || catCfg.enabled === false) return false;
      if (config.mode === 'required' && !field.required) return false;
      if (config.onlyEmpty && !this.isEmpty(field)) return false;
      return true;
    },

    /** Skip reason to report for an ineligible-but-supported field. */
    ineligibleReason(field, config) {
      if (field.skipReason) return field.skipReason;
      const cat = C.categoryOf(field);
      if (!cat) return 'Unsupported control';
      const catCfg = config.categories && config.categories[cat];
      if (!catCfg || catCfg.enabled === false) return 'Category "' + cat + '" is switched off';
      if (config.mode === 'required' && !field.required) return 'Not a required field (Required Only mode)';
      if (config.onlyEmpty && !this.isEmpty(field)) return 'Field already has a value (Fill only empty fields)';
      return 'Not eligible';
    },

    isEmpty(field) {
      const v = field.currentValue;
      if (field.type === 'checkbox' || field.type === 'toggle') return v !== true;
      if (field.type === 'radio') return !v;
      if (v === null || v === undefined) return true;
      if (v instanceof Date) return false;
      return String(v).trim() === '';
    }
  };

  KF.scanner = scanner;
})();

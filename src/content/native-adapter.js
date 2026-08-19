/* Kendo Filler — native-adapter.js
 *
 * The fallback path used when no Kendo widget instance exists (spec §5, §16).
 *
 * Setting `el.value = x` is not enough for React/Angular/Vue-hosted inputs: React tracks
 * the previous value on the DOM node and will swallow the change, and Angular/Vue only
 * update their model from real input/change events. So we always write through the
 * *native* value setter (bypassing framework value shadowing) and then dispatch the same
 * event sequence a keyboard user produces.
 */
(function () {
  'use strict';

  const KF = (window.__KENDO_FILLER__ = window.__KENDO_FILLER__ || {});
  if (KF.native) return;
  const U = KF.utils;

  /* Prototypes must come from the element's OWN window: an input inside a same-origin
   * iframe is not an instanceof the top window's HTMLInputElement, and calling the wrong
   * realm's setter throws "Illegal invocation". */
  function viewOf(el) {
    return (el.ownerDocument && el.ownerDocument.defaultView) || window;
  }

  function protoOf(el) {
    const view = viewOf(el);
    switch (el.tagName) {
      case 'TEXTAREA':
        return view.HTMLTextAreaElement.prototype;
      case 'SELECT':
        return view.HTMLSelectElement.prototype;
      default:
        return view.HTMLInputElement.prototype;
    }
  }

  function nativeSetter(el) {
    const desc = Object.getOwnPropertyDescriptor(protoOf(el), 'value');
    return desc && desc.set ? desc.set : null;
  }

  function checkedSetter(el) {
    const view = viewOf(el);
    const desc = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'checked');
    return desc && desc.set ? desc.set : null;
  }

  const adapter = {
    /** Dispatch the event sequence frameworks and jQuery validation expect. */
    fireEvents(el, opts) {
      const o = opts || {};
      const win = (el.ownerDocument && el.ownerDocument.defaultView) || window;
      const fire = (type, Ctor, init) => {
        try {
          const C = win[Ctor] || window[Ctor];
          el.dispatchEvent(new C(type, Object.assign({ bubbles: true }, init || {})));
        } catch (e) {
          try {
            const ev = (el.ownerDocument || document).createEvent('HTMLEvents');
            ev.initEvent(type, true, true);
            el.dispatchEvent(ev);
          } catch (e2) {
            /* ignore */
          }
        }
      };

      if (o.keyboard) {
        fire('keydown', 'KeyboardEvent', { key: 'a', cancelable: true });
        fire('keypress', 'KeyboardEvent', { key: 'a', cancelable: true });
      }
      if (o.input !== false) fire('input', 'InputEvent', { cancelable: false });
      if (o.keyboard) fire('keyup', 'KeyboardEvent', { key: 'a', cancelable: true });
      if (o.change !== false) fire('change', 'Event', { cancelable: false });

      // jQuery keeps its own handler queue; a native dispatch does reach it, but
      // jQuery-namespaced handlers bound via .on('change.foo') still need this nudge on
      // some legacy pages.
      const $ = U.jq();
      if ($ && o.jquery !== false) {
        try {
          const $el = $(el);
          if (o.input !== false) $el.trigger('input');
          if (o.change !== false) $el.trigger('change');
        } catch (e) {
          /* ignore */
        }
      }
      if (o.blur) {
        try {
          el.dispatchEvent(new (win.FocusEvent || FocusEvent)('blur', { bubbles: false }));
          fire('focusout', 'FocusEvent');
        } catch (e) {
          /* ignore */
        }
      }
    },

    /** Framework-safe text/number value write. */
    setValue(el, value, opts) {
      const o = opts || {};
      const str = value === null || value === undefined ? '' : String(value);
      try {
        el.focus({ preventScroll: true });
      } catch (e) {
        /* ignore */
      }
      const setter = nativeSetter(el);
      try {
        if (setter) setter.call(el, str);
        else el.value = str;
      } catch (e) {
        return { ok: false, reason: 'Could not write the value: ' + e.message };
      }
      // React 15/16 tracker reset — makes React see a genuine change.
      try {
        if (el._valueTracker && typeof el._valueTracker.setValue === 'function') {
          el._valueTracker.setValue('');
          if (setter) setter.call(el, str);
        }
      } catch (e) {
        /* ignore */
      }

      this.fireEvents(el, { keyboard: o.keyboard !== false, blur: o.blur !== false });

      // Native validation rejection (min/max/pattern/step on the element itself).
      if (typeof el.checkValidity === 'function' && !el.checkValidity()) {
        const msg = el.validationMessage || 'value rejected by native validation';
        // An empty-required complaint means our write did not land at all.
        if (el.value === '' || (el.validity && (el.validity.rangeOverflow || el.validity.rangeUnderflow || el.validity.stepMismatch))) {
          return { ok: false, reason: msg, value: el.value };
        }
      }
      return { ok: true, value: el.value };
    },

    /** Checkbox / switch-like input (spec §8, §9). */
    setChecked(el, checked) {
      if (el.checked === checked) return { ok: true, value: checked, unchanged: true };
      const desc = checkedSetter(el);
      try {
        if (desc) desc.call(el, checked);
        else el.checked = checked;
      } catch (e) {
        return { ok: false, reason: 'Could not toggle: ' + e.message };
      }
      try {
        if (el._valueTracker && typeof el._valueTracker.setValue === 'function') {
          el._valueTracker.setValue(String(!checked));
        }
      } catch (e) {
        /* ignore */
      }
      this.fireEvents(el, { keyboard: false, blur: false });
      if (el.checked !== checked) {
        return { ok: false, reason: 'The page reverted the toggle' };
      }
      return { ok: true, value: el.checked };
    },

    /** Native <select>: first valid non-placeholder enabled option (spec §6). */
    selectFirstOption(el, skip) {
      const skipCount = skip || 0;
      const options = Array.prototype.slice.call(el.options || []);
      const candidates = options.filter((opt) => {
        if (opt.disabled) return false;
        if (opt.parentElement && opt.parentElement.tagName === 'OPTGROUP' && opt.parentElement.disabled) return false;
        if (opt.value === '' || opt.value === null) return false;
        if (U.isPlaceholderText(opt.textContent)) return false;
        return true;
      });
      if (!candidates.length) return { ok: false, reason: 'Dropdown has no selectable options' };
      if (skipCount >= candidates.length) return { ok: false, reason: 'No further selectable options to try' };

      const opt = candidates[skipCount];
      const setter = nativeSetter(el);
      try {
        if (el.multiple) {
          options.forEach((o) => (o.selected = false));
          opt.selected = true;
        } else if (setter) {
          setter.call(el, opt.value);
        } else {
          el.value = opt.value;
        }
      } catch (e) {
        return { ok: false, reason: 'Could not select the option: ' + e.message };
      }
      if (!el.multiple && el.value !== opt.value) {
        el.selectedIndex = options.indexOf(opt);
      }
      this.fireEvents(el, { keyboard: false, blur: false });
      return { ok: true, value: opt.value, text: U.text(opt), index: skipCount };
    },

    /** Radio group: pick one member only (spec §10). */
    selectRadio(inputEl) {
      if (inputEl.checked) {
        this.fireEvents(inputEl, { keyboard: false, blur: false, input: false });
        return { ok: true, value: inputEl.value, unchanged: true };
      }
      try {
        inputEl.click(); // the most compatible way to move a radio group
      } catch (e) {
        /* fall through to manual */
      }
      if (!inputEl.checked) {
        const desc = checkedSetter(inputEl);
        try {
          if (desc) desc.call(inputEl, true);
          else inputEl.checked = true;
        } catch (e) {
          return { ok: false, reason: 'Could not select the radio option: ' + e.message };
        }
        this.fireEvents(inputEl, { keyboard: false, blur: false });
      }
      if (!inputEl.checked) return { ok: false, reason: 'The page reverted the radio selection' };
      return { ok: true, value: inputEl.value };
    },

    /** Content-editable free-form editors. */
    setContentEditable(el, value) {
      try {
        el.focus({ preventScroll: true });
        el.textContent = value;
        this.fireEvents(el, { keyboard: true, blur: true });
        return { ok: true, value: value };
      } catch (e) {
        return { ok: false, reason: 'Could not write into the editor: ' + e.message };
      }
    }
  };

  KF.native = adapter;
})();

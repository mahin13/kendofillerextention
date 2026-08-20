/* Kendo Filler — kendo-adapter.js
 *
 * Everything that talks to a real Kendo widget instance lives here (spec §5, §16, §26).
 *
 * WHY THIS FILE RUNS IN THE PAGE WORLD
 * ------------------------------------
 * Kendo widget instances are stored in jQuery's data cache inside the page's own
 * JavaScript realm. A normal (isolated-world) content script sees a different `window`
 * and can never reach them, so the engine is injected with world: 'MAIN'. That is the
 * only reliable way to call widget.value() / widget.select() instead of faking clicks.
 *
 * TRICKY KENDO POINTS, documented because they are easy to get wrong:
 *  1. `widget.value(x)` deliberately does NOT raise the change event, so nothing
 *     downstream reacts. We must raise it ourselves.
 *  2. Cascading DropDownLists do not listen to `change` — a child bound with
 *     `cascadeFrom` listens to the parent's `cascade` event, which Kendo raises from its
 *     internal `_change()`. So we prefer `_change()` and fall back to raising both
 *     `change` and `cascade`.
 *  3. `widget.select(index)` is popup-index based: when `optionLabel` is configured,
 *     index 0 is the placeholder, not the first record. We therefore select by data item
 *     value and only fall back to index selection.
 *  4. A remote-bound DropDownList has an empty dataSource until it is first opened.
 *     Opening the widget is exactly what a user does, so we open (never calling the
 *     application's API ourselves), wait for dataBound, then close.
 *  5. Kendo hides the original <input>/<select> and shows a wrapper, so visibility and
 *     disabled/readonly tests must consult the wrapper (see utils.js).
 */
(function () {
  'use strict';

  const KF = (window.__KENDO_FILLER__ = window.__KENDO_FILLER__ || {});
  if (KF.kendo) return;
  const U = KF.utils;

  /** Widget role names we know how to drive. */
  const DROPDOWN_WIDGETS = ['DropDownList', 'ComboBox', 'DropDownTree'];
  const NUMERIC_WIDGETS = ['NumericTextBox'];
  const SWITCH_WIDGETS = ['Switch', 'MobileSwitch'];
  const DATE_WIDGETS = ['DatePicker', 'DateTimePicker', 'TimePicker', 'DateInput'];
  const TEXT_WIDGETS = ['MaskedTextBox', 'TextBox', 'TextArea'];
  const UNSUPPORTED_WIDGETS = ['MultiSelect', 'AutoComplete', 'Upload', 'ColorPicker', 'Slider'];
  const EDITOR_WIDGETS = ['Editor'];

  const adapter = {
    DROPDOWN_WIDGETS,
    NUMERIC_WIDGETS,
    SWITCH_WIDGETS,
    DATE_WIDGETS,
    TEXT_WIDGETS,
    EDITOR_WIDGETS,
    UNSUPPORTED_WIDGETS,

    available() {
      return U.hasKendo();
    },

    /** The Kendo widget instance bound to an element, if any. */
    widgetOf(el) {
      const $ = U.jq();
      const k = U.kendo();
      if (!$ || !k || !el) return null;
      try {
        if (typeof k.widgetInstance === 'function') {
          const w = k.widgetInstance($(el));
          if (w && w.options) return w;
        }
      } catch (e) {
        /* keep looking */
      }
      try {
        const data = $(el).data() || {};
        for (const key in data) {
          if (/^kendo/.test(key) && data[key] && data[key].options && data[key].element) return data[key];
        }
      } catch (e) {
        /* ignore */
      }
      return null;
    },

    /** Widget role name, e.g. 'DropDownList'. Falls back to data-role. */
    widgetName(el) {
      const w = this.widgetOf(el);
      if (w && w.options && w.options.name) return w.options.name;
      const role = el && el.getAttribute && el.getAttribute('data-role');
      if (!role) return null;
      // data-role="dropdownlist" -> DropDownList
      const map = {
        dropdownlist: 'DropDownList',
        combobox: 'ComboBox',
        dropdowntree: 'DropDownTree',
        multiselect: 'MultiSelect',
        autocomplete: 'AutoComplete',
        numerictextbox: 'NumericTextBox',
        maskedtextbox: 'MaskedTextBox',
        datepicker: 'DatePicker',
        datetimepicker: 'DateTimePicker',
        timepicker: 'TimePicker',
        dateinput: 'DateInput',
        switch: 'Switch',
        treeview: 'TreeView',
        upload: 'Upload',
        editor: 'Editor',
        slider: 'Slider',
        colorpicker: 'ColorPicker',
        textbox: 'TextBox',
        textarea: 'TextArea',
        checkbox: 'CheckBox'
      };
      return map[String(role).toLowerCase()] || null;
    },

    /* ------------------------------------------------------------------ *
     * Event plumbing
     * ------------------------------------------------------------------ */

    /**
     * Raise the change the application is listening for.
     *
     * For list widgets we go through the widget's own `_change()`, because that is the
     * exact code path a real user selection takes: it raises `change` AND drives the
     * cascade that dependent dropdowns subscribe to.
     *
     * The catch (and the reason for the `_old` juggling below): Kendo deliberately
     * suppresses the change event for programmatic `value()` calls by writing the new
     * value into `widget._old` first, so a plain `_change()` afterwards sees "nothing
     * changed" and fires nothing at all. Resetting `_old` to a value that cannot equal
     * the current one makes Kendo treat our write as a genuine user change.
     */
    raiseChange(widget) {
      const name = (widget.options && widget.options.name) || '';
      const isList = DROPDOWN_WIDGETS.indexOf(name) !== -1;
      let viaInternal = false;

      if (isList && typeof widget._change === 'function') {
        try {
          const current = widget.value();
          const sentinel = String(current) === '' ? '\u0000kf' : '';
          widget._old = sentinel;
          if ('_oldIndex' in widget) widget._oldIndex = -1;
          widget._change();
          viaInternal = true;
        } catch (e) {
          viaInternal = false;
        }
      }

      if (!viaInternal) {
        try {
          widget.trigger('change');
        } catch (e) {
          /* ignore */
        }
        // Cascading children listen to 'cascade', not 'change'.
        try {
          if (typeof widget._triggerCascade === 'function') widget._triggerCascade();
          else if (isList || (widget.options && widget.options.cascadeFrom !== undefined)) {
            widget.trigger('cascade');
          }
        } catch (e) {
          /* ignore */
        }
      }
      // Unobtrusive/jQuery validation listens on the original element.
      try {
        const el = widget.element && widget.element[0] ? widget.element[0] : null;
        if (el) {
          const $ = U.jq();
          if ($) $(el).trigger('change');
          else el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } catch (e) {
        /* ignore */
      }
    },

    /* ------------------------------------------------------------------ *
     * DropDownList / ComboBox / DropDownTree  (spec §6)
     * ------------------------------------------------------------------ */

    /** Data items currently loaded in the widget, flattened for DropDownTree. */
    dataItems(widget) {
      let view = [];
      try {
        const ds = widget.dataSource;
        if (!ds) return [];
        view = (ds.view && ds.view()) || [];
        /* A filterable ("dropdown with search") widget keeps the SEARCH RESULT in view():
         * after any search — including one the user left behind — view() can be empty while
         * every record is still in data(). Reading only view() is what made a dropdown that
         * visibly has records report "no selectable options", so fall back to data(). */
        if (!view.length && typeof ds.data === 'function') view = ds.data() || [];
        view = view.toJSON ? view.slice(0) : Array.prototype.slice.call(view);
      } catch (e) {
        return [];
      }
      // DropDownTree: flatten loaded children so a leaf can be picked.
      const flat = [];
      const walk = (items, depth) => {
        if (!items || depth > 6) return;
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          flat.push(it);
          const kids = it && (it.items || it.children);
          if (kids) {
            const arr = kids.data ? kids.data() : kids;
            if (arr && arr.length) walk(Array.prototype.slice.call(arr), depth + 1);
          }
        }
      };
      walk(view, 0);
      return flat;
    },

    itemText(widget, item) {
      if (item == null) return '';
      const field = widget.options && widget.options.dataTextField;
      if (field && typeof item === 'object') {
        const v = this.getField(item, field);
        return v == null ? '' : String(v);
      }
      return typeof item === 'object' ? String(item.text != null ? item.text : '') : String(item);
    },

    itemValue(widget, item) {
      if (item == null) return '';
      const field = widget.options && widget.options.dataValueField;
      if (field && typeof item === 'object') {
        const v = this.getField(item, field);
        if (v !== undefined && v !== null) return v;
      }
      if (typeof item === 'object' && item.value !== undefined) return item.value;
      return this.itemText(widget, item);
    },

    getField(item, field) {
      if (!item || !field) return undefined;
      if (typeof item.get === 'function') {
        try {
          return item.get(field);
        } catch (e) {
          /* fall through */
        }
      }
      return field.split('.').reduce((o, k) => (o == null ? o : o[k]), item);
    },

    /** A record we are willing to select: enabled, non-placeholder, non-group-header. */
    isSelectableItem(widget, item) {
      if (item == null) return false;
      if (typeof item === 'object') {
        if (item.enabled === false || item.disabled === true || item.selectable === false) return false;
        if (item.hasChildren === true && (widget.options && widget.options.name === 'DropDownTree')) {
          // Parent nodes of a DropDownTree are selectable in Kendo, so allow them —
          // but prefer leaves, which the caller achieves by ordering.
        }
      }
      const text = this.itemText(widget, item);
      if (U.isPlaceholderText(text)) return false;
      const value = this.itemValue(widget, item);
      if (value === '' || value === null || value === undefined) return false;
      return true;
    },

    /**
     * Open the widget, exactly as a user clicking it would, and wait for its list.
     *
     * This is not cosmetic. A DropDownList with autoBind:false, serverFiltering, a cascade
     * parent, or a remote transport holds NO data until it is first opened — its dataSource
     * view is empty and any attempt to pick "the first record" finds nothing. Opening makes
     * the widget perform its own normal read (we never call the application's API
     * ourselves), so the records are present before we select one.
     *
     * @returns {Promise<boolean>} true when the list has at least one record
     */
    async openAndWait(widget, waitMs, opts) {
      const o = opts || {};
      const timeout = waitMs || 4000;
      // Records already loaded: opening is pure flicker and pure delay.
      if (!o.force && this.dataItems(widget).length) return true;
      if (typeof widget.open !== 'function') return this.dataItems(widget).length > 0;

      let bound = false;
      try {
        if (widget.one) widget.one('dataBound', () => (bound = true));
      } catch (e) {
        /* ignore */
      }
      try {
        widget.open();
      } catch (e) {
        return this.dataItems(widget).length > 0;
      }

      const start = Date.now();
      /* A searchable list frequently loads NOTHING on open (serverFiltering + minLength),
       * so waiting out the full remote-read budget only to then type is dead time. */
      const openBudget = this.isFilterable(widget) ? Math.min(700, timeout) : timeout;
      // Leave as soon as records are available; only a remote read costs real time.
      while (Date.now() - start < openBudget) {
        if (this.dataItems(widget).length) break;
        await U.sleep(20);
        if (bound && this.dataItems(widget).length) break;
      }
      // Still nothing and the widget has a search box: it is one of the lists that loads
      // only what is typed. So type, the way a tester does.
      if (!this.dataItems(widget).length && this.isFilterable(widget)) {
        await this.searchForRecords(widget, Math.max(800, timeout - (Date.now() - start)));
      }
      // Only the DOM path needs the popup painted; the API path reads the dataSource.
      if (o.render) await U.sleep(30);
      try {
        if (typeof widget.close === 'function') widget.close();
      } catch (e) {
        /* ignore */
      }
      return this.dataItems(widget).length > 0;
    },

    /** Kept for callers that only want data when the list is empty. */
    async ensureData(widget, waitMs) {
      if (this.dataItems(widget).length) return true;
      return await this.openAndWait(widget, waitMs);
    },

    /* ------------------------------------------------------------------ *
     * Dropdowns WITH A SEARCH BOX
     * ------------------------------------------------------------------ *
     * Two different problems both look like "the dropdown is empty":
     *  - a stale filter leaves dataSource.view() empty (handled in dataItems())
     *  - a serverFiltering list with minLength loads NOTHING until something is typed, so
     *    opening it is not enough.
     * widget.search() is Kendo's own entry point for the search box, so driving it keeps us
     * inside the widget's normal behaviour instead of calling the application's API.
     */

    /** Does this widget show a search / filter box? */
    isFilterable(widget) {
      const o = (widget && widget.options) || {};
      if (o.filter && String(o.filter).toLowerCase() !== 'none') return true;
      if (o.serverFiltering === true) return true;
      try {
        if (widget && widget.filterInput && widget.filterInput.length) return true;
      } catch (e) {
        /* ignore */
      }
      return false;
    },

    /** The search box of a filterable widget, whether Kendo exposes it or not. */
    filterInputOf(widget) {
      try {
        if (widget && widget.filterInput && widget.filterInput[0]) return widget.filterInput[0];
      } catch (e) {
        /* ignore */
      }
      const el = widget && widget.element && widget.element[0];
      const wrapper = (widget && widget.wrapper && widget.wrapper[0]) || (el ? U.kendoWrapper(el) : null);
      return el ? this.domFilterInput(el, wrapper) : null;
    },

    /**
     * Ask the search box for records: first with an empty term (which also clears a filter
     * somebody else left behind), then with a few common letters and digits.
     * @returns {Promise<boolean>} true when records arrived
     */
    async searchForRecords(widget, waitMs) {
      const probes = ['', 'a', 'e', 'o', 'i', 's', '1'];
      const budget = waitMs || 2400;
      const per = Math.max(160, Math.round(budget / probes.length));
      const canSearch = typeof widget.search === 'function';
      const input = canSearch ? null : this.filterInputOf(widget);
      if (!canSearch && !input) return false;

      for (const probe of probes) {
        try {
          if (canSearch) widget.search(probe);
          else if (KF.native) KF.native.setValue(input, probe, { keyboard: true, blur: false });
        } catch (e) {
          continue;
        }
        const start = Date.now();
        while (Date.now() - start < per) {
          if (this.dataItems(widget).length) return true;
          await U.sleep(25);
        }
      }
      return this.dataItems(widget).length > 0;
    },

    /**
     * Select the first valid selectable record (spec §6).
     * `skip` lets the caller retry with the next record when validation rejected the
     * previous one.
     * @returns {Promise<{ok:boolean, reason?:string, text?:string, value?:*, index?:number}>}
     */
    async selectFirstRecord(widget, skip, opts) {
      const o = opts || {};
      const skipCount = skip || 0;

      /* Open the widget when its list is not loaded yet — that is the case that genuinely
       * needs a user-like open (autoBind:false, serverFiltering, cascade child, remote
       * transport). When the records are already in the dataSource, opening only costs time
       * and flicker, so it is skipped unless `alwaysOpen` is set. */
      if (skipCount === 0 && o.openFirst !== false) {
        if (o.alwaysOpen || !this.dataItems(widget).length) {
          await this.openAndWait(widget, 0, { force: !!o.alwaysOpen });
        }
      }

      let items = this.dataItems(widget);
      if (!items.length) {
        await this.ensureData(widget);
        items = this.dataItems(widget);
      }

      const candidates = items.filter((it) => this.isSelectableItem(widget, it));
      if (!candidates.length) {
        /* The dataSource can look empty while the popup is showing records — a widget with a
         * search box bound to a custom source, or a list built from a template. What the
         * tester can see and click, we can click too. */
        const own = widget.element && widget.element[0];
        if (own) {
          const dom = await this.domSelectFirst(own, skipCount);
          if (dom.ok) return dom;
        }
        return { ok: false, reason: 'Dropdown has no selectable options' };
      }
      if (skipCount >= candidates.length) return { ok: false, reason: 'No further selectable options to try' };

      const item = candidates[skipCount];
      const value = this.itemValue(widget, item);
      const text = this.itemText(widget, item);

      let applied = false;
      try {
        widget.value(value);
        // A widget bound to a remote source resolves value() asynchronously, so give the
        // write one turn to land before deciding it failed.
        if (String(widget.value()) !== String(value)) await U.sleep(80);
        applied = String(widget.value()) === String(value);
      } catch (e) {
        applied = false;
      }
      if (!applied) {
        // Fall back to popup-index selection, offsetting the optionLabel placeholder.
        try {
          const offset = widget.options && widget.options.optionLabel ? 1 : 0;
          const idx = items.indexOf(item);
          widget.select(Math.max(0, idx) + offset);
          applied = true;
        } catch (e) {
          applied = false;
        }
      }
      if (!applied) {
        try {
          // DropDownTree and friends accept the data item itself.
          widget.value([value]);
          applied = true;
        } catch (e) {
          return { ok: false, reason: 'Kendo widget rejected the value' };
        }
      }

      this.raiseChange(widget);
      return { ok: true, text: text, value: value, index: skipCount };
    },

    /* ------------------------------------------------------------------ *
     * TreeView  (spec §7)
     * ------------------------------------------------------------------ */

    /** Visible, loaded, selectable nodes in DOM order. */
    treeNodes(widget) {
      const $ = U.jq();
      const root = widget && widget.element && widget.element[0];
      if (!root) return [];
      const items = Array.prototype.slice.call(root.querySelectorAll('li.k-item, li.k-treeview-item'));
      return items.filter((li) => {
        if (!U.isVisible(li)) return false;
        if (li.classList.contains('k-disabled') || li.classList.contains('k-state-disabled')) return false;
        if (li.getAttribute('aria-disabled') === 'true') return false;
        const content = li.querySelector(':scope > div > .k-in, :scope > .k-in, :scope > div > .k-treeview-leaf');
        if (!content) return false;
        // Purely structural / non-selectable nodes carry no text.
        if (!U.text(content)) return false;
        if (content.classList.contains('k-disabled')) return false;
        const dataItem = widget.dataItem ? widget.dataItem(li) : null;
        if (dataItem && (dataItem.enabled === false || dataItem.selectable === false)) return false;
        return true;
      });
    },

    /** Select the first valid node (spec §7). */
    selectFirstNode(widget, skip) {
      const $ = U.jq();
      const nodes = this.treeNodes(widget);
      const skipCount = skip || 0;
      if (!nodes.length) return { ok: false, reason: 'TreeView has no selectable nodes' };
      if (skipCount >= nodes.length) return { ok: false, reason: 'No further selectable nodes to try' };
      const li = nodes[skipCount];

      try {
        widget.select(li);
      } catch (e) {
        return { ok: false, reason: 'Kendo TreeView rejected the selection: ' + e.message };
      }

      // Kendo's select() is silent, so raise the events the application expects.
      try {
        widget.trigger('select', { node: li });
      } catch (e) {
        /* ignore */
      }
      try {
        widget.trigger('change');
      } catch (e) {
        /* ignore */
      }

      // Checkbox-enabled trees drive their state from the checkbox, not the selection.
      const box = li.querySelector(':scope > div > .k-checkbox-wrapper input[type=checkbox], :scope > div > input[type=checkbox], :scope > input[type=checkbox]');
      if (box && !box.checked && !U.isDisabled(box)) {
        try {
          box.checked = true;
          if ($) $(box).trigger('change');
          else box.dispatchEvent(new Event('change', { bubbles: true }));
          widget.trigger('check', { node: li });
        } catch (e) {
          /* ignore */
        }
      }

      const content = li.querySelector(':scope > div > .k-in, :scope > .k-in, :scope > div > .k-treeview-leaf');
      return { ok: true, text: U.text(content), index: skipCount };
    },

    /* ------------------------------------------------------------------ *
     * NumericTextBox  (spec §11, §12)
     * ------------------------------------------------------------------ */

    numericConstraints(widget) {
      const o = (widget && widget.options) || {};
      const c = {};
      if (o.min !== null && o.min !== undefined && isFinite(o.min)) c.min = Number(o.min);
      if (o.max !== null && o.max !== undefined && isFinite(o.max)) c.max = Number(o.max);
      if (o.step !== null && o.step !== undefined && isFinite(o.step)) c.step = Number(o.step);
      if (Number.isInteger(o.decimals)) c.decimals = o.decimals;
      else if (o.format && /(\{0:)?[nNcCpP](\d)/.test(String(o.format))) {
        const m = String(o.format).match(/[nNcCpP](\d)/);
        if (m) c.decimals = parseInt(m[1], 10);
      }
      if (o.restrictDecimals && Number.isInteger(o.decimals)) c.decimals = o.decimals;
      return c;
    },

    setNumeric(widget, value) {
      try {
        widget.value(value);
      } catch (e) {
        return { ok: false, reason: 'Numeric value rejected by the widget: ' + e.message };
      }
      const applied = widget.value();
      if (applied === null || applied === undefined || isNaN(applied)) {
        return { ok: false, reason: 'Numeric value rejected by min/max' };
      }
      this.raiseChange(widget);
      return { ok: true, value: applied };
    },

    /* ------------------------------------------------------------------ *
     * Switch  (spec §9)
     * ------------------------------------------------------------------ */

    setSwitch(widget, on) {
      try {
        if (typeof widget.check === 'function') {
          if (widget.check() === on) return { ok: true, value: on, unchanged: true };
          widget.check(on);
        } else if (typeof widget.toggle === 'function') {
          widget.toggle(on);
        } else if (typeof widget.value === 'function') {
          widget.value(on);
        } else {
          return { ok: false, reason: 'Kendo Switch API not available' };
        }
      } catch (e) {
        return { ok: false, reason: 'Kendo Switch rejected the value: ' + e.message };
      }
      try {
        widget.trigger('change', { checked: on });
      } catch (e) {
        /* ignore */
      }
      try {
        const el = widget.element && widget.element[0];
        if (el) {
          const $ = U.jq();
          if ($) $(el).trigger('change');
          else el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } catch (e) {
        /* ignore */
      }
      return { ok: true, value: on };
    },

    /* ------------------------------------------------------------------ *
     * Date / time pickers  (spec §13)
     * ------------------------------------------------------------------ */

    dateConstraints(widget) {
      const o = (widget && widget.options) || {};
      const c = {};
      if (o.min instanceof Date) c.min = o.min;
      if (o.max instanceof Date) c.max = o.max;
      return c;
    },

    setDate(widget, date) {
      try {
        widget.value(date);
      } catch (e) {
        return { ok: false, reason: 'Date rejected by the widget: ' + e.message };
      }
      const applied = widget.value();
      if (!applied) return { ok: false, reason: 'Date rejected by min/max' };
      this.raiseChange(widget);
      const k = U.kendo();
      let text = String(applied);
      try {
        if (k && k.toString) text = k.toString(applied, (widget.options && widget.options.format) || 'd');
      } catch (e) {
        /* ignore */
      }
      return { ok: true, value: text };
    },

    /* ------------------------------------------------------------------ *
     * MaskedTextBox / TextBox
     * ------------------------------------------------------------------ */

    setText(widget, value) {
      try {
        widget.value(value);
      } catch (e) {
        return { ok: false, reason: 'Text rejected by the widget: ' + e.message };
      }
      this.raiseChange(widget);
      return { ok: true, value: widget.value() };
    },

    /* ------------------------------------------------------------------ *
     * DOM-only fallbacks: used when the widget INSTANCE cannot be reached
     * ------------------------------------------------------------------ *
     * A page can render perfectly normal Kendo markup while keeping jQuery/kendo out of
     * `window` (bundled, or jQuery.noConflict(true)). The widget objects then live in a
     * scope nothing can reach, so every API call above is unavailable. Rather than skip the
     * whole form, we recognise the widget by its markup and drive it the way a user does:
     * click to open, click the first record (spec §5 "fall back to native DOM interaction").
     */

    /** Identify a Kendo control from its markup alone. */
    shapeOf(el) {
      const wrapper = U.kendoWrapper(el);
      if (!wrapper) return null;
      const has = (sel) => wrapper.matches(sel) || !!wrapper.closest(sel);
      if (has('.k-dropdownlist, .k-dropdown, .k-combobox, .k-dropdowntree')) {
        return { kind: 'dropdown', wrapper: wrapper, name: 'DropDownList (DOM)' };
      }
      if (has('.k-numerictextbox')) return { kind: 'numeric', wrapper: wrapper, name: 'NumericTextBox (DOM)' };
      if (has('.k-switch, .k-switch-container')) return { kind: 'toggle', wrapper: wrapper, name: 'Switch (DOM)' };
      if (has('.k-datetimepicker')) return { kind: 'datetime', wrapper: wrapper, name: 'DateTimePicker (DOM)' };
      if (has('.k-timepicker')) return { kind: 'time', wrapper: wrapper, name: 'TimePicker (DOM)' };
      if (has('.k-datepicker, .k-dateinput')) return { kind: 'date', wrapper: wrapper, name: 'DatePicker (DOM)' };
      if (has('.k-maskedtextbox')) return { kind: 'masked', wrapper: wrapper, name: 'MaskedTextBox (DOM)' };
      if (has('.k-editor')) return { kind: 'editor', wrapper: wrapper, name: 'Editor (DOM)' };
      if (has('.k-multiselect')) return { kind: 'multiselect', wrapper: wrapper, name: 'MultiSelect (DOM)' };
      if (has('.k-autocomplete')) return { kind: 'autocomplete', wrapper: wrapper, name: 'AutoComplete (DOM)' };
      if (has('.k-picker')) return { kind: 'dropdown', wrapper: wrapper, name: 'Picker (DOM)' };
      return null;
    },

    /**
     * The VISIBLE input Kendo renders next to the hidden original.
     * For a NumericTextBox that is `.k-formatted-value`; the user's keystrokes go there and
     * Kendo copies the parsed result into the original element.
     */
    visibleProxyInput(el) {
      const wrapper = U.kendoWrapper(el);
      if (!wrapper) return null;
      const candidates = wrapper.querySelectorAll('input');
      for (const c of candidates) {
        if (c === el) continue;
        if (c.type === 'hidden') continue;
        if (U.isRendered(c)) return c;
      }
      return null;
    },

    /** Full mouse sequence — Kendo opens its popup on mousedown, not on click alone. */
    pressElement(node) {
      const view = (node.ownerDocument && node.ownerDocument.defaultView) || window;
      const fire = (type, Ctor) => {
        try {
          const C = view[Ctor] || window[Ctor];
          node.dispatchEvent(new C(type, { bubbles: true, cancelable: true, view: view, button: 0 }));
        } catch (e) {
          /* ignore */
        }
      };
      fire('pointerdown', 'PointerEvent');
      fire('mousedown', 'MouseEvent');
      fire('pointerup', 'PointerEvent');
      fire('mouseup', 'MouseEvent');
      try {
        node.click();
      } catch (e) {
        fire('click', 'MouseEvent');
      }
    },

    /** The popup list belonging to this widget, if it is currently on screen. */
    findPopupList(el, wrapper) {
      const doc = el.ownerDocument || document;
      const ids = [
        wrapper && wrapper.getAttribute('aria-owns'),
        wrapper && wrapper.getAttribute('aria-controls'),
        el.getAttribute && el.getAttribute('aria-owns'),
        el.getAttribute && el.getAttribute('aria-controls')
      ].filter(Boolean);
      for (const raw of ids) {
        for (const id of String(raw).split(/\s+/)) {
          const node = doc.getElementById(id);
          if (node && U.isRendered(node)) return node.closest('.k-list-container, .k-popup, .k-animation-container') || node;
        }
      }
      // Otherwise: the one visible dropdown list on the page.
      const lists = doc.querySelectorAll('.k-list-container, .k-popup .k-list, .k-animation-container .k-list');
      for (const l of lists) {
        if (U.isRendered(l)) return l;
      }
      return null;
    },

    /** Selectable <li> records inside an open popup list. */
    popupItems(list) {
      if (!list) return [];
      const items = Array.prototype.slice.call(
        list.querySelectorAll('li.k-item, li.k-list-item, .k-list-item, li[role="option"]')
      );
      return items.filter((li) => {
        if (!U.isRendered(li)) return false;
        if (li.classList.contains('k-disabled') || li.classList.contains('k-state-disabled')) return false;
        if (li.getAttribute('aria-disabled') === 'true') return false;
        if (li.classList.contains('k-group-header') || li.classList.contains('k-list-group-item')) return false;
        if (li.classList.contains('k-list-optionlabel')) return false; // the placeholder row
        // "No data found" template, and anything that belongs to the search box itself.
        if (li.closest('.k-nodata, .k-no-data, .k-list-filter, .k-searchbox')) return false;
        const text = U.text(li);
        if (!text || U.isPlaceholderText(text)) return false;
        return true;
      });
    },

    /** Text currently displayed by the widget's visible face. */
    displayedText(wrapper) {
      if (!wrapper) return '';
      const face = wrapper.querySelector('.k-input-value-text, .k-input-inner, .k-input, .k-textbox');
      if (face) {
        if (face.tagName === 'INPUT') return String(face.value || '');
        return U.text(face);
      }
      return U.text(wrapper);
    },

    /**
     * The search box of a "dropdown with search", found from markup alone.
     *
     * Kendo renders it inside the popup (.k-list-filter / .k-searchbox in newer themes, a
     * bare .k-textbox in the older ones); a ComboBox instead uses its own visible input.
     * It is deliberately NOT treated as a form field elsewhere (classifier: widget chrome) —
     * here we type into it on purpose, because that is the only way some lists ever load.
     */
    domFilterInput(el, wrapper) {
      const usable = (i) => {
        if (!i || i.tagName !== 'INPUT') return false;
        if (i.type === 'hidden' || i.readOnly || i.disabled) return false;
        return U.isRendered(i);
      };
      const pick = (root) => {
        if (!root) return null;
        const inputs = root.querySelectorAll(
          '.k-list-filter input, .k-searchbox input, input.k-textbox, input[type="search"], input[type="text"], input:not([type])'
        );
        for (const i of inputs) {
          if (usable(i)) return i;
        }
        return null;
      };
      const list = this.findPopupList(el, wrapper);
      return pick(list) || pick(wrapper);
    },

    /**
     * A searchable list can be empty until something is typed (serverFiltering + minLength).
     * Try a few characters and take whatever the list comes back with.
     * @returns {Promise<Element[]>} popup records, empty when the search found nothing
     */
    async domSearchForItems(el, wrapper, list) {
      const input = this.domFilterInput(el, wrapper);
      if (!input) return [];
      const N = KF.native;
      if (!N) return [];
      for (const probe of ['a', 'e', 'o', 's', '1']) {
        // No blur: blurring would close the popup we are reading from.
        N.setValue(input, probe, { keyboard: true, blur: false, change: false });
        const start = Date.now();
        while (Date.now() - start < 700) {
          await U.sleep(35);
          const found = this.popupItems(this.findPopupList(el, wrapper) || list);
          if (found.length) return found;
        }
      }
      return [];
    },

    /**
     * Open the dropdown by clicking it and select the first valid record — the pure-DOM
     * path used when the widget instance is unreachable.
     */
    async domSelectFirst(el, skip) {
      const skipCount = skip || 0;
      const wrapper = U.kendoWrapper(el);
      if (!wrapper) return { ok: false, reason: 'Kendo widget not available and no wrapper found' };

      const before = this.displayedText(wrapper);
      const opener =
        wrapper.querySelector('.k-select, .k-input-button, .k-button, .k-icon, .k-i-arrow-60-down') ||
        wrapper.querySelector('.k-dropdown-wrap, .k-input-inner') ||
        wrapper;

      this.pressElement(opener);

      /* Wait for the popup to render — testing BEFORE each sleep, so a local list (the
       * common case) costs one tick instead of a fixed 70ms. */
      let list = null;
      let items = [];
      let grace = 700;
      const start = Date.now();
      while (Date.now() - start < 3000) {
        list = this.findPopupList(el, wrapper);
        items = this.popupItems(list);
        if (items.length) break;
        if (list) {
          // A popup with a search box is entitled to show nothing yet — stop waiting for
          // records that will only arrive once something is typed.
          if (grace === 700 && this.domFilterInput(el, wrapper)) grace = 150;
          if (Date.now() - start > grace) break;
        }
        await U.sleep(25);
      }
      if (!list) {
        return { ok: false, reason: 'Dropdown did not open (no popup list found)' };
      }
      if (!items.length) {
        // A dropdown with a search box may hold nothing until a term is typed.
        items = await this.domSearchForItems(el, wrapper, list);
      }
      if (!items.length) {
        this.pressElement(opener); // close again
        return { ok: false, reason: 'Dropdown has no selectable options' };
      }
      if (skipCount >= items.length) {
        this.pressElement(opener);
        return { ok: false, reason: 'No further selectable options to try' };
      }

      const item = items[skipCount];
      const text = U.text(item);
      this.pressElement(item);

      // Confirm the widget actually took the value — poll briefly instead of a flat wait.
      let after = '';
      const clicked = Date.now();
      while (Date.now() - clicked < 320) {
        after = this.displayedText(wrapper);
        if (after && after !== before) break;
        await U.sleep(25);
      }
      /* Leave the page as we found it: a popup still standing (some searchable lists keep
       * theirs open after a click) would sit over the next field and confuse its lookup. */
      const stillOpen = this.findPopupList(el, wrapper);
      if (stillOpen && U.isRendered(stillOpen)) this.pressElement(opener);

      if (after && after !== before) return { ok: true, text: text || after, value: after };
      if (el.value !== undefined && String(el.value) !== '' && !U.isPlaceholderText(String(el.value))) {
        return { ok: true, text: text || String(el.value), value: el.value };
      }
      return { ok: false, reason: 'Clicked "' + text + '" but the dropdown did not change' };
    },

    /**
     * Write a value into a Kendo-shaped numeric/text control without its API: put it in the
     * VISIBLE input (which is where a user types, and what Kendo parses on change) and also
     * into the hidden original, so the posted value is right either way.
     */
    domSetValue(el, value) {
      const N = KF.native;
      const proxy = this.visibleProxyInput(el);
      let wrote = false;
      let shown = null;

      if (proxy) {
        const res = N.setValue(proxy, value, { keyboard: true, blur: true });
        wrote = res.ok;
        shown = res.value;
      }
      // The original is hidden, so skip the focus/keyboard theatre — just set and notify.
      const orig = N.setValue(el, value, { keyboard: false, blur: false });
      wrote = wrote || orig.ok;
      if (!wrote) return { ok: false, reason: orig.reason || 'Could not write the value' };
      return { ok: true, value: shown !== null && shown !== undefined ? shown : orig.value };
    },

    /** Toggle a Kendo Switch by clicking it (no API available). */
    domToggle(el, on) {
      const wrapper = U.kendoWrapper(el) || el;
      const isOn = () =>
        el.checked === true ||
        wrapper.classList.contains('k-switch-on') ||
        wrapper.classList.contains('k-switch-checked') ||
        wrapper.getAttribute('aria-checked') === 'true';
      if (isOn() === on) return { ok: true, value: on, unchanged: true };
      this.pressElement(wrapper.querySelector('.k-switch-container, .k-switch-handle') || wrapper);
      if (isOn() === on) return { ok: true, value: on };
      // Clicking the chrome did not take: drive the underlying checkbox directly.
      const res = KF.native.setChecked(el, on);
      if (res.ok && isOn() !== on) return { ok: false, reason: 'The switch did not change state' };
      return res;
    },

    /**
     * Guess the display format of a date control from whatever it already shows, so a
     * DOM-only fill writes text the application can parse (07/11/2039 -> dd/MM/yyyy).
     */
    domDateText(el, date) {
      const V = KF.values;
      const proxy = this.visibleProxyInput(el) || el;
      const existing = String(proxy.value || el.value || '').trim();
      const p = (n) => String(n).padStart(2, '0');
      const dd = p(date.getDate());
      const mm = p(date.getMonth() + 1);
      const yyyy = date.getFullYear();

      let m = existing.match(/^(\d{1,2})([/.\-])(\d{1,2})\2(\d{4})/);
      if (m) {
        const sep = m[2];
        // Ambiguous when both parts are <= 12; dd/MM is the Kendo default in most locales.
        const first = Number(m[1]);
        const third = Number(m[3]);
        if (first > 12 && third <= 12) return [dd, mm, yyyy].join(sep);
        if (third > 12) return [mm, dd, yyyy].join(sep);
        return [dd, mm, yyyy].join(sep);
      }
      m = existing.match(/^(\d{4})([/.\-])(\d{1,2})\2(\d{1,2})/);
      if (m) return [yyyy, mm, dd].join(m[2]);

      return V.isoDate(date); // nothing to copy: ISO is the safest neutral form
    },

    /* ------------------------------------------------------------------ *
     * Kendo Editor — the rich text / "HTML box"
     * ------------------------------------------------------------------ *
     * Markup (classic mode), which is what `Html.Kendo().Editor()` renders:
     *
     *   <div class="k-widget k-editor">
     *     <ul class="k-editor-toolbar">…</ul>
     *     <iframe class="k-editor-content">   <-- contenteditable BODY inside
     *     <textarea id="Description" name="Description" style="display:none">
     *   </div>
     *
     * The value the form posts lives in the hidden <textarea>, but what the user sees is the
     * iframe body (or, in inline mode, a contenteditable div). So a DOM-only fill has to write
     * to BOTH: the visible body, so the tester sees it, and the textarea, so a save posts it.
     * With the widget available, `editor.value(html)` does both correctly.
     */

    /** Is this element the hidden textarea/div behind a Kendo Editor? */
    isEditorElement(el) {
      if (!el || !el.closest) return false;
      return !!el.closest('.k-editor');
    },

    /** The contenteditable surface a user actually types into. */
    editorBody(el) {
      const wrapper = el.closest && el.closest('.k-editor');
      if (!wrapper) return null;
      // Classic mode: an iframe whose body is contenteditable (same-origin, so reachable).
      const frame = wrapper.querySelector('iframe');
      if (frame) {
        try {
          const doc = frame.contentDocument;
          if (doc && doc.body) return doc.body;
        } catch (e) {
          /* unreachable frame: fall through to inline mode */
        }
      }
      // Inline mode: a contenteditable element inside the widget.
      return wrapper.querySelector('[contenteditable="true"], .k-editor-content[contenteditable]');
    },

    /** Set content through the widget API (keeps the textarea and the view in step). */
    setEditor(widget, html) {
      try {
        widget.value(html);
      } catch (e) {
        return { ok: false, reason: 'Editor rejected the value: ' + e.message };
      }
      try {
        widget.trigger('change');
      } catch (e) {
        /* ignore */
      }
      // Kendo only syncs the textarea on blur/change, so make sure it holds the value.
      try {
        const el = widget.element && widget.element[0];
        if (el && 'value' in el && !el.value) el.value = html;
      } catch (e) {
        /* ignore */
      }
      const applied = (() => {
        try {
          return widget.value();
        } catch (e) {
          return html;
        }
      })();
      return { ok: true, value: this.plainText(applied) };
    },

    /** DOM-only editor fill: visible body + hidden textarea, with the events Kendo expects. */
    domSetEditor(el, html) {
      const body = this.editorBody(el);
      let wrote = false;

      if (body) {
        try {
          body.innerHTML = html;
          const view = (body.ownerDocument && body.ownerDocument.defaultView) || window;
          ['input', 'keyup', 'change', 'blur'].forEach((type) => {
            try {
              body.dispatchEvent(new (view.Event || Event)(type, { bubbles: true }));
            } catch (e) {
              /* ignore */
            }
          });
          wrote = true;
        } catch (e) {
          wrote = false;
        }
      }

      // The hidden textarea is what the form posts.
      if (el && 'value' in el) {
        const res = KF.native.setValue(el, html, { keyboard: false, blur: false });
        wrote = wrote || res.ok;
      }
      if (!wrote) return { ok: false, reason: 'Could not write into the editor' };
      return { ok: true, value: this.plainText(html) };
    },

    /** Readable one-line summary of HTML content, for the diagnostics list. */
    plainText(html) {
      const s = String(html || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return s.slice(0, 80);
    },

    /** A MaskedTextBox needs digits/letters that fit its mask, not a label. */
    maskedValueFor(widget) {
      const mask = String((widget.options && widget.options.mask) || '');
      if (!mask) return null;
      const rules = (widget.options && widget.options.rules) || {};
      let out = '';
      for (const ch of mask) {
        switch (ch) {
          case '0':
          case '9':
            out += String(KF.values.randomInt(0, 9));
            break;
          case '#':
            out += String(KF.values.randomInt(0, 9));
            break;
          case 'L':
          case '?':
            out += 'ABCDEFGHJKLMNPQRSTUVWXYZ'[KF.values.randomInt(0, 23)];
            break;
          case 'A':
          case 'a':
            out += 'ABCDEFGHJKLMNPQRSTUVWXYZ'[KF.values.randomInt(0, 23)];
            break;
          case '&':
          case 'C':
            out += 'X';
            break;
          default:
            if (rules[ch]) out += String(KF.values.randomInt(0, 9));
            else out += ch; // literal
        }
      }
      return out;
    }
  };

  KF.kendo = adapter;
})();

/* Kendo Filler — classifier.js
 *
 * Turns a DOM element into the normalised field record described in spec §20, and applies
 * the safety/skip rules of spec §17. Nothing here changes the page.
 */
(function () {
  'use strict';

  const KF = (window.__KENDO_FILLER__ = window.__KENDO_FILLER__ || {});
  if (KF.classifier) return;
  const U = KF.utils;
  const KA = KF.kendo;

  /* Containers whose inputs are unambiguously widget chrome, never form fields: dropdown
   * list popups, calendars, grid filter/column menus, pagers, search bars. Filling these
   * would fight the UI rather than fill the form. */
  const CHROME_CONTAINERS =
    '.k-list-container, .k-list, .k-calendar, .k-calendar-container, .k-filter-menu,' +
    '.k-column-menu, .k-grid-toolbar, .k-grid-filter, .k-pager, .k-pager-wrap, .k-grid-search,' +
    '.k-multiselect-wrap, .k-searchbar, .k-list-filter, .k-dropdowngrid-popup,' +
    '.k-treeview.k-dropdowntree-popup, [data-role="pager"]';

  /* Ambiguous popups: `.k-animation-container` / `.k-popup` hold dropdown lists AND, in
   * many applications, whole edit forms rendered inside a Kendo Window. Skipping them
   * blindly would make every field of a modal form invisible to the extension, so these
   * are only treated as chrome when they contain no real form content. */
  const POPUP_CONTAINERS = '.k-animation-container, .k-popup';
  /* `.k-content` is deliberately NOT here: Kendo puts it on its own popups, so treating it
   * as evidence of a form would let dropdown/tree popups be mistaken for editable forms. */
  const POPUP_FORM_CONTENT =
    'form, .k-window-content, .k-edit-form-container, .k-form, .modal-body';

  /* Application shell — navigation bars, side menus, headers, breadcrumbs, tab strips.
   * Controls in here (global search, menu filters, page-size pickers) are navigation, not
   * form data, and filling them navigates or re-queries the page.
   * NOTE: `.k-header` is deliberately absent — old Kendo puts that class on the DropDownList
   * wrapper itself, so matching it would skip real fields. */
  const SHELL_CONTAINERS =
    // Generic
    'nav, aside, header, footer, [role="navigation"], [role="menubar"], [role="banner"],' +
    '.navbar, .nav, .navigation, .nav-bar, .topbar, .top-bar, .app-header, .masthead,' +
    '.sidebar, .side-bar, .sidenav, .side-nav, .side-menu, .sidemenu, .main-menu, .menu-bar,' +
    '.breadcrumb, .dropdown-menu, .navbar-collapse,' +
    '.k-breadcrumb, .k-menu, .k-panelbar, .k-toolbar, .k-appbar, .k-drawer,' +
    '.k-tabstrip-items, .k-tabstrip-items-wrapper,' +
    '#sidebar, #navbar, #nav, #header, #menu, #mainNav, #sideMenu,' +
    // Shell containers used by this Bootstrap/Metronic-style admin layout. Class names such
    // as `sidebar-container` and `left-sidemenu` do NOT match `.sidebar`/`.side-menu`, so
    // they have to be listed explicitly.
    '.page-header, .page-header-inner, .page-logo, .top-menu, #nav-bar-section,' +
    '.sidebar-container, .sidemenu-container, .left-sidemenu, #sidbar,' +
    '.chat-sidebar-container, .chat-sidebar, .quick-sidebar, .quick-setting,' +
    '.page-footer, .page-footer-inner, #sticky-footer';

  /* The region that holds the actual page form. When one is identifiable, ANY control
   * outside it is shell by definition — that catches navigation and side panels whatever
   * they are called, which is far more reliable than enumerating class names. */
  const MAIN_CONTAINERS =
    'main, [role="main"], .page-content-wrapper, .page-content, #page-body-content,' +
    '.main-content, #main-content, .content-wrapper, .app-content, #content';

  /* Dialogs are legitimately rendered outside the content region (Kendo appends them to
   * <body>), so they are always in scope. */
  const DIALOG_CONTAINERS =
    '.k-window, .k-window-content, .k-dialog, .k-edit-form-container, .modal, [role="dialog"]';

  /* Global search / filter boxes: they re-query the page rather than hold form data.
   * Matched on the WHOLE identifier or caption, so real fields such as "Search Criteria
   * Name" or a column called "Filter Set" are not swept up with them. */
  const SCOPE = '(?:global|quick|page|grid|top|main|nav|site)';
  const SUFFIX = '(?:box|bar|text|term|input|field|str|value)';
  const SEARCH_IDENT = new RegExp(
    '^(?:(?:txt|inp|input|fld|field)[_-]?)?(?:' +
      // "search", "txtSearch", "globalSearch", "searchTerm"
      '(?:' + SCOPE + '[_-]?)?search' + SUFFIX + '?' +
      // "filter"/"lookup" alone is too often a real field name, so it needs a scope or suffix
      '|' + SCOPE + '[_-]?(?:filter|lookup)' + SUFFIX + '?' +
      '|(?:filter|lookup)' + SUFFIX +
      ')$',
    'i'
  );
  const SEARCH_TEXT =
    /^\s*(global\s+|quick\s+|page\s+|site\s+)?(search|filter|find|lookup)(\s+here|\s+records|\s+results)?\s*(\.{2,}|…|:)?\s*$/i;

  /** Fields whose category is deliberately out of scope for v1 (spec §30). */
  const OUT_OF_SCOPE_WIDGETS = {
    MultiSelect: 'MultiSelect is planned for a later release',
    AutoComplete: 'AutoComplete is planned for a later release',
    Upload: 'File upload controls are never filled',
    ColorPicker: 'ColorPicker is planned for a later release',
    Slider: 'Slider is planned for a later release'
  };

  const DECIMAL_LABEL_HINT =
    /(amount|price|rate|value|percent|pct|weight|ratio|fee|cost|nav|yield|factor|spread|total|balance|decimal|coupon|premium|notional|fx|return|score)/i;

  const classifier = {
    CHROME_CONTAINERS,
    SHELL_CONTAINERS,
    MAIN_CONTAINERS,

    /* Resolving the content region touches the whole document, so it is memoised and reset
     * once per scan by scanner.scan(). */
    _mainCache: new Map(),

    resetScanCache() {
      this._mainCache = new Map();
    },

    /**
     * The outermost credible page-content region: rendered, and actually containing form
     * controls. Returns null when the page has no recognisable content wrapper, in which
     * case only the class-based shell rules apply.
     */
    mainRegion(doc) {
      const d = doc || document;
      if (this._mainCache.has(d)) {
        const cached = this._mainCache.get(d);
        // A cached region that has been detached would exclude the entire page.
        if (!cached || cached.isConnected) return cached;
      }
      let found = null;
      let nodes = [];
      try {
        nodes = d.querySelectorAll(MAIN_CONTAINERS);
      } catch (e) {
        nodes = [];
      }
      for (const n of nodes) {
        // Never accept a "content region" that is itself part of the navigation shell.
        if (n.closest && n.closest(SHELL_CONTAINERS)) continue;
        if (!n.querySelector('input, select, textarea, [data-role]')) continue;
        if (!U.isRendered(n)) continue;
        found = n; // document order: the outermost match wins, which is the safest choice
        break;
      }
      this._mainCache.set(d, found);
      return found;
    },

    /**
     * Elements we must never touch, whatever the mode (spec §17).
     * @param {Element} el
     * @param {string} [label] pre-computed label, so it is not resolved twice per field
     */
    hardSkip(el, label) {
      if (!el || el.nodeType !== 1) return 'not an element';
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute && (el.getAttribute('type') || '')).toLowerCase();

      if (tag === 'button') return 'button';
      if (tag === 'input' && ['submit', 'reset', 'button', 'image', 'file'].indexOf(type) !== -1) {
        return type + ' control is never filled';
      }
      // A Kendo widget can be built ON a hidden input (MVC DropDownListFor, cascading and
      // searchable pickers). The widget is visible, so that is a real field — see
      // utils.isKendoOriginal(). Tokens and row ids have no Kendo chrome and stay skipped.
      if (type === 'hidden' && !U.isKendoOriginal(el)) return 'hidden input';
      if (el.closest && el.closest(CHROME_CONTAINERS)) return 'widget chrome, not a form field';
      // Navigation shell: sidebar, navbar, header, breadcrumbs, tab strip, settings panels.
      // `data-kf-fill` is the escape hatch for a real form that genuinely lives in one.
      const optedIn = el.closest && el.closest('[data-kf-fill], .kf-fill');
      if (!optedIn && el.closest) {
        if (el.closest(SHELL_CONTAINERS)) return 'navigation / sidebar control';

        /* Structural rule: when the page has an identifiable content region, anything
         * outside it is navigation/side panel whatever it is called. Dialogs are exempt —
         * Kendo renders them at <body> level, outside every content wrapper. */
        const main = this.mainRegion(el.ownerDocument || document);
        if (main && !main.contains(el) && !el.closest(DIALOG_CONTAINERS)) {
          return 'outside the page content area (navigation / sidebar)';
        }
      }
      if (el.closest) {
        const popup = el.closest(POPUP_CONTAINERS);
        if (popup) {
          const isDialog = popup.querySelector(DIALOG_CONTAINERS);
          const isWidgetPopup = popup.querySelector(
            '.k-list, .k-treeview, .k-calendar, .k-time-list, .k-columnmenu-item-wrapper'
          );
          const hasForm = popup.querySelector(POPUP_FORM_CONTENT);
          // A popup holding a list/tree/calendar is a widget's own popup — never a form.
          // The universal-search DropDownTree is exactly this case, and picking a record in
          // it would navigate the application.
          if (!isDialog && (isWidgetPopup || !hasForm)) {
            return 'widget chrome, not a form field';
          }
        }
      }
      if (el.closest && el.closest('[data-kf-ignore], .kf-ignore')) return 'explicitly ignored';

      /* The editing surface of a Kendo Editor (its contenteditable body, whether inline or
       * inside the widget's iframe) is filled through the editor itself, so it must not be
       * picked up as a field in its own right. */
      // Test the attribute, not `isContentEditable`: the property is unreliable outside a
      // full layout engine, and the attribute is what the markup actually carries.
      const ce = el.getAttribute && el.getAttribute('contenteditable');
      const editable = el.isContentEditable === true || (ce !== null && ce !== 'false');
      if (editable && el.closest && el.closest('.k-editor')) {
        return 'rich text editor body (filled through the editor)';
      }
      const frameEl =
        el.ownerDocument && el.ownerDocument.defaultView && el.ownerDocument.defaultView.frameElement;
      if (frameEl && frameEl.closest && frameEl.closest('.k-editor')) {
        return 'rich text editor body (filled through the editor)';
      }

      // Search / filter boxes re-query the page instead of holding data.
      if (type === 'search') return 'search / filter control';
      const captions = [
        el.getAttribute && el.getAttribute('placeholder'),
        el.getAttribute && el.getAttribute('aria-label'),
        el.getAttribute && el.getAttribute('title')
      ].filter(Boolean);
      const idents = [el.name, el.id].filter(Boolean);
      if (captions.some((s) => SEARCH_TEXT.test(s)) || idents.some((s) => SEARCH_IDENT.test(s))) {
        return 'search / filter control';
      }

      // Sensitive fields are off by default (spec §13, §17).
      if (type === 'password') return 'password field skipped by safety rules';
      const idish = [
        el.name,
        el.id,
        el.getAttribute && el.getAttribute('autocomplete'),
        label === undefined ? U.labelFor(el) : label
      ]
        .filter(Boolean)
        .join(' ');
      if (U.SENSITIVE_PATTERN.test(idish)) return 'sensitive field skipped by safety rules';

      return null;
    },

    /** Kendo TreeView roots on the page. */
    isTreeRoot(el) {
      if (!el || el.nodeType !== 1) return false;
      if (el.getAttribute && el.getAttribute('data-role') === 'treeview') return true;
      if (el.classList && (el.classList.contains('k-treeview') || el.classList.contains('k-treeview-lines'))) {
        return true;
      }
      return false;
    },

    /** Is this checkbox actually a Kendo Switch / ARIA switch? */
    isSwitch(el, widgetName) {
      if (widgetName && KA.SWITCH_WIDGETS.indexOf(widgetName) !== -1) return true;
      if (el.getAttribute && el.getAttribute('role') === 'switch') return true;
      const w = el.closest && el.closest('.k-switch, .k-mobile-switch, .k-switch-container');
      if (w) return true;
      const dataRole = el.getAttribute && el.getAttribute('data-role');
      if (dataRole && dataRole.toLowerCase() === 'switch') return true;
      // Common non-Kendo switch markup: <input type=checkbox class="form-check-input" role=switch>
      // or a wrapper marked .switch / .toggle.
      const wrap = el.closest && el.closest('.switch, .toggle, .form-switch, .slider-switch');
      return !!wrap;
    },

    /** Numeric constraints from native attributes. */
    nativeNumericConstraints(el) {
      const c = {};
      const min = el.getAttribute && el.getAttribute('min');
      const max = el.getAttribute && el.getAttribute('max');
      const step = el.getAttribute && el.getAttribute('step');
      if (min !== null && min !== '' && isFinite(Number(min))) c.min = Number(min);
      if (max !== null && max !== '' && isFinite(Number(max))) c.max = Number(max);
      if (step && step !== 'any' && isFinite(Number(step))) {
        c.step = Number(step);
        const dot = String(step).indexOf('.');
        if (dot !== -1) c.decimals = String(step).length - dot - 1;
        else c.decimals = 0;
      }
      return c;
    },

    lengthConstraints(el) {
      const c = {};
      const maxLength = el.maxLength;
      if (typeof maxLength === 'number' && maxLength > 0 && maxLength < 524288) c.maxLength = maxLength;
      const minLength = el.minLength;
      if (typeof minLength === 'number' && minLength > 0) c.minLength = minLength;
      return c;
    },

    /** Resolve the decimal precision a Kendo NumericTextBox will accept. */
    resolveDecimals(widget, el, label) {
      const c = KA.numericConstraints(widget);
      if (Number.isInteger(c.decimals)) return { decimals: c.decimals, known: true };
      const fmt = String((widget.options && widget.options.format) || '');
      if (/^\{?0?:?[#,0]+\}?$/.test(fmt) && fmt.indexOf('.') === -1) return { decimals: 0, known: true };
      if (Number.isInteger(widget.options && widget.options.decimals)) {
        return { decimals: widget.options.decimals, known: true };
      }
      // No explicit precision. Kendo's default numeric format allows 2 decimals, so a
      // decimal value is legal — but an integer is legal for BOTH, so we only choose
      // "decimal" when something about the field suggests fractional data.
      const step = c.step;
      const current = widget.value && widget.value();
      const fractional =
        (isFinite(step) && step > 0 && step < 1) ||
        (typeof current === 'number' && !Number.isInteger(current)) ||
        DECIMAL_LABEL_HINT.test(label || '');
      return { decimals: fractional ? 2 : 0, known: false, fractional: fractional };
    },

    /**
     * Build the normalised field record.
     * @param {Element} el          control element (for radios: the group's first input)
     * @param {Object} [extra]      {groupInputs, groupName}
     * @returns {Object|null}
     */
    build(el, extra) {
      const ex = extra || {};
      const label = U.labelFor(el);
      const hard = this.hardSkip(el, label);
      const widget = KA.available() ? KA.widgetOf(el) : null;
      let widgetName = KA.available() ? KA.widgetName(el) : null;

      /* No widget instance reachable (jQuery/kendo not exposed on window, or the widget was
       * created in a private scope) — recognise the control from its markup instead so it
       * can still be driven through the DOM. */
      let shape = null;
      if (!widget) {
        shape = KA.shapeOf(el);
        if (shape && !widgetName) widgetName = shape.name;
      }

      const field = {
        id: U.logicalId(el, ex.groupName || ''),
        element: el,
        elementDesc: U.describe(el),
        label: label,
        type: null,
        kendoWidgetType: widgetName || null,
        widget: widget || null,
        required: false,
        requiredEvidence: '',
        visible: U.isVisible(el),
        disabled: U.isDisabled(el),
        readonly: false,
        currentValue: null,
        container: U.container(el),
        constraints: {},
        groupInputs: ex.groupInputs || null,
        groupName: ex.groupName || null,
        dependencyParent: null,
        processed: false,
        skipReason: hard || null
      };

      if (hard) return field;

      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();

      if (widgetName && OUT_OF_SCOPE_WIDGETS[widgetName]) {
        field.type = 'unsupported';
        field.skipReason = OUT_OF_SCOPE_WIDGETS[widgetName];
        return field;
      }

      /* ---------------- Kendo TreeView ---------------- */
      if (this.isTreeRoot(el)) {
        field.type = 'tree';
        field.kendoWidgetType = 'TreeView';
        field.readonly = false;
        field.currentValue = (() => {
          try {
            const w = KA.widgetOf(el);
            const sel = w && w.select && w.select();
            return sel && sel.length ? U.text(sel[0]) : null;
          } catch (e) {
            return null;
          }
        })();
      } else if (ex.groupName || type === 'radio') {
        /* ---------------- Radio group ---------------- */
        field.type = 'radio';
        const inputs = field.groupInputs || [el];
        const checked = inputs.filter((i) => i.checked)[0];
        field.currentValue = checked ? checked.value : null;
        field.visible = inputs.some((i) => U.isVisible(i));
        field.disabled = inputs.every((i) => U.isDisabled(i));
      } else if (widgetName && KA.DROPDOWN_WIDGETS.indexOf(widgetName) !== -1) {
        /* ---------------- Kendo DropDownList / ComboBox / DropDownTree ----------
         * Checked BEFORE plain <select>: a Kendo DropDownList is frequently built on a
         * <select>, and driving that select natively would change the value without ever
         * updating the widget the user sees. */
        field.type = 'dropdown';
        field.currentValue = widget ? widget.value() : el.value;
      } else if (tag === 'select') {
        /* ---------------- Native select ---------------- */
        field.type = 'dropdown';
        field.currentValue = el.value;
        field.readonly = false;
      } else if (type === 'checkbox' || (widgetName === 'CheckBox' && tag === 'input')) {
        /* ---------------- Checkbox vs Switch ---------------- */
        if (this.isSwitch(el, widgetName)) {
          field.type = 'toggle';
          field.kendoWidgetType = widgetName || field.kendoWidgetType;
        } else {
          field.type = 'checkbox';
        }
        field.currentValue = el.checked;
      } else if (widgetName && KA.SWITCH_WIDGETS.indexOf(widgetName) !== -1) {
        field.type = 'toggle';
        field.currentValue = widget && widget.check ? widget.check() : el.checked;
      } else if (widgetName && KA.NUMERIC_WIDGETS.indexOf(widgetName) !== -1) {
        /* ---------------- Kendo NumericTextBox: numeric or decimal -------------- */
        const c = KA.numericConstraints(widget);
        const res = this.resolveDecimals(widget, el, label);
        field.constraints = Object.assign({}, c, { decimals: res.decimals });
        field.constraints.precisionKnown = res.known;
        field.type = res.decimals > 0 ? 'decimal' : 'numeric';
        field.currentValue = widget ? widget.value() : el.value;
      } else if (widgetName && KA.DATE_WIDGETS.indexOf(widgetName) !== -1) {
        /* ---------------- Kendo date/time pickers ---------------- */
        field.type =
          widgetName === 'TimePicker' ? 'time' : widgetName === 'DateTimePicker' ? 'datetime' : 'date';
        field.constraints = KA.dateConstraints(widget);
        field.currentValue = widget ? widget.value() : el.value;
      } else if (widgetName === 'Editor' || (shape && shape.kind === 'editor')) {
        /* ---------------- Kendo Editor: the rich text / "HTML box" --------------
         * The hidden <textarea> is what the form posts; the visible surface is an iframe
         * body (classic mode) or a contenteditable div (inline mode). Both are written. */
        field.type = 'editor';
        field.kendoWidgetType = widgetName || (shape && shape.name) || 'Editor';
        field.readonly = false;
        field.currentValue = widget
          ? (function () {
              try {
                return widget.value();
              } catch (e) {
                return el.value;
              }
            })()
          : el.value;
        const body = KA.editorBody(el);
        if (body && !U.text(body) && !field.currentValue) field.currentValue = '';
        // These editors are usually paired with a live character counter ("0/2000"), which
        // is the only place the limit is expressed — the markup carries no maxlength.
        const limit = this.counterLimit(el);
        if (limit) field.constraints = { maxLength: limit };
      } else if (widgetName === 'MaskedTextBox') {
        field.type = 'masked';
        field.readonly = U.isReadonly(el);
        field.currentValue = el.value;
      } else if (shape) {
        /* ---------------- Kendo markup, no reachable widget instance ------------
         * Recognised from the wrapper's classes; driven through the DOM by the filler. */
        field.kendoWidgetType = shape.name;
        field.currentValue = el.value !== undefined ? el.value : null;
        switch (shape.kind) {
          case 'dropdown':
            field.type = 'dropdown';
            break;
          case 'numeric': {
            // Precision is not discoverable without the API, but the value the control is
            // already showing usually reveals it: "0.000000" means 6 decimal places.
            const shown = String(
              (KA.visibleProxyInput(el) && KA.visibleProxyInput(el).value) || el.value || ''
            );
            const m = shown.match(/[.,](\d+)\s*%?$/);
            const decimals = m ? Math.min(10, m[1].length) : DECIMAL_LABEL_HINT.test(label) ? 2 : 0;
            field.constraints = { decimals: decimals, precisionKnown: !!m };
            field.type = decimals > 0 ? 'decimal' : 'numeric';
            break;
          }
          case 'toggle':
            field.type = 'toggle';
            field.currentValue = el.checked;
            break;
          case 'date':
          case 'datetime':
          case 'time':
            field.type = shape.kind;
            break;
          case 'masked':
            field.type = 'masked';
            break;
          default:
            field.type = 'unsupported';
            field.skipReason = shape.name.replace(' (DOM)', '') + ' is planned for a later release';
        }
      } else if (tag === 'textarea') {
        field.type = 'textarea';
        field.constraints = this.lengthConstraints(el);
        field.readonly = U.isReadonly(el);
        field.currentValue = el.value;
      } else if (tag === 'input') {
        /* ---------------- Native inputs ---------------- */
        field.readonly = U.isReadonly(el);
        field.currentValue = el.value;
        const numeric = this.nativeNumericConstraints(el);
        switch (type) {
          case 'number':
            field.constraints = numeric;
            field.type = numeric.decimals > 0 || el.getAttribute('step') === 'any' ? 'decimal' : 'numeric';
            if (field.type === 'decimal' && !Number.isInteger(field.constraints.decimals)) {
              field.constraints.decimals = 2;
            }
            break;
          case 'range':
            field.constraints = numeric;
            field.type = 'unsupported';
            field.skipReason = 'Slider/range input is planned for a later release';
            break;
          case 'email':
            field.type = 'email';
            field.constraints = this.lengthConstraints(el);
            break;
          case 'url':
            field.type = 'url';
            field.constraints = this.lengthConstraints(el);
            break;
          case 'tel':
            field.type = 'tel';
            field.constraints = this.lengthConstraints(el);
            break;
          case 'date':
            field.type = 'date';
            field.constraints = this.nativeDateConstraints(el);
            break;
          case 'time':
            field.type = 'time';
            break;
          case 'datetime-local':
            field.type = 'datetime';
            field.constraints = this.nativeDateConstraints(el);
            break;
          case 'month':
            field.type = 'month';
            break;
          case 'week':
            field.type = 'week';
            break;
          case 'color':
            field.type = 'unsupported';
            field.skipReason = 'ColorPicker is planned for a later release';
            break;
          case 'text':
          case 'search':
          case '':
            field.type = 'text';
            field.constraints = this.lengthConstraints(el);
            // A Kendo widget may exist without us recognising the role; keep it visible
            // in diagnostics so odd markup is debuggable.
            if (widgetName && KA.TEXT_WIDGETS.indexOf(widgetName) === -1 && widgetName !== 'CheckBox') {
              field.kendoWidgetType = widgetName;
            }
            break;
          default:
            field.type = 'unsupported';
            field.skipReason = 'Input type "' + type + '" is not supported';
        }
      } else if (el.isContentEditable && el.getAttribute('role') === 'textbox') {
        field.type = 'textarea';
        field.currentValue = U.text(el);
      } else {
        field.type = 'unsupported';
        field.skipReason = 'Unrecognised control';
      }

      /* ---------------- required / eligibility ---------------- */
      const req = KF.required.detect(el);
      field.required = req.required;
      field.requiredEvidence = req.evidence;
      if (!field.required && field.groupInputs) {
        for (const input of field.groupInputs) {
          const r = KF.required.detect(input);
          if (r.required) {
            field.required = true;
            field.requiredEvidence = r.evidence;
            break;
          }
        }
      }

      if (!field.skipReason) {
        if (!field.visible) field.skipReason = 'Field is hidden';
        else if (field.disabled) field.skipReason = 'Field is disabled';
        else if (field.readonly && ['text', 'textarea', 'email', 'url', 'tel', 'masked'].indexOf(field.type) !== -1) {
          field.skipReason = 'Field is readonly';
        }
      }
      return field;
    },

    /** Character limit taken from a live counter next to the field, e.g. "0/2000". */
    counterLimit(el) {
      const cont = U.container(el);
      if (!cont) return 0;
      const nodes = cont.querySelectorAll('label, span, small, div');
      for (const n of nodes) {
        if (n.contains(el)) continue;
        const m = U.text(n).match(/^\s*\d+\s*\/\s*(\d{1,6})\s*$/);
        if (m) {
          const limit = parseInt(m[1], 10);
          if (limit > 0) return limit;
        }
      }
      return 0;
    },

    nativeDateConstraints(el) {
      const c = {};
      const parse = (v) => {
        if (!v) return null;
        const d = new Date(v);
        return isNaN(d.getTime()) ? null : d;
      };
      const min = parse(el.getAttribute('min'));
      const max = parse(el.getAttribute('max'));
      if (min) c.min = min;
      if (max) c.max = max;
      return c;
    },

    /** Category key used by the popup toggles (spec §3.2). */
    categoryOf(field) {
      switch (field.type) {
        case 'dropdown':
          return 'dropdown';
        case 'tree':
          return 'tree';
        case 'checkbox':
          return 'checkbox';
        case 'toggle':
          return 'toggle';
        case 'radio':
          return 'radio';
        case 'numeric':
          return 'numeric';
        case 'decimal':
          return 'decimal';
        case 'text':
        case 'textarea':
        case 'email':
        case 'url':
        case 'tel':
        case 'masked':
        case 'date':
        case 'datetime':
        case 'time':
        case 'month':
        case 'week':
        case 'editor':
          return 'freeform';
        default:
          return null;
      }
    },

    /** Driver fields can reveal dependent fields, so we wait after changing them. */
    isDriver(field) {
      return ['dropdown', 'tree', 'radio', 'toggle', 'checkbox'].indexOf(field.type) !== -1;
    }
  };

  KF.classifier = classifier;
})();

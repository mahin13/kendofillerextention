/* Kendo Filler — filler.js
 *
 * The fill session: the multi-pass algorithm of spec §15, the conditional/dependent field
 * handling of spec §14, the per-field error isolation of spec §24 and the performance
 * bounds of spec §25.
 *
 * The session never clicks Save/Submit, never navigates, and never calls application APIs
 * itself (spec §16, §17).
 */
(function () {
  'use strict';

  const KF = (window.__KENDO_FILLER__ = window.__KENDO_FILLER__ || {});
  if (KF.filler) return;
  const U = KF.utils;
  const KA = KF.kendo;
  const C = KF.classifier;
  const S = KF.scanner;
  const V = KF.values;
  const N = KF.native;

  const YES_PATTERN = /^(yes|y|true|1|on|enabled?|active|available|allow(ed)?|include[d]?|si|oui)$/i;
  const NO_PATTERN = /^(no|n|false|0|off|disabled?|inactive|unavailable|deny|denied|exclude[d]?|none)$/i;
  const DESTRUCTIVE_PATTERN = /(delete|remove|purge|wipe|reset|discard|terminate|cancel\s+all|drop)/i;

  /* Failures that are worth trying again on a later pass — typically a cascading dropdown
   * or tree whose records only exist once its parent has a value. */
  const RETRYABLE_FAILURE =
    /no selectable options|no selectable nodes|Kendo widget not available|became hidden|removed from the page/i;
  const MAX_FIELD_ATTEMPTS = 3;

  /** Skip reasons that can never change during this session. */
  function isPermanentSkip(reason) {
    if (!reason) return false;
    return (
      /never filled|not supported|later release|Unrecognised control|widget chrome|navigation \/ sidebar|search \/ filter|hidden input|explicitly ignored|button$|safety rules|Category ".*" is switched off|Required Only mode/i.test(
        reason
      ) || /^Input type/.test(reason)
    );
  }

  const filler = {
    running: false,

    defaultConfig() {
      return {
        mode: 'all', // 'all' | 'required'
        onlyEmpty: false,
        maxPasses: 10,
        highlight: false,
        timeBudgetMs: 60000,
        categories: {
          // openFirst: open the widget like a user before picking, so lists that only load
          // on first open (autoBind:false, serverFiltering, cascades) have records.
          dropdown: { enabled: true, openFirst: true },
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
    },

    mergeConfig(cfg) {
      const base = this.defaultConfig();
      const out = Object.assign({}, base, cfg || {});
      out.categories = Object.assign({}, base.categories);
      const incoming = (cfg && cfg.categories) || {};
      Object.keys(base.categories).forEach((k) => {
        out.categories[k] = Object.assign({}, base.categories[k], incoming[k] || {});
      });
      return out;
    },

    /**
     * Run one fill session.
     * @returns {Promise<Object>} structured summary + diagnostics (spec §23, §24)
     */
    async run(rawConfig) {
      if (this.running) {
        return { ok: false, error: 'A fill session is already running on this page' };
      }
      this.running = true;

      const config = this.mergeConfig(rawConfig);
      const started = Date.now();
      const watcher = KF.watcher.create(U.accessibleDocuments());
      const processed = new Set(); // logical ids we will never revisit
      const filled = [];
      const failures = [];
      const pendingSkips = new Map(); // id -> {label,type,reason} (may resolve in a later pass)
      const detected = new Set();
      const attempts = new Map(); // id -> how many records already tried
      let passes = 0;
      let aborted = null;

      /* A session must never outlive the page it was started on. If the application
       * navigates (or a single-page app swaps the view) while we are still filling, the
       * session stops instead of writing into whatever the user has just landed on. */
      const startUrl = location.href;
      const navigatedAway = () => location.href !== startUrl;

      if (config.categories.conditional.enabled) watcher.start();

      try {
        let roots = [null]; // null = full document scan (pass 1)
        while (passes < Math.max(1, config.maxPasses)) {
          passes++;
          if (Date.now() - started > config.timeBudgetMs) {
            aborted = 'Time budget reached after ' + passes + ' passes';
            break;
          }
          if (navigatedAway()) {
            aborted = 'The page navigated away — session stopped';
            break;
          }

          // ---- 1. Scan ---------------------------------------------------
          let fields = [];
          const seenInPass = new Set();
          for (const root of roots) {
            const found = S.scan(root ? { root: root } : {});
            found.forEach((f) => {
              if (seenInPass.has(f.id)) return; // Set lookup, not an O(n²) array scan
              seenInPass.add(f.id);
              fields.push(f);
            });
          }
          // Records classified just now are still accurate as long as nothing has mutated
          // since, which lets the fill loop skip a second full classification per field.
          const scanMutations = watcher.mutationCount;

          // ---- 2. Classify + record detection ----------------------------
          const workable = [];
          fields.forEach((f) => {
            if (processed.has(f.id)) return;
            const cat = C.categoryOf(f);
            const supported = !!cat && f.type !== 'unsupported';
            if (supported && !isPermanentSkip(f.skipReason)) detected.add(f.id);

            if (S.isEligible(f, config)) {
              workable.push(f);
              return;
            }
            const reason = S.ineligibleReason(f, config);
            if (isPermanentSkip(reason) || !supported) {
              processed.add(f.id);
              if (supported) {
                pendingSkips.set(f.id, { label: f.label, type: f.type, reason: reason });
              }
            } else {
              // Might become fillable after a dependency renders — keep it pending.
              pendingSkips.set(f.id, { label: f.label, type: f.type, reason: reason });
            }
          });

          if (!workable.length) {
            // Nothing to do in this pass. Give the page one last scoped look only if the
            // previous pass produced mutations.
            const settle = config.categories.conditional.enabled
              ? await watcher.waitForSettle({ quietMs: 150, timeoutMs: 400, minWait: 0 })
              : { mutated: false };
            const dirty = config.categories.conditional.enabled ? watcher.takeDirty() : [];
            if (!settle.mutated && !dirty.length) break;
            roots = dirty.length ? this.dedupeRoots(dirty) : [null];
            continue;
          }

          // ---- 3. Fill in DOM order, drivers first (spec §15) --------------
          // Stable partition: driver fields (dropdown/tree/radio/toggle/checkbox) keep
          // their DOM order but run before dependents, so a cascade parent is always set
          // before the child dropdown that is waiting on it.
          const ordered = workable
            .map((f, i) => ({ f: f, i: i, driver: C.isDriver(f) ? 0 : 1 }))
            .sort((a, b) => a.driver - b.driver || a.i - b.i)
            .map((x) => x.f);
          let filledDriverThisPass = false;

          for (const field of ordered) {
            if (Date.now() - started > config.timeBudgetMs) {
              aborted = 'Time budget reached while filling';
              break;
            }
            if (navigatedAway()) {
              aborted = 'The page navigated away — session stopped';
              break;
            }
            if (processed.has(field.id)) continue;

            // Re-validate immediately before filling — the DOM may have moved on.
            if (!field.element || !field.element.isConnected) {
              pendingSkips.set(field.id, {
                label: field.label,
                type: field.type,
                reason: 'Field was removed from the page before it could be filled'
              });
              processed.add(field.id);
              continue;
            }
            /* Re-classify only when the DOM has actually changed since the scan. With the
             * observer running we know that for certain; without it (conditional filling
             * off) we re-check to stay safe. */
            const stale = !watcher.running || watcher.mutationCount !== scanMutations;
            const fresh = stale
              ? C.build(field.element, { groupInputs: field.groupInputs, groupName: field.groupName })
              : field;
            if (!S.isEligible(fresh, config)) {
              const reason = S.ineligibleReason(fresh, config);
              pendingSkips.set(field.id, {
                label: fresh.label,
                type: fresh.type,
                reason: reason === 'Field is hidden' ? 'Field became hidden before fill' : reason
              });
              if (isPermanentSkip(reason)) processed.add(field.id);
              continue;
            }

            // Capture the mutation cursor BEFORE the write, and remember the widget's own
            // markup, so the field's private churn (a Kendo Switch flipping classes and
            // animating its handle) is not mistaken for a dependency rendering.
            const seqBeforeFill = watcher.seq;
            const fieldFace = U.fieldFace(fresh.element) || U.kendoWrapper(fresh.element) || fresh.element;

            let result;
            try {
              result = await this.fillField(fresh, config, attempts);
            } catch (e) {
              result = { ok: false, reason: 'Unexpected error: ' + (e && e.message ? e.message : String(e)) };
            }

            // A dependent dropdown is legitimately empty until its parent is filled, so a
            // "nothing to select" answer must NOT retire the field — it is retried on a
            // later pass (capped, so a permanently empty list cannot spin).
            if (!result.ok && RETRYABLE_FAILURE.test(result.reason || '')) {
              const tries = (attempts.get(field.id) || 0) + 1;
              attempts.set(field.id, tries);
              if (tries < MAX_FIELD_ATTEMPTS) {
                pendingSkips.set(field.id, {
                  label: fresh.label,
                  type: fresh.type,
                  reason: result.reason + ' — retrying after dependencies are filled'
                });
                continue; // leave it out of `processed`
              }
            }

            processed.add(field.id);
            pendingSkips.delete(field.id);

            const record = {
              id: field.id,
              label: fresh.label || '(no label)',
              type: fresh.type,
              category: C.categoryOf(fresh),
              required: fresh.required,
              element: fresh.elementDesc,
              kendo: fresh.kendoWidgetType || null,
              value: result.ok ? this.displayValue(result.value) : null,
              reason: result.ok ? null : result.reason
            };
            if (result.ok) {
              filled.push(record);
              if (C.isDriver(fresh)) filledDriverThisPass = true;
              if (config.highlight) this.highlight(fresh.element);
            } else {
              failures.push(record);
            }

            // ---- 4. Let dependent UI render (spec §14) -------------------
            // Adaptive: probe briefly for any DOM activity and only wait for a quiet period
            // when something actually happened. Most fields reveal nothing, and a fixed
            // settle delay on every one of 60 fields is where a slow run comes from.
            if (config.categories.conditional.enabled && result.ok && C.isDriver(fresh)) {
              // Checkboxes and switches rarely reveal anything, so they get a shorter probe
              // than a dropdown/tree/radio whose whole purpose is often to drive a cascade.
              const light = fresh.type === 'checkbox' || fresh.type === 'toggle';
              await watcher.settleAfterFill(fieldFace, seqBeforeFill, {
                probeMs: light ? 70 : 130,
                quietMs: light ? 110 : 150,
                timeoutMs: light ? 600 : 1500
              });
            }
          }
          if (aborted) break;

          // ---- 5. Re-scan only what changed (spec §25) -------------------
          if (!config.categories.conditional.enabled) break;
          // Wait properly only when a driver was actually filled — otherwise nothing can be
          // pending and a long settle is pure delay.
          await watcher.waitForSettle(
            filledDriverThisPass
              ? { quietMs: 180, timeoutMs: 1500, minWait: 0 }
              : { quietMs: 100, timeoutMs: 320, minWait: 0 }
          );
          const dirty = watcher.takeDirty();
          if (!dirty.length) {
            // No DOM change at all: nothing new can have appeared.
            const anyPending = Array.from(pendingSkips.values()).some(
              (s) => !isPermanentSkip(s.reason)
            );
            if (!anyPending) break;
            roots = [null];
            // A full re-scan is only worth doing once more.
            if (passes >= 2) break;
          } else {
            roots = this.dedupeRoots(dirty);
          }
        }
      } finally {
        watcher.stop();
        this.running = false;
      }

      const skipped = Array.from(pendingSkips.entries()).map(([id, s]) => ({
        id: id,
        label: s.label || '(no label)',
        type: s.type,
        // The retry note is only meaningful mid-session; report the plain reason at the end.
        reason: String(s.reason || '').replace(' — retrying after dependencies are filled', '')
      }));

      const detectedCount = detected.size;
      const summary =
        'Detected ' +
        detectedCount +
        ' field' +
        (detectedCount === 1 ? '' : 's') +
        ' • Filled ' +
        filled.length +
        ' • Skipped ' +
        (skipped.length + failures.length);

      return {
        ok: true,
        url: location.href,
        title: document.title,
        kendoDetected: KA.available(),
        kendoVersion: (U.kendo() && U.kendo().version) || null,
        mode: config.mode,
        passes: passes,
        durationMs: Date.now() - started,
        aborted: aborted,
        counts: {
          detected: detectedCount,
          filled: filled.length,
          failed: failures.length,
          skipped: skipped.length
        },
        summary: summary,
        filled: filled,
        failures: failures,
        skipped: skipped
      };
    },

    /** Collapse nested containers so we never scan the same subtree twice. */
    dedupeRoots(nodes) {
      const roots = [];
      nodes.forEach((n) => {
        if (!n || !n.isConnected) return;
        if (roots.some((r) => r === n || (r.contains && r.contains(n)))) return;
        for (let i = roots.length - 1; i >= 0; i--) {
          if (n.contains && n.contains(roots[i])) roots.splice(i, 1);
        }
        roots.push(n);
      });
      return roots.length ? roots : [null];
    },

    displayValue(v) {
      if (v === null || v === undefined) return null;
      if (v instanceof Date) return V.isoDate(v) + ' ' + V.isoTime(v);
      if (typeof v === 'boolean') return v ? 'ON' : 'OFF';
      return String(v).slice(0, 80);
    },

    highlight(el) {
      const target = U.kendoWrapper(el) || el;
      if (!target || !target.style) return;
      const prev = target.style.outline;
      target.style.outline = '2px solid #1e88e5';
      setTimeout(() => {
        try {
          target.style.outline = prev;
        } catch (e) {
          /* ignore */
        }
      }, 1500);
    },

    /* ------------------------------------------------------------------ *
     * Per-field dispatch
     * ------------------------------------------------------------------ */
    async fillField(field, config, attempts) {
      switch (field.type) {
        case 'dropdown':
          return await this.fillDropdown(field, config, attempts);
        case 'tree':
          return await this.fillTree(field, config, attempts);
        case 'checkbox':
          return this.fillCheckbox(field, config);
        case 'toggle':
          return this.fillToggle(field, config);
        case 'radio':
          return this.fillRadio(field, config);
        case 'numeric':
          return this.fillNumeric(field, config, false);
        case 'decimal':
          return this.fillNumeric(field, config, true);
        case 'date':
        case 'datetime':
        case 'time':
        case 'month':
        case 'week':
          return this.fillDateLike(field, config);
        case 'masked':
          return this.fillMasked(field, config);
        case 'editor':
          return this.fillEditor(field, config);
        case 'email':
          return this.fillFreeText(field, config, V.email(field.constraints));
        case 'url':
          return this.fillFreeText(field, config, V.url());
        case 'tel':
          return this.fillFreeText(field, config, V.tel());
        case 'textarea':
          return this.fillFreeText(field, config, V.textarea(field.label, field.constraints));
        case 'text':
          return this.fillFreeText(field, config, V.text(field.label, field.constraints));
        default:
          return { ok: false, reason: 'No filler for type "' + field.type + '"' };
      }
    },

    /** Dropdowns: first valid record, retrying the next one if validation rejects it. */
    async fillDropdown(field, config, attempts) {
      const el = field.element;
      const widget = KA.available() ? KA.widgetOf(el) : null;
      const maxTries = 3;
      let lastReason = 'Dropdown has no selectable options';

      /* A Kendo DropDownList is often built ON a <select>. Driving that select natively
       * changes the posted value but leaves the widget showing "- Select -", which reads as
       * "not filled" to the user. So whenever Kendo chrome is present we click the widget
       * open and pick a record from its popup, and only fall back to the raw select if that
       * genuinely fails. */
      const shape = widget ? null : KA.shapeOf(el);
      const kendoShaped = !!(shape && shape.kind === 'dropdown');
      const isNativeSelect = el.tagName === 'SELECT' && !widget && !kendoShaped;

      for (let attempt = 0; attempt < maxTries; attempt++) {
        let res;
        if (widget) {
          res = await KA.selectFirstRecord(widget, attempt, {
            openFirst: config.categories.dropdown.openFirst !== false
          });
        } else if (isNativeSelect) {
          res = N.selectFirstOption(el, attempt);
        } else {
          res = await KA.domSelectFirst(el, attempt);
          if (!res.ok && el.tagName === 'SELECT') {
            const nat = N.selectFirstOption(el, attempt);
            if (nat.ok) {
              res = {
                ok: true,
                value: nat.value,
                text: nat.text + ' (set on the underlying select — the widget display may not refresh)'
              };
            }
          }
        }
        if (!res.ok) {
          lastReason = res.reason;
          break;
        }
        // Spec §6: if the first record causes a validation failure, try the next one.
        await U.sleep(80);
        if (!U.hasValidationError(el)) {
          return { ok: true, value: res.text || res.value };
        }
        lastReason = 'Selected record "' + (res.text || res.value) + '" failed validation';
      }
      return { ok: false, reason: lastReason };
    },

    async fillTree(field, config, attempts) {
      const el = field.element;
      const widget = KA.available() ? KA.widgetOf(el) : null;
      if (widget) {
        for (let attempt = 0; attempt < 3; attempt++) {
          const res = KA.selectFirstNode(widget, attempt);
          if (!res.ok) return { ok: false, reason: res.reason };
          await U.sleep(80);
          if (!U.hasValidationError(el)) return { ok: true, value: res.text };
        }
        return { ok: false, reason: 'Every candidate tree node failed validation' };
      }

      // No Kendo API: fall back to activating the first visible node label.
      const node = el.querySelector('.k-in, .k-treeview-leaf, li[role="treeitem"] > div > span');
      if (!node) return { ok: false, reason: 'Kendo widget not available and no selectable node found' };
      try {
        node.click();
        return { ok: true, value: U.text(node) };
      } catch (e) {
        return { ok: false, reason: 'Could not select the tree node: ' + e.message };
      }
    },

    fillCheckbox(field, config) {
      const want = (config.categories.checkbox.state || 'checked') === 'checked';
      const el = field.element;
      if (el.checked === want) return { ok: true, value: want }; // spec §8: no needless toggling
      return N.setChecked(el, want);
    },

    fillToggle(field, config) {
      const want = (config.categories.toggle.default || 'yes') === 'yes';
      const widget = KA.available() ? KA.widgetOf(field.element) : null;
      if (widget && KA.SWITCH_WIDGETS.indexOf(widget.options && widget.options.name) !== -1) {
        return KA.setSwitch(widget, want);
      }
      // Kendo Switch markup without a reachable widget: click the switch like a user.
      const shape = KA.shapeOf(field.element);
      if (shape && shape.kind === 'toggle') {
        return KA.domToggle(field.element, want);
      }
      if (field.element.type === 'checkbox') {
        if (field.element.checked === want) return { ok: true, value: want };
        return N.setChecked(field.element, want);
      }
      return { ok: false, reason: 'Kendo Switch API not available for this control' };
    },

    /** Radio group: Yes/No preference, exactly one member selected (spec §10). */
    fillRadio(field, config) {
      const wantYes = (config.categories.radio.default || 'yes') === 'yes';
      const inputs = (field.groupInputs || [field.element]).filter(
        (i) => i && i.isConnected && !U.isDisabled(i) && U.isVisible(i)
      );
      if (!inputs.length) return { ok: false, reason: 'No enabled option in this radio group' };

      const describe = (i) => {
        const parts = [i.value, U.labelFor(i)].filter(Boolean).map((s) => String(s).trim());
        return parts;
      };
      const matches = (i, pattern) =>
        describe(i).some((t) => pattern.test(t) || pattern.test(t.replace(/[^\w]/g, '')));

      let target =
        inputs.filter((i) => matches(i, wantYes ? YES_PATTERN : NO_PATTERN))[0] || null;

      if (!target) {
        // Spec §10: no Yes/No option — only fall back when it is safe to do so.
        const safe = inputs.filter((i) => !describe(i).some((t) => DESTRUCTIVE_PATTERN.test(t)));
        if (!safe.length) {
          return { ok: false, reason: 'No safe fallback option in this radio group' };
        }
        target = safe[0];
        const res = N.selectRadio(target);
        if (!res.ok) return res;
        return {
          ok: true,
          value: (U.labelFor(target) || target.value) + ' (no Yes/No option — first safe option used)'
        };
      }

      const res = N.selectRadio(target);
      if (!res.ok) return res;
      return { ok: true, value: U.labelFor(target) || target.value };
    },

    fillNumeric(field, config, isDecimal) {
      const catCfg = isDecimal ? config.categories.decimal : config.categories.numeric;
      const discovered = field.constraints || {};
      const constraints = {
        min: isFinite(discovered.min) ? discovered.min : Number(catCfg.min),
        max: isFinite(discovered.max) ? discovered.max : Number(catCfg.max),
        step: discovered.step,
        avoid: field.currentValue
      };
      if (isDecimal) {
        constraints.decimals = Number.isInteger(discovered.decimals)
          ? discovered.decimals
          : Number(catCfg.decimals);
      }
      const value = isDecimal ? V.decimal(constraints) : V.numeric(constraints);

      const widget = KA.available() ? KA.widgetOf(field.element) : null;
      if (widget && KA.NUMERIC_WIDGETS.indexOf(widget.options && widget.options.name) !== -1) {
        const res = KA.setNumeric(widget, value);
        if (!res.ok) return res;
        if (U.hasValidationError(field.element)) {
          return { ok: false, reason: 'Numeric value rejected by field validation' };
        }
        return { ok: true, value: res.value };
      }

      // Kendo NumericTextBox markup without a reachable widget: the visible formatted input
      // is where a user types, so write there as well as into the hidden original.
      const shape = KA.shapeOf(field.element);
      if (shape && shape.kind === 'numeric') {
        const res = KA.domSetValue(field.element, value);
        if (!res.ok) return res;
        if (U.hasValidationError(field.element)) {
          return { ok: false, reason: 'Numeric value rejected by field validation' };
        }
        return { ok: true, value: res.value };
      }

      const res = N.setValue(field.element, value, { keyboard: true, blur: true });
      if (!res.ok) return res;
      return { ok: true, value: res.value };
    },

    fillDateLike(field, config) {
      const widget = KA.available() ? KA.widgetOf(field.element) : null;
      if (widget && KA.DATE_WIDGETS.indexOf(widget.options && widget.options.name) !== -1) {
        const constraints = KA.dateConstraints(widget);
        const value =
          field.type === 'time'
            ? V.time(constraints)
            : field.type === 'datetime'
            ? V.dateTime(constraints)
            : V.date(constraints);
        return KA.setDate(widget, value);
      }

      // Kendo date markup without a reachable widget: write text in the format the control
      // is already displaying, so the application can parse it back.
      const shape = KA.shapeOf(field.element);
      if (shape && ['date', 'datetime', 'time'].indexOf(shape.kind) !== -1) {
        const c0 = field.constraints || {};
        const when =
          field.type === 'time' ? V.time(c0) : field.type === 'datetime' ? V.dateTime(c0) : V.date(c0);
        let str;
        if (field.type === 'time') str = V.isoTime(when);
        else if (field.type === 'datetime') str = KA.domDateText(field.element, when) + ' ' + V.isoTime(when);
        else str = KA.domDateText(field.element, when);
        const res = KA.domSetValue(field.element, str);
        if (!res.ok) return res;
        return { ok: true, value: res.value || str };
      }

      const c = field.constraints || {};
      let text;
      switch (field.type) {
        case 'time':
          text = V.isoTime(V.time(c));
          break;
        case 'datetime':
          text = V.isoDateTimeLocal(V.dateTime(c));
          break;
        case 'month':
          text = V.isoMonth(V.date(c));
          break;
        case 'week':
          text = V.isoWeek(V.date(c));
          break;
        default:
          text = V.isoDate(V.date(c));
      }
      const res = N.setValue(field.element, text, { keyboard: false, blur: true });
      if (!res.ok) return res;
      return { ok: true, value: res.value || text };
    },

    /** Kendo Editor / "HTML box": widget API when reachable, otherwise body + textarea. */
    fillEditor(field, config) {
      const html = V.html(field.label, field.constraints);
      const widget = KA.available() ? KA.widgetOf(field.element) : null;
      if (widget && typeof widget.value === 'function' && (widget.options || {}).name === 'Editor') {
        return KA.setEditor(widget, html);
      }
      return KA.domSetEditor(field.element, html);
    },

    fillMasked(field, config) {
      const widget = KA.available() ? KA.widgetOf(field.element) : null;
      if (widget) {
        const masked = KA.maskedValueFor(widget);
        if (masked !== null) return KA.setText(widget, masked);
        return KA.setText(widget, V.text(field.label, field.constraints));
      }
      return this.fillFreeText(field, config, V.text(field.label, field.constraints));
    },

    /** Label + random number, through the widget when one exists (spec §13). */
    fillFreeText(field, config, value) {
      const widget = KA.available() ? KA.widgetOf(field.element) : null;
      if (widget && KA.TEXT_WIDGETS.indexOf(widget.options && widget.options.name) !== -1) {
        return KA.setText(widget, value);
      }
      if (field.element.isContentEditable) {
        return N.setContentEditable(field.element, value);
      }
      // Kendo text markup with no reachable widget: the original element is hidden, so the
      // value must also go into the visible input the user sees.
      if (!U.isRendered(field.element) && KA.shapeOf(field.element)) {
        return KA.domSetValue(field.element, value);
      }
      const res = N.setValue(field.element, value, { keyboard: true, blur: true });
      if (!res.ok) return res;
      if (U.hasValidationError(field.element)) {
        return { ok: false, reason: 'Value "' + value + '" rejected by field validation' };
      }
      return { ok: true, value: res.value };
    },

    /** Dry scan used by the popup to preview what is on the page. */
    inspect(rawConfig) {
      const config = this.mergeConfig(rawConfig);
      const fields = S.scan({});
      const byCategory = {};
      let detected = 0;
      let requiredCount = 0;
      fields.forEach((f) => {
        const cat = C.categoryOf(f);
        if (!cat || f.type === 'unsupported') return;
        if (isPermanentSkip(f.skipReason)) return;
        detected++;
        if (f.required) requiredCount++;
        byCategory[cat] = (byCategory[cat] || 0) + 1;
      });
      return {
        ok: true,
        kendoDetected: KA.available(),
        kendoVersion: (U.kendo() && U.kendo().version) || null,
        detected: detected,
        required: requiredCount,
        byCategory: byCategory
      };
    }
  };

  KF.filler = filler;
})();

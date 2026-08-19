/* Kendo Filler — dependency-watcher.js
 *
 * Spec §14 / §25: watch the page for the DOM changes that a filled value triggers, so
 * conditional fields that appear afterwards can be discovered and filled — without
 * polling the whole document forever.
 *
 * Design notes:
 *  - One MutationObserver per accessible document, started only for the duration of a
 *    fill session and disconnected at the end (no background monitoring).
 *  - Callbacks are cheap: they record a timestamp and remember the smallest sensible
 *    container that changed, so re-scans can be scoped instead of full-page.
 *  - `waitForSettle()` is a bounded quiet-period wait: it returns as soon as mutations
 *    stop for `quietMs`, or when `timeoutMs` elapses. It also waits while a Kendo loading
 *    mask / spinner is on screen, which is how an AJAX-driven dependent field arrives.
 */
(function () {
  'use strict';

  const KF = (window.__KENDO_FILLER__ = window.__KENDO_FILLER__ || {});
  if (KF.watcher) return;
  const U = KF.utils;

  const LOADING_SELECTOR =
    '.k-loading-mask, .k-loading-image, .k-i-loading, .k-loading, .k-loader,' +
    '.loading-overlay, .spinner-border:not(.d-none), [aria-busy="true"]';

  const WATCHED_ATTRS = ['style', 'class', 'hidden', 'disabled', 'readonly', 'aria-hidden', 'aria-disabled'];

  function Watcher(docs) {
    this.docs = docs && docs.length ? docs : [document];
    this.observers = [];
    this.lastMutation = 0;
    this.mutationCount = 0;
    this.dirty = new Set();
    this.running = false;
    this.seq = 0;
    this.events = []; // {seq, node, at} — bounded ring of where mutations happened
  }

  Watcher.prototype.start = function () {
    if (this.running) return this;
    this.running = true;

    const handle = (records) => {
      const now = Date.now();
      this.lastMutation = now;
      this.mutationCount += records.length;
      for (const rec of records) {
        if (rec.type === 'childList') {
          for (const node of rec.addedNodes) {
            if (node.nodeType === 1) {
              this.markDirty(node);
              this.record(node, now);
            }
          }
          if (!rec.addedNodes.length && rec.target) {
            this.markDirty(rec.target);
            this.record(rec.target, now);
          }
        } else if (rec.target) {
          this.markDirty(rec.target);
          this.record(rec.target, now);
        }
      }
      if (this.dirty.size > 200) {
        // Too much churn to track precisely — fall back to whole-document re-scan.
        this.dirty.clear();
        this.dirty.add(this.docs[0].body || this.docs[0]);
      }
    };

    this.docs.forEach((doc) => {
      try {
        const target = doc.body || doc.documentElement;
        if (!target) return;
        const obs = new (doc.defaultView || window).MutationObserver(handle);
        obs.observe(target, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: WATCHED_ATTRS
        });
        this.observers.push(obs);
      } catch (e) {
        /* a document we cannot observe is simply not watched */
      }
    });
    return this;
  };

  /** Remember the nearest form/section that changed, for a scoped re-scan. */
  Watcher.prototype.markDirty = function (node) {
    if (!node || node.nodeType !== 1) return;
    // Ignore churn coming from widget chrome (popup lists, calendars, spinners).
    if (node.closest && node.closest(KF.classifier.CHROME_CONTAINERS)) return;
    const scope =
      (node.closest && node.closest('form, .k-form, .k-window-content, .modal-body, section, fieldset, .k-tabstrip-wrapper')) ||
      (node.ownerDocument && node.ownerDocument.body) ||
      node;
    this.dirty.add(scope);
  };

  /**
   * Remember WHERE each mutation happened, not just that one happened.
   *
   * This is what makes filling a switch fast. Toggling a Kendo Switch mutates the widget's
   * own markup (class flips, aria-checked, the animating handle), which a plain "did anything
   * change?" test reads as "a dependency may be rendering" — so every toggle paid a full
   * quiet-period wait, and an animating switch could keep the wait alive until it timed out.
   * By recording the target node we can ask the only question that matters: did anything
   * change OUTSIDE the field we just filled?
   */
  Watcher.prototype.record = function (node, at) {
    this.seq = (this.seq || 0) + 1;
    this.events.push({ seq: this.seq, node: node, at: at });
    if (this.events.length > 300) this.events.splice(0, this.events.length - 300);
  };

  /** @returns {{changed:boolean, lastAt:number}} activity outside `root` since `sinceSeq` */
  Watcher.prototype._outside = function (root, sinceSeq) {
    let changed = false;
    let lastAt = 0;
    const since = sinceSeq || 0;
    for (const e of this.events) {
      if (e.seq <= since) continue;
      if (root && root.contains && root.contains(e.node)) continue;
      changed = true;
      if (e.at > lastAt) lastAt = e.at;
    }
    return { changed: changed, lastAt: lastAt };
  };

  /**
   * Wait after filling one field: probe briefly for activity OUTSIDE that field, and only
   * then wait for it to go quiet. Returns almost immediately for the common case of a field
   * that reveals nothing.
   */
  Watcher.prototype.settleAfterFill = function (root, sinceSeq, opts) {
    const o = opts || {};
    const probeMs = o.probeMs === undefined ? 120 : o.probeMs;
    const quietMs = o.quietMs === undefined ? 150 : o.quietMs;
    const timeoutMs = o.timeoutMs === undefined ? 1500 : o.timeoutMs;
    const self = this;
    const start = Date.now();

    return (async function () {
      let info = self._outside(root, sinceSeq);
      while (!info.changed && Date.now() - start < probeMs) {
        if (self.isLoading()) break;
        await U.sleep(30);
        info = self._outside(root, sinceSeq);
      }
      if (!info.changed && !self.isLoading()) {
        return { mutated: false, waited: Date.now() - start };
      }
      while (Date.now() - start < timeoutMs) {
        info = self._outside(root, sinceSeq);
        if (!self.isLoading()) {
          if (info.lastAt && Date.now() - info.lastAt >= quietMs) break;
          if (!info.lastAt && Date.now() - start >= quietMs) break;
        }
        await U.sleep(40);
      }
      return { mutated: true, waited: Date.now() - start };
    })();
  };

  /**
   * Short probe: did anything change in the next `probeMs`?
   * Used instead of a fixed settle delay after every filled field — most fields trigger no
   * dependent rendering at all, and waiting a fixed 350 ms for each of 60 fields is where
   * the time went.
   */
  Watcher.prototype.waitForChange = function (sinceCount, probeMs) {
    const self = this;
    const limit = probeMs === undefined ? 140 : probeMs;
    const start = Date.now();
    return (async function () {
      while (Date.now() - start < limit) {
        if (self.mutationCount > sinceCount) return true;
        if (self.isLoading()) return true;
        await U.sleep(30);
      }
      return self.mutationCount > sinceCount;
    })();
  };

  Watcher.prototype.isLoading = function () {
    // Memoised: this runs inside tight wait loops and querying every document each time is
    // pure overhead.
    const now = Date.now();
    if (this._loadingAt && now - this._loadingAt < 80) return this._loadingWas;
    this._loadingAt = now;
    this._loadingWas = this._checkLoading();
    return this._loadingWas;
  };

  Watcher.prototype._checkLoading = function () {
    for (const doc of this.docs) {
      let nodes;
      try {
        nodes = doc.querySelectorAll(LOADING_SELECTOR);
      } catch (e) {
        continue;
      }
      for (const n of nodes) {
        if (U.isVisible(n)) return true;
      }
    }
    return false;
  };

  /**
   * Bounded wait for the UI to stop changing.
   * @returns {Promise<{mutated:boolean, timedOut:boolean, waited:number}>}
   */
  Watcher.prototype.waitForSettle = function (opts) {
    const o = opts || {};
    const quietMs = o.quietMs || 220;
    const timeoutMs = o.timeoutMs || 2500;
    const minWait = o.minWait === undefined ? 60 : o.minWait;
    const start = Date.now();
    const startCount = this.mutationCount;
    const self = this;

    return (async function () {
      await U.sleep(minWait);
      while (true) {
        const elapsed = Date.now() - start;
        if (elapsed >= timeoutMs) {
          return { mutated: self.mutationCount > startCount, timedOut: true, waited: elapsed };
        }
        if (self.isLoading()) {
          await U.sleep(90);
          continue;
        }
        const changed = self.mutationCount > startCount;
        if (!changed) {
          // Nothing happened at all: give asynchronous work a short grace period only.
          if (elapsed >= Math.min(timeoutMs, Math.max(minWait + quietMs, 350))) {
            return { mutated: false, timedOut: false, waited: elapsed };
          }
        } else if (Date.now() - self.lastMutation >= quietMs) {
          return { mutated: true, timedOut: false, waited: elapsed };
        }
        await U.sleep(60);
      }
    })();
  };

  /** Containers that changed since the last call; clears the set. */
  Watcher.prototype.takeDirty = function () {
    const arr = [];
    this.dirty.forEach((n) => {
      if (n && n.isConnected) arr.push(n);
    });
    this.dirty.clear();
    return arr;
  };

  Watcher.prototype.stop = function () {
    this.observers.forEach((o) => {
      try {
        o.disconnect();
      } catch (e) {
        /* ignore */
      }
    });
    this.observers = [];
    this.running = false;
    this.dirty.clear();
    this.events = []; // release the node references we were holding
  };

  KF.watcher = {
    create(docs) {
      return new Watcher(docs);
    }
  };
})();

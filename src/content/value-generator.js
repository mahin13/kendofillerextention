/* Kendo Filler — value-generator.js
 *
 * Spec §21: one central, independently testable module for every generated value.
 * All randomness goes through crypto.getRandomValues. Every value is clamped into the
 * constraints discovered on the field, so a generated value can never be NaN, Infinity,
 * out of range, or over the configured decimal precision.
 */
(function () {
  'use strict';

  const KF = (window.__KENDO_FILLER__ = window.__KENDO_FILLER__ || {});
  if (KF.values) return;

  const DEFAULT_MIN = 1;
  const DEFAULT_MAX = 999;
  const DEFAULT_DECIMALS = 2;

  function cryptoRandom() {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] / 4294967296; // [0,1)
  }

  function randomInt(min, max) {
    if (!isFinite(min) || !isFinite(max)) {
      min = DEFAULT_MIN;
      max = DEFAULT_MAX;
    }
    if (max < min) {
      const t = min;
      min = max;
      max = t;
    }
    const span = Math.floor(max) - Math.ceil(min) + 1;
    if (span <= 0) return Math.round(min);
    return Math.ceil(min) + Math.floor(cryptoRandom() * span);
  }

  /** Random digit suffix used for free-form values, e.g. 58321. */
  function randomSuffix(digits) {
    const n = digits || 5;
    const min = Math.pow(10, n - 1);
    const max = Math.pow(10, n) - 1;
    return randomInt(min, max);
  }

  function round(value, decimals) {
    const f = Math.pow(10, decimals);
    return Math.round(value * f) / f;
  }

  /** Snap a value onto the field's step grid without leaving [min,max]. */
  function snapToStep(value, step, min, max, decimals) {
    if (!step || !isFinite(step) || step <= 0) return value;
    const base = isFinite(min) ? min : 0;
    let snapped = base + Math.round((value - base) / step) * step;
    snapped = round(snapped, Math.max(decimals || 0, decimalsOfStep(step)));
    if (isFinite(min) && snapped < min) snapped = round(min + Math.abs(step) * 0, decimals || 0);
    if (isFinite(max) && snapped > max) snapped = round(snapped - step, decimals || 0);
    if (isFinite(min) && snapped < min) snapped = min;
    return snapped;
  }

  function decimalsOfStep(step) {
    const s = String(step);
    const i = s.indexOf('.');
    return i === -1 ? 0 : s.length - i - 1;
  }

  const generator = {
    randomInt,
    randomSuffix,
    round,

    /** Whole number honouring min / max / step (spec §11). */
    numeric(constraints) {
      const c = constraints || {};
      let min = isFinite(c.min) ? c.min : DEFAULT_MIN;
      let max = isFinite(c.max) ? c.max : DEFAULT_MAX;
      if (max < min) max = min;

      // Keep the range sane when the page declares something enormous.
      if (max - min > 1e9) max = min + DEFAULT_MAX;

      let v = randomInt(Math.ceil(min), Math.floor(max));
      if (c.step) v = snapToStep(v, c.step, min, max, 0);
      v = Math.round(v);
      if (isFinite(c.min) && v < c.min) v = Math.ceil(c.min);
      if (isFinite(c.max) && v > c.max) v = Math.floor(c.max);
      if (!isFinite(v)) v = DEFAULT_MIN;

      // Uniqueness nudge: never hand back the value already sitting in the field.
      if (c.avoid != null && Number(c.avoid) === v) {
        const alt = v + 1;
        if (!isFinite(c.max) || alt <= c.max) v = alt;
        else if (!isFinite(c.min) || v - 1 >= c.min) v = v - 1;
      }
      return v;
    },

    /** Decimal honouring min / max / step / precision (spec §12). */
    decimal(constraints) {
      const c = constraints || {};
      const decimals = Number.isInteger(c.decimals) ? Math.max(0, Math.min(10, c.decimals)) : DEFAULT_DECIMALS;
      let min = isFinite(c.min) ? c.min : DEFAULT_MIN;
      let max = isFinite(c.max) ? c.max : DEFAULT_MAX;
      if (max < min) max = min;
      if (max - min > 1e9) max = min + DEFAULT_MAX;

      let v = min + cryptoRandom() * (max - min);
      v = round(v, decimals);
      if (c.step) v = snapToStep(v, c.step, min, max, decimals);
      v = round(v, decimals);

      if (isFinite(c.min) && v < c.min) v = round(c.min, decimals);
      if (isFinite(c.max) && v > c.max) v = round(c.max, decimals);
      if (!isFinite(v)) v = round(DEFAULT_MIN + cryptoRandom(), decimals);

      // A zero value is legal but a poor test value when the range allows more.
      if (v === 0 && max > 0) v = round(Math.min(max, 1 + cryptoRandom() * 9), decimals);

      if (c.avoid != null && Number(c.avoid) === v) {
        const bump = Math.pow(10, -decimals);
        const alt = round(v + bump, decimals);
        if (!isFinite(c.max) || alt <= c.max) v = alt;
      }
      return v;
    },

    /** Label + random number (spec §13), trimmed to maxlength. */
    text(label, constraints) {
      const c = constraints || {};
      const base = this.normaliseLabel(label) || 'Test';
      const suffix = String(randomSuffix(5));
      let value = base + ' ' + suffix;

      const max = isFinite(c.maxLength) && c.maxLength > 0 ? c.maxLength : null;
      if (max) {
        if (max <= suffix.length) {
          value = suffix.slice(-max);
        } else {
          const room = max - suffix.length - 1;
          value = (room > 0 ? base.slice(0, room).trim() + ' ' : '') + suffix;
          value = value.slice(0, max);
        }
      }
      const min = isFinite(c.minLength) ? c.minLength : 0;
      while (value.length < min) value += String(randomInt(0, 9));
      return value;
    },

    /** Longer body text for textareas. */
    textarea(label, constraints) {
      const c = constraints || {};
      const base = this.normaliseLabel(label) || 'Notes';
      let value = base + ' — automated test entry ' + randomSuffix(5) + '.';
      if (isFinite(c.maxLength) && c.maxLength > 0) value = value.slice(0, c.maxLength);
      const min = isFinite(c.minLength) ? c.minLength : 0;
      while (value.length < min) value += ' x';
      return value;
    },

    normaliseLabel(label) {
      return String(label || '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\*/g, '')
        .replace(/[:\-–—]+\s*$/, '')
        .replace(/\s*\(optional\)\s*/i, ' ')
        .replace(/\s*\(required\)\s*/i, ' ')
        .replace(/[^\w \-.&/']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 40);
    },

    /** HTML body for a rich text / "HTML box" field (spec §13 applied to markup). */
    html(label, constraints) {
      const c = constraints || {};
      const base = this.normaliseLabel(label) || 'Content';
      const n = randomSuffix(5);
      let value =
        '<p>' + base + ' ' + n + '</p><p>Automated test entry for <strong>' + base +
        '</strong>.</p><ul><li>Line one ' + n + '</li><li>Line two</li></ul>';
      // The character counters on these fields count text, not markup, so keep it short.
      if (isFinite(c.maxLength) && c.maxLength > 0 && this.textLength(value) > c.maxLength) {
        value = '<p>' + base + ' ' + n + '</p>';
        if (this.textLength(value) > c.maxLength) value = '<p>' + n + '</p>';
      }
      return value;
    },

    textLength(html) {
      return String(html || '')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ').length;
    },

    email(constraints) {
      let v = 'email' + randomSuffix(5) + '@example.com';
      const c = constraints || {};
      if (isFinite(c.maxLength) && c.maxLength > 0 && v.length > c.maxLength) {
        v = ('e' + randomSuffix(3) + '@ex.com').slice(0, c.maxLength);
      }
      return v;
    },

    url() {
      return 'https://example.com/test/' + randomSuffix(5);
    },

    tel() {
      return '+1' + randomInt(2000000000, 9899999999);
    },

    /** A safe Date object inside any discovered min/max window. */
    date(constraints) {
      const c = constraints || {};
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let lo = c.min instanceof Date ? new Date(c.min) : new Date(today.getTime() - 30 * 864e5);
      let hi = c.max instanceof Date ? new Date(c.max) : new Date(today.getTime() + 30 * 864e5);
      if (hi < lo) hi = new Date(lo.getTime());
      const t = lo.getTime() + Math.floor(cryptoRandom() * Math.max(0, hi.getTime() - lo.getTime()));
      const d = new Date(t);
      d.setHours(0, 0, 0, 0);
      if (d < lo) d.setTime(lo.getTime());
      if (d > hi) d.setTime(hi.getTime());
      return d;
    },

    dateTime(constraints) {
      const d = this.date(constraints);
      d.setHours(randomInt(8, 17), randomInt(0, 59) - (randomInt(0, 59) % 5), 0, 0);
      return d;
    },

    time(constraints) {
      const d = this.date(constraints);
      d.setHours(randomInt(8, 17), [0, 15, 30, 45][randomInt(0, 3)], 0, 0);
      return d;
    },

    /** ISO helpers for native date/time inputs. */
    isoDate(d) {
      const p = (n) => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    },
    isoTime(d) {
      const p = (n) => String(n).padStart(2, '0');
      return p(d.getHours()) + ':' + p(d.getMinutes());
    },
    isoDateTimeLocal(d) {
      return this.isoDate(d) + 'T' + this.isoTime(d);
    },
    isoMonth(d) {
      return this.isoDate(d).slice(0, 7);
    },
    isoWeek(d) {
      // ISO-8601 week of the given date.
      const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const day = t.getUTCDay() || 7;
      t.setUTCDate(t.getUTCDate() + 4 - day);
      const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
      const week = Math.ceil(((t - yearStart) / 864e5 + 1) / 7);
      return t.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
    },

    color() {
      const h = () => String(randomInt(0, 255).toString(16)).padStart(2, '0');
      return '#' + h() + h() + h();
    }
  };

  KF.values = generator;
})();

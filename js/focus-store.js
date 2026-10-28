/**
 * Daymark - Daily Focus Store
 * Persists the current day's focus priorities and intention separately from
 * tasks and theme preferences.
 *
 * Storage contract
 * - Key: daymark.focus.v1
 * - Shape: {
 *     version: 1,
 *     plans: {
 *       "YYYY-MM-DD": { taskIds: ["existing-task-id"], intention: "..." }
 *     }
 *   }
 * - Dates are local calendar keys built from getFullYear(), getMonth(), and
 *   getDate(). No UTC date slicing is used, so the plan follows the user's
 *   local day rather than UTC midnight.
 * - Task ids refer to records in daymark.tasks.v1. Daily Focus never copies
 *   task objects or writes focus fields onto tasks.
 * - Retention: a successful save keeps today plus the 30 prior calendar days
 *   (31 date entries at most) and drops older Daily Focus entries. Future
 *   date keys are left alone. Cleanup only touches daymark.focus.v1.
 *
 * Failure behavior
 * - The in-memory plans change only after localStorage accepts the new
 *   payload, so a failed write leaves the last saved plan intact.
 * - Unreadable payloads are copied to daymark.focus.v1.unreadable before the
 *   first replacement write. They are never used to render.
 */

(function (global) {
  'use strict';

  const KEY = 'daymark.focus.v1';
  const BACKUP_KEY = KEY + '.unreadable';
  const VERSION = 1;
  const MAX_TASKS = 3;
  const MAX_INTENTION = 160;
  const RETENTION_DAYS = 30;
  const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

  let plans = {};
  let status = 'unknown';
  let corruptRaw = null;
  let needsBackup = false;
  let cachedStorage;
  let storageChecked = false;

  /* ---------------------------------------------------------------------- */
  /* Storage access                                                         */
  /* ---------------------------------------------------------------------- */

  /**
   * The task storage module only manages daymark.tasks.v1. Daily Focus uses
   * its own access check so this key can be read independently and so a
   * focus-only storage problem cannot alter task storage behavior.
   *
   * This deliberately does not probe with a test write. A browser that can
   * read but temporarily not write should still show the last saved plan;
   * each write reports its own failure through commit().
   */
  function getStorage() {
    if (storageChecked) {
      return cachedStorage;
    }

    storageChecked = true;

    try {
      cachedStorage = global.localStorage || null;
    } catch (error) {
      cachedStorage = null;
    }

    return cachedStorage;
  }

  /* ---------------------------------------------------------------------- */
  /* Validation                                                             */
  /* ---------------------------------------------------------------------- */

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  /**
   * Local calendar key. Do not replace this with toISOString().slice(0, 10):
   * that uses UTC and moves the day for users west of UTC in the evening.
   */
  function dateKey(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function isValidDateKey(value) {
    if (typeof value !== 'string') {
      return false;
    }

    const match = DATE_KEY_PATTERN.exec(value);

    if (!match) {
      return false;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(year, month - 1, day);

    return parsed.getFullYear() === year &&
      parsed.getMonth() === month - 1 &&
      parsed.getDate() === day;
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function normalizeTaskIds(value) {
    const ids = [];
    const seen = new Set();

    if (!Array.isArray(value)) {
      return ids;
    }

    value.forEach(function (rawId) {
      if (typeof rawId !== 'string' || ids.length >= MAX_TASKS) {
        return;
      }

      const id = rawId.trim();

      if (!id || seen.has(id)) {
        return;
      }

      seen.add(id);
      ids.push(id);
    });

    return ids;
  }

  function normalizeIntention(value) {
    if (typeof value !== 'string') {
      return '';
    }

    return value.trim().slice(0, MAX_INTENTION);
  }

  function normalizePlan(raw) {
    if (!isPlainObject(raw)) {
      return null;
    }

    return {
      taskIds: normalizeTaskIds(raw.taskIds),
      intention: normalizeIntention(raw.intention)
    };
  }

  function clonePlans(source) {
    const copy = {};

    Object.keys(source).forEach(function (key) {
      copy[key] = {
        taskIds: source[key].taskIds.slice(),
        intention: source[key].intention
      };
    });

    return copy;
  }

  /* ---------------------------------------------------------------------- */
  /* Recovery and saving                                                    */
  /* ---------------------------------------------------------------------- */

  function markCorrupt(raw, storage) {
    status = 'corrupt';
    corruptRaw = raw;
    needsBackup = true;
    plans = {};

    // Keep the unreadable payload recoverable. If this fails, replacement
    // writes stay blocked so the original value is not silently destroyed.
    try {
      storage.setItem(BACKUP_KEY, raw);
      needsBackup = false;
    } catch (error) {
      needsBackup = true;
    }
  }

  function backupCorrupt(storage) {
    if (!needsBackup) {
      return true;
    }

    try {
      storage.setItem(BACKUP_KEY, corruptRaw);
      needsBackup = false;
      return true;
    } catch (error) {
      return false;
    }
  }

  function prunePlans(source, currentKey) {
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
    const cutoffKey = dateKey(cutoff);
    const kept = {};

    Object.keys(source).forEach(function (key) {
      if (!isValidDateKey(key)) {
        return;
      }

      // ISO-shaped keys sort chronologically. Today is always kept, and
      // yesterday's plan remains available until it passes retention.
      if (key !== currentKey && key < cutoffKey) {
        return;
      }

      const plan = normalizePlan(source[key]);

      if (plan) {
        kept[key] = plan;
      }
    });

    return kept;
  }

  /**
   * Writes a complete, validated payload. Memory is updated only after the
   * write succeeds, so callers can safely keep showing the previous plan.
   */
  function commit(nextPlans) {
    const storage = getStorage();

    if (!storage) {
      status = 'unavailable';
      return false;
    }

    if (!backupCorrupt(storage)) {
      return false;
    }

    const currentKey = dateKey(new Date());
    const pruned = prunePlans(nextPlans, currentKey);
    let payload;

    try {
      payload = JSON.stringify({ version: VERSION, plans: pruned });
    } catch (error) {
      return false;
    }

    try {
      storage.setItem(KEY, payload);
    } catch (error) {
      return false;
    }

    plans = pruned;
    status = 'ok';
    corruptRaw = null;
    needsBackup = false;
    return true;
  }

  /* ---------------------------------------------------------------------- */
  /* Public API                                                             */
  /* ---------------------------------------------------------------------- */

  function initialize() {
    plans = {};
    status = 'unknown';
    corruptRaw = null;
    needsBackup = false;

    const storage = getStorage();

    if (!storage) {
      status = 'unavailable';
      return;
    }

    let raw;

    try {
      raw = storage.getItem(KEY);
    } catch (error) {
      status = 'unavailable';
      return;
    }

    if (raw === null) {
      status = 'empty';
      return;
    }

    let parsed;

    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      markCorrupt(raw, storage);
      return;
    }

    if (!isPlainObject(parsed) ||
        parsed.version !== VERSION ||
        !isPlainObject(parsed.plans)) {
      markCorrupt(raw, storage);
      return;
    }

    Object.keys(parsed.plans).forEach(function (key) {
      if (!isValidDateKey(key)) {
        return;
      }

      const plan = normalizePlan(parsed.plans[key]);

      if (plan) {
        plans[key] = plan;
      }
    });

    status = 'ok';
  }

  function getTodayPlan() {
    const currentKey = dateKey(new Date());
    const plan = plans[currentKey];

    return {
      dateKey: currentKey,
      taskIds: plan ? plan.taskIds.slice() : [],
      intention: plan ? plan.intention : ''
    };
  }

  function setTaskIds(ids) {
    const current = getTodayPlan();
    const next = clonePlans(plans);

    next[current.dateKey] = {
      taskIds: normalizeTaskIds(ids),
      intention: current.intention
    };

    const saved = commit(next);

    return {
      ok: saved,
      plan: saved ? getTodayPlan() : current,
      reason: saved ? '' : 'storage'
    };
  }

  function setIntention(text) {
    if (typeof text !== 'string') {
      return { ok: false, reason: 'invalid', plan: getTodayPlan() };
    }

    const intention = text.trim();

    if (intention.length > MAX_INTENTION) {
      return { ok: false, reason: 'too-long', plan: getTodayPlan() };
    }

    const current = getTodayPlan();
    const next = clonePlans(plans);

    next[current.dateKey] = {
      taskIds: current.taskIds.slice(),
      intention: intention
    };

    const saved = commit(next);

    return {
      ok: saved,
      plan: saved ? getTodayPlan() : current,
      reason: saved ? '' : 'storage'
    };
  }

  global.DaymarkFocusStore = {
    KEY: KEY,
    BACKUP_KEY: BACKUP_KEY,
    VERSION: VERSION,
    MAX_TASKS: MAX_TASKS,
    MAX_INTENTION: MAX_INTENTION,
    RETENTION_DAYS: RETENTION_DAYS,
    initialize: initialize,
    getDateKey: function () {
      return dateKey(new Date());
    },
    getTodayPlan: getTodayPlan,
    setTaskIds: setTaskIds,
    setIntention: setIntention,
    getStatus: function () {
      return status;
    }
  };
})(window);

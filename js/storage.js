/**
 * Daymark - Storage Module
 * Persists the task collection in the browser's localStorage.
 *
 * This module only handles reading, writing, and recovering the stored
 * collection. Task rules (validation, filtering, sorting) stay in
 * js/task-store.js.
 *
 * localStorage is per browser and per origin. It does not sync between
 * devices or browsers.
 */

(function (global) {
  'use strict';

  const KEY = 'daymark.tasks.v1';
  const BACKUP_KEY = KEY + '.unreadable';

  let cachedStorage;
  let storageChecked = false;

  /**
   * localStorage can throw when it is disabled or when storage is full.
   * Probe it once so the rest of the app can fall back to memory safely.
   */
  function getStorage() {
    if (storageChecked) {
      return cachedStorage;
    }

    storageChecked = true;

    try {
      const candidate = global.localStorage;

      if (!candidate) {
        return null;
      }

      const probeKey = KEY + '.probe';
      candidate.setItem(probeKey, '1');
      candidate.removeItem(probeKey);

      cachedStorage = candidate;
    } catch (error) {
      cachedStorage = null;
    }

    return cachedStorage;
  }

  function isAvailable() {
    return Boolean(getStorage());
  }

  /**
   * Keeps the unreadable payload instead of throwing it away. This lets a
   * future version (or the user, through dev tools) recover it.
   */
  function backup(raw) {
    if (typeof raw !== 'string') {
      return false;
    }

    const storage = getStorage();

    if (!storage) {
      return false;
    }

    try {
      storage.setItem(BACKUP_KEY, raw);
      return true;
    } catch (error) {
      return false;
    }
  }

  function readRaw() {
    const storage = getStorage();

    if (!storage) {
      return null;
    }

    try {
      return storage.getItem(KEY);
    } catch (error) {
      return null;
    }
  }

  /**
   * Returns { status, tasks, raw }.
   *
   * status is one of:
   * - "ok"          parsed array (individual records still need validation)
   * - "empty"       nothing has been saved yet
   * - "corrupt"     stored value could not be parsed as an array; the raw
   *                 value is backed up and left in place
   * - "unavailable" localStorage cannot be used (e.g. disabled)
   */
  function load() {
    const storage = getStorage();

    if (!storage) {
      return { status: 'unavailable', tasks: [], raw: null };
    }

    let raw;

    try {
      raw = storage.getItem(KEY);
    } catch (error) {
      return { status: 'unavailable', tasks: [], raw: null };
    }

    if (raw === null) {
      return { status: 'empty', tasks: [], raw: null };
    }

    let parsed;

    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      backup(raw);
      return { status: 'corrupt', tasks: [], raw: raw };
    }

    if (!Array.isArray(parsed)) {
      backup(raw);
      return { status: 'corrupt', tasks: [], raw: raw };
    }

    const tasks = parsed.filter(function (item) {
      return item !== null && typeof item === 'object' && !Array.isArray(item);
    });

    if (parsed.length > 0 && tasks.length === 0) {
      backup(raw);
      return { status: 'corrupt', tasks: [], raw: raw };
    }

    return { status: 'ok', tasks: tasks, raw: raw };
  }

  function save(tasks) {
    if (!Array.isArray(tasks)) {
      return false;
    }

    const storage = getStorage();

    if (!storage) {
      return false;
    }

    try {
      storage.setItem(KEY, JSON.stringify(tasks));
      return true;
    } catch (error) {
      return false;
    }
  }

  function clear() {
    const storage = getStorage();

    if (!storage) {
      return false;
    }

    try {
      storage.removeItem(KEY);
      return true;
    } catch (error) {
      return false;
    }
  }

  function getBackup() {
    const storage = getStorage();

    if (!storage) {
      return null;
    }

    try {
      return storage.getItem(BACKUP_KEY);
    } catch (error) {
      return null;
    }
  }

  global.DaymarkStorage = {
    KEY: KEY,
    BACKUP_KEY: BACKUP_KEY,
    isAvailable: isAvailable,
    load: load,
    save: save,
    clear: clear,
    readRaw: readRaw,
    backup: backup,
    getBackup: getBackup
  };
})(window);

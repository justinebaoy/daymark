/**
 * Daymark - Theme
 * Applies the saved appearance preference (light, dark, or system) before
 * the stylesheets load so pages do not flash the wrong theme.
 *
 * The preference is stored separately from task data. Tasks remain in
 * js/storage.js and are never touched by this module.
 */

(function (global) {
  'use strict';

  const KEY = 'daymark.theme.v1';
  const PREFERENCES = ['light', 'dark', 'system'];
  const root = document.documentElement;
  let currentPreference = 'system';

  function normalize(value) {
    return PREFERENCES.indexOf(value) !== -1 ? value : 'system';
  }

  function readPreference() {
    try {
      return normalize(global.localStorage.getItem(KEY));
    } catch (error) {
      return 'system';
    }
  }

  function systemPrefersDark() {
    try {
      return Boolean(
        global.matchMedia &&
        global.matchMedia('(prefers-color-scheme: dark)').matches
      );
    } catch (error) {
      return false;
    }
  }

  function resolve(preference) {
    if (preference === 'dark') {
      return 'dark';
    }

    if (preference === 'light') {
      return 'light';
    }

    return systemPrefersDark() ? 'dark' : 'light';
  }

  function apply() {
    root.setAttribute('data-theme', resolve(currentPreference));
    root.setAttribute('data-theme-preference', currentPreference);
  }

  /**
   * Saves and applies a preference. Returns true when it was persisted.
   * The current page still switches theme if storage is blocked.
   */
  function setPreference(value) {
    currentPreference = normalize(value);

    let saved = false;

    try {
      global.localStorage.setItem(KEY, currentPreference);
      saved = true;
    } catch (error) {
      saved = false;
    }

    apply();
    return saved;
  }

  currentPreference = readPreference();
  apply();

  if (global.matchMedia) {
    try {
      const query = global.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = function () {
        if (currentPreference === 'system') {
          apply();
        }
      };

      if (typeof query.addEventListener === 'function') {
        query.addEventListener('change', handleChange);
      } else if (typeof query.addListener === 'function') {
        query.addListener(handleChange);
      }
    } catch (error) {
      // The saved preference still applies without live system updates.
    }
  }

  global.DaymarkTheme = {
    KEY: KEY,
    PREFERENCES: PREFERENCES.slice(),
    getPreference: function () {
      return currentPreference;
    },
    getResolvedTheme: function () {
      return resolve(currentPreference);
    },
    setPreference: setPreference
  };
})(window);

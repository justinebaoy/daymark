/**
 * Daymark - Settings Module
 * Appearance preference, task export, and clearing saved tasks.
 *
 * Tasks are read and removed through the shared DaymarkTaskStore. This page
 * never writes task storage directly.
 */

(function () {
  'use strict';

  const Store = window.DaymarkTaskStore;
  const Storage = window.DaymarkStorage || null;
  const Theme = window.DaymarkTheme || null;
  const DEFAULT_STORAGE_NOTE =
    'Tasks are stored only in this browser. Clearing browser data removes them.';

  const els = {};
  let clearDialogReturnFocus = null;

  /* ---------------------------------------------------------------------- */
  /* Startup                                                                */
  /* ---------------------------------------------------------------------- */

  function init() {
    cacheElements();

    if (!hasRequiredElements()) {
      return;
    }

    initializeStore();
    initializeTheme();
    bindEvents();
    renderData();
  }

  function cacheElements() {
    els.themeOptions = document.getElementById('themeOptions');
    els.themeStatus = document.getElementById('themeStatus');
    els.taskCount = document.getElementById('settingsTaskCount');
    els.exportButton = document.getElementById('exportTasksButton');
    els.clearButton = document.getElementById('clearTasksButton');
    els.dataStatus = document.getElementById('dataStatus');
    els.storageNote = document.getElementById('storageNote');

    els.clearDialog = document.getElementById('clearTasksDialog');
    els.clearDialogCount = document.getElementById('clearTasksDialogCount');
    els.confirmClear = document.getElementById('confirmClearTasks');
    els.cancelClear = document.getElementById('cancelClearTasks');
  }

  function hasRequiredElements() {
    return Boolean(
      els.themeOptions &&
      els.themeStatus &&
      els.taskCount &&
      els.exportButton &&
      els.clearButton &&
      els.dataStatus &&
      els.storageNote &&
      els.clearDialog &&
      els.clearDialogCount &&
      els.confirmClear &&
      els.cancelClear
    );
  }

  function bindEvents() {
    els.themeOptions.addEventListener('change', handleThemeChange);
    els.exportButton.addEventListener('click', exportTasks);
    els.clearButton.addEventListener('click', function (event) {
      openClearDialog(event.currentTarget);
    });
    els.confirmClear.addEventListener('click', clearAllTasks);

    els.clearDialog.querySelectorAll('[data-close-clear-dialog]').forEach(function (button) {
      button.addEventListener('click', function () {
        els.clearDialog.close();
      });
    });

    els.clearDialog.addEventListener('close', handleClearDialogClose);
  }

  function initializeStore() {
    if (!Store || typeof Store.initialize !== 'function') {
      return;
    }

    try {
      Store.initialize();
    } catch (error) {
      // renderData treats an unreadable store as unavailable.
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Appearance                                                             */
  /* ---------------------------------------------------------------------- */

  function initializeTheme() {
    if (!Theme || typeof Theme.getPreference !== 'function') {
      els.themeOptions.disabled = true;
      showStatus(
        els.themeStatus,
        'Appearance settings are unavailable in this browser.',
        true
      );
      return;
    }

    const preference = Theme.getPreference();
    const radios = els.themeOptions.querySelectorAll('input[name="theme"]');
    let matched = false;

    radios.forEach(function (radio) {
      radio.checked = radio.value === preference;
      matched = matched || radio.checked;
    });

    if (!matched) {
      setCheckedTheme('system');
    }

    updateThemeSelection();
  }

  function handleThemeChange(event) {
    const input = event.target;
    const value = input && input.value;

    if (!input || input.name !== 'theme' || !value) {
      return;
    }

    if (!Theme || typeof Theme.setPreference !== 'function') {
      showStatus(
        els.themeStatus,
        'Appearance settings are unavailable in this browser.',
        true
      );
      return;
    }

    const saved = Theme.setPreference(value);
    updateThemeSelection();

    if (saved) {
      showStatus(els.themeStatus, 'Appearance preference saved.', false);
    } else {
      showStatus(
        els.themeStatus,
        'The theme changed for this page, but the preference could not be saved in this browser.',
        true
      );
    }
  }

  function setCheckedTheme(value) {
    const radios = els.themeOptions.querySelectorAll('input[name="theme"]');

    radios.forEach(function (radio) {
      radio.checked = radio.value === value;
    });
  }

  function updateThemeSelection() {
    const labels = els.themeOptions.querySelectorAll('.settings-choice');

    labels.forEach(function (label) {
      const radio = label.querySelector('input[name="theme"]');
      label.classList.toggle('is-selected', Boolean(radio && radio.checked));
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Data summary                                                           */
  /* ---------------------------------------------------------------------- */

  function getStorageStatus() {
    if (!Store || typeof Store.getStorageStatus !== 'function') {
      return 'unavailable';
    }

    try {
      return Store.getStorageStatus();
    } catch (error) {
      return 'unavailable';
    }
  }

  function getTasks() {
    if (!Store || typeof Store.getAll !== 'function') {
      return null;
    }

    try {
      const tasks = Store.getAll();
      return Array.isArray(tasks) ? tasks : null;
    } catch (error) {
      return null;
    }
  }

  function renderData() {
    const status = getStorageStatus();
    const tasks = getTasks();

    if (status !== 'ok' || !tasks) {
      els.taskCount.textContent = 'Unavailable';
      els.exportButton.disabled = true;
      els.clearButton.disabled = true;
      els.storageNote.textContent = storageMessage(status);
      return;
    }

    const count = tasks.length;

    els.taskCount.textContent = formatTaskCount(count);
    els.exportButton.disabled = false;
    els.clearButton.disabled = count === 0;

    if (count === 0) {
      els.storageNote.textContent =
        'There are no saved tasks right now. Add tasks in My Tasks to see them here.';
    } else {
      els.storageNote.textContent = DEFAULT_STORAGE_NOTE;
    }
  }

  function storageMessage(status) {
    if (status === 'corrupt') {
      return 'Saved task data could not be read. Export and clear are unavailable, and your stored data is unchanged.';
    }

    if (status === 'unavailable') {
      return 'Browser storage is unavailable. Export and clear are unavailable, and tasks cannot be saved.';
    }

    return 'Saved tasks are unavailable right now. Export and clear are disabled.';
  }

  function getTaskCount() {
    const tasks = getTasks();
    return tasks ? tasks.length : null;
  }

  /* ---------------------------------------------------------------------- */
  /* Export                                                                 */
  /* ---------------------------------------------------------------------- */

  function exportTasks() {
    if (getStorageStatus() !== 'ok') {
      showStatus(
        els.dataStatus,
        'Tasks cannot be exported because saved data is unavailable.',
        true
      );
      return;
    }

    const tasks = getTasks();

    if (!tasks) {
      showStatus(els.dataStatus, 'Tasks could not be read for export.', true);
      return;
    }

    if (tasks.length === 0) {
      showStatus(
        els.dataStatus,
        'There are no tasks to export. Add a task in My Tasks first.',
        false
      );
      return;
    }

    try {
      const json = JSON.stringify(tasks, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = url;
      link.download = 'daymark-tasks-' + localDateStamp(new Date()) + '.json';
      document.body.appendChild(link);
      link.click();
      link.remove();

      window.setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1000);

      showStatus(
        els.dataStatus,
        'Exported ' + formatTaskCount(tasks.length) + ' as JSON.',
        false
      );
    } catch (error) {
      showStatus(
        els.dataStatus,
        'The export could not be created. Please try again.',
        true
      );
    }
  }

  function localDateStamp(date) {
    return date.getFullYear() + '-' +
      pad(date.getMonth() + 1) + '-' +
      pad(date.getDate());
  }

  function pad(value) {
    return value < 10 ? '0' + value : String(value);
  }

  /* ---------------------------------------------------------------------- */
  /* Clear all tasks                                                        */
  /* ---------------------------------------------------------------------- */

  function openClearDialog(trigger) {
    const count = getTaskCount();

    if (count === null) {
      showStatus(
        els.dataStatus,
        'Tasks cannot be cleared because saved data is unavailable.',
        true
      );
      return;
    }

    if (count === 0) {
      showStatus(els.dataStatus, 'There are no tasks to clear.', false);
      return;
    }

    els.clearDialogCount.textContent = count === 1
      ? 'your saved task'
      : 'all ' + count + ' saved tasks';
    clearDialogReturnFocus = trigger || document.activeElement;

    if (!els.clearDialog.open) {
      els.clearDialog.showModal();
    }

    els.cancelClear.focus();
  }

  function clearAllTasks() {
    if (!Store || typeof Store.remove !== 'function' || getStorageStatus() !== 'ok') {
      renderData();
      els.clearDialog.close();
      showStatus(
        els.dataStatus,
        'Tasks could not be cleared because saved data is unavailable.',
        true
      );
      return;
    }

    const tasks = getTasks();

    if (!tasks || tasks.length === 0) {
      els.clearDialog.close();
      renderData();
      showStatus(els.dataStatus, 'There are no tasks to clear.', false);
      return;
    }

    let removedAll = true;

    tasks.forEach(function (task) {
      if (!task || !Store.remove(task.id)) {
        removedAll = false;
      }
    });

    const persisted = removedAll && tasksAreCleared();

    if (!persisted) {
      // Reload whatever is still saved before updating the page so it never
      // shows a false success.
      initializeStore();
    }

    renderData();
    els.clearDialog.close();

    if (persisted) {
      showStatus(
        els.dataStatus,
        'All tasks were cleared from this browser.',
        false
      );
      return;
    }

    showStatus(
      els.dataStatus,
      'The tasks could not be fully cleared, so your saved data was kept. Please try again.',
      true
    );
  }

  function tasksAreCleared() {
    if (!Storage || typeof Storage.load !== 'function') {
      const tasks = getTasks();
      return Boolean(tasks) && tasks.length === 0;
    }

    try {
      const result = Storage.load();
      return result.status === 'ok' && result.tasks.length === 0;
    } catch (error) {
      return false;
    }
  }

  function handleClearDialogClose() {
    const target = clearDialogReturnFocus;

    clearDialogReturnFocus = null;

    if (target && document.contains(target) && !target.disabled) {
      target.focus();
      return;
    }

    if (!els.exportButton.disabled) {
      els.exportButton.focus();
      return;
    }

    const firstTheme = els.themeOptions.querySelector('input[name="theme"]:not(:disabled)');

    if (firstTheme) {
      firstTheme.focus();
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Feedback                                                               */
  /* ---------------------------------------------------------------------- */

  function showStatus(element, message, isError) {
    element.textContent = message;
    element.classList.toggle('is-error', Boolean(isError));
    element.hidden = false;
  }

  function formatTaskCount(count) {
    if (count === 0) {
      return 'No tasks';
    }

    return count + ' ' + (count === 1 ? 'task' : 'tasks');
  }

  /* ---------------------------------------------------------------------- */
  /* Boot                                                                   */
  /* ---------------------------------------------------------------------- */

  // Re-read the collection when the page is restored from the back/forward
  // cache so the count and buttons match what My Tasks currently shows.
  window.addEventListener('pageshow', function (event) {
    if (!event.persisted || !els.exportButton) {
      return;
    }

    initializeStore();
    renderData();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/**
 * Daymark - Tasks Page
 * Presentation and interaction layer for task management.
 *
 * Task data lives in js/task-store.js and is saved to localStorage through
 * js/storage.js, so edits survive page reloads.
 */

(function () {
  'use strict';

  const Store = window.DaymarkTaskStore;
  const Storage = window.DaymarkStorage || null;
  const UI = window.DaymarkUI || null;

  if (!Store) {
    return;
  }

  const PRIORITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High' };
  const CATEGORY_LABELS = { work: 'Work', personal: 'Personal', study: 'Study', other: 'Other' };
  const DEFAULT_SORT = 'dueDate';
  const DAY_IN_MS = 24 * 60 * 60 * 1000;

  const timeFormatter = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  });
  const monthDayFormatter = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric'
  });
  const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  const els = {};
  let taskDialogReturnFocus = null;
  let taskDialogFocusSelector = null;
  let taskDialogNativeFocus = null;
  let pendingDeleteId = null;
  let deleteDialogReturnFocus = null;
  let deleteDialogFocusSelector = null;
  let deleteDialogNativeFocus = null;
  let submitLocked = false;

  function init() {
    cacheElements();

    if (!els.taskList) {
      return;
    }

    Store.initialize();
    bindEvents();
    render();
  }

  function cacheElements() {
    els.addTaskButton = document.getElementById('addTaskButton');
    els.search = document.getElementById('taskSearch');
    els.statusFilter = document.getElementById('statusFilter');
    els.priorityFilter = document.getElementById('priorityFilter');
    els.categoryFilter = document.getElementById('categoryFilter');
    els.sortFilter = document.getElementById('sortFilter');
    els.taskList = document.getElementById('taskList');
    els.taskListHeading = document.getElementById('taskListHeading');
    els.taskTemplate = document.getElementById('taskItemTemplate');
    els.taskCount = document.getElementById('taskCount');
    els.clearFilters = document.getElementById('clearFilters');
    els.emptyState = document.getElementById('taskEmptyState');
    els.emptyTitle = document.getElementById('taskEmptyTitle');
    els.emptyText = document.getElementById('taskEmptyText');
    els.emptyAddButton = document.getElementById('emptyAddButton');
    els.emptyClearButton = document.getElementById('emptyClearButton');
    els.announcements = document.getElementById('taskAnnouncements');

    els.taskDialog = document.getElementById('taskDialog');
    els.taskForm = document.getElementById('taskForm');
    els.taskDialogTitle = document.getElementById('taskDialogTitle');
    els.taskSubmitButton = document.getElementById('taskSubmitButton');
    els.taskId = document.getElementById('taskId');
    els.taskTitle = document.getElementById('taskTitle');
    els.taskTitleError = document.getElementById('taskTitleError');
    els.taskDescription = document.getElementById('taskDescription');
    els.taskDueDate = document.getElementById('taskDueDate');
    els.taskPriority = document.getElementById('taskPriority');
    els.taskCategory = document.getElementById('taskCategory');
    els.taskFormError = document.getElementById('taskFormError');

    els.deleteDialog = document.getElementById('deleteDialog');
    els.deleteTaskTitle = document.getElementById('deleteTaskTitle');
    els.confirmDeleteButton = document.getElementById('confirmDeleteButton');
    els.cancelDeleteButton = document.getElementById('cancelDeleteButton');
  }

  function bindEvents() {
    els.addTaskButton.addEventListener('click', function (event) {
      openTaskDialog(null, event.currentTarget);
    });

    els.emptyAddButton.addEventListener('click', function (event) {
      openTaskDialog(null, event.currentTarget);
    });

    els.taskForm.addEventListener('submit', handleTaskSubmit);
    els.taskTitle.addEventListener('input', function () {
      if (els.taskTitle.value.trim()) {
        clearTitleError();
      }
    });

    els.search.addEventListener('input', render);
    els.statusFilter.addEventListener('change', render);
    els.priorityFilter.addEventListener('change', render);
    els.categoryFilter.addEventListener('change', render);
    els.sortFilter.addEventListener('change', render);
    document.addEventListener('keydown', handleDocumentKeydown);
    document.addEventListener('keydown', handleDialogTab);

    els.clearFilters.addEventListener('click', function () {
      resetFilters();
    });
    els.emptyClearButton.addEventListener('click', function () {
      resetFilters();
    });

    els.taskList.addEventListener('change', handleTaskListChange);
    els.taskList.addEventListener('click', handleTaskListClick);

    els.taskDialog.querySelectorAll('[data-close-dialog]').forEach(function (button) {
      button.addEventListener('click', function () {
        els.taskDialog.close();
      });
    });

    els.deleteDialog.querySelectorAll('[data-close-delete-dialog]').forEach(function (button) {
      button.addEventListener('click', function () {
        els.deleteDialog.close();
      });
    });

    els.confirmDeleteButton.addEventListener('click', confirmDelete);

    els.taskDialog.addEventListener('close', handleTaskDialogClose);
    els.deleteDialog.addEventListener('close', handleDeleteDialogClose);
    els.taskDialog.addEventListener('cancel', handleTaskDialogCancel);
    els.deleteDialog.addEventListener('cancel', handleDeleteDialogCancel);
  }

  function handleDocumentKeydown(event) {
    if (event.defaultPrevented || event.isComposing || event.key !== '/') {
      return;
    }

    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    if (isEditableElement(event.target)) {
      return;
    }

    if (document.querySelector('dialog[open]')) {
      return;
    }

    const sidebar = document.getElementById('sidebarNav');

    if (sidebar && sidebar.classList.contains('is-open')) {
      return;
    }

    event.preventDefault();
    els.search.focus();
  }

  function isEditableElement(element) {
    if (!element || !element.tagName) {
      return false;
    }

    if (element.isContentEditable) {
      return true;
    }

    return element.tagName === 'INPUT' ||
      element.tagName === 'TEXTAREA' ||
      element.tagName === 'SELECT';
  }

  /**
   * Native <dialog> already makes the background inert. This only closes the
   * gap where Tab from the last control can briefly land on the page body.
   */
  function handleDialogTab(event) {
    if (event.key !== 'Tab' || event.defaultPrevented) {
      return;
    }

    const dialog = document.querySelector('dialog[open]');

    if (!dialog) {
      return;
    }

    const focusable = Array.prototype.slice.call(dialog.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), ' +
      'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(function (element) {
      return element.getClientRects().length > 0;
    });

    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey) {
      if (active === first || !dialog.contains(active)) {
        event.preventDefault();
        last.focus();
      }

      return;
    }

    if (active === last || !dialog.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Filtering, sorting, and rendering                                      */
  /* ---------------------------------------------------------------------- */

  function getFilters() {
    return {
      search: els.search.value,
      status: els.statusFilter.value,
      priority: els.priorityFilter.value,
      category: els.categoryFilter.value,
      sort: els.sortFilter.value || DEFAULT_SORT
    };
  }

  function hasActiveFilters(filters) {
    return Boolean(
      filters.search.trim() ||
      filters.status !== 'all' ||
      filters.priority !== 'all' ||
      filters.category !== 'all'
    );
  }

  function render() {
    const filters = getFilters();
    const allTasks = Store.getAll();
    const visibleTasks = Store.query(filters);
    const filtersActive = hasActiveFilters(filters);

    els.taskList.replaceChildren();

    visibleTasks.forEach(function (task) {
      els.taskList.appendChild(createTaskRow(task));
    });

    els.taskList.hidden = visibleTasks.length === 0;
    els.emptyState.hidden = visibleTasks.length > 0;
    els.clearFilters.hidden = !filtersActive;

    if (visibleTasks.length === 0) {
      updateEmptyState(allTasks.length, filtersActive, filters, allTasks);
    }

    updateCount(visibleTasks.length, allTasks.length, filtersActive);
  }

  function updateCount(visibleCount, totalCount, filtersActive) {
    const noun = totalCount === 1 ? 'task' : 'tasks';

    if (filtersActive) {
      els.taskCount.textContent = visibleCount + ' of ' + totalCount + ' ' + noun;
    } else {
      els.taskCount.textContent = totalCount + ' ' + noun;
    }
  }

  function updateEmptyState(totalCount, filtersActive, filters, allTasks) {
    if (totalCount === 0) {
      els.emptyTitle.textContent = 'A clear day ahead';
      els.emptyText.textContent = "You don't have any tasks yet. Add your first task to get started.";
      els.emptyAddButton.hidden = false;
      els.emptyClearButton.hidden = true;
      return;
    }

    const onlyStatusFilter = filtersActive &&
      filters.status === 'active' &&
      !filters.search.trim() &&
      filters.priority === 'all' &&
      filters.category === 'all';
    const allComplete = allTasks.every(function (task) {
      return task.completed;
    });

    if (onlyStatusFilter && allComplete) {
      els.emptyTitle.textContent = 'All caught up';
      els.emptyText.textContent =
        'Every saved task is complete. Clear the filter to review your completed work.';
      els.emptyAddButton.hidden = true;
      els.emptyClearButton.hidden = false;
      return;
    }

    const noun = totalCount === 1 ? 'task' : 'tasks';

    els.emptyTitle.textContent = 'No matching tasks';
    els.emptyText.textContent = filtersActive
      ? 'No tasks match the current search or filters. Clear filters to see all ' +
        totalCount + ' ' + noun + '.'
      : 'There is nothing to show right now.';
    els.emptyAddButton.hidden = true;
    els.emptyClearButton.hidden = false;
  }

  function createTaskRow(task) {
    const fragment = els.taskTemplate.content.cloneNode(true);
    const row = fragment.querySelector('.task-item');
    const checkbox = fragment.querySelector('.task-toggle');
    const title = fragment.querySelector('.task-title');
    const description = fragment.querySelector('.task-description');
    const category = fragment.querySelector('.task-category');
    const priority = fragment.querySelector('.task-priority');
    const due = fragment.querySelector('.task-due');
    const completedBadge = fragment.querySelector('.task-status-completed');
    const completedAt = fragment.querySelector('.task-completed-at');
    const editButton = fragment.querySelector('.task-edit');
    const deleteButton = fragment.querySelector('.task-delete');

    row.dataset.taskId = task.id;
    row.classList.toggle('is-completed', task.completed);

    checkbox.checked = task.completed;
    checkbox.setAttribute(
      'aria-label',
      (task.completed ? 'Reopen task: ' : 'Mark task complete: ') + task.title
    );

    title.textContent = task.title;

    if (task.description) {
      description.textContent = task.description;
      description.hidden = false;
    }

    category.textContent = CATEGORY_LABELS[task.category] || task.category;

    priority.textContent = PRIORITY_LABELS[task.priority] || task.priority;
    priority.classList.add('task-priority-' + task.priority);

    if (task.dueDate) {
      const overdue = !task.completed && isOverdue(task.dueDate);
      due.hidden = false;
      due.textContent = (overdue ? 'Overdue · ' : '') + formatRelativeDateTime(task.dueDate);
      due.classList.toggle('is-overdue', overdue);
    }

    if (task.completed) {
      completedBadge.hidden = false;

      if (task.completedAt) {
        completedAt.hidden = false;
        completedAt.textContent = 'Completed ' + formatRelativeDateTime(task.completedAt);
      }
    }

    editButton.querySelector('.visually-hidden').textContent = 'Edit task: ' + task.title;
    deleteButton.querySelector('.visually-hidden').textContent = 'Delete task: ' + task.title;

    return fragment;
  }

  /* ---------------------------------------------------------------------- */
  /* Create and edit                                                        */
  /* ---------------------------------------------------------------------- */

  function openTaskDialog(task, trigger) {
    els.taskForm.reset();
    clearTitleError();
    clearFormError();
    submitLocked = false;

    const editing = Boolean(task);

    els.taskDialogTitle.textContent = editing ? 'Edit task' : 'Add a task';
    els.taskSubmitButton.textContent = editing ? 'Save changes' : 'Add task';
    els.taskId.value = editing ? task.id : '';
    els.taskTitle.value = editing ? task.title : '';
    els.taskDescription.value = editing ? task.description : '';
    els.taskDueDate.value = editing && task.dueDate ? toDateTimeLocalValue(task.dueDate) : '';
    els.taskPriority.value = editing ? task.priority : 'medium';
    els.taskCategory.value = editing ? task.category : 'work';

    taskDialogReturnFocus = trigger || document.activeElement;
    taskDialogFocusSelector = null;
    // <dialog> restores focus to whatever was focused before it opened.
    // Record that element so a late native restoration can be recognized.
    taskDialogNativeFocus = document.activeElement;
    els.taskDialog.showModal();
    els.taskTitle.focus();
  }

  function handleTaskSubmit(event) {
    event.preventDefault();

    if (submitLocked) {
      return;
    }

    // The lock stays on after a successful save so a rapid second submit
    // from the same dialog cannot create a duplicate task. It is cleared
    // when the dialog is opened again.
    submitLocked = true;
    clearFormError();

    const input = {
      title: els.taskTitle.value,
      description: els.taskDescription.value,
      dueDate: els.taskDueDate.value,
      priority: els.taskPriority.value,
      category: els.taskCategory.value
    };

    const errors = Store.validate(input);

    if (errors.title) {
      submitLocked = false;
      showTitleError(errors.title);
      els.taskTitle.focus();
      return;
    }

    clearTitleError();

    if (!storageReady()) {
      submitLocked = false;
      showFormError(
        'This browser could not save tasks right now. Your details are still here, so you can try again.'
      );
      return;
    }

    const taskId = els.taskId.value;
    let task;
    let message;

    if (taskId) {
      task = Store.update(taskId, input);
      message = 'Task updated.';
    } else {
      task = Store.add(input);
      message = 'Task added.';
    }

    if (!task) {
      submitLocked = false;
      showFormError('The task could not be saved. Please check the details and try again.');
      els.taskTitle.focus();
      return;
    }

    if (!isTaskPersisted(task.id, task)) {
      // Keep the dialog open with the entered values and put the shared
      // store back in sync with what is actually saved.
      submitLocked = false;
      Store.initialize();
      render();
      showFormError(
        'The task could not be saved in this browser. Your details are still here, so you can try again.'
      );
      return;
    }

    taskDialogFocusSelector = '[data-task-id="' + task.id + '"] .task-edit';
    render();

    const focusTarget = getTaskDialogFocusTarget();

    els.taskDialog.close();
    focusAfterDialog(focusTarget, taskDialogNativeFocus);
    notify(message);
  }

  function showTitleError(message) {
    els.taskTitleError.textContent = message;
    els.taskTitleError.hidden = false;
    els.taskTitle.setAttribute('aria-invalid', 'true');
  }

  function clearTitleError() {
    els.taskTitleError.textContent = '';
    els.taskTitleError.hidden = true;
    els.taskTitle.removeAttribute('aria-invalid');
  }

  function showFormError(message) {
    els.taskFormError.textContent = message;
    els.taskFormError.hidden = false;
  }

  function clearFormError() {
    els.taskFormError.textContent = '';
    els.taskFormError.hidden = true;
  }

  function handleTaskDialogClose() {
    const target = getTaskDialogFocusTarget();
    const nativeFocus = taskDialogNativeFocus;

    taskDialogFocusSelector = null;
    taskDialogReturnFocus = null;
    taskDialogNativeFocus = null;

    focusAfterDialog(target, nativeFocus);
  }

  /**
   * Escape closes a native dialog and the browser restores focus itself. In
   * a busy or background tab the engine can defer the close event, so close
   * explicitly and restore focus right away. The native modal, focus trap,
   * and close semantics are still used; this only makes restoration
   * deterministic. The close event still handles every other dismissal path.
   */
  function handleTaskDialogCancel(event) {
    event.preventDefault();

    const target = getTaskDialogFocusTarget();
    const nativeFocus = taskDialogNativeFocus;

    els.taskDialog.close();
    focusAfterDialog(target, nativeFocus);
  }

  function handleDeleteDialogCancel(event) {
    event.preventDefault();

    const target = getDeleteDialogFocusTarget();
    const nativeFocus = deleteDialogNativeFocus;

    els.deleteDialog.close();
    focusAfterDialog(target, nativeFocus);
  }

  function getTaskDialogFocusTarget() {
    if (taskDialogFocusSelector) {
      const target = document.querySelector(taskDialogFocusSelector);

      if (target) {
        return target;
      }
    }

    if (taskDialogReturnFocus && document.contains(taskDialogReturnFocus)) {
      return taskDialogReturnFocus;
    }

    return els.addTaskButton;
  }

  /* ---------------------------------------------------------------------- */
  /* Complete, reopen, and delete                                           */
  /* ---------------------------------------------------------------------- */

  function handleTaskListChange(event) {
    const checkbox = event.target.closest('.task-toggle');

    if (!checkbox) {
      return;
    }

    const row = checkbox.closest('[data-task-id]');
    const task = row ? Store.get(row.dataset.taskId) : null;

    if (!task || !storageReady()) {
      render();
      notify('Task change could not be saved.', 'error');

      if (task) {
        focusTaskControl(task.id, '.task-toggle');
      }

      return;
    }

    const changedTask = Store.toggle(task.id);

    if (!changedTask) {
      render();
      notify('Task could not be updated.', 'error');
      return;
    }

    if (!isTaskPersisted(changedTask.id, changedTask)) {
      Store.initialize();
      render();
      notify('Task change could not be saved.', 'error');
      focusTaskControl(changedTask.id, '.task-toggle');
      return;
    }

    notify(changedTask.completed ? 'Task completed.' : 'Task reopened.');
    render();
    focusTaskControl(changedTask.id, '.task-toggle');
  }

  function focusTaskControl(id, controlSelector) {
    const selector = '[data-task-id="' + id + '"] ' + controlSelector;
    const target = document.querySelector(selector);

    if (target) {
      target.focus();
      return;
    }

    els.taskListHeading.focus();
  }

  function handleTaskListClick(event) {
    const editButton = event.target.closest('.task-edit');

    if (editButton) {
      const row = editButton.closest('[data-task-id]');
      const task = row ? Store.get(row.dataset.taskId) : null;

      if (task) {
        openTaskDialog(task, editButton);
      }

      return;
    }

    const deleteButton = event.target.closest('.task-delete');

    if (deleteButton) {
      const row = deleteButton.closest('[data-task-id]');
      const task = row ? Store.get(row.dataset.taskId) : null;

      if (task) {
        openDeleteDialog(task, deleteButton);
      }
    }
  }

  function openDeleteDialog(task, trigger) {
    pendingDeleteId = task.id;
    deleteDialogReturnFocus = trigger;
    deleteDialogFocusSelector = null;
    deleteDialogNativeFocus = document.activeElement;
    els.deleteTaskTitle.textContent = task.title;
    els.deleteDialog.showModal();
    els.cancelDeleteButton.focus();
  }

  function confirmDelete() {
    if (!pendingDeleteId) {
      return;
    }

    const id = pendingDeleteId;
    pendingDeleteId = null;

    const nativeFocus = deleteDialogNativeFocus;

    if (!storageReady()) {
      els.deleteDialog.close();
      focusAfterDialog(getDeleteDialogFocusTarget(), nativeFocus);
      notify('Task could not be deleted because browser storage is unavailable.', 'error');
      return;
    }

    const removed = Store.remove(id);
    const persisted = removed && isTaskAbsent(id);

    if (!persisted) {
      // The shared store may still hold an in-memory copy that was never
      // saved, so reload the saved collection before reporting a failure.
      Store.initialize();
      render();
      // Rendering replaced the row, so target the same task's control in the
      // refreshed list rather than the detached trigger.
      deleteDialogFocusSelector = '[data-task-id="' + id + '"] .task-delete';
      els.deleteDialog.close();
      focusAfterDialog(getDeleteDialogFocusTarget(), nativeFocus);
      notify('Task could not be deleted. Your saved task was kept.', 'error');
      return;
    }

    render();
    els.deleteDialog.close();
    focusAfterDialog(getDeleteDialogFocusTarget(), nativeFocus);
    notify('Task deleted.');
  }

  function getDeleteDialogFocusTarget() {
    if (deleteDialogFocusSelector) {
      const target = document.querySelector(deleteDialogFocusSelector);

      if (target) {
        return target;
      }
    }

    if (deleteDialogReturnFocus && document.contains(deleteDialogReturnFocus)) {
      return deleteDialogReturnFocus;
    }

    return els.addTaskButton;
  }

  function handleDeleteDialogClose() {
    const target = getDeleteDialogFocusTarget();
    const nativeFocus = deleteDialogNativeFocus;

    pendingDeleteId = null;
    deleteDialogReturnFocus = null;
    deleteDialogFocusSelector = null;
    deleteDialogNativeFocus = null;

    focusAfterDialog(target, nativeFocus);
  }

  /**
   * Native dialogs usually restore focus to the invoking control, but some
   * engines do it just after the close event and can overwrite an explicit
   * target. Focus now and keep a short guard against a late native
   * restoration. Only the element the browser recorded before opening the
   * dialog (or the page body) is corrected, so ordinary programmatic focus
   * changes are left alone. Any real pointer or keyboard interaction hands
   * control back to the user immediately.
   */
  function focusAfterDialog(target, nativeFocus) {
    if (!target || typeof target.focus !== 'function') {
      return;
    }

    let corrections = 0;
    let released = false;

    function release() {
      if (released) {
        return;
      }

      released = true;
      document.removeEventListener('focusin', handleFocus, true);
      document.removeEventListener('pointerdown', release, true);
      document.removeEventListener('keydown', release, true);
    }

    function handleFocus(event) {
      if (event.target === target) {
        return;
      }

      // Another dialog opening takes over focus management.
      if (document.querySelector('dialog[open]')) {
        release();
        return;
      }

      const nativeRestoration = event.target === document.body ||
        (nativeFocus && event.target === nativeFocus);

      if (corrections < 2 && nativeRestoration) {
        corrections += 1;
        target.focus();
        return;
      }

      release();
    }

    target.focus();
    document.addEventListener('focusin', handleFocus, true);
    document.addEventListener('pointerdown', release, true);
    document.addEventListener('keydown', release, true);

    // Cleanup only: correctness never depends on this timer running.
    window.setTimeout(release, 400);
  }

  /* ---------------------------------------------------------------------- */
  /* Filter reset and announcements                                         */
  /* ---------------------------------------------------------------------- */

  function resetFilters() {
    els.search.value = '';
    els.statusFilter.value = 'all';
    els.priorityFilter.value = 'all';
    els.categoryFilter.value = 'all';
    render();
    els.search.focus();
  }

  function readPersistedTasks() {
    if (!Storage || typeof Storage.load !== 'function') {
      return null;
    }

    try {
      const result = Storage.load();
      return result && result.status === 'ok' ? result.tasks : null;
    } catch (error) {
      return null;
    }
  }

  function storageReady() {
    return typeof Store.getStorageStatus === 'function' &&
      Store.getStorageStatus() === 'ok';
  }

  function isTaskPersisted(id, task) {
    const storedTasks = readPersistedTasks();

    if (!storedTasks) {
      return false;
    }

    const stored = storedTasks.find(function (item) {
      return item && item.id === id;
    });

    if (!stored) {
      return false;
    }

    return ['title', 'description', 'dueDate', 'priority', 'category', 'completed']
      .every(function (field) {
        return stored[field] === task[field];
      });
  }

  function isTaskAbsent(id) {
    const storedTasks = readPersistedTasks();
    return Boolean(storedTasks) && !storedTasks.some(function (item) {
      return item && item.id === id;
    });
  }

  function notify(message, tone) {
    if (UI && typeof UI.notify === 'function') {
      UI.notify(message, { tone: tone === 'error' ? 'error' : 'success' });
      return;
    }

    announce(message);
  }

  function announce(message) {
    if (!els.announcements) {
      return;
    }

    els.announcements.textContent = '';

    window.setTimeout(function () {
      els.announcements.textContent = message;
    }, 60);
  }

  /* ---------------------------------------------------------------------- */
  /* Formatting helpers                                                     */
  /* ---------------------------------------------------------------------- */

  function isOverdue(value) {
    const date = new Date(value);
    return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
  }

  function startOfDay(date) {
    const copy = new Date(date.getTime());
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  function dayDifference(date) {
    return Math.round((startOfDay(date) - startOfDay(new Date())) / DAY_IN_MS);
  }

  function formatRelativeDateTime(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return '';
    }

    const difference = dayDifference(date);
    const time = timeFormatter.format(date).replace(/\s([AP]M)$/i, '\u00A0$1');

    if (difference === 0) {
      return 'Today, ' + time;
    }

    if (difference === 1) {
      return 'Tomorrow, ' + time;
    }

    if (difference === -1) {
      return 'Yesterday, ' + time;
    }

    const dateLabel = date.getFullYear() === new Date().getFullYear()
      ? monthDayFormatter.format(date)
      : fullDateFormatter.format(date);

    return dateLabel + ', ' + time;
  }

  function toDateTimeLocalValue(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return '';
    }

    function pad(number) {
      return String(number).padStart(2, '0');
    }

    return date.getFullYear() + '-' +
      pad(date.getMonth() + 1) + '-' +
      pad(date.getDate()) + 'T' +
      pad(date.getHours()) + ':' +
      pad(date.getMinutes());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

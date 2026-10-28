/**
 * Daymark - Dashboard Module
 * Renders the dashboard from the shared task collection in js/task-store.js.
 *
 * Metric definitions:
 * - Tasks due today: active (not completed) tasks whose due date falls on
 *   today's local calendar day. Overdue tasks are not counted here; they stay
 *   in Today's Tasks until they are completed.
 * - Completed tasks: every completed task in the collection, whatever its due
 *   date.
 * - Remaining tasks: every active (not completed) task in the collection.
 * - Weekly progress: completions whose completedAt falls in the current
 *   Monday through Sunday local week, grouped by calendar day.
 *
 * Today's Tasks shows active overdue tasks plus every task due today, sorted
 * by due time. Upcoming Deadlines shows active tasks due tomorrow or later,
 * earliest first.
 */

(function () {
  'use strict';

  const Store = window.DaymarkTaskStore;
  const Storage = window.DaymarkStorage || null;
  const UI = window.DaymarkUI || null;
  const FocusStore = window.DaymarkFocusStore || null;

  if (!Store) {
    return;
  }

  const PRIORITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High' };
  const CATEGORY_LABELS = { work: 'Work', personal: 'Personal', study: 'Study', other: 'Other' };
  const DAY_IN_MS = 24 * 60 * 60 * 1000;
  const MAX_DEADLINES = 4;
  const EM_DASH = '\u2014';
  const WEEK_LENGTH = 7;
  const DAY_NAMES = [
    'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'
  ];
  const SAVE_ERROR = 'Your change could not be saved, so it was not applied. ' +
    'Check that browser storage is available, then try again.';
  const FOCUS_SAVE_ERROR = 'Your Daily Focus change could not be saved, so it was not applied. ' +
    'Check that browser storage is available, then try again.';
  const FOCUS_STORAGE_NOTE = 'Daily Focus cannot be saved in this browser right now. ' +
    'Changes you make here will not be kept after you reload the page.';
  const FOCUS_CORRUPT_NOTE = 'Saved Daily Focus data could not be read, so today starts with a fresh plan. ' +
    'Your tasks and theme are unaffected. A new plan will be saved when you make a change.';
  const FOCUS_MAX_TASKS = FocusStore ? FocusStore.MAX_TASKS : 3;
  const FOCUS_MAX_INTENTION = FocusStore ? FocusStore.MAX_INTENTION : 160;

  const timeFormatter = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  });
  const monthDayFormatter = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric'
  });
  const weekdayDateFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
  const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
  const longDateFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });

  const els = {};
  let focusIntentionEditing = false;
  let focusSaveError = '';
  let focusCleanupSignature = '';
  let focusDialogReturnFocus = null;
  let lastFocusDate = '';

  /* ---------------------------------------------------------------------- */
  /* Startup                                                                */
  /* ---------------------------------------------------------------------- */

  function init() {
    cacheElements();

    if (!els.todayList || !els.deadlineList || !els.todayTemplate || !els.deadlineTemplate) {
      return;
    }

    updateWelcome();
    Store.initialize();

    if (FocusStore) {
      FocusStore.initialize();
      lastFocusDate = FocusStore.getDateKey();
    }

    bindFocusEvents();
    els.todayList.addEventListener('change', handleTaskToggle);
    render();
  }

  function cacheElements() {
    els.greeting = document.getElementById('welcome-heading');
    els.date = document.getElementById('dashboardDate');
    els.notice = document.getElementById('dashboardNotice');
    els.noticeText = document.getElementById('dashboardNoticeText');
    els.dueToday = document.getElementById('dashboardDueToday');
    els.completed = document.getElementById('dashboardCompleted');
    els.remaining = document.getElementById('dashboardRemaining');
    els.todayList = document.getElementById('dashboardTodayList');
    els.todayEmpty = document.getElementById('dashboardTodayEmpty');
    els.deadlineList = document.getElementById('dashboardDeadlineList');
    els.deadlineEmpty = document.getElementById('dashboardDeadlineEmpty');
    els.deadlineMore = document.getElementById('dashboardDeadlineMore');
    els.todayTemplate = document.getElementById('dashboardTaskTemplate');
    els.deadlineTemplate = document.getElementById('dashboardDeadlineTemplate');
    els.announcer = document.getElementById('dashboardAnnouncer');
    els.focusCard = document.getElementById('focusCard');
    els.focusDate = document.getElementById('focusDate');
    els.focusManageButton = document.getElementById('focusManageButton');
    els.focusStorageNote = document.getElementById('focusStorageNote');
    els.focusIntentionDisplay = document.getElementById('focusIntentionDisplay');
    els.focusIntentionText = document.getElementById('focusIntentionText');
    els.focusIntentionEditButton = document.getElementById('focusIntentionEditButton');
    els.focusIntentionForm = document.getElementById('focusIntentionForm');
    els.focusIntentionInput = document.getElementById('focusIntentionInput');
    els.focusIntentionCount = document.getElementById('focusIntentionCount');
    els.focusIntentionError = document.getElementById('focusIntentionError');
    els.focusIntentionCancel = document.getElementById('focusIntentionCancel');
    els.focusProgress = document.getElementById('focusProgress');
    els.focusProgressText = document.getElementById('focusProgressText');
    els.focusProgressPercent = document.getElementById('focusProgressPercent');
    els.focusProgressBar = document.getElementById('focusProgressBar');
    els.focusProgressFill = document.getElementById('focusProgressFill');
    els.focusSummary = document.getElementById('focusSummary');
    els.focusTaskList = document.getElementById('focusTaskList');
    els.focusTaskTemplate = document.getElementById('focusTaskTemplate');
    els.focusEmpty = document.getElementById('focusEmpty');
    els.focusEmptyTitle = document.getElementById('focusEmptyTitle');
    els.focusEmptyText = document.getElementById('focusEmptyText');
    els.focusEmptyButton = document.getElementById('focusEmptyButton');
    els.focusEmptyLink = document.getElementById('focusEmptyLink');
    els.focusComplete = document.getElementById('focusComplete');
    els.focusCompleteText = document.getElementById('focusCompleteText');
    els.focusDialog = document.getElementById('focusDialog');
    els.focusDialogForm = document.getElementById('focusDialogForm');
    els.focusDialogClose = document.getElementById('focusDialogClose');
    els.focusDialogList = document.getElementById('focusDialogList');
    els.focusDialogEmpty = document.getElementById('focusDialogEmpty');
    els.focusDialogCount = document.getElementById('focusDialogCount');
    els.focusDialogError = document.getElementById('focusDialogError');
    els.focusDialogSave = document.getElementById('focusDialogSave');
    els.focusHeading = document.getElementById('focus-heading');
    els.weeklyChart = document.querySelector('.weekly-chart');
    els.weeklyBars = els.weeklyChart
      ? Array.from(els.weeklyChart.querySelectorAll('.weekly-bar'))
      : [];
    els.weeklyScaleMin = document.querySelector('.weekly-labels span:first-child');
    els.weeklyScaleMax = document.querySelector('.weekly-labels span:last-child');
  }

  function updateWelcome() {
    const now = new Date();
    const hour = now.getHours();
    let greeting = 'Good evening.';

    if (hour < 12) {
      greeting = 'Good morning.';
    } else if (hour < 18) {
      greeting = 'Good afternoon.';
    }

    if (els.greeting) {
      els.greeting.textContent = greeting;
    }

    if (els.date) {
      els.date.textContent = longDateFormatter.format(now);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Rendering                                                              */
  /* ---------------------------------------------------------------------- */

  function render() {
    const status = typeof Store.getStorageStatus === 'function'
      ? Store.getStorageStatus()
      : 'unavailable';

    if (status !== 'ok') {
      renderStorageProblem(status);
      return;
    }

    clearNotice();

    const tasks = Store.getAll();
    const now = new Date();
    const todayStart = startOfDay(now);
    const tomorrowStart = addDays(todayStart, 1);
    const activeTasks = tasks.filter(function (task) {
      return !task.completed;
    });

    const dueToday = activeTasks.filter(function (task) {
      const due = parseDate(task.dueDate);
      return Boolean(due) && due >= todayStart && due < tomorrowStart;
    }).length;
    const completed = tasks.filter(function (task) {
      return task.completed;
    }).length;

    els.dueToday.textContent = String(dueToday);
    els.completed.textContent = String(completed);
    els.remaining.textContent = String(activeTasks.length);

    renderWeeklyProgress(tasks);
    renderTodayTasks(tasks, todayStart, tomorrowStart);
    renderUpcomingDeadlines(tasks, tomorrowStart);
    renderFocus(tasks);
  }

  /**
   * Counts completed tasks per local calendar day for the current Monday to
   * Sunday week. Only a completed task with a valid completedAt timestamp is
   * counted; pending work is not part of this chart.
   */
  function renderWeeklyProgress(tasks) {
    if (!els.weeklyChart || els.weeklyBars.length !== WEEK_LENGTH) {
      return;
    }

    const weekStart = startOfWeek(new Date());
    const weekEnd = addDays(weekStart, WEEK_LENGTH);
    const counts = new Array(WEEK_LENGTH).fill(0);

    tasks.forEach(function (task) {
      if (!task || task.completed !== true) {
        return;
      }

      const completedAt = parseDate(task.completedAt);

      if (!completedAt || completedAt < weekStart || completedAt >= weekEnd) {
        return;
      }

      const index = dayIndex(completedAt, weekStart);

      if (index >= 0 && index < WEEK_LENGTH) {
        counts[index] += 1;
      }
    });

    const maxCount = Math.max.apply(null, counts);
    const total = counts.reduce(function (sum, count) {
      return sum + count;
    }, 0);

    els.weeklyBars.forEach(function (bar, index) {
      const count = counts[index];
      // Keep the tallest bar at 80% so the day labels fit, and let the
      // stylesheet's min-height keep zero days visible.
      const height = maxCount > 0 ? Math.round((count / maxCount) * 80) : 0;
      const label = weeklyBarLabel(index, count);

      bar.dataset.value = String(count);
      bar.style.height = height + '%';
      bar.title = label;
      bar.setAttribute('aria-label', label);
    });

    els.weeklyChart.setAttribute('aria-label', weeklyChartLabel(counts, total));

    if (els.weeklyScaleMin) {
      els.weeklyScaleMin.textContent = '0';
    }

    if (els.weeklyScaleMax) {
      els.weeklyScaleMax.textContent = String(maxCount);
    }
  }

  function weeklyBarLabel(index, count) {
    if (count === 0) {
      return DAY_NAMES[index] + ': no tasks completed';
    }

    return DAY_NAMES[index] + ': ' + count + ' ' + plural(count, 'task') + ' completed';
  }

  function weeklyChartLabel(counts, total) {
    if (total === 0) {
      return 'Weekly task completion, Monday through Sunday: no tasks completed this week.';
    }

    const days = counts.map(function (count, index) {
      return DAY_NAMES[index] + ' ' + count + ' ' + plural(count, 'task');
    }).join(', ');

    return 'Weekly task completion, Monday through Sunday: ' + days + '. ' +
      total + ' ' + plural(total, 'task') + ' completed this week.';
  }

  function renderWeeklyProgressUnavailable() {
    if (!els.weeklyChart || els.weeklyBars.length !== WEEK_LENGTH) {
      return;
    }

    els.weeklyBars.forEach(function (bar) {
      bar.removeAttribute('data-value');
      bar.style.height = '0%';
      bar.title = 'Weekly completion data unavailable';
      bar.setAttribute('aria-label', 'Weekly completion data unavailable');
    });

    els.weeklyChart.setAttribute(
      'aria-label',
      'Weekly task completion is unavailable because saved tasks cannot be read.'
    );

    if (els.weeklyScaleMin) {
      els.weeklyScaleMin.textContent = EM_DASH;
    }

    if (els.weeklyScaleMax) {
      els.weeklyScaleMax.textContent = EM_DASH;
    }
  }

  function renderTodayTasks(tasks, todayStart, tomorrowStart) {
    const entries = tasks
      .map(function (task) {
        return { task: task, due: parseDate(task.dueDate) };
      })
      .filter(function (entry) {
        if (!entry.due || entry.due >= tomorrowStart) {
          return false;
        }

        // Tasks from earlier days stay listed while they are still active.
        if (entry.due < todayStart) {
          return !entry.task.completed;
        }

        return true;
      })
      .sort(function (a, b) {
        return (a.due - b.due) || a.task.title.localeCompare(b.task.title);
      });

    const fragment = document.createDocumentFragment();

    entries.forEach(function (entry) {
      fragment.appendChild(createTaskRow(entry.task, todayStart));
    });

    els.todayList.replaceChildren(fragment);
    els.todayEmpty.hidden = entries.length > 0;
    els.todayEmpty.textContent = tasks.length === 0
      ? 'No tasks yet. Add your first task on My Tasks.'
      : 'Nothing due today. Enjoy the breathing room.';
  }

  function createTaskRow(task, todayStart) {
    const node = els.todayTemplate.content.firstElementChild.cloneNode(true);
    const checkbox = node.querySelector('.task-checkbox');
    const title = node.querySelector('.task-title');
    const category = node.querySelector('.task-category');
    const priority = node.querySelector('.task-priority');
    const time = node.querySelector('.task-time');
    const due = parseDate(task.dueDate);

    node.dataset.taskId = task.id;
    node.classList.toggle('is-completed', task.completed);

    checkbox.dataset.taskId = task.id;
    checkbox.checked = task.completed;
    checkbox.setAttribute(
      'aria-label',
      'Mark \'' + task.title + '\' as ' + (task.completed ? 'not complete' : 'complete')
    );

    title.textContent = task.title;
    category.textContent = CATEGORY_LABELS[task.category] || 'Other';

    const priorityKey = PRIORITY_LABELS[task.priority] ? task.priority : 'medium';
    priority.textContent = PRIORITY_LABELS[priorityKey];
    priority.classList.add('task-priority-' + priorityKey);

    if (task.completed) {
      time.textContent = formatCompletedLabel(task);
      time.classList.add('task-time-completed');
    } else if (due && due < todayStart) {
      time.textContent = 'Overdue \u00b7 ' + monthDayFormatter.format(due);
      time.classList.add('task-time-overdue');
    } else if (due) {
      time.textContent = timeFormatter.format(due);
    } else {
      time.textContent = '';
    }

    return node;
  }

  function renderUpcomingDeadlines(tasks, tomorrowStart) {
    const entries = tasks
      .map(function (task) {
        return { task: task, due: parseDate(task.dueDate) };
      })
      .filter(function (entry) {
        return Boolean(entry.due) && entry.due >= tomorrowStart && !entry.task.completed;
      })
      .sort(function (a, b) {
        return (a.due - b.due) || a.task.title.localeCompare(b.task.title);
      });

    const visible = entries.slice(0, MAX_DEADLINES);
    const fragment = document.createDocumentFragment();

    visible.forEach(function (entry) {
      fragment.appendChild(createDeadlineItem(entry.task, entry.due));
    });

    els.deadlineList.replaceChildren(fragment);
    els.deadlineEmpty.hidden = entries.length > 0;
    els.deadlineEmpty.textContent = tasks.length === 0
      ? 'No deadlines scheduled.'
      : 'No upcoming deadlines.';

    const remaining = entries.length - visible.length;

    if (remaining > 0) {
      els.deadlineMore.hidden = false;
      els.deadlineMore.textContent = remaining + (remaining === 1
        ? ' more upcoming deadline'
        : ' more upcoming deadlines');
    } else {
      els.deadlineMore.hidden = true;
      els.deadlineMore.textContent = '';
    }
  }

  function createDeadlineItem(task, due) {
    const node = els.deadlineTemplate.content.firstElementChild.cloneNode(true);
    const title = node.querySelector('.deadline-title');
    const date = node.querySelector('.deadline-date');
    const isUrgent = due.getTime() - Date.now() <= DAY_IN_MS;

    node.dataset.taskId = task.id;
    node.classList.toggle('urgent', isUrgent);
    title.textContent = task.title;
    date.textContent = formatDeadlineDate(due);

    return node;
  }

  function renderStorageProblem(status) {
    els.todayList.replaceChildren();
    els.deadlineList.replaceChildren();
    els.todayEmpty.hidden = true;
    els.deadlineEmpty.hidden = true;
    els.deadlineMore.hidden = true;
    els.deadlineMore.textContent = '';
    els.dueToday.textContent = EM_DASH;
    els.completed.textContent = EM_DASH;
    els.remaining.textContent = EM_DASH;
    renderWeeklyProgressUnavailable();
    renderFocusPaused();

    let message = 'Tasks could not be loaded right now.';

    if (status === 'corrupt') {
      message = 'Saved tasks could not be read. Your saved data has been left untouched, ' +
        'but the dashboard cannot show tasks until it is repaired.';
    } else if (status === 'unavailable') {
      message = 'Tasks cannot be read or saved in this browser. Enable storage for this site, ' +
        'then reload the page.';
    }

    showNotice(message);
  }

  /* ---------------------------------------------------------------------- */
  /* Completion toggles                                                     */
  /* ---------------------------------------------------------------------- */

  function handleTaskToggle(event) {
    const checkbox = event.target;

    if (!checkbox || !checkbox.classList || !checkbox.classList.contains('task-checkbox')) {
      return;
    }

    const id = checkbox.dataset.taskId;

    if (!id || !Store.get(id)) {
      render();
      return;
    }

    const task = Store.toggle(id);

    if (!task) {
      render();
      return;
    }

    if (!isPersisted(id, task)) {
      // Put the shared store back in sync with the saved collection and tell
      // the user the click was not saved instead of showing a false success.
      Store.initialize();
      render();
      showNotice(SAVE_ERROR);
      announce('Change could not be saved.');
      focusCheckbox(id);
      return;
    }

    render();
    notify(task.completed ? 'Task completed.' : 'Task reopened.');
    focusCheckbox(id);
  }

  function isPersisted(id, task) {
    if (!Storage || typeof Storage.load !== 'function') {
      return false;
    }

    const result = Storage.load();

    if (result.status !== 'ok') {
      return false;
    }

    const stored = result.tasks.find(function (item) {
      return item && item.id === id;
    });

    return Boolean(stored) && stored.completed === task.completed;
  }

  function focusCheckbox(id) {
    const checkboxes = els.todayList.querySelectorAll('.task-checkbox');
    let fallback = null;

    for (let index = 0; index < checkboxes.length; index += 1) {
      if (checkboxes[index].dataset.taskId === id) {
        checkboxes[index].focus({ preventScroll: true });
        return;
      }

      if (!fallback) {
        fallback = checkboxes[index];
      }
    }

    if (fallback) {
      fallback.focus({ preventScroll: true });
      return;
    }

    const heading = document.getElementById('today-tasks-heading');

    if (heading) {
      heading.focus({ preventScroll: true });
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Daily Focus                                                            */
  /* ---------------------------------------------------------------------- */

  function bindFocusEvents() {
    if (!els.focusCard) {
      return;
    }

    if (!FocusStore || !els.focusTaskList || !els.focusTaskTemplate || !els.focusDialog) {
      els.focusCard.hidden = true;
      return;
    }

    els.focusManageButton.addEventListener('click', function (event) {
      openFocusDialog(event.currentTarget);
    });

    els.focusEmptyButton.addEventListener('click', function (event) {
      openFocusDialog(event.currentTarget);
    });

    els.focusTaskList.addEventListener('change', handleFocusToggle);
    els.focusTaskList.addEventListener('click', handleFocusListClick);

    els.focusIntentionEditButton.addEventListener('click', openIntentionEditor);
    els.focusIntentionCancel.addEventListener('click', function () {
      closeIntentionEditor(true);
    });
    els.focusIntentionForm.addEventListener('submit', handleIntentionSubmit);
    els.focusIntentionInput.addEventListener('input', handleIntentionInput);
    els.focusIntentionInput.addEventListener('keydown', handleIntentionKeydown);

    els.focusDialogForm.addEventListener('submit', saveFocusDialog);
    els.focusDialogList.addEventListener('change', handleFocusCandidateChange);
    els.focusDialog.addEventListener('cancel', handleFocusDialogCancel);
    els.focusDialog.addEventListener('close', handleFocusDialogClose);
    document.addEventListener('keydown', handleFocusDialogTab);

    els.focusDialog.querySelectorAll('[data-close-focus]').forEach(function (button) {
      button.addEventListener('click', function () {
        els.focusDialog.close();
      });
    });
  }

  function renderFocus(tasks) {
    if (!FocusStore || !els.focusCard || !els.focusTaskList || !els.focusTaskTemplate) {
      return;
    }

    if (els.focusDate) {
      els.focusDate.textContent = longDateFormatter.format(new Date());
    }

    const plan = FocusStore.getTodayPlan();
    const tasksById = new Map();

    tasks.forEach(function (task) {
      tasksById.set(task.id, task);
    });

    const selected = [];
    const seen = new Set();

    plan.taskIds.forEach(function (id) {
      const task = tasksById.get(id);

      if (task && !seen.has(id) && selected.length < FOCUS_MAX_TASKS) {
        seen.add(id);
        selected.push(task);
      }
    });

    // A deleted task must not stay in the interface or in the saved plan.
    // Only write when there is something to clean, and only once per shape.
    maybeCleanFocusIds(plan, selected);
    renderFocusIntention(plan);
    renderFocusTasks(selected);
    renderFocusProgress(selected);
    updateFocusEmptyState(selected, tasks.length);
    renderFocusStorageNote();
  }

  function renderFocusPaused() {
    if (!FocusStore || !els.focusCard || !els.focusTaskList) {
      return;
    }

    if (els.focusDate) {
      els.focusDate.textContent = longDateFormatter.format(new Date());
    }

    const plan = FocusStore.getTodayPlan();
    renderFocusIntention(plan);
    els.focusTaskList.replaceChildren();
    els.focusTaskList.hidden = true;
    els.focusProgress.hidden = true;
    els.focusComplete.hidden = true;
    els.focusManageButton.hidden = true;
    els.focusEmpty.hidden = false;
    els.focusEmptyTitle.textContent = 'Daily Focus is paused';
    els.focusEmptyText.textContent =
      'Your focus priorities need saved tasks, which cannot be loaded right now.';
    els.focusEmptyButton.hidden = true;
    els.focusEmptyLink.hidden = true;
    renderFocusStorageNote();
  }

  function maybeCleanFocusIds(plan, selected) {
    if (FocusStore.getStatus() !== 'ok') {
      return;
    }

    const validIds = selected.map(function (task) {
      return task.id;
    });

    if (plan.taskIds.length === validIds.length &&
        plan.taskIds.every(function (id, index) {
          return id === validIds[index];
        })) {
      return;
    }

    const signature = plan.dateKey + '|' + plan.taskIds.join(',') + '|' + validIds.join(',');

    if (signature === focusCleanupSignature) {
      return;
    }

    focusCleanupSignature = signature;

    if (FocusStore.setTaskIds(validIds).ok) {
      focusCleanupSignature = '';
    }
  }

  function renderFocusStorageNote() {
    if (!els.focusStorageNote) {
      return;
    }

    let message = '';
    let isError = false;

    if (focusSaveError) {
      message = focusSaveError;
      isError = true;
    } else if (FocusStore.getStatus() === 'unavailable') {
      message = FOCUS_STORAGE_NOTE;
    } else if (FocusStore.getStatus() === 'corrupt') {
      message = FOCUS_CORRUPT_NOTE;
    }

    els.focusStorageNote.textContent = message;
    els.focusStorageNote.hidden = !message;
    els.focusStorageNote.classList.toggle('is-error', isError);
  }

  function renderFocusIntention(plan) {
    if (!els.focusIntentionText) {
      return;
    }

    const hasIntention = Boolean(plan.intention);

    els.focusIntentionText.textContent = hasIntention
      ? plan.intention
      : 'A short intention can anchor the day.';
    els.focusIntentionText.classList.toggle('is-placeholder', !hasIntention);
    els.focusIntentionEditButton.textContent = hasIntention ? 'Edit intention' : 'Add intention';
    els.focusIntentionEditButton.setAttribute(
      'aria-label',
      hasIntention ? 'Edit today\'s intention' : 'Add today\'s intention'
    );

    if (!focusIntentionEditing) {
      els.focusIntentionForm.hidden = true;
      els.focusIntentionDisplay.hidden = false;
    }
  }

  function renderFocusTasks(selected) {
    const fragment = document.createDocumentFragment();

    selected.forEach(function (task) {
      fragment.appendChild(createFocusTask(task));
    });

    els.focusTaskList.replaceChildren(fragment);
    els.focusTaskList.hidden = selected.length === 0;
  }

  function createFocusTask(task) {
    const node = els.focusTaskTemplate.content.firstElementChild.cloneNode(true);
    const checkbox = node.querySelector('.focus-task-checkbox');
    const checkboxLabel = node.querySelector('.focus-task-check-label');
    const title = node.querySelector('.focus-task-title');
    const category = node.querySelector('.task-category');
    const priority = node.querySelector('.task-priority');
    const time = node.querySelector('.task-time');
    const removeButton = node.querySelector('.focus-task-remove');
    const removeLabel = node.querySelector('.focus-task-remove-label');
    const due = parseDate(task.dueDate);
    const todayStart = startOfDay(new Date());

    node.dataset.taskId = task.id;
    node.classList.toggle('is-completed', task.completed);

    checkbox.dataset.taskId = task.id;
    checkbox.checked = task.completed;
    checkboxLabel.textContent = task.completed
      ? 'Reopen task: ' + task.title
      : 'Mark task complete: ' + task.title;

    title.textContent = task.title;
    category.textContent = CATEGORY_LABELS[task.category] || 'Other';

    const priorityKey = PRIORITY_LABELS[task.priority] ? task.priority : 'medium';
    priority.textContent = PRIORITY_LABELS[priorityKey];
    priority.classList.add('task-priority-' + priorityKey);

    if (task.completed) {
      time.textContent = formatCompletedLabel(task);
      time.classList.add('task-time-completed');
    } else if (due && due < todayStart) {
      time.textContent = 'Overdue \u00b7 ' + monthDayFormatter.format(due);
      time.classList.add('task-time-overdue');
    } else if (due) {
      const dueDay = startOfDay(due);

      time.textContent = dueDay.getTime() === todayStart.getTime()
        ? timeFormatter.format(due)
        : formatDeadlineDate(due);
    } else {
      time.hidden = true;
    }

    removeButton.setAttribute(
      'aria-label',
      'Remove \'' + task.title + '\' from today\'s focus'
    );
    removeLabel.textContent = 'Remove ' + task.title + ' from today\'s focus';

    return node;
  }

  function renderFocusProgress(selected) {
    const total = selected.length;
    const completed = selected.filter(function (task) {
      return task.completed;
    }).length;
    const remaining = total - completed;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    const allComplete = total > 0 && completed === total;

    els.focusProgressText.textContent = completed + ' of ' + total + ' completed';
    els.focusProgressPercent.textContent = percent + '%';
    els.focusProgressFill.style.width = percent + '%';
    els.focusProgressBar.setAttribute('aria-valuenow', String(percent));
    els.focusProgressBar.setAttribute(
      'aria-valuetext',
      total > 0
        ? completed + ' of ' + total + ' priorities complete, ' + percent + ' percent'
        : 'No priorities selected'
    );

    els.focusCompleteText.textContent = completed + ' of ' + total + ' ' +
      (total === 1 ? 'priority' : 'priorities') + ' completed.';
    els.focusComplete.hidden = !allComplete;
    els.focusSummary.hidden = allComplete || total === 0;
    els.focusSummary.textContent = remaining + ' ' +
      (remaining === 1 ? 'priority' : 'priorities') + ' remaining.';
  }

  function updateFocusEmptyState(selected, taskCount) {
    const hasSelection = selected.length > 0;

    els.focusEmpty.hidden = hasSelection;
    els.focusProgress.hidden = !hasSelection;
    els.focusManageButton.hidden = !hasSelection;

    if (hasSelection) {
      return;
    }

    els.focusComplete.hidden = true;

    if (taskCount === 0) {
      els.focusEmptyTitle.textContent = 'A clear slate.';
      els.focusEmptyText.textContent =
        'Add your first task on My Tasks, then choose up to three priorities here.';
      els.focusEmptyButton.hidden = true;
      els.focusEmptyLink.hidden = false;
      return;
    }

    els.focusEmptyTitle.textContent = 'What matters most today?';
    els.focusEmptyText.textContent =
      'Choose up to three tasks to give the day a clear direction.';
    els.focusEmptyButton.hidden = false;
    els.focusEmptyLink.hidden = true;
  }

  function openFocusDialog(trigger) {
    if (!FocusStore || !els.focusDialog || els.focusDialog.open) {
      return;
    }

    focusDialogReturnFocus = trigger || document.activeElement;
    renderFocusCandidates(FocusStore.getTodayPlan().taskIds);
    clearFocusDialogError();
    els.focusDialog.showModal();

    const checked = els.focusDialogList.querySelector('.focus-candidate-checkbox:checked');
    const first = els.focusDialogList.querySelector('.focus-candidate-checkbox');
    const target = checked || first || els.focusDialogClose;

    if (target) {
      target.focus({ preventScroll: true });
    }
  }

  function renderFocusCandidates(selectedIds) {
    els.focusDialogList.replaceChildren();

    const active = Store.query({ status: 'active', sort: 'dueDate' });
    const completed = Store.query({ status: 'completed', sort: 'dueDate' });
    const selected = new Set(selectedIds);

    if (active.length === 0 && completed.length === 0) {
      els.focusDialogEmpty.hidden = false;
      els.focusDialogSave.disabled = true;
      els.focusDialogCount.textContent = 'No tasks available.';
      return;
    }

    els.focusDialogEmpty.hidden = true;
    els.focusDialogSave.disabled = false;

    if (active.length > 0) {
      els.focusDialogList.appendChild(
        createFocusCandidateGroup('To do', active, selected, '')
      );
    }

    if (completed.length > 0) {
      els.focusDialogList.appendChild(
        createFocusCandidateGroup(
          'Completed',
          completed,
          selected,
          'Completed tasks count as complete in today\'s progress.'
        )
      );
    }

    updateFocusDialogCount();
  }

  function createFocusCandidateGroup(label, tasks, selected, note) {
    const fieldset = document.createElement('fieldset');
    const legend = document.createElement('legend');
    const list = document.createElement('div');

    fieldset.className = 'focus-candidate-group';
    legend.textContent = label + ' (' + tasks.length + ')';
    list.className = 'focus-candidate-list';
    fieldset.appendChild(legend);

    if (note) {
      const noteNode = document.createElement('p');
      noteNode.className = 'focus-candidate-note';
      noteNode.textContent = note;
      fieldset.appendChild(noteNode);
    }

    tasks.forEach(function (task) {
      list.appendChild(createFocusCandidate(task, selected.has(task.id)));
    });

    fieldset.appendChild(list);
    return fieldset;
  }

  function createFocusCandidate(task, isSelected) {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    const body = document.createElement('span');
    const title = document.createElement('span');
    const meta = document.createElement('span');
    const category = document.createElement('span');
    const priority = document.createElement('span');
    const status = document.createElement('span');
    const due = parseDate(task.dueDate);
    const priorityKey = PRIORITY_LABELS[task.priority] ? task.priority : 'medium';

    label.className = 'focus-candidate';
    label.dataset.taskId = task.id;
    label.classList.toggle('is-selected', isSelected);
    label.classList.toggle('is-completed', task.completed);

    checkbox.type = 'checkbox';
    checkbox.className = 'focus-candidate-checkbox';
    checkbox.value = task.id;
    checkbox.checked = isSelected;
    checkbox.setAttribute(
      'aria-label',
      'Select ' + task.title + (task.completed ? ' (completed)' : '')
    );

    body.className = 'focus-candidate-body';
    title.className = 'focus-candidate-title';
    title.textContent = task.title;

    meta.className = 'focus-candidate-meta';
    category.className = 'task-category';
    category.textContent = CATEGORY_LABELS[task.category] || 'Other';
    priority.className = 'task-priority task-priority-' + priorityKey;
    priority.textContent = PRIORITY_LABELS[priorityKey];
    meta.appendChild(category);
    meta.appendChild(priority);

    if (task.completed) {
      status.className = 'focus-candidate-status';
      status.textContent = 'Completed';
      meta.appendChild(status);
    } else if (due) {
      status.className = 'focus-candidate-due';
      status.textContent = formatFocusDue(due);
      meta.appendChild(status);
    }

    body.appendChild(title);
    body.appendChild(meta);
    label.appendChild(checkbox);
    label.appendChild(body);
    return label;
  }

  function formatFocusDue(due) {
    const todayStart = startOfDay(new Date());

    if (due < todayStart) {
      return 'Overdue \u00b7 ' + monthDayFormatter.format(due);
    }

    if (startOfDay(due).getTime() === todayStart.getTime()) {
      return timeFormatter.format(due);
    }

    return formatDeadlineDate(due);
  }

  function updateFocusDialogCount() {
    const count = getCheckedFocusIds().length;

    els.focusDialogCount.textContent = count + ' of ' + FOCUS_MAX_TASKS + ' selected' +
      (count >= FOCUS_MAX_TASKS ? '. Limit reached.' : '.');
  }

  function getCheckedFocusIds() {
    const ids = [];
    const seen = new Set();
    const checkboxes = els.focusDialogList.querySelectorAll('.focus-candidate-checkbox:checked');

    checkboxes.forEach(function (checkbox) {
      const id = checkbox.value;

      if (id && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    });

    return ids;
  }

  function handleFocusCandidateChange(event) {
    const checkbox = event.target.closest('.focus-candidate-checkbox');

    if (!checkbox) {
      return;
    }

    const candidate = checkbox.closest('.focus-candidate');
    const ids = getCheckedFocusIds();

    if (ids.length > FOCUS_MAX_TASKS) {
      checkbox.checked = false;

      if (candidate) {
        candidate.classList.remove('is-selected');
      }

      setFocusDialogError(
        'You can choose up to three priorities. Remove one before adding another.'
      );
      updateFocusDialogCount();
      return;
    }

    if (candidate) {
      candidate.classList.toggle('is-selected', checkbox.checked);
    }

    clearFocusDialogError();
    updateFocusDialogCount();
  }

  function setFocusDialogError(message) {
    els.focusDialogError.textContent = message;
    els.focusDialogError.hidden = false;
  }

  function clearFocusDialogError() {
    els.focusDialogError.textContent = '';
    els.focusDialogError.hidden = true;
  }

  function saveFocusDialog(event) {
    event.preventDefault();

    if (!FocusStore) {
      return;
    }

    const ids = getCheckedFocusIds();

    if (ids.length > FOCUS_MAX_TASKS) {
      setFocusDialogError(
        'You can choose up to three priorities. Remove one before saving.'
      );
      return;
    }

    const result = FocusStore.setTaskIds(ids);

    if (!result.ok) {
      focusSaveError = FOCUS_SAVE_ERROR;
      renderFocusStorageNote();
      clearFocusToast();
      setFocusDialogError(
        'Your focus could not be saved, so your previous selection is unchanged. ' +
        'Check browser storage, then try again.'
      );
      return;
    }

    focusSaveError = '';
    clearFocusDialogError();
    renderFocus(Store.getAll());
    els.focusDialog.close();

    const total = FocusStore.getTodayPlan().taskIds.length;

    notify(total === 0
      ? 'Today\'s focus cleared.'
      : 'Daily Focus updated. ' + total + ' of ' + FOCUS_MAX_TASKS + ' priorities selected.');
  }

  function handleFocusDialogCancel(event) {
    event.preventDefault();
    els.focusDialog.close();
  }

  function handleFocusDialogClose() {
    const target = resolveFocusDialogReturn();

    focusDialogReturnFocus = null;

    if (target && typeof target.focus === 'function') {
      target.focus({ preventScroll: true });
    }
  }

  function resolveFocusDialogReturn() {
    const candidates = [
      els.focusManageButton,
      els.focusEmptyButton,
      els.focusEmptyLink,
      focusDialogReturnFocus,
      els.focusHeading
    ];

    for (let index = 0; index < candidates.length; index += 1) {
      const element = candidates[index];

      if (element &&
          !element.hidden &&
          element.getClientRects().length > 0) {
        return element;
      }
    }

    return els.focusHeading;
  }

  /**
   * Native <dialog> traps focus itself. This covers the same edge as the task
   * dialogs: tabbing from the last control must not land on the page body.
   */
  function handleFocusDialogTab(event) {
    if (event.key !== 'Tab' || event.defaultPrevented ||
        !els.focusDialog || !els.focusDialog.open) {
      return;
    }

    const focusable = Array.prototype.slice.call(els.focusDialog.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), ' +
      'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(function (element) {
      return element.getClientRects().length > 0;
    });

    if (focusable.length === 0) {
      event.preventDefault();
      els.focusDialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey) {
      if (active === first || !els.focusDialog.contains(active)) {
        event.preventDefault();
        last.focus();
      }

      return;
    }

    if (active === last || !els.focusDialog.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  }

  function openIntentionEditor() {
    if (!FocusStore || !els.focusIntentionForm) {
      return;
    }

    const plan = FocusStore.getTodayPlan();

    focusIntentionEditing = true;
    els.focusIntentionDisplay.hidden = true;
    els.focusIntentionForm.hidden = false;
    els.focusIntentionInput.value = plan.intention;
    clearIntentionError();
    updateIntentionCount();
    els.focusIntentionInput.focus({ preventScroll: true });

    const end = els.focusIntentionInput.value.length;

    if (typeof els.focusIntentionInput.setSelectionRange === 'function') {
      els.focusIntentionInput.setSelectionRange(end, end);
    }
  }

  function closeIntentionEditor(restoreFocus) {
    focusIntentionEditing = false;
    els.focusIntentionForm.hidden = true;
    els.focusIntentionDisplay.hidden = false;
    clearIntentionError();

    if (restoreFocus) {
      els.focusIntentionEditButton.focus({ preventScroll: true });
    }
  }

  function handleIntentionInput() {
    if (!els.focusIntentionError.hidden) {
      clearIntentionError();
    }

    updateIntentionCount();
  }

  function handleIntentionKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeIntentionEditor(true);
    }
  }

  function updateIntentionCount() {
    if (!els.focusIntentionCount) {
      return;
    }

    els.focusIntentionCount.textContent =
      els.focusIntentionInput.value.length + ' / ' + FOCUS_MAX_INTENTION;
  }

  function showIntentionError(message) {
    els.focusIntentionError.textContent = message;
    els.focusIntentionError.hidden = false;
    els.focusIntentionInput.setAttribute('aria-invalid', 'true');
  }

  function clearIntentionError() {
    els.focusIntentionError.textContent = '';
    els.focusIntentionError.hidden = true;
    els.focusIntentionInput.removeAttribute('aria-invalid');
  }

  function handleIntentionSubmit(event) {
    event.preventDefault();

    if (!FocusStore) {
      return;
    }

    const value = els.focusIntentionInput.value.trim();

    if (value.length > FOCUS_MAX_INTENTION) {
      showIntentionError('Keep your intention to ' + FOCUS_MAX_INTENTION + ' characters or fewer.');
      els.focusIntentionInput.focus({ preventScroll: true });
      return;
    }

    const previous = FocusStore.getTodayPlan().intention;

    if (value === previous) {
      closeIntentionEditor(false);
      renderFocusIntention(FocusStore.getTodayPlan());
      els.focusIntentionEditButton.focus({ preventScroll: true });
      return;
    }

    const result = FocusStore.setIntention(value);

    if (!result.ok) {
      focusSaveError = FOCUS_SAVE_ERROR;
      renderFocusStorageNote();
      clearFocusToast();
      showIntentionError(
        result.reason === 'too-long'
          ? 'Keep your intention to ' + FOCUS_MAX_INTENTION + ' characters or fewer.'
          : 'Your intention could not be saved, so it is still here for you to try again.'
      );
      els.focusIntentionInput.focus({ preventScroll: true });
      return;
    }

    focusSaveError = '';
    closeIntentionEditor(false);
    renderFocusIntention(FocusStore.getTodayPlan());
    renderFocusStorageNote();
    els.focusIntentionEditButton.focus({ preventScroll: true });
    notify(previous && !value ? 'Intention cleared.' : 'Intention saved.');
  }

  function handleFocusToggle(event) {
    const checkbox = event.target.closest('.focus-task-checkbox');

    if (!checkbox) {
      return;
    }

    const row = checkbox.closest('[data-task-id]');
    const id = row ? row.dataset.taskId : '';
    const task = id ? Store.get(id) : null;

    if (!task) {
      renderFocus(Store.getAll());
      return;
    }

    if (Store.getStorageStatus() !== 'ok') {
      renderFocus(Store.getAll());
      notify('Task change could not be saved.', 'error');
      focusFocusCheckbox(id);
      return;
    }

    const changed = Store.toggle(id);

    if (!changed) {
      renderFocus(Store.getAll());
      notify('Task could not be updated.', 'error');
      focusFocusCheckbox(id);
      return;
    }

    if (!isPersisted(id, changed)) {
      Store.initialize();
      render();
      notify('Task change could not be saved.', 'error');
      focusFocusCheckbox(id);
      return;
    }

    render();
    notify(focusToggleMessage(changed));
    focusFocusCheckbox(id);
  }

  function focusToggleMessage(task) {
    const plan = FocusStore.getTodayPlan();
    const selected = plan.taskIds
      .map(function (id) {
        return Store.get(id);
      })
      .filter(Boolean);
    const total = selected.length;
    const completed = selected.filter(function (item) {
      return item.completed;
    }).length;

    if (task.completed && total > 0 && completed === total) {
      return 'Task completed. Today\'s focus is complete.';
    }

    return (task.completed ? 'Task completed. ' : 'Task reopened. ') +
      completed + ' of ' + total + ' priorities complete.';
  }

  function handleFocusListClick(event) {
    const removeButton = event.target.closest('.focus-task-remove');

    if (!removeButton) {
      return;
    }

    const row = removeButton.closest('[data-task-id]');
    const id = row ? row.dataset.taskId : '';
    const plan = FocusStore.getTodayPlan();

    if (!id || plan.taskIds.indexOf(id) === -1) {
      return;
    }

    const removeButtons = Array.prototype.slice.call(
      els.focusTaskList.querySelectorAll('.focus-task-remove')
    );
    const index = removeButtons.indexOf(removeButton);
    const nextIds = plan.taskIds.filter(function (taskId) {
      return taskId !== id;
    });
    const result = FocusStore.setTaskIds(nextIds);

    if (!result.ok) {
      focusSaveError = FOCUS_SAVE_ERROR;
      renderFocusStorageNote();
      notify('Task could not be removed from today\'s focus. It is still selected.', 'error');
      removeButton.focus({ preventScroll: true });
      return;
    }

    focusSaveError = '';
    renderFocus(Store.getAll());
    focusFocusAfterRemoval(index);
    notify('Removed from today\'s focus. The task itself is unchanged.');
  }

  function focusFocusCheckbox(id) {
    const checkboxes = els.focusTaskList.querySelectorAll('.focus-task-checkbox');

    for (let index = 0; index < checkboxes.length; index += 1) {
      if (checkboxes[index].dataset.taskId === id) {
        checkboxes[index].focus({ preventScroll: true });
        return;
      }
    }

    focusCardFallback();
  }

  function focusFocusAfterRemoval(index) {
    const removeButtons = els.focusTaskList.querySelectorAll('.focus-task-remove');

    if (removeButtons.length > 0) {
      const target = removeButtons[Math.min(index, removeButtons.length - 1)];
      target.focus({ preventScroll: true });
      return;
    }

    focusCardFallback();
  }

  function focusCardFallback() {
    if (els.focusEmptyButton && !els.focusEmptyButton.hidden) {
      els.focusEmptyButton.focus({ preventScroll: true });
      return;
    }

    if (els.focusManageButton && !els.focusManageButton.hidden) {
      els.focusManageButton.focus({ preventScroll: true });
      return;
    }

    if (els.focusHeading) {
      els.focusHeading.focus({ preventScroll: true });
    }
  }

  function syncFocusDate(announce) {
    if (!FocusStore) {
      return;
    }

    const current = FocusStore.getDateKey();

    if (current === lastFocusDate) {
      return;
    }

    lastFocusDate = current;
    focusSaveError = '';

    if (focusIntentionEditing) {
      closeIntentionEditor(false);
    }

    if (els.focusDialog && els.focusDialog.open) {
      els.focusDialog.close();
    }

    FocusStore.initialize();
    updateWelcome();
    render();

    if (announce && !document.hidden) {
      notify('A new day has started. Your Daily Focus is ready for today.');
    }
  }

  function handleFocusStorageEvent(event) {
    if (!event || event.key === null) {
      Store.initialize();

      if (FocusStore) {
        FocusStore.initialize();
        focusSaveError = '';
      }

      lastFocusDate = FocusStore ? FocusStore.getDateKey() : '';
      render();
      return;
    }

    const tasksChanged = Storage && event.key === Storage.KEY;
    const focusChanged = FocusStore && event.key === FocusStore.KEY;

    if (!tasksChanged && !focusChanged) {
      return;
    }

    if (tasksChanged) {
      Store.initialize();
    }

    if (focusChanged) {
      FocusStore.initialize();
      focusSaveError = '';
    }

    lastFocusDate = FocusStore ? FocusStore.getDateKey() : '';
    render();
  }

  /* ---------------------------------------------------------------------- */
  /* Formatting helpers                                                     */
  /* ---------------------------------------------------------------------- */

  function parseDate(value) {
    if (!value) {
      return null;
    }

    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  function startOfDay(date) {
    const copy = new Date(date.getTime());
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  function addDays(date, days) {
    const copy = new Date(date.getTime());
    copy.setDate(copy.getDate() + days);
    return copy;
  }

  /**
   * Monday is the first day of the week. getDay() returns Sunday as 0, so
   * shift it into a Monday-based index before subtracting.
   */
  function startOfWeek(date) {
    const start = startOfDay(date);
    const mondayOffset = (start.getDay() + 6) % 7;
    return addDays(start, -mondayOffset);
  }

  /**
   * Counts calendar days rather than milliseconds so daylight-saving changes
   * cannot shift a completion into the wrong bar.
   */
  function calendarDayNumber(date) {
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_IN_MS;
  }

  function dayIndex(date, weekStart) {
    return calendarDayNumber(date) - calendarDayNumber(weekStart);
  }

  function plural(count, singular) {
    return count === 1 ? singular : singular + 's';
  }

  function formatCompletedLabel(task) {
    const completed = parseDate(task.completedAt);

    if (!completed) {
      return 'Completed';
    }

    const now = new Date();

    if (startOfDay(completed).getTime() === startOfDay(now).getTime()) {
      return 'Completed ' + timeFormatter.format(completed);
    }

    return 'Completed ' + monthDayFormatter.format(completed);
  }

  function formatDeadlineDate(due) {
    const now = new Date();
    const daysAway = Math.round((startOfDay(due) - startOfDay(now)) / DAY_IN_MS);
    const time = timeFormatter.format(due);

    if (daysAway === 1) {
      return 'Tomorrow \u00b7 ' + time;
    }

    const dateLabel = due.getFullYear() === now.getFullYear()
      ? weekdayDateFormatter.format(due)
      : fullDateFormatter.format(due);

    return dateLabel + ' \u00b7 ' + time;
  }

  /* ---------------------------------------------------------------------- */
  /* Feedback                                                               */
  /* ---------------------------------------------------------------------- */

  function showNotice(message) {
    if (!els.notice || !els.noticeText) {
      return;
    }

    els.noticeText.textContent = message;
    els.notice.hidden = false;
  }

  function clearNotice() {
    if (!els.notice || !els.noticeText) {
      return;
    }

    els.noticeText.textContent = '';
    els.notice.hidden = true;
  }

  function notify(message, tone) {
    if (UI && typeof UI.notify === 'function') {
      UI.notify(message, { tone: tone === 'error' ? 'error' : 'success' });
      return;
    }

    announce(message);
  }

  function clearFocusToast() {
    if (UI && typeof UI.clearToast === 'function') {
      UI.clearToast();
    }
  }

  function announce(message) {
    if (!els.announcer) {
      return;
    }

    els.announcer.textContent = '';

    window.setTimeout(function () {
      els.announcer.textContent = message;
    }, 60);
  }

  /* ---------------------------------------------------------------------- */
  /* Boot                                                                   */
  /* ---------------------------------------------------------------------- */

  // Editing tasks in another tab makes this page stale. Re-read the saved
  // collection when the browser restores the page from its back/forward cache.
  window.addEventListener('pageshow', function (event) {
    if (!event.persisted || !els.todayList) {
      return;
    }

    Store.initialize();

    if (FocusStore) {
      FocusStore.initialize();
      lastFocusDate = FocusStore.getDateKey();
    }

    render();
  });

  // A long-running session must not keep showing yesterday's plan. Check the
  // local calendar when the page is focused or becomes visible again; there
  // is deliberately no midnight timer.
  window.addEventListener('focus', function () {
    syncFocusDate(true);
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      syncFocusDate(true);
    }
  });

  window.addEventListener('storage', handleFocusStorageEvent);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

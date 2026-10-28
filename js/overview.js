/**
 * Daymark - Overview Module
 * Weekly statistics for the Weekly Overview page.
 *
 * All data comes from the shared task collection in js/task-store.js. This
 * page is read-only: it never adds, edits, completes, or removes tasks.
 *
 * Week definition: Monday 00:00 through Sunday 23:59:59.999 in the user's
 * local time zone. Statistics for the current week are:
 * - Completed: tasks marked complete whose completedAt falls in the week.
 * - Remaining: active (not completed) tasks whose dueDate falls in the week.
 * - Completion rate: completed / (completed + remaining), when that total is
 *   greater than zero.
 */

(function () {
  'use strict';

  const Store = window.DaymarkTaskStore;
  const EM_DASH = '\u2014';
  const WEEK_LENGTH = 7;

  const weekdayFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: 'short'
  });
  const weekdayLongFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: 'long'
  });
  const monthDayFormatter = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric'
  });
  const monthDayYearFormatter = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  const els = {};

  /* ---------------------------------------------------------------------- */
  /* Startup                                                                */
  /* ---------------------------------------------------------------------- */

  function init() {
    cacheElements();

    if (!hasRequiredElements()) {
      return;
    }

    initializeStore();
    render();
  }

  function cacheElements() {
    els.weekRange = document.getElementById('overviewWeekRange');
    els.notice = document.getElementById('overviewNotice');
    els.noticeText = document.getElementById('overviewNoticeText');
    els.completed = document.getElementById('overviewCompleted');
    els.remaining = document.getElementById('overviewRemaining');
    els.rate = document.getElementById('overviewRate');
    els.summaryNote = document.getElementById('overviewSummaryNote');
    els.weekTotal = document.getElementById('overviewWeekTotal');
    els.dayList = document.getElementById('overviewDayList');
    els.daysEmpty = document.getElementById('overviewDaysEmpty');
    els.daysNote = document.getElementById('overviewDaysNote');
    els.dayTemplate = document.getElementById('overviewDayTemplate');
  }

  function hasRequiredElements() {
    return Boolean(
      els.weekRange &&
      els.completed &&
      els.remaining &&
      els.rate &&
      els.summaryNote &&
      els.weekTotal &&
      els.dayList &&
      els.daysEmpty &&
      els.daysNote &&
      els.dayTemplate
    );
  }

  function initializeStore() {
    if (!Store || typeof Store.initialize !== 'function') {
      return;
    }

    try {
      Store.initialize();
    } catch (error) {
      // Rendering below treats the store as unavailable instead of crashing
      // the page. Existing saved tasks are left untouched.
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Rendering                                                              */
  /* ---------------------------------------------------------------------- */

  function render() {
    const now = new Date();
    const weekStart = startOfWeek(now);
    const weekEnd = addDays(weekStart, WEEK_LENGTH);

    els.weekRange.textContent = formatWeekRange(weekStart, weekEnd);

    const status = getStorageStatus();

    if (status !== 'ok') {
      renderStorageProblem(status);
      return;
    }

    const tasks = getTasks();

    if (!tasks) {
      renderStorageProblem('unavailable');
      return;
    }

    clearNotice();

    const week = collectWeekData(tasks, weekStart, weekEnd);

    renderSummary(week, tasks.length);
    renderBreakdown(week, weekStart);
  }

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

  /**
   * Reads the shared collection once and splits it into this week's
   * completions and active tasks due this week. Tasks are never modified.
   */
  function collectWeekData(tasks, weekStart, weekEnd) {
    const completed = [];
    const remaining = [];
    let missingCompletionTimestamps = 0;

    tasks.forEach(function (task) {
      if (!task || typeof task !== 'object') {
        return;
      }

      if (task.completed === true) {
        const completedAt = parseDate(task.completedAt);

        if (!completedAt) {
          missingCompletionTimestamps += 1;
          return;
        }

        if (completedAt >= weekStart && completedAt < weekEnd) {
          completed.push({ task: task, completedAt: completedAt });
        }

        return;
      }

      const dueDate = parseDate(task.dueDate);

      if (dueDate && dueDate >= weekStart && dueDate < weekEnd) {
        remaining.push(task);
      }
    });

    return {
      completed: completed,
      remaining: remaining,
      missingCompletionTimestamps: missingCompletionTimestamps
    };
  }

  function renderSummary(week, totalTasks) {
    const completedCount = week.completed.length;
    const remainingCount = week.remaining.length;
    const counted = completedCount + remainingCount;

    els.completed.textContent = String(completedCount);
    els.remaining.textContent = String(remainingCount);

    if (counted > 0) {
      const percent = Math.round((completedCount / counted) * 100);
      els.rate.textContent = percent + '%';
    } else {
      els.rate.textContent = EM_DASH;
    }

    if (counted > 0) {
      els.summaryNote.textContent = counted + ' ' + plural(counted, 'task') +
        ' counted this week: ' + completedCount + ' completed, ' +
        remainingCount + ' still open.';
    } else if (totalTasks === 0) {
      els.summaryNote.textContent =
        'No tasks yet. Add tasks in My Tasks to see your week here.';
    } else {
      els.summaryNote.textContent = 'No tasks were completed or due this week.';
    }
  }

  function renderBreakdown(week, weekStart) {
    const counts = new Array(WEEK_LENGTH).fill(0);

    week.completed.forEach(function (entry) {
      const index = dayIndex(entry.completedAt, weekStart);

      if (index >= 0 && index < WEEK_LENGTH) {
        counts[index] += 1;
      }
    });

    const maxCount = Math.max.apply(null, counts);
    const fragment = document.createDocumentFragment();

    for (let index = 0; index < WEEK_LENGTH; index += 1) {
      const date = addDays(weekStart, index);
      const count = counts[index];
      const row = createDayRow(date, count, maxCount);

      fragment.appendChild(row);
    }

    els.dayList.replaceChildren(fragment);
    els.dayList.hidden = false;
    els.daysEmpty.hidden = true;

    const completedCount = week.completed.length;
    els.weekTotal.textContent = completedCount + ' completed';

    if (week.missingCompletionTimestamps > 0) {
      const missing = week.missingCompletionTimestamps;

      els.daysNote.textContent = missing + ' completed ' +
        plural(missing, 'task') + ' ' + (missing === 1 ? 'has' : 'have') +
        ' no saved completion time, so ' +
        (missing === 1 ? 'it is' : 'they are') +
        ' not shown in the daily breakdown.';
      els.daysNote.hidden = false;
    } else {
      els.daysNote.textContent = '';
      els.daysNote.hidden = true;
    }
  }

  function createDayRow(date, count, maxCount) {
    const row = els.dayTemplate.content.firstElementChild.cloneNode(true);
    const name = row.querySelector('.overview-day-name');
    const dateLabel = row.querySelector('.overview-day-date');
    const bar = row.querySelector('.overview-day-bar');
    const countLabel = row.querySelector('.overview-day-count');
    const countText = formatTaskCount(count);
    const percent = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;

    name.textContent = weekdayFormatter.format(date);
    dateLabel.textContent = monthDayFormatter.format(date);
    countLabel.textContent = countText;

    if (bar) {
      bar.style.width = percent + '%';
    }

    row.classList.toggle('is-empty', count === 0);
    row.setAttribute(
      'aria-label',
      weekdayLongFormatter.format(date) + ', ' +
        monthDayFormatter.format(date) + ': ' + countText
    );

    return row;
  }

  function renderStorageProblem(status) {
    showNotice(storageMessage(status));

    els.completed.textContent = EM_DASH;
    els.remaining.textContent = EM_DASH;
    els.rate.textContent = EM_DASH;
    els.summaryNote.textContent =
      'Statistics will appear once saved tasks can be read.';

    els.weekTotal.textContent = EM_DASH;
    els.dayList.replaceChildren();
    els.dayList.hidden = true;
    els.daysEmpty.textContent =
      'The daily breakdown is unavailable until saved tasks can be read.';
    els.daysEmpty.hidden = false;
    els.daysNote.textContent = '';
    els.daysNote.hidden = true;
  }

  /* ---------------------------------------------------------------------- */
  /* Feedback                                                               */
  /* ---------------------------------------------------------------------- */

  function storageMessage(status) {
    if (status === 'corrupt') {
      return 'Saved task data could not be read, so weekly statistics are ' +
        'hidden. Your existing stored data has been left untouched.';
    }

    if (status === 'unavailable') {
      return 'Browser storage is unavailable, so saved tasks cannot be read. ' +
        'Weekly statistics are hidden and your tasks are unchanged.';
    }

    return 'Saved tasks are not available right now, so weekly statistics ' +
      'are hidden. Your tasks are unchanged.';
  }

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

  /* ---------------------------------------------------------------------- */
  /* Date and formatting helpers                                            */
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
   * cannot shift a completion into the wrong row.
   */
  function calendarDayNumber(date) {
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) /
      (24 * 60 * 60 * 1000);
  }

  function dayIndex(date, weekStart) {
    return calendarDayNumber(date) - calendarDayNumber(weekStart);
  }

  function formatWeekRange(weekStart, weekEnd) {
    const lastDay = addDays(weekEnd, -1);

    if (weekStart.getFullYear() !== lastDay.getFullYear()) {
      return monthDayYearFormatter.format(weekStart) + ' \u2013 ' +
        monthDayYearFormatter.format(lastDay);
    }

    return monthDayFormatter.format(weekStart) + ' \u2013 ' +
      monthDayFormatter.format(lastDay) + ', ' + lastDay.getFullYear();
  }

  function formatTaskCount(count) {
    if (count === 0) {
      return 'No tasks';
    }

    return count + ' ' + plural(count, 'task');
  }

  function plural(count, singular) {
    return count === 1 ? singular : singular + 's';
  }

  /* ---------------------------------------------------------------------- */
  /* Boot                                                                   */
  /* ---------------------------------------------------------------------- */

  // Coming back from My Tasks can restore this page from the back/forward
  // cache, so re-read the shared collection to keep the week current.
  window.addEventListener('pageshow', function (event) {
    if (!event.persisted || !els.dayList) {
      return;
    }

    initializeStore();
    render();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

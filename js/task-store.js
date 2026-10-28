/**
 * Daymark - Task Store
 * Task data, persistence, and query logic.
 *
 * Tasks are kept in memory while the page is open and mirrored to
 * localStorage through js/storage.js after every change. Demo tasks are
 * seeded only on a first visit, so deleting every task stays deleted after
 * a refresh.
 */

(function (global) {
  'use strict';

  const Storage = global.DaymarkStorage || null;
  const PRIORITIES = ['low', 'medium', 'high'];
  const CATEGORIES = ['work', 'personal', 'study', 'other'];
  const DEFAULT_PRIORITY = 'medium';
  const DEFAULT_CATEGORY = 'work';
  const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
  const STATUSES = ['all', 'active', 'completed'];
  const SORT_OPTIONS = ['dueDate', 'priority', 'createdAt'];

  let tasks = [];
  let idCounter = 0;
  let storageStatus = Storage ? 'unknown' : 'unavailable';

  function generateId() {
    idCounter += 1;

    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return 'task-' + global.crypto.randomUUID();
    }

    return 'task-' + Date.now().toString(36) + '-' + idCounter;
  }

  function generateUniqueId(usedIds) {
    let id = generateId();

    while (usedIds && usedIds.has(id)) {
      id = generateId();
    }

    if (usedIds) {
      usedIds.add(id);
    }

    return id;
  }

  function persist() {
    if (!Storage || typeof Storage.save !== 'function') {
      return false;
    }

    const saved = Storage.save(tasks);

    if (saved && (storageStatus === 'unknown' || storageStatus === 'empty' || storageStatus === 'corrupt')) {
      storageStatus = 'ok';
    }

    return saved;
  }

  function trim(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function toTimestamp(value) {
    if (!value) {
      return null;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function normalizeInput(input) {
    const source = input || {};

    return {
      title: trim(source.title),
      description: trim(source.description),
      dueDate: toTimestamp(source.dueDate),
      priority: PRIORITIES.indexOf(source.priority) !== -1 ? source.priority : DEFAULT_PRIORITY,
      category: CATEGORIES.indexOf(source.category) !== -1 ? source.category : DEFAULT_CATEGORY
    };
  }

  /**
   * Returns an object of field errors. Only title is required.
   */
  function validate(input) {
    const errors = {};
    const title = trim(input && input.title);

    if (!title) {
      errors.title = 'Please enter a title for your task.';
    } else if (title.length > 120) {
      errors.title = 'Keep the title to 120 characters or fewer.';
    }

    return errors;
  }

  /**
   * Repairs a record read from storage. Invalid records are dropped; valid
   * fields are preserved. Missing or duplicate ids are replaced so every
   * task keeps a unique identifier.
   */
  function normalizeStoredTask(raw, usedIds) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return null;
    }

    const title = trim(raw.title);

    if (!title) {
      return null;
    }

    const createdAt = toTimestamp(raw.createdAt) || new Date().toISOString();
    const completed = raw.completed === true;
    const completedAt = completed ? (toTimestamp(raw.completedAt) || createdAt) : null;
    const currentId = typeof raw.id === 'string' ? raw.id.trim() : '';
    let id = currentId;

    if (!id || usedIds.has(id)) {
      id = generateUniqueId(usedIds);
    } else {
      usedIds.add(id);
    }

    return {
      id: id,
      title: title,
      description: typeof raw.description === 'string' ? raw.description : '',
      dueDate: toTimestamp(raw.dueDate),
      priority: PRIORITIES.indexOf(raw.priority) !== -1 ? raw.priority : DEFAULT_PRIORITY,
      category: CATEGORIES.indexOf(raw.category) !== -1 ? raw.category : DEFAULT_CATEGORY,
      completed: completed,
      createdAt: createdAt,
      completedAt: completedAt
    };
  }

  function findTask(id) {
    return tasks.find(function (task) {
      return task.id === id;
    }) || null;
  }

  function add(input) {
    const data = normalizeInput(input);

    if (!data.title) {
      return null;
    }

    const now = new Date().toISOString();
    const usedIds = new Set(tasks.map(function (task) {
      return task.id;
    }));

    const task = {
      id: generateUniqueId(usedIds),
      title: data.title,
      description: data.description,
      dueDate: data.dueDate,
      priority: data.priority,
      category: data.category,
      completed: false,
      createdAt: now,
      completedAt: null
    };

    tasks.push(task);
    persist();
    return task;
  }

  function update(id, input) {
    const task = findTask(id);

    if (!task) {
      return null;
    }

    const data = normalizeInput(input);

    if (!data.title) {
      return null;
    }

    task.title = data.title;
    task.description = data.description;
    task.dueDate = data.dueDate;
    task.priority = data.priority;
    task.category = data.category;

    persist();
    return task;
  }

  function remove(id) {
    const index = tasks.findIndex(function (task) {
      return task.id === id;
    });

    if (index === -1) {
      return false;
    }

    tasks.splice(index, 1);
    persist();
    return true;
  }

  function toggle(id) {
    const task = findTask(id);

    if (!task) {
      return null;
    }

    task.completed = !task.completed;
    task.completedAt = task.completed ? new Date().toISOString() : null;

    persist();
    return task;
  }

  function getAll() {
    return tasks.slice();
  }

  function get(id) {
    const task = findTask(id);
    return task ? Object.assign({}, task) : null;
  }

  function dueTime(task) {
    if (!task.dueDate) {
      return Number.POSITIVE_INFINITY;
    }

    const time = new Date(task.dueDate).getTime();
    return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
  }

  function compareDueDate(a, b) {
    const aTime = dueTime(a);
    const bTime = dueTime(b);

    if (aTime !== bTime) {
      return aTime - bTime;
    }

    const priorityDifference = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];

    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    return b.createdAt.localeCompare(a.createdAt);
  }

  function comparePriority(a, b) {
    const priorityDifference = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];

    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    const aTime = dueTime(a);
    const bTime = dueTime(b);

    if (aTime !== bTime) {
      return aTime - bTime;
    }

    return b.createdAt.localeCompare(a.createdAt);
  }

  function compareCreatedAt(a, b) {
    return b.createdAt.localeCompare(a.createdAt);
  }

  function getComparator(sort) {
    if (sort === 'priority') {
      return comparePriority;
    }

    if (sort === 'createdAt') {
      return compareCreatedAt;
    }

    return compareDueDate;
  }

  /**
   * Filters and sorts a snapshot of the current tasks. All controls are
   * applied together; none of them resets another.
   */
  function query(filters) {
    const options = filters || {};
    const search = trim(options.search).toLocaleLowerCase();
    const status = STATUSES.indexOf(options.status) !== -1 ? options.status : 'all';
    const priority = PRIORITIES.indexOf(options.priority) !== -1 ? options.priority : 'all';
    const category = CATEGORIES.indexOf(options.category) !== -1 ? options.category : 'all';
    const sort = SORT_OPTIONS.indexOf(options.sort) !== -1 ? options.sort : 'dueDate';

    return tasks
      .filter(function (task) {
        if (search && task.title.toLocaleLowerCase().indexOf(search) === -1) {
          return false;
        }

        if (status === 'active' && task.completed) {
          return false;
        }

        if (status === 'completed' && !task.completed) {
          return false;
        }

        if (priority !== 'all' && task.priority !== priority) {
          return false;
        }

        if (category !== 'all' && task.category !== category) {
          return false;
        }

        return true;
      })
      .sort(getComparator(sort));
  }

  function dateAt(dayOffset, hour, minute) {
    const date = new Date();
    date.setDate(date.getDate() + dayOffset);
    date.setHours(hour, minute, 0, 0);
    return date.toISOString();
  }

  function daysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString();
  }

  /**
   * Loads saved tasks once at startup.
   *
   * - No saved data: seed the demo tasks and save them (first visit only).
   * - Valid data: use it, repairing ids/timestamps while preserving fields.
   * - Corrupt data: keep the raw value and its backup untouched, and run
   *   with demo tasks in memory until the user makes a change.
   */
  function initialize() {
    if (!Storage) {
      storageStatus = 'unavailable';
      seedDemoTasks();
      return;
    }

    const result = Storage.load();
    storageStatus = result.status;

    if (result.status === 'ok') {
      const usedIds = new Set();
      const normalized = [];

      result.tasks.forEach(function (raw) {
        const task = normalizeStoredTask(raw, usedIds);

        if (task) {
          normalized.push(task);
        }
      });

      tasks = normalized;

      if (normalized.length === 0 && result.tasks.length > 0) {
        // The array parsed, but no record had a usable title.
        storageStatus = 'corrupt';
        Storage.backup(result.raw);
        seedDemoTasks();
        return;
      }

      if (JSON.stringify(normalized) !== JSON.stringify(result.tasks)) {
        // Keep the original payload recoverable before writing repairs. If
        // the backup cannot be made, leave the stored value untouched and
        // continue with the repaired copy in memory.
        if (Storage.backup(result.raw)) {
          persist();
        }
      }

      return;
    }

    if (result.status === 'empty') {
      seedDemoTasks();

      if (persist()) {
        storageStatus = 'ok';
      } else {
        storageStatus = 'unavailable';
      }

      return;
    }

    // Corrupt or unavailable: work in memory without overwriting anything.
    seedDemoTasks();
  }

  /**
   * Sample tasks so a first visit has something realistic to demonstrate.
   * They are saved on first visit and can then be edited or deleted like any
   * other task.
   */
  function seedDemoTasks() {
    if (tasks.length > 0) {
      return;
    }

    const usedIds = new Set();
    const completedAt = new Date(Date.now() - 45 * 60 * 1000).toISOString();

    tasks = [
      {
        id: generateUniqueId(usedIds),
        title: 'Review project proposal',
        description: 'Skim the scope, timeline, and budget before the 11:00 sync.',
        dueDate: dateAt(0, 10, 30),
        priority: 'high',
        category: 'work',
        completed: false,
        createdAt: daysAgo(2),
        completedAt: null
      },
      {
        id: generateUniqueId(usedIds),
        title: 'Call dentist for appointment',
        description: '',
        dueDate: dateAt(0, 13, 0),
        priority: 'medium',
        category: 'personal',
        completed: false,
        createdAt: daysAgo(1),
        completedAt: null
      },
      {
        id: generateUniqueId(usedIds),
        title: 'Update weekly report',
        description: 'Add the latest metrics and send the summary to the team.',
        dueDate: dateAt(0, 15, 0),
        priority: 'high',
        category: 'work',
        completed: false,
        createdAt: daysAgo(1),
        completedAt: null
      },
      {
        id: generateUniqueId(usedIds),
        title: 'Grocery shopping',
        description: '',
        dueDate: dateAt(0, 17, 30),
        priority: 'low',
        category: 'personal',
        completed: false,
        createdAt: new Date().toISOString(),
        completedAt: null
      },
      {
        id: generateUniqueId(usedIds),
        title: 'Read chapter 5',
        description: 'Research methods, pages 112-140.',
        dueDate: dateAt(1, 19, 0),
        priority: 'low',
        category: 'study',
        completed: false,
        createdAt: daysAgo(2),
        completedAt: null
      },
      {
        id: generateUniqueId(usedIds),
        title: 'Morning stretch',
        description: '',
        dueDate: dateAt(0, 7, 0),
        priority: 'low',
        category: 'personal',
        completed: true,
        createdAt: daysAgo(3),
        completedAt: completedAt
      }
    ];
  }

  global.DaymarkTaskStore = {
    PRIORITIES: PRIORITIES.slice(),
    CATEGORIES: CATEGORIES.slice(),
    validate: validate,
    initialize: initialize,
    add: add,
    update: update,
    remove: remove,
    toggle: toggle,
    get: get,
    getAll: getAll,
    query: query,
    getStorageStatus: function () {
      return storageStatus;
    }
  };
})(window);

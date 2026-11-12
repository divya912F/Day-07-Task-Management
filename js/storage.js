/**
 * storage.js
 * A tiny wrapper around the Local Storage API.
 * Every read/write is guarded so the app keeps working even if
 * storage is full, disabled (private mode) or contains bad JSON.
 */

const KEYS = Object.freeze({
  TASKS: 'tasknest:tasks',
  THEME: 'tasknest:theme',
});

const read = (key, fallback) => {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch (err) {
    console.warn(`[storage] could not read "${key}"`, err);
    return fallback;
  }
};

const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn(`[storage] could not write "${key}"`, err);
    return false;
  }
};

export const Storage = {
  KEYS,
  getTasks: () => {
    const tasks = read(KEYS.TASKS, []);
    return Array.isArray(tasks) ? tasks : [];
  },
  setTasks: (tasks) => write(KEYS.TASKS, tasks),
  getTheme: () => read(KEYS.THEME, null),
  setTheme: (theme) => write(KEYS.THEME, theme),
};

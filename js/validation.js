/**
 * validation.js
 * Declarative validation: every field has a list of rules.
 * A rule is a function that returns an error message or null.
 */

export const OPTIONS = Object.freeze({
  categories: ['Work', 'Personal', 'Meeting', 'Development', 'Learning', 'Other'],
  priorities: ['High', 'Medium', 'Low'],
  statuses: ['Pending', 'In Progress', 'Completed'],
});

/** Local date in YYYY-MM-DD (avoids the UTC shift of toISOString). */
export const localISODate = (date = new Date()) => {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};

/* ---- reusable rule factories ---- */
const required = (label) => (v) => (String(v ?? '').trim() ? null : `${label} is required.`);
const minLen = (n, label) => (v) => (v.trim().length >= n ? null : `${label} needs at least ${n} characters.`);
const maxLen = (n, label) => (v) => (v.trim().length <= n ? null : `${label} must be ${n} characters or less.`);
const oneOf = (list, msg) => (v) => (list.includes(v) ? null : msg);
const realDate = (v) => {
  const d = new Date(`${v}T00:00:00`);
  return !Number.isNaN(d.getTime()) && localISODate(d) === v ? null : 'Enter a valid date.';
};
const optional = (...rules) => (v) => (String(v ?? '').trim() ? rules.map((r) => r(v)).find(Boolean) ?? null : null);

const SCHEMA = {
  title: [required('Title'), minLen(3, 'Title'), maxLen(60, 'Title')],
  description: [required('Description'), minLen(10, 'Description'), maxLen(300, 'Description')],
  category: [oneOf(OPTIONS.categories, 'Pick a category.')],
  priority: [oneOf(OPTIONS.priorities, 'Pick a priority level.')],
  status: [oneOf(OPTIONS.statuses, 'Pick a valid status.')],
  dueDate: [required('Due date'), realDate],
  assignee: [
    optional(
      minLen(2, 'Assignee'),
      (v) => (/^[a-zA-Z][a-zA-Z .'-]{1,39}$/.test(v.trim()) ? null : 'Use letters, spaces, dots, apostrophes or hyphens only.')
    ),
  ],
};

/**
 * Validate a task object.
 * @param {Object} task
 * @param {{ keepDate?: string }} [ctx] keepDate = existing due date that may stay in the past while editing
 * @returns {{ ok: boolean, errors: Object<string,string> }}
 */
export const validate = (task, { keepDate = '' } = {}) => {
  const errors = Object.entries(SCHEMA).reduce((acc, [field, rules]) => {
    const value = task[field] ?? '';
    const message = rules.map((rule) => rule(value)).find(Boolean);
    return message ? { ...acc, [field]: message } : acc;
  }, {});

  // cross-field / contextual rule: no past dates (unless unchanged while editing)
  if (!errors.dueDate && task.dueDate < localISODate() && task.dueDate !== keepDate) {
    errors.dueDate = 'Due date cannot be in the past.';
  }

  return { ok: Object.keys(errors).length === 0, errors };
};

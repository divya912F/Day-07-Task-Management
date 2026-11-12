/**
 * ui.js
 * View layer: builds DOM for the Kanban board, dashboard tiles,
 * insights charts, toasts, the confirm <dialog> and the form.
 * Contains no business logic — it only renders what it is given.
 */

import { OPTIONS, localISODate } from './validation.js';

const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value = '') => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);

const DAY = 24 * 60 * 60 * 1000;
const daysBetween = (fromISO, toISO) => Math.round((new Date(`${toISO}T00:00`) - new Date(`${fromISO}T00:00`)) / DAY);

/** Human-friendly deadline label, e.g. "Due in 3 days", "Overdue by 2 days". */
const deadlineLabel = (dueDate, status) => {
  const pretty = new Date(`${dueDate}T00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  if (status === 'Completed') return { text: pretty, tone: 'done' };
  const diff = daysBetween(localISODate(), dueDate);
  if (diff < 0) return { text: `Overdue ${Math.abs(diff)}d · ${pretty}`, tone: 'late' };
  if (diff === 0) return { text: 'Due today', tone: 'today' };
  if (diff === 1) return { text: 'Due tomorrow', tone: 'soon' };
  return { text: `In ${diff} days · ${pretty}`, tone: 'normal' };
};

const initialsOf = (name) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

/* ------------------------------------------------------------------ */
/* Kanban board                                                        */
/* ------------------------------------------------------------------ */

const cardHTML = ({ id, title, description, category, priority, dueDate, status, assignee }) => {
  const { text, tone } = deadlineLabel(dueDate, status);
  const done = status === 'Completed';
  const lane = OPTIONS.statuses.indexOf(status);

  return `
  <li class="card card--${priority.toLowerCase()}${done ? ' card--done' : ''}" data-id="${esc(id)}" draggable="true">
    <div class="card__top">
      <span class="prio prio--${priority.toLowerCase()}">${esc(priority)}</span>
      <span class="cat">#${esc(category.toLowerCase())}</span>
      <label class="tick" title="${done ? 'Mark as pending' : 'Mark as completed'}">
        <input type="checkbox" data-act="complete" ${done ? 'checked' : ''} aria-label="Completed: ${esc(title)}" />
        <span aria-hidden="true"></span>
      </label>
    </div>
    <h4 class="card__title">${esc(title)}</h4>
    <p class="card__desc">${esc(description)}</p>
    <div class="card__foot">
      <span class="when when--${tone}">⏱ ${esc(text)}</span>
      ${assignee ? `<span class="who" title="${esc(assignee)}">${esc(initialsOf(assignee))}</span>` : ''}
    </div>
    <div class="card__tools">
      <button type="button" data-act="left" ${lane === 0 ? 'disabled' : ''} aria-label="Move left">◀</button>
      <button type="button" data-act="right" ${lane === OPTIONS.statuses.length - 1 ? 'disabled' : ''} aria-label="Move right">▶</button>
      <span class="card__spacer"></span>
      <button type="button" data-act="edit" aria-label="Edit ${esc(title)}">Edit</button>
      <button type="button" data-act="delete" class="danger" aria-label="Delete ${esc(title)}">Delete</button>
    </div>
  </li>`;
};

/**
 * Render the board.
 * @param {Array} visible   tasks after search / filter / sort
 * @param {number} total    number of stored tasks
 */
export const renderBoard = (visible, total) => {
  const board = qs('#kanban');
  const nothing = qs('#nothing');

  qsa('.lane', board).forEach((lane) => {
    const { status } = lane.dataset;
    const items = visible.filter((t) => t.status === status);
    qs('.lane__count', lane).textContent = items.length;
    qs('.lane__list', lane).innerHTML = items.length
      ? items.map(cardHTML).join('')
      : '<li class="lane__empty">Drop tasks here</li>';
  });

  qs('#shownCount').textContent = `${visible.length} shown`;

  const showEmpty = visible.length === 0;
  board.hidden = showEmpty;
  nothing.hidden = !showEmpty;
  if (showEmpty) {
    qs('#nothingTitle').textContent = total ? 'No tasks match' : 'Your nest is empty';
    qs('#nothingText').textContent = total
      ? 'Nothing fits this search or filter. Try something else or hit Reset.'
      : 'Add your first task above and it will land on the board.';
  }
};

/* ------------------------------------------------------------------ */
/* Dashboard + insights                                               */
/* ------------------------------------------------------------------ */

const STATUS_COLORS = { Pending: 'var(--yellow)', 'In Progress': 'var(--blue)', Completed: 'var(--mint)' };
const PRIORITY_COLORS = { High: 'var(--red)', Medium: 'var(--orange)', Low: 'var(--mint)' };

export const renderStats = (s) => {
  // every element with data-stat="key" shows s[key]
  qsa('[data-stat]').forEach((el) => {
    el.textContent = s[el.dataset.stat];
  });

  qs('#tileBar').style.width = `${s.percent}%`;
  qs('#sideBar').style.width = `${s.percent}%`;
  qs('#sidePercent').textContent = s.percent;
  qs('#sideNote').textContent = s.total
    ? `${s.completed} of ${s.total} tasks done`
    : 'No tasks yet';

  // donut (conic-gradient)
  let start = 0;
  const slices = OPTIONS.statuses.map((status) => {
    const count = s.byStatus[status];
    const deg = s.total ? (count / s.total) * 360 : 0;
    const slice = `${STATUS_COLORS[status]} ${start}deg ${start + deg}deg`;
    start += deg;
    return slice;
  });
  qs('#donut').style.background = s.total ? `conic-gradient(${slices.join(', ')})` : 'var(--muted-bg)';
  qs('#donutLabel').innerHTML = `${s.percent}%<small>done</small>`;
  qs('#statusLegend').innerHTML = OPTIONS.statuses
    .map((st) => `<li><i style="background:${STATUS_COLORS[st]}"></i>${st}<b>${s.byStatus[st]}</b></li>`)
    .join('');

  // category horizontal bars
  const maxCat = Math.max(1, ...Object.values(s.byCategory));
  qs('#catBars').innerHTML = OPTIONS.categories
    .map((c) => `
      <li>
        <span>${c}</span>
        <div class="hbars__track"><div class="hbars__fill" style="width:${(s.byCategory[c] / maxCat) * 100}%"></div></div>
        <b>${s.byCategory[c]}</b>
      </li>`)
    .join('');

  // priority stacked bar
  qs('#prioStack').innerHTML = OPTIONS.priorities
    .filter((p) => s.byPriority[p] > 0)
    .map((p) => `<span style="flex:${s.byPriority[p]};background:${PRIORITY_COLORS[p]}" title="${p}: ${s.byPriority[p]}">${s.byPriority[p]}</span>`)
    .join('') || '<span class="stack-bar__empty">No data yet</span>';
  qs('#prioLegend').innerHTML = OPTIONS.priorities
    .map((p) => `<li><i style="background:${PRIORITY_COLORS[p]}"></i>${p}<b>${s.byPriority[p]}</b></li>`)
    .join('');
};

/* ------------------------------------------------------------------ */
/* Toasts                                                             */
/* ------------------------------------------------------------------ */

const TOAST_TONE = { success: ['mint', '✓'], info: ['blue', 'i'], warn: ['yellow', '!'], error: ['red', '✕'] };

export const toast = (message, kind = 'success', ms = 2800) => {
  const [color, glyph] = TOAST_TONE[kind] ?? TOAST_TONE.info;
  const el = document.createElement('div');
  el.className = `toast toast--${color}`;
  el.innerHTML = `<b class="toast__glyph">${glyph}</b><span>${esc(message)}</span>`;
  qs('#toasts').prepend(el);

  const dismiss = () => {
    el.classList.add('toast--out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };
  el.addEventListener('click', dismiss);
  setTimeout(dismiss, ms);
};

/* ------------------------------------------------------------------ */
/* Confirm dialog (native <dialog>)                                    */
/* ------------------------------------------------------------------ */

/** @returns {Promise<boolean>} */
export const confirmAction = ({ title, text, okLabel = 'Delete' }) => {
  const dialog = qs('#confirmDialog');
  qs('#confirmTitle').textContent = title;
  qs('#confirmText').textContent = text;
  qs('#confirmOk').textContent = okLabel;

  return new Promise((resolve) => {
    // clicking the backdrop (outside the box) cancels
    const onBackdrop = (e) => e.target === dialog && dialog.close('cancel');
    dialog.addEventListener('click', onBackdrop);
    dialog.addEventListener(
      'close',
      () => {
        dialog.removeEventListener('click', onBackdrop);
        resolve(dialog.returnValue === 'ok');
      },
      { once: true }
    );
    dialog.returnValue = '';
    dialog.showModal();
  });
};

/* ------------------------------------------------------------------ */
/* Form                                                               */
/* ------------------------------------------------------------------ */

export const Form = {
  el: () => qs('#taskForm'),

  read() {
    const data = Object.fromEntries(new FormData(this.el()));
    return {
      id: data.id ?? '',
      title: (data.title ?? '').trim(),
      description: (data.description ?? '').trim(),
      category: data.category ?? '',
      priority: data.priority ?? '',
      dueDate: data.dueDate ?? '',
      status: data.status ?? '',
      assignee: (data.assignee ?? '').trim(),
    };
  },

  showErrors(errors) {
    this.clearErrors();
    const form = this.el();
    Object.entries(errors).forEach(([name, msg]) => {
      const box = qs(`[data-for="${name}"]`, form);
      if (box) box.textContent = msg;
      qsa(`[name="${name}"]`, form).forEach((input) => input.setAttribute('aria-invalid', 'true'));
      box?.closest('.field')?.classList.add('field--bad');
    });
    qs('[aria-invalid="true"]', form)?.focus(); // jump to the first problem
  },

  clearErrors(name) {
    const form = this.el();
    const boxes = name ? qsa(`[data-for="${name}"]`, form) : qsa('[data-for]', form);
    boxes.forEach((box) => {
      box.textContent = '';
      box.closest('.field')?.classList.remove('field--bad');
    });
    const inputs = name ? qsa(`[name="${name}"]`, form) : qsa('[aria-invalid]', form);
    inputs.forEach((i) => i.removeAttribute('aria-invalid'));
  },

  countChars() {
    const len = qs('#fDesc').value.length;
    const counter = qs('#descCounter');
    counter.textContent = `${len}/300`;
    counter.classList.toggle('counter--max', len >= 280);
  },

  load(task) {
    const { elements: f } = this.el();
    this.clearErrors();
    ['id', 'title', 'description', 'category', 'dueDate', 'status'].forEach((k) => (f[k].value = task[k]));
    f.assignee.value = task.assignee ?? '';
    qsa('[name="priority"]', this.el()).forEach((r) => (r.checked = r.value === task.priority));
    f.dueDate.min = '';
    this.setMode('edit');
    this.countChars();
  },

  reset() {
    const form = this.el();
    form.reset();
    form.elements.id.value = '';
    form.elements.dueDate.min = localISODate();
    this.clearErrors();
    this.setMode('create');
    this.countChars();
  },

  setMode(mode) {
    const editing = mode === 'edit';
    qs('#formTag').textContent = editing ? 'EDIT' : 'NEW';
    qs('#formTitleText').textContent = editing ? 'Edit task' : 'Add a task';
    qs('#saveBtn').textContent = editing ? 'Save Changes ✓' : 'Add Task →';
    qs('#cancelEditBtn').hidden = !editing;
    qs('#clearFormBtn').hidden = editing;
    qs('#formPanel').classList.toggle('panel--editing', editing);
  },
};

/* ------------------------------------------------------------------ */
/* Theme                                                              */
/* ------------------------------------------------------------------ */

export const setTheme = (theme) => {
  document.documentElement.dataset.theme = theme;
  const dark = theme === 'dark';
  qs('#themeLabel').textContent = dark ? 'Light mode' : 'Dark mode';
  qs('#themeIcon').textContent = dark ? '☀️' : '🌙';
  qs('#themeBtn').setAttribute('aria-pressed', String(dark));
};

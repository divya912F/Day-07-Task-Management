/**
 * app.js — entry module
 * The TaskNest controller: owns the task state, applies search/filter/sort,
 * computes analytics, and reacts to user events.
 */

import { Storage } from './storage.js';
import { validate, OPTIONS, localISODate } from './validation.js';
import { renderBoard, renderStats, toast, confirmAction, Form, setTheme } from './ui.js';

const RANK = { High: 3, Medium: 2, Low: 1 };

const SORTERS = {
  newest: (a, b) => b.createdAt - a.createdAt,
  dueSoon: (a, b) => a.dueDate.localeCompare(b.dueDate) || RANK[b.priority] - RANK[a.priority],
  dueLate: (a, b) => b.dueDate.localeCompare(a.dueDate) || RANK[b.priority] - RANK[a.priority],
  prioHigh: (a, b) => RANK[b.priority] - RANK[a.priority] || a.dueDate.localeCompare(b.dueDate),
  prioLow: (a, b) => RANK[a.priority] - RANK[b.priority] || a.dueDate.localeCompare(b.dueDate),
};

const uid = () => crypto.randomUUID?.() ?? `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const shiftDate = (iso, days) => {
  const d = new Date(`${iso}T00:00`);
  d.setDate(d.getDate() + days);
  return localISODate(d);
};

class TaskNest {
  #tasks = Storage.getTasks();
  #view = { q: '', category: '', priority: '', status: '', sort: 'newest' };

  /* ---------------- derived data ---------------- */

  get visibleTasks() {
    const { q, category, priority, status, sort } = this.#view;
    const needle = q.trim().toLowerCase();
    const matches = (task) =>
      task.title.toLowerCase().includes(needle) &&
      (!category || task.category === category) &&
      (!priority || task.priority === priority) &&
      (!status || task.status === status);

    return this.#tasks.filter(matches).sort(SORTERS[sort] ?? SORTERS.newest);
  }

  get stats() {
    const tasks = this.#tasks;
    const today = localISODate();
    const nextWeek = shiftDate(today, 7);
    const tally = (key, keys) =>
      Object.fromEntries(keys.map((k) => [k, tasks.filter((t) => t[key] === k).length]));

    const byStatus = tally('status', OPTIONS.statuses);
    const open = tasks.filter((t) => t.status !== 'Completed');
    const total = tasks.length;

    return {
      total,
      completed: byStatus.Completed,
      pending: byStatus.Pending,
      inProgress: byStatus['In Progress'],
      high: tasks.filter((t) => t.priority === 'High').length,
      percent: total ? Math.round((byStatus.Completed / total) * 100) : 0,
      byStatus,
      byCategory: tally('category', OPTIONS.categories),
      byPriority: tally('priority', OPTIONS.priorities),
      overdue: open.filter((t) => t.dueDate < today).length,
      dueToday: open.filter((t) => t.dueDate === today).length,
      dueWeek: open.filter((t) => t.dueDate > today && t.dueDate <= nextWeek).length,
    };
  }

  /* ---------------- persistence + render ---------------- */

  render() {
    renderBoard(this.visibleTasks, this.#tasks.length);
    renderStats(this.stats);
  }

  /** Replace the task list, save it to Local Storage and re-render. */
  #commit(nextTasks) {
    this.#tasks = nextTasks;
    if (!Storage.setTasks(this.#tasks)) toast('Saving failed — Local Storage is unavailable.', 'error', 4000);
    this.render();
  }

  #find = (id) => this.#tasks.find((t) => t.id === id);

  /* ---------------- CRUD ---------------- */

  add(fields) {
    const stamp = Date.now();
    const task = { id: uid(), ...fields, createdAt: stamp, updatedAt: stamp };
    this.#commit([task, ...this.#tasks]);
    toast(`Added “${task.title}”`, 'success');
  }

  update(id, fields) {
    this.#commit(this.#tasks.map((t) => (t.id === id ? { ...t, ...fields, updatedAt: Date.now() } : t)));
    toast('Changes saved', 'info');
  }

  setStatus(id, status, { silent = false } = {}) {
    const task = this.#find(id);
    if (!task || task.status === status) return;
    this.#commit(this.#tasks.map((t) => (t.id === id ? { ...t, status, updatedAt: Date.now() } : t)));
    if (!silent) toast(status === 'Completed' ? `Done! “${task.title}” completed 🎉` : `Moved to ${status}`, status === 'Completed' ? 'success' : 'info');
  }

  async remove(id) {
    const task = this.#find(id);
    if (!task) return;
    const yes = await confirmAction({ title: 'Delete this task?', text: `“${task.title}” will be removed permanently.`, okLabel: 'Delete' });
    if (!yes) return;

    const card = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    const finish = () => {
      if (Form.el().elements.id.value === id) Form.reset();
      this.#commit(this.#tasks.filter((t) => t.id !== id));
      toast('Task deleted', 'warn');
    };
    if (card) {
      card.classList.add('card--leaving');
      card.addEventListener('animationend', finish, { once: true });
    } else finish();
  }

  async purgeCompleted() {
    const done = this.#tasks.filter((t) => t.status === 'Completed');
    if (!done.length) return toast('No completed tasks to clear', 'info');
    const yes = await confirmAction({
      title: 'Clear completed tasks?',
      text: `${done.length} completed task${done.length === 1 ? '' : 's'} will be removed permanently.`,
      okLabel: 'Clear all',
    });
    if (!yes) return;
    this.#commit(this.#tasks.filter((t) => t.status !== 'Completed'));
    toast(`Cleared ${done.length} completed task${done.length === 1 ? '' : 's'}`, 'warn');
  }

  /* ---------------- event handlers ---------------- */

  onSubmit = (e) => {
    e.preventDefault();
    const { id, ...fields } = Form.read();
    const { ok, errors } = validate(fields, { keepDate: id ? this.#find(id)?.dueDate : '' });

    if (!ok) {
      Form.showErrors(errors);
      toast(`Please fix ${Object.keys(errors).length} field${Object.keys(errors).length > 1 ? 's' : ''}`, 'error');
      return;
    }
    id ? this.update(id, fields) : this.add(fields);
    Form.reset();
  };

  onBoardClick = (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const { id } = btn.closest('.card').dataset;
    const task = this.#find(id);
    if (!task) return;
    const lane = OPTIONS.statuses.indexOf(task.status);

    switch (btn.dataset.act) {
      case 'edit':
        Form.load(task);
        document.querySelector('#new-task').scrollIntoView({ behavior: 'smooth' });
        Form.el().elements.title.focus({ preventScroll: true });
        break;
      case 'delete':
        this.remove(id);
        break;
      case 'left':
        this.setStatus(id, OPTIONS.statuses[lane - 1]);
        break;
      case 'right':
        this.setStatus(id, OPTIONS.statuses[lane + 1]);
        break;
    }
  };

  onBoardChange = (e) => {
    if (e.target.dataset.act !== 'complete') return;
    const { id } = e.target.closest('.card').dataset;
    this.setStatus(id, e.target.checked ? 'Completed' : 'Pending');
  };

  onViewChange = () => {
    const val = (sel) => document.querySelector(sel).value;
    this.#view = { q: val('#q'), category: val('#fltCategory'), priority: val('#fltPriority'), status: val('#fltStatus'), sort: val('#sortSel') };
    renderBoard(this.visibleTasks, this.#tasks.length);
  };

  resetView = () => {
    ['#q', '#fltCategory', '#fltPriority', '#fltStatus'].forEach((s) => (document.querySelector(s).value = ''));
    document.querySelector('#sortSel').value = 'newest';
    this.onViewChange();
  };

  /* ---------------- drag & drop between lanes ---------------- */

  enableDragAndDrop(board) {
    let draggingId = null;

    board.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.card');
      if (!card) return;
      draggingId = card.dataset.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggingId);
      requestAnimationFrame(() => card.classList.add('card--dragging'));
    });

    board.addEventListener('dragend', (e) => {
      e.target.closest('.card')?.classList.remove('card--dragging');
      board.querySelectorAll('.lane--over').forEach((l) => l.classList.remove('lane--over'));
      draggingId = null;
    });

    board.addEventListener('dragover', (e) => {
      const lane = e.target.closest('.lane');
      if (!lane || !draggingId) return;
      e.preventDefault();
      board.querySelectorAll('.lane--over').forEach((l) => l !== lane && l.classList.remove('lane--over'));
      lane.classList.add('lane--over');
    });

    board.addEventListener('drop', (e) => {
      const lane = e.target.closest('.lane');
      if (!lane || !draggingId) return;
      e.preventDefault();
      lane.classList.remove('lane--over');
      this.setStatus(draggingId, lane.dataset.status);
    });
  }

  /* ---------------- bootstrapping ---------------- */

  initTheme() {
    const saved = Storage.getTheme();
    const systemDark = matchMedia('(prefers-color-scheme: dark)').matches;
    setTheme(saved ?? (systemDark ? 'dark' : 'light'));

    document.querySelector('#themeBtn').addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      setTheme(next);
      Storage.setTheme(next);
    });
  }

  initNav() {
    const links = [...document.querySelectorAll('.sidenav__link')];
    const spy = new IntersectionObserver(
      (entries) =>
        entries
          .filter((en) => en.isIntersecting)
          .forEach(({ target }) => links.forEach((a) => a.classList.toggle('is-current', a.hash === `#${target.id}`))),
      { rootMargin: '-35% 0px -60% 0px' }
    );
    links.forEach((a) => {
      const section = document.querySelector(a.hash);
      if (section) spy.observe(section);
    });

    document.querySelector('#quickAddBtn').addEventListener('click', () =>
      setTimeout(() => Form.el().elements.title.focus({ preventScroll: true }), 350)
    );
  }

  init() {
    const form = Form.el();
    const board = document.querySelector('#kanban');

    document.querySelector('#dateLine').textContent = new Date()
      .toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      .toUpperCase();
    document.querySelector('#yr').textContent = new Date().getFullYear();

    this.initTheme();
    this.initNav();
    Form.reset();

    // form
    form.addEventListener('submit', this.onSubmit);
    form.addEventListener('input', ({ target }) => {
      if (target.name) Form.clearErrors(target.name);
      if (target.id === 'fDesc') Form.countChars();
    });
    document.querySelector('#clearFormBtn').addEventListener('click', () => Form.reset());
    document.querySelector('#cancelEditBtn').addEventListener('click', () => {
      Form.reset();
      toast('Edit cancelled', 'info', 1800);
    });

    // board
    board.addEventListener('click', this.onBoardClick);
    board.addEventListener('change', this.onBoardChange);
    this.enableDragAndDrop(board);
    document.querySelector('#purgeBtn').addEventListener('click', () => this.purgeCompleted());

    // search / filter / sort
    document.querySelector('#q').addEventListener('input', this.onViewChange);
    ['#fltCategory', '#fltPriority', '#fltStatus', '#sortSel'].forEach((s) =>
      document.querySelector(s).addEventListener('change', this.onViewChange)
    );
    document.querySelector('#resetControls').addEventListener('click', this.resetView);

    // keep multiple tabs in sync
    window.addEventListener('storage', ({ key }) => {
      if (key === Storage.KEYS.TASKS) {
        this.#tasks = Storage.getTasks();
        this.render();
      }
    });

    this.render();
  }
}

new TaskNest().init();

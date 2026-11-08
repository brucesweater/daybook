// The to-do screen. The age line is the point: every open task always shows it, and it stays current.

import { byId, fromTemplate, setText } from './dom.js';
import { animate, DURATION, syncList } from './motion.js';
import { attachRowSwipe } from './swipe.js';
import { countText, doneLine, notesPreview, sortDone, sortOpen } from './tasks.js';
import { ageText, ageTone } from './wording.js';

/** How long a checked row stays in place, during which tapping again cancels it. */
const SETTLE_MS = 900;
const TONE_CLASSES = ['age-fresh', 'age-warm', 'age-old'];

export function createTodoView({ store, isUsingKeyboard, onEditTask, onDeleteTask, onClear, onCountChange }) {
  const countEl = byId('todo-count');
  const emptyEl = byId('todo-empty');
  const openList = byId('open-list');
  const doneList = byId('done-list');
  const addForm = byId('add-form');
  const addInput = byId('add-input');
  const completedEl = byId('completed');
  const completedToggle = byId('completed-toggle');
  const completedLabel = byId('completed-label');
  const clearButton = byId('clear-completed');
  const scrollEl = byId('todo-scroll');

  /** Tasks checked off moments ago, still in the open list. Their completedAt is already set. */
  const settling = new Map();
  let expanded = false;
  let firstRender = true;

  function createRow() {
    const row = fromTemplate('task-row-template');
    row.querySelector('.check').addEventListener('click', () => toggle(row.dataset.key));
    row.querySelector('.task-text').addEventListener('click', () => {
      const task = store.taskById(row.dataset.key);
      if (task) onEditTask(task);
    });
    return row;
  }

  function updateRow(row, task, now) {
    const line = row.querySelector('.task-line');
    const notes = row.querySelector('.task-notes');
    const checked = !!task.completedAt;
    row.classList.toggle('is-checked', checked);
    setText(row.querySelector('.task-title'), task.title);
    const preview = notesPreview(task.notes);
    setText(notes, preview);
    notes.hidden = preview === '';
    row.querySelector('.check').setAttribute('aria-label', `Mark ${task.title} as ${checked ? 'not done' : 'done'}`);
    if (checked && !settling.has(task.id)) {
      setText(line, doneLine(task, now));
      line.classList.remove(...TONE_CLASSES);
    } else {
      updateAge(line, task, now);
    }
  }

  function updateAge(line, task, now) {
    const assigned = Date.parse(task.assignedAt);
    setText(line, ageText(assigned, now));
    const tone = `age-${ageTone(assigned, now)}`;
    if (!line.classList.contains(tone)) {
      line.classList.remove(...TONE_CLASSES);
      line.classList.add(tone);
    }
  }

  /**
   * The row holding focus is about to go: focus moves to the next one, or failing that the Completed heading or the Add
   * field. The field is only for someone at the keyboard: for anyone else, T and N would type into it, and a phone
   * would raise its keyboard.
   */
  function moveFocusFrom(row) {
    const sibling = (node, step) => {
      let next = node[step];
      while (next?.classList.contains('leaving')) next = next[step];
      return next;
    };
    const neighbour = sibling(row, 'nextElementSibling') ?? sibling(row, 'previousElementSibling');
    const target = neighbour?.querySelector('.check')
      ?? (row.parentElement === doneList && !completedEl.hidden ? completedToggle : null)
      ?? (isUsingKeyboard() ? addInput : null);
    target?.focus({ preventScroll: true });
  }

  function render() {
    const tasks = store.tasks;
    for (const [id, timer] of settling) {
      if (!store.taskById(id)?.completedAt) {
        clearTimeout(timer);
        settling.delete(id);
      }
    }
    const open = sortOpen(tasks.filter((task) => !task.completedAt || settling.has(task.id)));
    const done = sortDone(tasks.filter((task) => task.completedAt && !settling.has(task.id)));
    const now = Date.now();
    const animated = !firstRender;
    firstRender = false;

    setText(countEl, countText(tasks));
    onCountChange?.(tasks.filter((task) => !task.completedAt).length);
    emptyEl.hidden = open.length > 0;
    openList.hidden = open.length === 0;
    addForm.classList.toggle('after-rows', open.length > 0);

    syncList(openList, open, {
      keyOf: (task) => task.id,
      create: createRow,
      update: (row, task) => updateRow(row, task, now),
      animated,
      onLeave: moveFocusFrom,
    });

    if (done.length === 0) expanded = false;
    completedEl.hidden = done.length === 0;
    setText(completedLabel, `Completed (${done.length})`);
    completedToggle.setAttribute('aria-expanded', String(expanded));
    completedEl.classList.toggle('is-expanded', expanded);
    if (!expanded && !doneList.classList.contains('is-animating')) doneList.hidden = true;
    syncList(doneList, done, {
      keyOf: (task) => task.id,
      create: createRow,
      update: (row, task) => updateRow(row, task, now),
      animated: animated && expanded,
      onLeave: moveFocusFrom,
    });
  }

  function toggle(id) {
    const task = store.taskById(id);
    if (!task) return;
    if (settling.has(id)) {
      clearTimeout(settling.get(id));
      settling.delete(id);
      store.setCompleted(id, null);
    } else if (task.completedAt) {
      const hadFocus = document.activeElement?.classList.contains('check');
      store.setCompleted(id, null);
      if (hadFocus) focusCheck(id);
    } else {
      settling.set(id, setTimeout(() => {
        settling.delete(id);
        render();
      }, SETTLE_MS));
      store.setCompleted(id, new Date().toISOString());
    }
  }

  function focusCheck(id) {
    for (const row of openList.children) {
      if (row.dataset.key === id) row.querySelector('.check').focus({ preventScroll: true });
    }
  }

  // ---------- Live age lines ----------

  function refreshAges() {
    const now = Date.now();
    const tasks = new Map(store.tasks.map((task) => [task.id, task]));
    for (const row of openList.children) {
      if (row.classList.contains('leaving')) continue;
      const task = tasks.get(row.dataset.key);
      if (task) updateAge(row.querySelector('.task-line'), task, now);
    }
  }

  // ---------- Adding ----------

  let composing = false;
  addInput.addEventListener('compositionstart', () => { composing = true; });
  addInput.addEventListener('compositionend', () => { composing = false; });

  /** Keeps the field in view above the tab bar and any on-screen keyboard. */
  function keepAddFieldVisible() {
    const field = addForm.getBoundingClientRect();
    const scroller = scrollEl.getBoundingClientRect();
    const paddingBottom = parseFloat(getComputedStyle(scrollEl).paddingBottom) || 0;
    const viewport = globalThis.visualViewport;
    const keyboardTop = viewport ? viewport.offsetTop + viewport.height : Infinity;
    const limit = Math.min(scroller.bottom - paddingBottom, keyboardTop) - 8;
    if (field.bottom > limit) scrollEl.scrollTop += field.bottom - limit;
  }

  /** The new row opens up over a moment, pushing the field down, so the scroll follows it frame by frame. */
  function followAddField() {
    const end = performance.now() + DURATION + 60;
    const step = () => {
      keepAddFieldVisible();
      if (performance.now() < end) requestAnimationFrame(step);
    };
    step();
  }

  addForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (composing) return;
    const title = addInput.value.trim();
    if (title === '') return;
    store.addTask(title);
    addInput.value = '';
    addInput.focus({ preventScroll: true });
    followAddField();
  });
  addForm.addEventListener('click', (event) => {
    if (event.target !== addInput) addInput.focus();
  });

  byId('focus-add').addEventListener('click', () => {
    addInput.focus({ preventScroll: true });
    addForm.scrollIntoView({ block: 'center', behavior: 'auto' });
  });

  // ---------- Completed ----------

  completedToggle.addEventListener('click', () => {
    expanded = !expanded;
    completedToggle.setAttribute('aria-expanded', String(expanded));
    completedEl.classList.toggle('is-expanded', expanded);
    doneList.hidden = false;
    const height = doneList.offsetHeight;
    const frames = [{ height: '0px', opacity: 0 }, { height: `${height}px`, opacity: 1 }];
    doneList.classList.add('is-animating');
    animate(doneList, expanded ? frames : frames.reverse(), {}, () => {
      doneList.classList.remove('is-animating');
      doneList.hidden = !expanded;
    });
    if (expanded && doneList.getBoundingClientRect().bottom > scrollEl.getBoundingClientRect().bottom) {
      completedEl.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
  });

  clearButton.addEventListener('click', () => onClear(new Set(settling.keys())));

  attachRowSwipe(openList, onDeleteTask);
  attachRowSwipe(doneList, onDeleteTask);

  store.subscribe(render);

  return { render, refreshAges, focusAdd: () => addInput.focus({ preventScroll: true }) };
}

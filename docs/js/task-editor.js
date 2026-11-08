// The task sheet: Title, Notes, Assigned (which can't be in the future), Delete Task.

import * as Day from './calendar-day.js';
import { byId } from './dom.js';
import { dismissSheet, presentSheet, wireSheet } from './sheet.js';
import { fieldsToInstant, instantToFields } from './tasks.js';

export function createTaskEditor({ store, onDeleted }) {
  const dialog = byId('task-sheet');
  const form = byId('task-form');
  const submit = byId('task-submit');
  const title = byId('task-title');
  const notes = byId('task-notes');
  const date = byId('task-date');
  const time = byId('task-time');
  const deleteButton = byId('task-delete');
  const body = dialog.querySelector('.sheet-body');

  let editing = null;
  let assignedAt = null;
  let shown = null;

  /**
   * Inputs being typed into. Nothing may write to them, not even a new `max`: Chrome forgets the digits typed so far,
   * so month 12 comes out as February. Leaving the field catches up.
   */
  const typing = new Set();

  /** Writes the inputs, and how far forward they can go. */
  function writeAssigned() {
    shown = instantToFields(assignedAt);
    const now = instantToFields(new Date().toISOString());
    date.value = shown.day;
    time.value = shown.time;
    date.max = now.day;
    time.max = shown.day === now.day ? now.time : '';
  }

  /** The inputs → assignedAt. Untouched inputs keep the original instant, seconds and all. */
  function readAssigned() {
    if (date.value === shown.day && time.value === shown.time) return;
    if (!(Day.isValid(date.value) && date.value >= '1000-01-01')) return;
    const instant = fieldsToInstant(date.value, time.value, Date.now());
    if (instant !== null) assignedAt = instant;
  }

  for (const input of [date, time]) {
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab' && event.key !== 'Enter' && event.key !== 'Escape') typing.add(input);
    });
    input.addEventListener('input', () => {
      // Picked rather than typed: a future choice stops at now straight away.
      if (!typing.has(input)) {
        readAssigned();
        writeAssigned();
      }
    });
    input.addEventListener('blur', () => {
      typing.delete(input);
      if (!editing) return;
      readAssigned();
      writeAssigned();
    });
  }

  function updateSubmit() {
    submit.disabled = title.value.trim() === '';
  }

  title.addEventListener('input', updateSubmit);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (title.value.trim() === '' || !editing) return;
    readAssigned();
    store.updateTask(editing.id, { title: title.value.trim(), notes: notes.value.trim(), assignedAt }, editing);
    editing = null;
    await dismissSheet(dialog);
  });

  function cancel() {
    if (dialog.classList.contains('closing')) return;
    editing = null;
    dismissSheet(dialog);
  }

  wireSheet(dialog, cancel);
  dialog.querySelector('[data-cancel]').addEventListener('click', cancel);

  deleteButton.addEventListener('click', async () => {
    if (!editing) return;
    const { id } = editing;
    editing = null;
    await dismissSheet(dialog);
    onDeleted(id);
  });

  return {
    open(task) {
      editing = task;
      assignedAt = task.assignedAt;
      title.value = task.title;
      notes.value = task.notes;
      typing.clear();
      writeAssigned();
      updateSubmit();
      presentSheet(dialog);
      body.scrollTop = 0;
    },
  };
}

// The event sheet. New Event and Edit Event are the same form.

import { byId } from './dom.js';
import {
  draftFromEvent,
  endIsBeforeStart,
  fieldsFromDraft,
  moveEnd,
  moveStart,
  newDraft,
  setAllDay,
} from './events.js';
import * as Day from './calendar-day.js';
import { fieldToMinutes, minutesToField } from './format.js';
import { dismissSheet, presentSheet, wireSheet } from './sheet.js';

/**
 * The last day the editor takes, which is also the `max` on its date inputs. Going to a day means drawing its month,
 * and the grid runs into the next month, so December 9999 would need days in a year this format can't write.
 */
const LAST_DAY = '9999-11-30';

/** A complete day from a date input, or null. Chrome reports 0002-11-05 partway through typing a year. */
function readDay(input) {
  const { value } = input;
  return Day.isValid(value) && value >= '1000-01-01' && value <= LAST_DAY ? value : null;
}

export function createEventEditor({ store, onSaved, onDeleted }) {
  const dialog = byId('event-sheet');
  const form = byId('event-form');
  const heading = byId('event-sheet-title');
  const submit = byId('event-submit');
  const title = byId('event-title');
  const notes = byId('event-notes');
  const allDay = byId('event-all-day');
  const startDate = byId('event-start-date');
  const startTime = byId('event-start-time');
  const endDate = byId('event-end-date');
  const endTime = byId('event-end-time');
  const deleteButton = byId('event-delete');
  const body = dialog.querySelector('.sheet-body');

  let draft = null;
  let editingId = null;

  /**
   * The draft as it was when this edit of Starts began. Typing 2:30 PM passes through 2:00 AM and 2:30 AM, and those
   * aren't choices, so every value is measured from here and not from the value before it. Otherwise each one pushes
   * Ends along again, and they add up.
   */
  let startBase = null;

  /**
   * Inputs being typed into. Their in-between values aren't choices yet, and nothing may write to them, not even a new
   * `min`: Chrome forgets the digits typed so far, so 45 in the minutes comes out as 05. Leaving the field catches up.
   */
  const typing = new Set();

  function setEndInvalid(invalid) {
    for (const input of [endDate, endTime]) {
      if (invalid) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }

  /** Writes Ends from the draft, and tells it how far back it can go. */
  function writeEndFields() {
    endDate.value = draft.endDay;
    endTime.value = minutesToField(draft.endMinutes);
    endDate.min = draft.startDay;
    endTime.min = draft.endDay === draft.startDay ? minutesToField(draft.startMinutes) : '';
    setEndInvalid(false);
  }

  function writeDateFields() {
    startDate.value = draft.startDay;
    startTime.value = minutesToField(draft.startMinutes);
    startTime.hidden = draft.allDay;
    endTime.hidden = draft.allDay;
    writeEndFields();
  }

  function updateSubmit() {
    submit.disabled = title.value.trim() === '';
  }

  function present() {
    title.value = draft.title;
    notes.value = draft.notes;
    allDay.checked = draft.allDay;
    typing.clear();
    startBase = null;
    writeDateFields();
    heading.textContent = editingId ? 'Edit Event' : 'New Event';
    submit.textContent = editingId ? 'Save' : 'Add';
    deleteButton.hidden = !editingId;
    updateSubmit();
    presentSheet(dialog);
    body.scrollTop = 0;
    if (!editingId) title.focus();
  }

  function onEndInput(day, minutes, input) {
    if (!draft || day === null || minutes === null) return;
    startBase = null;
    if (typing.has(input)) {
      const tooEarly = endIsBeforeStart(draft, day, minutes);
      setEndInvalid(tooEarly);
      if (!tooEarly) draft = moveEnd(draft, day, minutes);
      return;
    }
    draft = moveEnd(draft, day, minutes);
    writeEndFields();
  }

  startDate.addEventListener('input', () => {
    const day = readDay(startDate);
    if (!draft || day === null) return;
    startBase ??= draft;
    draft = moveStart(startBase, day);
    writeEndFields();
  });
  startTime.addEventListener('input', () => {
    const minutes = fieldToMinutes(startTime.value);
    if (!draft || minutes === null) return;
    startBase ??= draft;
    draft = moveStart(startBase, startBase.startDay, minutes);
    writeEndFields();
  });
  endDate.addEventListener('input', () => onEndInput(readDay(endDate), draft?.endMinutes, endDate));
  endTime.addEventListener('input', () => onEndInput(draft?.endDay, fieldToMinutes(endTime.value), endTime));

  const dateInputs = [startDate, startTime, endDate, endTime];
  for (const input of dateInputs) {
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab' && event.key !== 'Enter' && event.key !== 'Escape') typing.add(input);
    });
    input.addEventListener('blur', () => settle(input));
  }

  /** Focus left a date or time input: whatever it holds now is final, or it goes back to what's valid. */
  function settle(input) {
    typing.delete(input);
    startBase = null;
    if (!draft) return;
    if (input === endDate || input === endTime) {
      const day = readDay(endDate) ?? draft.endDay;
      const minutes = fieldToMinutes(endTime.value) ?? draft.endMinutes;
      draft = moveEnd(draft, day, minutes);
    }
    writeDateFields();
  }

  allDay.addEventListener('change', () => {
    if (!draft) return;
    startBase = null;
    draft = setAllDay(draft, allDay.checked);
    writeDateFields();
  });

  title.addEventListener('input', updateSubmit);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (title.value.trim() === '' || !draft) return;
    if (dateInputs.includes(document.activeElement)) settle(document.activeElement);
    const fields = fieldsFromDraft({ ...draft, title: title.value, notes: notes.value });
    let saved;
    if (editingId) {
      store.updateEvent(editingId, fields);
      saved = store.eventById(editingId);
    } else {
      saved = store.addEvent(fields);
    }
    draft = null;
    await dismissSheet(dialog);
    onSaved(saved);
  });

  function cancel() {
    if (dialog.classList.contains('closing')) return;
    draft = null;
    dismissSheet(dialog);
  }

  wireSheet(dialog, cancel);
  dialog.querySelector('[data-cancel]').addEventListener('click', cancel);

  deleteButton.addEventListener('click', async () => {
    if (!draft) return;
    const id = editingId;
    draft = null;
    await dismissSheet(dialog);
    onDeleted(id);
  });

  return {
    openNew(day) {
      editingId = null;
      draft = newDraft(day, new Date());
      present();
    },
    openEdit(event) {
      editingId = event.id;
      draft = draftFromEvent(event);
      present();
    },
  };
}

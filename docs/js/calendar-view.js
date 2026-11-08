// The calendar screen: month header, the grid, and the selected day's agenda.

import * as Day from './calendar-day.js';
import { changeMonth, dayForKey, goToToday, rollToday, selectDay } from './calendar-state.js';
import { byId, fromTemplate, h, setText, swallowNextClick } from './dom.js';
import { agendaFor, coversDay, eventCounts, timeLine } from './events.js';
import { agendaTitle, dayLabel, monthName, weekdayLetter, weekdayName } from './format.js';
import { monthSwipeTurns, speedAtRelease } from './gesture.js';
import { monthGrid, weekdayOrder, CELLS } from './grid.js';
import { animate, reducedMotion, syncList } from './motion.js';
import { attachRowSwipe } from './swipe.js';

const SWIPE_START = 10;
const COLUMNS = 7;

export function createCalendarView({ store, prefs, initial, onNewEvent, onEditEvent, onDeleteEvent }) {
  const monthNameEl = byId('month-name');
  const monthYearEl = byId('month-year');
  const weekdaysEl = byId('weekdays');
  const daysEl = byId('days');
  const paneEl = byId('days-pane');
  const agendaTitleEl = byId('agenda-title');
  const agendaEmptyEl = byId('agenda-empty');
  const agendaListEl = byId('agenda-list');
  const agendaScrollEl = agendaListEl.parentElement;

  let state = initial;
  let renderedDay = null;

  // ---------- Building the grid once; rendering only updates it ----------

  for (const weekday of weekdayOrder(prefs.firstWeekday)) {
    weekdaysEl.append(
      h('div', { class: 'weekday', role: 'columnheader', 'aria-label': weekdayName(weekday) }, weekdayLetter(weekday)),
    );
  }

  const cells = [];
  for (let row = 0; row < CELLS / COLUMNS; row += 1) {
    const week = h('div', { class: 'week', role: 'row' });
    for (let column = 0; column < COLUMNS; column += 1) {
      const number = h('span', { class: 'day-number' });
      const cell = h('div', { class: 'day', role: 'gridcell', tabindex: '-1' }, number, h('span', { class: 'day-dot' }));
      cells.push({ cell, number });
      week.append(cell);
    }
    paneEl.append(week);
  }

  function fillPane(cellsOf, month, selected) {
    const grid = monthGrid(month.year, month.month, prefs.firstWeekday);
    const counts = eventCounts(store.events, grid[0].day, grid[CELLS - 1].day);
    grid.forEach(({ day, inMonth }, index) => {
      const { cell, number } = cellsOf(index);
      const count = counts.get(day) ?? 0;
      const isToday = day === state.today;
      const isSelected = day === selected;
      cell.dataset.day = day;
      cell.className = [
        'day',
        inMonth ? '' : 'is-adjacent',
        isToday ? 'is-today' : '',
        isSelected ? 'is-selected' : '',
        count > 0 ? 'has-event' : '',
      ].filter(Boolean).join(' ');
      setText(number, String(Day.parts(day).day));
      cell.setAttribute('aria-label', dayLabel(day, count));
      cell.setAttribute('aria-selected', String(isSelected));
      if (isToday) cell.setAttribute('aria-current', 'date');
      else cell.removeAttribute('aria-current');
      cell.tabIndex = isSelected ? 0 : -1;
    });
  }

  function renderGrid() {
    fillPane((index) => cells[index], state, state.selected);
  }

  function renderHeader() {
    setText(monthNameEl, monthName(state.month));
    setText(monthYearEl, String(state.year));
  }

  function renderAgenda() {
    const day = state.selected;
    const dayChanged = day !== renderedDay;
    renderedDay = day;
    setText(agendaTitleEl, agendaTitle(day, state.today));
    const events = agendaFor(store.events, day);
    agendaEmptyEl.hidden = events.length > 0;
    syncList(agendaListEl, events, {
      keyOf: (event) => event.id,
      create: createAgendaRow,
      update: updateAgendaRow,
      animated: !dayChanged,
      onLeave: () => focusSelected(),
    });
    if (dayChanged) agendaScrollEl.scrollTop = 0;
  }

  function createAgendaRow() {
    const row = fromTemplate('agenda-row-template');
    row.querySelector('.agenda-row').addEventListener('click', () => {
      const event = store.eventById(row.dataset.key);
      if (event) onEditEvent(event);
    });
    return row;
  }

  function updateAgendaRow(row, event) {
    setText(row.querySelector('.agenda-row-title'), event.title);
    setText(row.querySelector('.agenda-row-time'), timeLine(event, state.selected, prefs.uses24Hour));
  }

  function render() {
    renderHeader();
    renderGrid();
    renderAgenda();
  }

  // ---------- Moving around ----------

  function focusSelected() {
    cells.find(({ cell }) => cell.dataset.day === state.selected)?.cell.focus({ preventScroll: true });
  }

  let ghost = null;

  function clearGhost() {
    ghost?.remove();
    ghost = null;
    if (typeof paneEl.getAnimations === 'function') {
      for (const animation of paneEl.getAnimations()) animation.cancel();
    }
  }

  /** A copy of a pane, for sliding. Hidden from assistive tech, and nothing in it can take focus. */
  function makeGhostPane() {
    const copy = paneEl.cloneNode(true);
    copy.removeAttribute('id');
    copy.classList.add('days-ghost');
    copy.setAttribute('aria-hidden', 'true');
    for (const node of copy.querySelectorAll('[tabindex]')) node.removeAttribute('tabindex');
    for (const node of copy.querySelectorAll('[role]')) node.removeAttribute('role');
    for (const node of copy.querySelectorAll('[aria-label]')) node.removeAttribute('aria-label');
    for (const node of copy.querySelectorAll('[aria-selected]')) node.removeAttribute('aria-selected');
    for (const node of copy.querySelectorAll('[aria-current]')) node.removeAttribute('aria-current');
    return copy;
  }

  /** Slides from the month now showing to whatever `next` shows, without waiting to update the state. */
  function slideTo(next, fromOffset = 0) {
    const direction = Math.sign(Day.compareMonths(next, state));
    if (direction === 0 || reducedMotion() || typeof paneEl.animate !== 'function') {
      clearGhost();
      state = next;
      render();
      return;
    }
    clearGhost();
    const width = daysEl.clientWidth;
    const outgoing = makeGhostPane();
    daysEl.append(outgoing);
    ghost = outgoing;
    state = next;
    render();
    const translate = (x) => ({ transform: `translate3d(${x}px, 0, 0)` });
    animate(outgoing, [translate(fromOffset), translate(-direction * width)], {}, () => {
      outgoing.remove();
      if (ghost === outgoing) ghost = null;
    });
    animate(paneEl, [translate(fromOffset + direction * width), translate(0)]);
  }

  function go(next, { focus = false } = {}) {
    slideTo(next);
    if (focus) focusSelected();
  }

  // ---------- Mouse and keyboard on the grid ----------

  daysEl.addEventListener('click', (event) => {
    const cell = event.target.closest('.day');
    if (!cell?.dataset.day) return;
    // The second click of a double-click only opens New Event; the grid may have moved under it.
    if (event.detail >= 2) return;
    go(selectDay(state, cell.dataset.day), { focus: true });
  });

  // On an adjacent-month day the first click already moved the grid, so go by the selection, not the target.
  daysEl.addEventListener('dblclick', () => onNewEvent(state.selected));

  daysEl.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const day = dayForKey(state.selected, event.key, prefs.firstWeekday);
    if (day) {
      event.preventDefault();
      go(selectDay(state, day), { focus: true });
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault();
      go(changeMonth(state, event.key === 'PageUp' ? -1 : 1), { focus: true });
    } else if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
    }
  });

  byId('prev-month').addEventListener('click', () => go(changeMonth(state, -1)));
  byId('next-month').addEventListener('click', () => go(changeMonth(state, 1)));
  byId('go-today').addEventListener('click', () => go(goToToday(state)));
  byId('new-event').addEventListener('click', () => onNewEvent(state.selected));

  // ---------- Swiping months ----------

  let swipe = null;

  /** While dragging, the neighbouring months sit either side, drawn from the real grid. */
  function buildSwipePanes() {
    const before = changeMonth(state, -1);
    const after = changeMonth(state, 1);
    const make = (month, selected, side) => {
      const pane = makeGhostPane();
      const paneCells = [...pane.querySelectorAll('.day')].map((cell) => ({ cell, number: cell.querySelector('.day-number') }));
      fillPane((index) => paneCells[index], month, selected);
      for (const { cell } of paneCells) {
        for (const name of ['role', 'aria-label', 'aria-selected', 'aria-current', 'tabindex']) cell.removeAttribute(name);
      }
      pane.style.left = `${side * 100}%`;
      pane.style.right = `${-side * 100}%`;
      daysEl.append(pane);
      return pane;
    };
    return [make(before, before.selected, -1), make(after, after.selected, 1)];
  }

  daysEl.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' || !event.isPrimary) return;
    swipe = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastTime: event.timeStamp, speed: 0, offset: 0, panes: null };
  });

  daysEl.addEventListener('pointermove', (event) => {
    if (!swipe || event.pointerId !== swipe.id) return;
    const dx = event.clientX - swipe.x;
    const dy = event.clientY - swipe.y;
    if (!swipe.panes) {
      if (Math.abs(dx) < SWIPE_START && Math.abs(dy) < SWIPE_START) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        swipe = null;
        return;
      }
      clearGhost();
      swipe.x = event.clientX; // No jump: the grid starts following from here.
      swipe.panes = buildSwipePanes();
      daysEl.setPointerCapture(event.pointerId);
    }
    const elapsed = event.timeStamp - swipe.lastTime;
    if (elapsed > 0) swipe.speed = (event.clientX - swipe.lastX) / elapsed;
    swipe.lastX = event.clientX;
    swipe.lastTime = event.timeStamp;
    swipe.offset = event.clientX - swipe.x;
    const transform = `translate3d(${swipe.offset}px, 0, 0)`;
    paneEl.style.transform = transform;
    for (const pane of swipe.panes) pane.style.transform = transform;
  });

  const endSwipe = (event) => {
    if (!swipe || event.pointerId !== swipe.id) return;
    const { panes, offset, speed, lastTime } = swipe;
    swipe = null;
    if (!panes) return;
    swallowNextClick();
    for (const pane of panes) pane.remove();
    paneEl.style.removeProperty('transform');
    const turns = monthSwipeTurns({ offset, width: daysEl.clientWidth, speed: speedAtRelease(speed, lastTime, event.timeStamp) });
    if (event.type === 'pointerup' && turns) {
      slideTo(changeMonth(state, offset < 0 ? 1 : -1), offset);
    } else if (offset !== 0) {
      animate(paneEl, [{ transform: `translate3d(${offset}px, 0, 0)` }, { transform: 'translate3d(0, 0, 0)' }]);
    }
  };
  daysEl.addEventListener('pointerup', endSwipe);
  daysEl.addEventListener('pointercancel', endSwipe);

  attachRowSwipe(agendaListEl, onDeleteEvent);

  store.subscribe(render);

  return {
    render,
    get state() {
      return state;
    },
    /** `T`: go to today, keeping focus in the grid if it's there. */
    goToday() {
      go(goToToday(state), { focus: daysEl.contains(document.activeElement) });
    },
    /** After saving an event: show its day, unless it's already on the selected one. */
    reveal(event) {
      if (!coversDay(event, state.selected)) go(selectDay(state, event.startDay));
    },
    /** Midnight passed. Returns whether the date really changed. */
    rollToday(today) {
      const next = rollToday(state, today);
      if (next === state) return false;
      state = next;
      render();
      return true;
    },
    focusSelected,
  };
}

// Daybook starts here. This file connects the pieces: the store, the two screens, the sheets, and the clock.

import { createBackupMenu } from './backup.js';
import * as Day from './calendar-day.js';
import { initialState } from './calendar-state.js';
import { createCalendarView } from './calendar-view.js';
import { demoData } from './demo.js';
import { byId, isField, setText } from './dom.js';
import { createEventEditor } from './event-editor.js';
import { firstWeekdayOf, prefers24Hour } from './format.js';
import { setSaveFailed, showOnce } from './notices.js';
import { STORE_KEY, Store, browserStorage } from './store.js';
import { createTaskEditor } from './task-editor.js';
import { createTodoView } from './todo-view.js';
import { showToast } from './toast.js';

const AGE_REFRESH_MS = 15000;
const CORRUPT_NOTICE = 'Your saved data couldn’t be read, so Daybook started empty. A copy was kept in this browser.';

const isDemo = new URLSearchParams(location.search).has('demo');

const prefs = {
  firstWeekday: firstWeekdayOf(navigator.language),
  uses24Hour: prefers24Hour(undefined),
};

// ---------- Data ----------

const store = new Store({
  storage: isDemo ? null : browserStorage(),
  persistent: !isDemo,
  onFirstSave: () => {
    // Asks the browser to keep this data under storage pressure. Some browsers prompt for it, so it waits
    // until there's something worth keeping, and happens once.
    navigator.storage?.persist?.()?.catch?.(() => {});
  },
});

const loadStatus = store.load();
if (isDemo) store.seed(demoData(new Date()));

store.subscribe(() => setSaveFailed(store.saveFailed));
setSaveFailed(store.saveFailed);
if (loadStatus === 'corrupt') showOnce(CORRUPT_NOTICE);

if (!isDemo) {
  // Another tab changed the data.
  addEventListener('storage', (event) => {
    if (event.key === STORE_KEY || event.key === null) store.reload();
  });
}

// ---------- Keyboard users reach Undo; everyone else keeps their place ----------

let usingKeyboard = false;
addEventListener('keydown', (event) => {
  if (event.key === 'Tab' || event.key === 'Enter' || event.key === ' ') usingKeyboard = true;
}, true);
addEventListener('pointerdown', () => { usingKeyboard = false; }, true);

// ---------- Screens ----------

const SCREEN_KEY = 'daybook.screen';
const screens = { calendar: byId('calendar'), todo: byId('todo') };
const scrollers = { calendar: byId('calendar-scroll'), todo: byId('todo-scroll') };
const tabs = { calendar: byId('tab-calendar'), todo: byId('tab-todo') };
const topbar = document.querySelector('.topbar');
let activeScreen = 'calendar';

const scrollOffsets = { calendar: 0, todo: 0 };

/** Below 1000 px one screen shows at a time. Each keeps its scroll position; display:none would lose it. */
function showScreen(name) {
  if (name === activeScreen) return;
  scrollOffsets[activeScreen] = scrollers[activeScreen].scrollTop;
  screens[activeScreen].classList.remove('is-active');
  tabs[activeScreen].removeAttribute('aria-current');
  activeScreen = name;
  screens[name].classList.add('is-active');
  tabs[name].setAttribute('aria-current', 'page');
  scrollers[name].scrollTop = scrollOffsets[name];
  updateTopbarLine();
  try {
    sessionStorage.setItem(SCREEN_KEY, name);
  } catch {
    // Only a convenience.
  }
}

/** On the calendar the whole screen scrolls, so its header is the top bar. */
function updateTopbarLine() {
  topbar.classList.toggle('is-scrolled-under', activeScreen === 'calendar' && scrollers.calendar.scrollTop > 0);
}

for (const [name, tab] of Object.entries(tabs)) {
  tab.addEventListener('click', () => showScreen(name));
}
try {
  const remembered = sessionStorage.getItem(SCREEN_KEY);
  if (remembered && remembered in screens) showScreen(remembered);
} catch {
  // Only a convenience.
}

// ---------- Views ----------

const calendar = createCalendarView({
  store,
  prefs,
  initial: initialState(Day.fromDate()),
  onNewEvent: (day) => eventEditor.openNew(day),
  onEditEvent: (event) => eventEditor.openEdit(event),
  onDeleteEvent: deleteEvent,
});

const eventEditor = createEventEditor({
  store,
  onSaved: (event) => {
    calendar.reveal(event);
    // If the event moved to another day, the row focus would have come back to is gone.
    if (usingKeyboard && document.activeElement === document.body) calendar.focusSelected();
  },
  onDeleted: deleteEvent,
});

const taskEditor = createTaskEditor({ store, onDeleted: deleteTask });

const todoBadge = byId('todo-badge');
const todo = createTodoView({
  store,
  isUsingKeyboard: () => usingKeyboard,
  onEditTask: (task) => taskEditor.open(task),
  onDeleteTask: deleteTask,
  onClear: (keepIds) => {
    const token = store.clearCompleted(keepIds);
    if (token) {
      showToast('Completed tasks cleared', () => store.restore(token), toastOptions('todo', () => todo.focusAdd()));
    }
  },
  onCountChange: (open) => {
    setText(todoBadge, String(open));
    todoBadge.hidden = open === 0;
    tabs.todo.setAttribute('aria-label', open > 0 ? `To-Do, ${open} open` : 'To-Do');
  },
});

/** Sending focus somewhere is for keyboard users. Anyone else keeps their place, and no text field raises a keyboard. */
function toastOptions(side, returnFocus) {
  return {
    side,
    focusUndo: usingKeyboard,
    returnFocus: () => {
      if (usingKeyboard) returnFocus();
    },
  };
}

function deleteEvent(id) {
  const token = store.removeEvent(id);
  if (token) showToast('Event deleted', () => store.restore(token), toastOptions('calendar', () => calendar.focusSelected()));
}

function deleteTask(id) {
  const token = store.removeTask(id);
  if (token) showToast('Task deleted', () => store.restore(token), toastOptions('todo', () => todo.focusAdd()));
}

const backup = createBackupMenu({ store });

calendar.render();
todo.render();

// ---------- Shortcuts ----------

addEventListener('keydown', (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (isField(event.target) || document.querySelector('dialog[open]') || backup.isOpen()) return;
  const key = event.key?.toLowerCase();
  if (key === 't') {
    event.preventDefault();
    showScreen('calendar');
    calendar.goToday();
  } else if (key === 'n') {
    event.preventDefault();
    showScreen('calendar');
    eventEditor.openNew(calendar.state.selected);
  }
});

// ---------- The clock ----------

function tick() {
  if (calendar.rollToday(Day.fromDate())) todo.render();
  todo.refreshAges();
}

setInterval(tick, AGE_REFRESH_MS);
addEventListener('focus', tick);
addEventListener('pageshow', tick);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) tick();
});

// ---------- Small touches ----------

// iOS Safari only shows :active on pages that listen for touches.
addEventListener('touchstart', () => {}, { passive: true });

// A hairline appears under a header once content is scrolling beneath it.
function hairlineWhenScrolled(scroller, header) {
  const update = () => header.classList.toggle('is-scrolled-under', scroller.scrollTop > 0);
  scroller.addEventListener('scroll', update, { passive: true });
  update();
}
hairlineWhenScrolled(scrollers.todo, document.querySelector('.todo-head'));
hairlineWhenScrolled(document.querySelector('.agenda-scroll'), byId('agenda-title'));
// Only shows in a short desktop window, where the month header stays put while the card scrolls (see style.css).
hairlineWhenScrolled(scrollers.calendar, document.querySelector('.calendar-head'));
scrollers.calendar.addEventListener('scroll', updateTopbarLine, { passive: true });

// ---------- Offline ----------

if ('serviceWorker' in navigator && !isDemo) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

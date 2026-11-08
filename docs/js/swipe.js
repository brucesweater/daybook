// Swipe left to delete, on touch only. Mouse users have the delete button in the editor. A short swipe opens
// the row on a Delete button; a long one deletes on release, like a list on iOS.

import { h, swallowNextClick } from './dom.js';
import { rowSwipeAction, speedAtRelease } from './gesture.js';
import { EASE, reducedMotion } from './motion.js';

const START_DISTANCE = 10;
const BUTTON_WIDTH = 88;

let openRow = null;

function closeOpenRow() {
  if (!openRow) return;
  const { row, surface } = openRow;
  openRow = null;
  settle(row, surface, 0, () => clearRow(row, surface));
}

function clearRow(row, surface) {
  row.classList.remove('is-swiping');
  row.querySelector('.swipe-delete')?.remove();
  surface.style.removeProperty('transform');
}

function settle(row, surface, target, done = () => {}) {
  const value = `translate3d(${target}px, 0, 0)`;
  if (reducedMotion() || typeof surface.animate !== 'function') {
    surface.style.transform = value;
    done();
    return;
  }
  const animation = surface.animate(
    [{ transform: getComputedStyle(surface).transform }, { transform: value }],
    { duration: 260, easing: EASE },
  );
  surface.style.transform = value;
  animation.addEventListener('finish', done);
  animation.addEventListener('cancel', done);
}

/** While a row is open, the next press anywhere else closes it and does nothing else. */
function swallowNextPress(event) {
  if (!openRow) return;
  // A re-render took the row away, say from another tab. There's nothing left to close.
  if (!openRow.row.isConnected) {
    openRow = null;
    return;
  }
  if (event.target.closest?.('.swipe-delete')) return;
  closeOpenRow();
  event.preventDefault();
  event.stopPropagation();
  swallowNextClick(true);
}
document.addEventListener('pointerdown', swallowNextPress, true);

/**
 * Makes the rows of a list swipeable.
 * @param list The list. Rows are its children, with a `.swipe-surface` inside, and a `data-key`.
 * @param onDelete Called with the row's key.
 */
export function attachRowSwipe(list, onDelete) {
  let gesture = null;

  list.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' || !event.isPrimary) return;
    const row = event.target.closest('[data-key]');
    const surface = row?.querySelector('.swipe-surface');
    if (!surface || row.classList.contains('leaving')) return;
    gesture = { id: event.pointerId, row, surface, x: event.clientX, y: event.clientY, lastX: event.clientX, lastTime: event.timeStamp, speed: 0, active: false };
  });

  list.addEventListener('pointermove', (event) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.active) {
      if (Math.abs(dx) < START_DISTANCE && Math.abs(dy) < START_DISTANCE) return;
      if (dx >= 0 || Math.abs(dy) > Math.abs(dx)) {
        gesture = null;
        return;
      }
      gesture.active = true;
      gesture.x = event.clientX; // No jump: the row starts following from here.
      list.setPointerCapture(event.pointerId);
      gesture.row.classList.add('is-swiping');
      if (!gesture.row.querySelector('.swipe-delete')) {
        const button = h('button', { class: 'swipe-delete', type: 'button', tabindex: '-1', 'aria-hidden': 'true' }, 'Delete');
        const { row } = gesture;
        button.addEventListener('click', () => {
          openRow = null;
          onDelete(row.dataset.key);
        });
        gesture.row.prepend(button);
      }
    }
    const elapsed = event.timeStamp - gesture.lastTime;
    if (elapsed > 0) gesture.speed = (gesture.lastX - event.clientX) / elapsed;
    gesture.lastX = event.clientX;
    gesture.lastTime = event.timeStamp;
    const offset = Math.min(0, event.clientX - gesture.x);
    gesture.surface.style.transform = `translate3d(${offset}px, 0, 0)`;
    event.preventDefault();
  });

  const release = (event) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const { active, row, surface, speed, lastTime } = gesture;
    gesture = null;
    if (!active) return;

    // A swipe must not also count as a tap on whatever is under the finger.
    swallowNextClick();

    const offset = -new DOMMatrixReadOnly(getComputedStyle(surface).transform).m41;
    const width = row.clientWidth;
    const action = event.type === 'pointerup'
      ? rowSwipeAction({ offset, width, speed: speedAtRelease(speed, lastTime, event.timeStamp) })
      : 'close';
    if (action === 'delete') {
      settle(row, surface, -width, () => onDelete(row.dataset.key));
    } else if (action === 'open') {
      settle(row, surface, -BUTTON_WIDTH);
      openRow = { row, surface };
    } else {
      settle(row, surface, 0, () => clearRow(row, surface));
    }
  };
  list.addEventListener('pointerup', release);
  list.addEventListener('pointercancel', release);
}

// A <dialog> as a sheet: showModal for real focus trapping, Esc and backdrop click to cancel, and a closing
// animation. The opening animation is pure CSS, keyed off [open].

import { reducedMotion } from './motion.js';

const CLOSING_MS = 300;

/** A click this soon after a sheet opens is the tail of whatever opened it, like the second tap of a double-tap. */
const OPENING_MS = 250;

const openedAt = new WeakMap();
const finishClosing = new WeakMap();

/** Whether a pointer event landed on the backdrop. The sheet's own padding has the sheet as its target too. */
function isOnBackdrop(dialog, event) {
  if (event.target !== dialog) return false;
  const box = dialog.getBoundingClientRect();
  return event.clientX < box.left || event.clientX >= box.right || event.clientY < box.top || event.clientY >= box.bottom;
}

/** Calls `onCancel` for Esc and for a click that both starts and ends on the backdrop. */
export function wireSheet(dialog, onCancel) {
  let pressedBackdrop = false;
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    onCancel();
  });
  dialog.addEventListener('pointerdown', (event) => {
    pressedBackdrop = isOnBackdrop(dialog, event);
  });
  dialog.addEventListener('click', (event) => {
    const isTailOfOpening = event.detail >= 2 || performance.now() - openedAt.get(dialog) < OPENING_MS;
    if (pressedBackdrop && isOnBackdrop(dialog, event) && !isTailOfOpening) onCancel();
    pressedBackdrop = false;
  });
  dialog.addEventListener('close', () => dialog.classList.remove('closing'));
}

export function presentSheet(dialog) {
  finishClosing.get(dialog)?.();
  dialog.classList.remove('closing');
  dialog.firstElementChild.inert = false;
  if (!dialog.open) dialog.showModal();
  openedAt.set(dialog, performance.now());
}

/**
 * Plays the closing animation, closes, and resolves. Closing restores focus to where it was.
 * Its contents stop responding straight away: a second tap on Delete, or Cancel and then Delete, must do nothing.
 *
 * It can also end early: the browser only lets a page refuse one Esc in a row, so a second one closes the dialog
 * outright. What's left of this one must stop then, or its timer closes the next sheet to open.
 */
export function dismissSheet(dialog) {
  return new Promise((resolve) => {
    if (!dialog.open) {
      resolve();
      return;
    }
    dialog.firstElementChild.inert = true;
    if (reducedMotion()) {
      dialog.close();
      resolve();
      return;
    }
    let timer = null;
    const finish = (event) => {
      if (event?.type === 'animationend' && event.target !== dialog) return;
      clearTimeout(timer);
      dialog.removeEventListener('animationend', finish);
      dialog.removeEventListener('close', finish);
      finishClosing.delete(dialog);
      if (dialog.open) dialog.close();
      resolve();
    };
    finishClosing.set(dialog, finish);
    dialog.addEventListener('animationend', finish);
    dialog.addEventListener('close', finish);
    timer = setTimeout(finish, CLOSING_MS);
    dialog.classList.add('closing');
  });
}

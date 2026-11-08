// The undo toast: a small capsule that lasts 5 seconds. A new one replaces the old one.

import { h, byId } from './dom.js';
import { animate } from './motion.js';

const LIFETIME_MS = 5000;

const region = byId('toast-region');

let current = null;

function clearTimer() {
  if (current) clearTimeout(current.timer);
}

function arm() {
  clearTimer();
  if (current) current.timer = setTimeout(hide, LIFETIME_MS);
}

/**
 * Takes the current toast away.
 * If focus was on it, focus goes to where the caller said it should.
 */
export function hide() {
  if (!current) return;
  clearTimer();
  const { node, returnFocus } = current;
  const hadFocus = node.contains(document.activeElement);
  current = null;
  node.inert = true;
  animate(
    node,
    [
      { opacity: 1, transform: 'none' },
      { opacity: 0, transform: 'translateY(8px)' },
    ],
    { duration: 200 },
    () => node.remove(),
  );
  if (hadFocus) returnFocus?.();
}

/**
 * Shows `message` with an Undo button. It stays while the pointer or focus is on it, so nobody loses it
 * mid-reach.
 *
 * @param focusUndo Moves focus to Undo, for keyboard users, who otherwise couldn't reach it in time.
 * @param returnFocus Where focus goes if it's still on the toast when the toast goes away.
 * @param side The card the toast belongs to, which it sits on when there are two side by side.
 */
export function showToast(message, onUndo, { focusUndo = false, returnFocus = null, side = 'calendar' } = {}) {
  if (current) {
    clearTimer();
    current.node.remove();
    current = null;
  }
  const undo = h('button', { class: 'toast-undo', type: 'button' }, 'Undo');
  const node = h('div', { class: 'toast' }, h('span', { class: 'toast-message' }, message), undo);
  current = { node, timer: null, returnFocus };

  undo.addEventListener('click', () => {
    onUndo();
    hide();
  });
  node.addEventListener('pointerenter', clearTimer);
  node.addEventListener('pointerleave', () => {
    if (!node.contains(document.activeElement)) arm();
  });
  node.addEventListener('focusin', clearTimer);
  node.addEventListener('focusout', (event) => {
    if (!node.contains(event.relatedTarget)) arm();
  });
  node.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hide();
  });

  region.dataset.side = side;
  region.append(node);
  animate(node, [
    { opacity: 0, transform: 'translateY(12px)' },
    { opacity: 1, transform: 'none' },
  ]);
  arm();
  if (focusUndo) undo.focus();
}

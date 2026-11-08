// The two small questions the app ever asks, in an alert-style <dialog>.

import { byId } from './dom.js';

const dialog = byId('alert');
const message = byId('alert-message');
const cancelButton = byId('alert-cancel');
const confirmButton = byId('alert-confirm');

let settle = null;

function close(result) {
  if (dialog.open) dialog.close();
  const resolve = settle;
  settle = null;
  resolve?.(result);
}

cancelButton.addEventListener('click', () => close(false));
confirmButton.addEventListener('click', () => close(true));
dialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  close(false);
});

function ask(text, { confirmLabel, showCancel }) {
  // Only one question at a time; a new one answers the old with "no".
  close(false);
  message.textContent = text;
  confirmButton.textContent = confirmLabel;
  cancelButton.hidden = !showCancel;
  dialog.classList.toggle('single-action', !showCancel);
  dialog.showModal();
  confirmButton.focus();
  return new Promise((resolve) => {
    settle = resolve;
  });
}

/** Resolves true if the user confirms. */
export function confirmDialog(text, confirmLabel) {
  return ask(text, { confirmLabel, showCancel: true });
}

/** Resolves when the user has read it. */
export function alertDialog(text) {
  return ask(text, { confirmLabel: 'OK', showCancel: false });
}

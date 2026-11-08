// Polite banners under the top bar: one that stays while saving is failing, and one-time messages.

import { h, byId } from './dom.js';

const region = byId('notices');
const SAVE_FAILED_TEXT = 'Changes can’t be saved in this browser. Export a backup to keep them.';

let saveBanner = null;

/** Shows or removes the banner that stays up for as long as saving fails. */
export function setSaveFailed(failed) {
  if (failed && !saveBanner) {
    saveBanner = h('p', { class: 'notice', id: 'save-banner' }, SAVE_FAILED_TEXT);
    region.append(saveBanner);
  } else if (!failed && saveBanner) {
    saveBanner.remove();
    saveBanner = null;
  }
}

/** A message said once, which the user can dismiss. */
export function showOnce(text) {
  const notice = h('p', { class: 'notice' }, h('span', {}, text));
  const dismiss = h('button', { class: 'notice-dismiss', type: 'button' }, 'OK');
  dismiss.addEventListener('click', () => notice.remove());
  notice.append(dismiss);
  region.prepend(notice);
}

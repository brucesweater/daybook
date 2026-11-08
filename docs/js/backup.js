// The `…` menu, and exporting and importing backups.

import * as Day from './calendar-day.js';
import { alertDialog, confirmDialog } from './dialogs.js';
import { byId, h } from './dom.js';
import { backupFilename, importQuestion } from './format.js';
import { hide as hideToast } from './toast.js';
import { parseDocument } from './schema.js';

const BAD_FILE = 'This file isn’t a Daybook backup.';

export function createBackupMenu({ store }) {
  const button = byId('menu-button');
  const menu = byId('menu');
  const fileInput = byId('import-file');
  const items = [...menu.querySelectorAll('[role="menuitem"]')];

  function isOpen() {
    return !menu.hidden;
  }

  function open() {
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    items[0].focus();
  }

  function close({ refocus = true } = {}) {
    if (!isOpen()) return;
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (refocus) button.focus();
  }

  button.addEventListener('click', () => (isOpen() ? close() : open()));

  document.addEventListener('pointerdown', (event) => {
    if (isOpen() && !menu.contains(event.target) && !button.contains(event.target)) close({ refocus: false });
  });

  menu.addEventListener('keydown', (event) => {
    const index = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(index + 1) % items.length].focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length].focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0].focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1].focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      close({ refocus: false });
    }
  });

  byId('menu-export').addEventListener('click', () => {
    close();
    const blob = new Blob([store.exportText()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: backupFilename(Day.fromDate()), hidden: true });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });

  byId('menu-import').addEventListener('click', () => {
    close();
    fileInput.click();
  });

  fileInput.addEventListener('change', async () => {
    const [file] = fileInput.files;
    if (!file) return;
    let text = null;
    try {
      // UTF-8 only, the way the iOS app reads a file: a broken byte rejects it on both, instead of turning into �.
      text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    } catch {
      // Unreadable, or not UTF-8: the same as not a backup.
    }
    // So choosing the same file again still fires `change`.
    fileInput.value = '';
    const data = text === null ? null : parseDocument(text);
    if (!data) {
      await alertDialog(BAD_FILE);
      return;
    }
    if (await confirmDialog(importQuestion(data), 'Replace')) {
      hideToast();
      store.replaceAll(data);
    }
  });

  return { isOpen };
}

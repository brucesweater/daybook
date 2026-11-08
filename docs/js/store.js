// The data, and keeping it saved. Every change saves immediately. Takes its storage as an argument so tests
// can hand it a fake one, and so ?demo can run on no storage at all.

import { parseDocument, stringifyDocument } from './schema.js';

export const STORE_KEY = 'daybook.v1';
export const CORRUPT_KEY = 'daybook.v1.corrupt';

/** `crypto.randomUUID` where it exists (secure contexts), otherwise a v4 UUID from getRandomValues. */
export function newId(source = globalThis.crypto) {
  if (typeof source?.randomUUID === 'function') return source.randomUUID();
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The browser's localStorage, or null where even touching it throws. */
export function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export class Store {
  events = [];
  tasks = [];
  /** True when the latest save failed. Cleared by the next save that works. */
  saveFailed = false;

  #storage;
  #persistent;
  #listeners = new Set();
  #onFirstSave;
  #savedOnce = false;
  /** Set when what's stored couldn't be read, or a corrupt store couldn't be copied aside: saving could destroy it. */
  #mustNotOverwrite = false;

  /**
   * @param storage A localStorage-like object, or null if there is none.
   * @param persistent False for demo mode: everything stays in memory.
   * @param onFirstSave Called after the first change that saves.
   */
  constructor({ storage = null, persistent = true, onFirstSave = () => {} } = {}) {
    this.#storage = storage;
    this.#persistent = persistent;
    this.#onFirstSave = onFirstSave;
  }

  /**
   * Reads what's saved. Returns `'ok'`, `'empty'`, `'corrupt'` (corrupt, copied aside, and worth saying so)
   * or `'unavailable'` (storage can't be read).
   *
   * A corrupt store is never overwritten on load. Its copy doubles as the record that the user has already
   * been told, so reloading doesn't say it twice.
   */
  load() {
    if (!this.#persistent) return 'empty';
    let raw;
    try {
      if (!this.#storage) throw new Error('No storage');
      raw = this.#storage.getItem(STORE_KEY);
    } catch {
      this.#mustNotOverwrite = true;
      this.saveFailed = true;
      return 'unavailable';
    }
    if (raw === null) return 'empty';
    const data = parseDocument(raw);
    if (data) {
      this.events = data.events;
      this.tasks = data.tasks;
      return 'ok';
    }
    try {
      if (this.#storage.getItem(CORRUPT_KEY) === raw) return 'empty';
      this.#storage.setItem(CORRUPT_KEY, raw);
    } catch {
      this.#mustNotOverwrite = true;
      this.saveFailed = true;
    }
    return 'corrupt';
  }

  /** Re-reads storage after another tab changed it. Something unreadable there is ignored. */
  reload() {
    if (!this.#persistent) return;
    let raw;
    try {
      raw = this.#storage.getItem(STORE_KEY);
    } catch {
      return;
    }
    const data = raw === null ? { events: [], tasks: [] } : parseDocument(raw);
    if (!data) return;
    this.events = data.events;
    this.tasks = data.tasks;
    this.#notify();
  }

  /** Starts with some data without saving it, for ?demo. */
  seed({ events, tasks }) {
    this.events = events;
    this.tasks = tasks;
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #notify() {
    for (const listener of this.#listeners) listener();
  }

  #save() {
    if (!this.#persistent) return;
    try {
      if (this.#mustNotOverwrite || !this.#storage) throw new Error('Not saving');
      this.#storage.setItem(STORE_KEY, stringifyDocument(this));
      this.saveFailed = false;
      if (!this.#savedOnce) {
        this.#savedOnce = true;
        this.#onFirstSave();
      }
    } catch {
      this.saveFailed = true;
    }
  }

  #commit() {
    this.#save();
    this.#notify();
  }

  /** The whole store as a file's text, for Export. */
  exportText(now = new Date()) {
    return stringifyDocument(this, now);
  }

  eventById(id) {
    return this.events.find((event) => event.id === id) ?? null;
  }

  taskById(id) {
    return this.tasks.find((task) => task.id === id) ?? null;
  }

  addEvent(fields) {
    const event = { id: newId(), ...fields };
    this.events = [...this.events, event];
    this.#commit();
    return event;
  }

  updateEvent(id, fields) {
    if (!this.eventById(id)) {
      // Another tab deleted it while this one was editing. Saving brings it back rather than losing the edit.
      this.events = [...this.events, { id, ...fields }];
    } else {
      this.events = this.events.map((event) => (event.id === id ? { ...event, ...fields } : event));
    }
    this.#commit();
  }

  /** @returns A token for restore(), or null if there was nothing to remove. */
  removeEvent(id) {
    return this.#remove('events', (event) => event.id === id);
  }

  addTask(title, now = new Date()) {
    const task = { id: newId(), title, notes: '', assignedAt: now.toISOString(), completedAt: null };
    this.tasks = [...this.tasks, task];
    this.#commit();
    return task;
  }

  /** @param original The task as the editor found it, for bringing it back if another tab has removed it since. */
  updateTask(id, fields, original = null) {
    if (!this.taskById(id)) {
      this.tasks = [...this.tasks, { id, ...fields, completedAt: original?.completedAt ?? null }];
    } else {
      this.tasks = this.tasks.map((task) => (task.id === id ? { ...task, ...fields } : task));
    }
    this.#commit();
  }

  /** Sets or clears completedAt, keeping everything else, including the original assignedAt. */
  setCompleted(id, completedAt) {
    if (this.taskById(id)) this.updateTask(id, { completedAt });
  }

  /** @returns A token for restore(), or null if there was nothing to remove. */
  removeTask(id) {
    return this.#remove('tasks', (task) => task.id === id);
  }

  /** Removes completed tasks, except any in `keepIds`. @returns A token for restore(), or null. */
  clearCompleted(keepIds = new Set()) {
    return this.#remove('tasks', (task) => task.completedAt && !keepIds.has(task.id));
  }

  #remove(listName, shouldRemove) {
    const entries = [];
    const kept = [];
    this[listName].forEach((item, index) => {
      if (shouldRemove(item)) entries.push({ item, index });
      else kept.push(item);
    });
    if (entries.length === 0) return null;
    this[listName] = kept;
    this.#commit();
    return { listName, entries };
  }

  /** Undo: puts removed items back exactly as they were (same ids, same dates), where they were. */
  restore({ listName, entries }) {
    const list = [...this[listName]];
    for (const { item, index } of entries) {
      if (!list.some((other) => other.id === item.id)) list.splice(Math.min(index, list.length), 0, item);
    }
    this[listName] = list;
    this.#commit();
  }

  /** Import: replaces everything. */
  replaceAll({ events, tasks }) {
    this.events = events;
    this.tasks = tasks;
    this.#commit();
  }
}

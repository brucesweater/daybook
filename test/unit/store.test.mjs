import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CORRUPT_KEY, STORE_KEY, Store, newId } from '../../docs/js/store.js';
import { parseDocument } from '../../docs/js/schema.js';
import { demoData } from '../../docs/js/demo.js';

const FIXTURE = readFileSync(new URL('../fixtures/daybook-sample.json', import.meta.url), 'utf8');

class FakeStorage {
  map = new Map();
  writes = [];
  failWrites = false;
  failReads = false;
  getItem(key) {
    if (this.failReads) throw new Error('blocked');
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    if (this.failWrites) throw new Error('quota');
    this.writes.push(key);
    this.map.set(key, value);
  }
}

const eventFields = {
  title: 'Dentist', notes: '', allDay: false,
  startDay: '2026-11-05', startMinutes: 870, endDay: '2026-11-05', endMinutes: 930,
};

test('a fresh store is empty and writes nothing on load', () => {
  const storage = new FakeStorage();
  const store = new Store({ storage });
  assert.equal(store.load(), 'empty');
  assert.deepEqual(store.events, []);
  assert.deepEqual(store.tasks, []);
  assert.deepEqual(storage.writes, []);
});

test('it loads the fixture from storage', () => {
  const storage = new FakeStorage();
  storage.map.set(STORE_KEY, FIXTURE);
  const store = new Store({ storage });
  assert.equal(store.load(), 'ok');
  assert.equal(store.events.length, 5);
  assert.equal(store.tasks.length, 3);
});

test('every change saves immediately, in the file format', () => {
  const storage = new FakeStorage();
  const store = new Store({ storage });
  store.load();
  const task = store.addTask('Essay', new Date('2026-11-01T18:00:00.000Z'));
  let saved = JSON.parse(storage.map.get(STORE_KEY));
  assert.equal(saved.app, 'Daybook');
  assert.equal(saved.version, 1);
  assert.equal(saved.tasks[0].id, task.id);
  assert.equal(saved.tasks[0].assignedAt, '2026-11-01T18:00:00.000Z');
  assert.equal(saved.tasks[0].completedAt, null);

  store.setCompleted(task.id, '2026-11-01T19:00:00.000Z');
  saved = JSON.parse(storage.map.get(STORE_KEY));
  assert.equal(saved.tasks[0].completedAt, '2026-11-01T19:00:00.000Z');

  store.setCompleted(task.id, null);
  saved = JSON.parse(storage.map.get(STORE_KEY));
  assert.equal(saved.tasks[0].completedAt, null);
  assert.equal(saved.tasks[0].assignedAt, '2026-11-01T18:00:00.000Z', 'reopening keeps assignedAt');

  const event = store.addEvent(eventFields);
  store.updateEvent(event.id, { title: 'Dentist again' });
  saved = JSON.parse(storage.map.get(STORE_KEY));
  assert.equal(saved.events[0].title, 'Dentist again');
  assert.ok(parseDocument(storage.map.get(STORE_KEY)), 'what is saved passes validation');
});

test('saved data loads back', () => {
  const storage = new FakeStorage();
  const first = new Store({ storage });
  first.load();
  first.addEvent(eventFields);
  first.addTask('Essay');
  const second = new Store({ storage });
  assert.equal(second.load(), 'ok');
  assert.deepEqual(second.events, first.events);
  assert.deepEqual(second.tasks, first.tasks);
});

test('listeners hear about changes', () => {
  const store = new Store({ storage: new FakeStorage() });
  let calls = 0;
  const unsubscribe = store.subscribe(() => { calls += 1; });
  store.addTask('One');
  assert.equal(calls, 1);
  unsubscribe();
  store.addTask('Two');
  assert.equal(calls, 1);
});

test('undo restores an event exactly, in place', () => {
  const store = new Store({ storage: new FakeStorage() });
  const a = store.addEvent({ ...eventFields, title: 'A' });
  const b = store.addEvent({ ...eventFields, title: 'B' });
  const c = store.addEvent({ ...eventFields, title: 'C' });
  const before = [...store.events];
  const token = store.removeEvent(b.id);
  assert.deepEqual(store.events.map((event) => event.id), [a.id, c.id]);
  store.restore(token);
  assert.deepEqual(store.events, before);
});

test('undo restores a task exactly, with the same id and dates', () => {
  const store = new Store({ storage: new FakeStorage() });
  const task = store.addTask('Essay', new Date('2026-10-01T00:00:00.000Z'));
  store.setCompleted(task.id, '2026-10-02T00:00:00.000Z');
  const snapshot = { ...store.tasks[0] };
  const token = store.removeTask(task.id);
  assert.deepEqual(store.tasks, []);
  store.restore(token);
  assert.deepEqual(store.tasks[0], snapshot);
});

test('removing something that is not there returns no token', () => {
  const store = new Store({ storage: new FakeStorage() });
  assert.equal(store.removeTask('nope'), null);
  assert.equal(store.removeEvent('nope'), null);
  assert.equal(store.clearCompleted(), null);
});

test('clear removes only completed tasks, skips those still settling, and undoes in place', () => {
  const store = new Store({ storage: new FakeStorage() });
  const open = store.addTask('Open');
  const done1 = store.addTask('Done 1');
  const settling = store.addTask('Settling');
  const done2 = store.addTask('Done 2');
  store.setCompleted(done1.id, '2026-10-02T00:00:00.000Z');
  store.setCompleted(settling.id, '2026-10-02T00:00:00.000Z');
  store.setCompleted(done2.id, '2026-10-03T00:00:00.000Z');
  const before = [...store.tasks];

  const token = store.clearCompleted(new Set([settling.id]));
  assert.deepEqual(store.tasks.map((task) => task.title), ['Open', 'Settling']);
  assert.equal(token.entries.length, 2);

  store.restore(token);
  assert.deepEqual(store.tasks, before);
  assert.equal(store.tasks[0].id, open.id);
});

test('restore does not duplicate an id that came back another way', () => {
  const store = new Store({ storage: new FakeStorage() });
  const task = store.addTask('Essay');
  const token = store.removeTask(task.id);
  store.restore(token);
  store.restore(token);
  assert.equal(store.tasks.length, 1);
});

test('replaceAll replaces everything and saves', () => {
  const storage = new FakeStorage();
  const store = new Store({ storage });
  store.addTask('Old');
  const data = parseDocument(FIXTURE);
  store.replaceAll(data);
  assert.equal(store.tasks.length, 3);
  assert.equal(store.events.length, 5);
  const reread = parseDocument(storage.map.get(STORE_KEY));
  assert.deepEqual(reread, data);
});

test('corrupt store: keeps a copy, starts empty, says so once, does not overwrite on load', () => {
  for (const raw of ['{not json', '{"app":"Other"}', '{"app":"Daybook","version":1,"events":[{}],"tasks":[]}', '']) {
    const storage = new FakeStorage();
    storage.map.set(STORE_KEY, raw);
    const store = new Store({ storage });
    assert.equal(store.load(), 'corrupt', raw);
    assert.deepEqual(store.events, []);
    assert.deepEqual(store.tasks, []);
    assert.equal(storage.map.get(CORRUPT_KEY), raw);
    assert.equal(storage.map.get(STORE_KEY), raw, 'the original is untouched by loading');

    // A reload with nothing changed doesn't say it again.
    const again = new Store({ storage });
    assert.equal(again.load(), 'empty');
    assert.deepEqual(storage.writes, [CORRUPT_KEY]);
  }
});

test('corrupt store: the first change saves normally, and the copy stays', () => {
  const storage = new FakeStorage();
  storage.map.set(STORE_KEY, '{not json');
  const store = new Store({ storage });
  store.load();
  store.addTask('New life');
  assert.equal(store.saveFailed, false);
  assert.equal(storage.map.get(CORRUPT_KEY), '{not json');
  assert.ok(parseDocument(storage.map.get(STORE_KEY)));
  const next = new Store({ storage });
  assert.equal(next.load(), 'ok');
  assert.equal(next.tasks[0].title, 'New life');
});

test('corrupt store that can not be copied is never overwritten', () => {
  const storage = new FakeStorage();
  storage.map.set(STORE_KEY, '{not json');
  storage.failWrites = true;
  const store = new Store({ storage });
  assert.equal(store.load(), 'corrupt');
  assert.equal(store.saveFailed, true);
  storage.failWrites = false;
  store.addTask('Can not save yet');
  assert.equal(storage.map.get(STORE_KEY), '{not json');
  assert.equal(store.saveFailed, true);
  assert.equal(store.tasks.length, 1, 'the app keeps working in memory');
});

test('a failed save flags saveFailed, never throws, keeps working, and recovers', () => {
  const storage = new FakeStorage();
  const store = new Store({ storage });
  store.load();
  storage.failWrites = true;
  assert.doesNotThrow(() => store.addTask('Unsaved'));
  assert.equal(store.saveFailed, true);
  assert.equal(store.tasks.length, 1);
  storage.failWrites = false;
  store.addTask('Saved');
  assert.equal(store.saveFailed, false);
  assert.equal(JSON.parse(storage.map.get(STORE_KEY)).tasks.length, 2);
});

test('storage that can not even be read means unavailable, and no crash', () => {
  const storage = new FakeStorage();
  storage.failReads = true;
  const store = new Store({ storage });
  assert.equal(store.load(), 'unavailable');
  assert.equal(store.saveFailed, true);
  assert.doesNotThrow(() => store.addTask('Memory only'));

  const none = new Store({ storage: null });
  assert.equal(none.load(), 'unavailable');
  assert.doesNotThrow(() => none.addTask('Memory only'));
  assert.equal(none.saveFailed, true);
});

test('if the first read failed, a later change does not overwrite data nobody has read', () => {
  const storage = new FakeStorage();
  storage.map.set(STORE_KEY, FIXTURE);
  storage.failReads = true;
  const store = new Store({ storage });
  assert.equal(store.load(), 'unavailable');

  // Reading works again, or writing never stopped working: the store still can't know what it would destroy.
  storage.failReads = false;
  store.addTask('After');
  assert.equal(storage.map.get(STORE_KEY), FIXTURE);
  assert.deepEqual(storage.writes, []);
  assert.equal(store.saveFailed, true, 'and the banner stays');
  assert.deepEqual(store.tasks.map((task) => task.title), ['After']);
});

test('a task brought back after another tab removed it keeps the state it had', () => {
  const storage = new FakeStorage();
  const store = new Store({ storage });
  store.load();
  const fields = { title: 'Edited', notes: '', assignedAt: '2026-10-01T12:00:00.000Z' };
  store.updateTask('gone', fields, { completedAt: '2026-10-02T12:00:00.000Z' });
  assert.deepEqual(store.taskById('gone'), { id: 'gone', ...fields, completedAt: '2026-10-02T12:00:00.000Z' });
  store.updateTask('gone too', fields, { completedAt: null });
  assert.equal(store.taskById('gone too').completedAt, null);
  store.updateTask('gone as well', fields);
  assert.equal(store.taskById('gone as well').completedAt, null);
  assert.ok(parseDocument(storage.map.get(STORE_KEY)), 'all of it still valid');
});

test('editing a task that is still there leaves its current state alone, whatever the sheet remembered', () => {
  const store = new Store({ storage: new FakeStorage() });
  const task = store.addTask('Essay');
  store.setCompleted(task.id, '2026-10-02T12:00:00.000Z'); // Checked off in another tab while a sheet was open here.
  store.updateTask(task.id, { title: 'Edited' }, { completedAt: null });
  assert.equal(store.taskById(task.id).completedAt, '2026-10-02T12:00:00.000Z');
});

test('onFirstSave runs once, after the first save that worked', () => {
  const storage = new FakeStorage();
  let calls = 0;
  const store = new Store({ storage, onFirstSave: () => { calls += 1; } });
  assert.equal(calls, 0, 'not on load');
  store.load();
  assert.equal(calls, 0);
  storage.failWrites = true;
  store.addTask('A');
  assert.equal(calls, 0, 'not when the save failed');
  storage.failWrites = false;
  store.addTask('B');
  store.addTask('C');
  assert.equal(calls, 1);
});

test('demo stores never touch storage', () => {
  const storage = new FakeStorage();
  storage.map.set(STORE_KEY, FIXTURE);
  let firstSaves = 0;
  const store = new Store({ storage, persistent: false, onFirstSave: () => { firstSaves += 1; } });
  assert.equal(store.load(), 'empty');
  store.seed(demoData(new Date('2026-11-01T18:00:00.000Z')));
  assert.ok(store.events.length > 0);
  store.addTask('Not saved');
  store.removeEvent(store.events[0].id);
  assert.deepEqual(storage.writes, []);
  assert.equal(storage.map.get(STORE_KEY), FIXTURE);
  assert.equal(firstSaves, 0);
  assert.equal(store.saveFailed, false);
});

test('reload picks up what another tab saved, and ignores nonsense', () => {
  const storage = new FakeStorage();
  const tabA = new Store({ storage });
  const tabB = new Store({ storage });
  tabA.load();
  tabB.load();
  let heard = 0;
  tabB.subscribe(() => { heard += 1; });
  tabA.addTask('From A');
  tabB.reload();
  assert.equal(heard, 1);
  assert.equal(tabB.tasks[0].title, 'From A');

  storage.map.set(STORE_KEY, 'junk');
  tabB.reload();
  assert.equal(heard, 1, 'nothing to re-render');
  assert.equal(tabB.tasks[0].title, 'From A', 'keeps what it has');

  storage.map.delete(STORE_KEY);
  tabB.reload();
  assert.deepEqual(tabB.tasks, []);
});

test('updating something another tab deleted brings it back rather than losing the edit', () => {
  const store = new Store({ storage: new FakeStorage() });
  store.updateEvent('gone', eventFields);
  assert.equal(store.eventById('gone').title, 'Dentist');
  store.updateTask('gone', { title: 'T', notes: '', assignedAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(store.taskById('gone').completedAt, null);
});

test('ids: randomUUID, then a getRandomValues fallback that makes a v4 UUID', () => {
  assert.match(newId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const onlyRandom = { getRandomValues: (bytes) => globalThis.crypto.getRandomValues(bytes) };
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) {
    const id = newId(onlyRandom);
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    seen.add(id);
  }
  assert.equal(seen.size, 200);
});

test('demo data is valid, fictional, and relative to now', () => {
  const now = new Date(2026, 10, 1, 15, 0);
  const data = demoData(now);
  const round = parseDocument(JSON.stringify({ app: 'Daybook', version: 1, ...data }));
  assert.ok(round, 'demo data passes validation');
  assert.ok(data.tasks.some((task) => !task.completedAt));
  assert.ok(data.tasks.some((task) => task.completedAt));
  assert.ok(data.events.some((event) => event.startDay === '2026-11-01'));
  assert.ok(data.events.some((event) => event.allDay));
  for (const task of data.tasks) assert.ok(Date.parse(task.assignedAt) <= now.getTime());
});

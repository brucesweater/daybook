// Hundreds of random real interactions, with invariants checked as it goes. Scripted tests follow paths someone
// thought of; this finds the combinations nobody did: undo during a slide, a check-off while a sheet closes, and so on.
// It's seeded, so a failure can be replayed: the message names the seed and the last actions.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument } from '../../docs/js/schema.js';
import { FIXTURE } from '../helpers/data.mjs';
import { launch, openApp, touchSwipe } from '../helpers/harness.mjs';

let env;
before(async () => { env = await launch(); });
after(async () => { await env.close(); });

/** mulberry32: small, seedable, good enough. */
function randomFrom(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (limit) => Math.floor(next() * limit),
    pick: (list) => list[Math.floor(next() * list.length)],
  };
}

/** What must be true whenever nothing is moving. */
async function checkInvariants(page) {
  const facts = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('#days-pane .day')];
    const selected = cells.filter((cell) => cell.getAttribute('aria-selected') === 'true');
    const open = [...document.querySelectorAll('#open-list > .task:not(.leaving)')];
    const done = [...document.querySelectorAll('#done-list > .task:not(.leaving)')];
    return {
      cells: cells.length,
      selected: selected.length,
      roving: cells.filter((cell) => cell.tabIndex === 0).length,
      selectedIsRoving: selected[0]?.tabIndex === 0,
      discs: cells.filter((cell) => cell.classList.contains('is-selected')).length,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      emptyOpen: open.filter((row) => !row.querySelector('.task-line').textContent).length,
      badLines: open.filter((row) => !/^(Assigned )/.test(row.querySelector('.task-line').textContent)).length,
      badDone: done.filter((row) => !/^Done .* · took /.test(row.querySelector('.task-line').textContent)).length,
      doneLabel: document.querySelector('#completed-label').textContent,
      completedHidden: document.querySelector('#completed').hidden,
      doneCount: done.length,
      openCount: open.length,
      count: document.querySelector('#todo-count').textContent,
      stored: localStorage.getItem('daybook.v1'),
    };
  });
  assert.equal(facts.cells, 42, 'always 42 cells');
  assert.equal(facts.selected, 1, 'exactly one selected day');
  assert.equal(facts.roving, 1, 'exactly one day in the tab order');
  assert.equal(facts.selectedIsRoving, true, 'and it is the selected one');
  assert.equal(facts.discs, 1, 'exactly one disc');
  assert.equal(facts.overflow, false, 'no sideways scrolling');
  assert.equal(facts.emptyOpen, 0, 'every open task shows its age line');
  assert.equal(facts.badLines, 0, 'open rows say Assigned');
  assert.equal(facts.badDone, 0, 'done rows say Done');
  if (!facts.completedHidden) assert.equal(facts.doneLabel, `Completed (${facts.doneCount})`);
  assert.equal(facts.completedHidden, facts.doneCount === 0, 'Completed is hidden exactly when there are none');
  if (facts.stored !== null) assert.ok(parseDocument(facts.stored), 'what is saved always passes validation');
}

async function closeAnySheet(page) {
  if (await page.locator('dialog[open]').count() === 0) return;
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'), null, { timeout: 2000 }).catch(async () => {
    // A second Escape: Chrome only lets a page refuse one close request without a user gesture.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog[open]'), null, { timeout: 2000 });
  });
}

function actionsFor(page, random, { touch }) {
  const clickFirst = async (selector) => {
    const items = page.locator(selector);
    const count = await items.count();
    if (count === 0) return;
    await items.nth(random.int(count)).click({ timeout: 400, force: false }).catch(() => {});
  };
  const onScreen = async (name) => {
    if (touch) await page.locator(`#tab-${name}`).click({ timeout: 400 }).catch(() => {});
  };

  return {
    'click a day': () => clickFirst('#days-pane .day'),
    'next month': () => page.locator('#next-month').click({ timeout: 400 }).catch(() => {}),
    'previous month': () => page.locator('#prev-month').click({ timeout: 400 }).catch(() => {}),
    today: () => page.locator('#go-today').click({ timeout: 400 }).catch(() => {}),
    'grid keys': async () => {
      await page.locator('#days-pane .day[tabindex="0"]').focus().catch(() => {});
      for (let i = random.int(4); i >= 0; i -= 1) {
        await page.keyboard.press(random.pick(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']));
      }
    },
    'T key': () => page.keyboard.press('t'),
    'add an event': async () => {
      await onScreen('calendar');
      await page.locator('#new-event').click({ timeout: 400 }).catch(() => {});
      await page.locator('#event-title').fill(random.pick(['Dentist', '写作业 ✏️', 'x'.repeat(200), '<img src=x onerror=alert(1)>'])).catch(() => {});
      await page.locator('#event-submit').click({ timeout: 400 }).catch(() => {});
    },
    'add an event, moving dates': async () => {
      await onScreen('calendar');
      await page.locator('#new-event').click({ timeout: 400 }).catch(() => {});
      await page.locator('#event-title').fill('Moved').catch(() => {});
      await page.locator('#event-start-date').fill(`2026-${String(1 + random.int(12)).padStart(2, '0')}-1${random.int(9)}`).catch(() => {});
      await page.locator('#event-end-time').fill(`${String(random.int(24)).padStart(2, '0')}:00`).catch(() => {});
      if (random.next() < 0.3) await page.locator('#event-all-day').click({ force: true, timeout: 400 }).catch(() => {});
      await page.locator('#event-submit').click({ timeout: 400 }).catch(() => {});
    },
    'delete an event': async () => {
      await onScreen('calendar');
      await clickFirst('.agenda-row');
      await page.locator('#event-delete').click({ timeout: 300 }).catch(() => {});
    },
    undo: () => clickFirst('.toast-undo'),
    'add a task': async () => {
      await onScreen('todo');
      await page.locator('#add-input').fill(random.pick(['Essay', 'Buy oat milk', '   ', '整理房间'])).catch(() => {});
      await page.locator('#add-input').press('Enter').catch(() => {});
    },
    'check a task': async () => {
      await onScreen('todo');
      await clickFirst('#open-list .check');
    },
    'reopen a task': async () => {
      await onScreen('todo');
      await clickFirst('#done-list .check');
    },
    'toggle Completed': async () => {
      await onScreen('todo');
      await page.locator('#completed-toggle').click({ timeout: 300 }).catch(() => {});
    },
    'clear Completed': async () => {
      await onScreen('todo');
      await page.locator('#clear-completed').click({ timeout: 300 }).catch(() => {});
    },
    'edit a task': async () => {
      await onScreen('todo');
      await clickFirst('#open-list .task-text');
      await page.locator('#task-title').fill('Edited').catch(() => {});
      await page.locator('#task-date').fill(random.pick(['2026-10-01', '2020-01-01', '2099-01-01'])).catch(() => {});
      await page.locator('#task-submit').click({ timeout: 300 }).catch(() => {});
    },
    'delete a task': async () => {
      await onScreen('todo');
      await clickFirst('#open-list .task-text');
      await page.locator('#task-delete').click({ timeout: 300 }).catch(() => {});
    },
    'switch tabs': async () => {
      if (touch) await onScreen(random.pick(['calendar', 'todo']));
    },
    'the menu': async () => {
      await page.locator('#menu-button').click({ timeout: 300 }).catch(() => {});
      await page.keyboard.press('Escape');
    },
    'import the fixture': async () => {
      await page.locator('#menu-button').click({ timeout: 300 }).catch(() => {});
      const chooser = page.waitForEvent('filechooser', { timeout: 400 }).catch(() => null);
      await page.locator('#menu-import').click({ timeout: 300 }).catch(() => {});
      const fileChooser = await chooser;
      if (fileChooser) {
        await fileChooser.setFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(FIXTURE) });
        await page.locator('#alert-confirm').click({ timeout: 400 }).catch(() => {});
      }
    },
    swipe: async () => {
      if (!touch) return;
      await onScreen(random.pick(['calendar', 'todo']));
      const rows = page.locator('#open-list .task:visible, .agenda-item:visible');
      const count = await rows.count();
      if (count === 0) return;
      const box = await rows.nth(random.int(count)).boundingBox().catch(() => null);
      if (!box) return;
      const y = box.y + Math.min(box.height / 2, 20);
      await touchSwipe(page, { x: 340, y }, { x: 340 - (40 + random.int(280)), y }, { steps: 6, stepDelay: 8 });
    },
    'swipe the grid': async () => {
      if (!touch) return;
      await onScreen('calendar');
      const grid = await page.locator('#days').boundingBox().catch(() => null);
      if (!grid) return;
      const direction = random.pick([-1, 1]);
      const y = grid.y + grid.height / 2;
      await touchSwipe(page, { x: 195, y }, { x: 195 + direction * (30 + random.int(120)), y }, { steps: 6, stepDelay: 8 });
    },
  };
}

const BASE_SEED = Number(process.env.MONKEY_SEED) || 20261101;
const STEPS = Number(process.env.MONKEY_STEPS) || 120;
const RUNS = [
  { layout: 'desktop', seed: BASE_SEED, touch: false },
  { layout: 'phone', seed: BASE_SEED + 1, touch: true },
];

describe('monkey', () => {
  for (const { layout, seed, touch } of RUNS) {
    test(`${layout}: ${STEPS} random actions, seed ${seed}`, { timeout: STEPS * 1500 }, async () => {
      const app = await openApp(env, { layout, seed: '{"app":"Daybook","version":1,"events":[],"tasks":[]}' });
      const { page, problems } = app;
      // Plenty of actions aim at things that aren't there right now. They should give up quickly.
      page.setDefaultTimeout(400);
      const random = randomFrom(seed);
      const actions = actionsFor(page, random, { touch });
      const names = Object.keys(actions);
      const trail = [];
      for (let step = 0; step < STEPS; step += 1) {
        const name = random.pick(names);
        trail.push(name);
        const started = Date.now();
        try {
          // Usually starts from the page. Sometimes a sheet stays up, and the action runs into it.
          if (random.next() < 0.8) await closeAnySheet(page);
          await actions[name]();
          if (step % 10 === 9) {
            await closeAnySheet(page);
            // Long enough for any check-off to settle and any animation to end.
            await page.waitForTimeout(1250);
            await checkInvariants(page);
          }
        } catch (error) {
          error.message = `seed ${seed}, step ${step}, last actions: ${trail.slice(-8).join(' > ')}\n${error.message}`;
          throw error;
        }
        assert.deepEqual(problems, [], `seed ${seed}, step ${step}, last actions: ${trail.slice(-8).join(' > ')}`);
        if (process.env.MONKEY_TRACE && Date.now() - started > 1500) console.log(`step ${step} ${name}: ${Date.now() - started} ms`);
      }
      await closeAnySheet(page);
      await app.finish();
    });
  }
});

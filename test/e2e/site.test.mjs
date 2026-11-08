import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { doc, event, messyData, task } from '../helpers/data.mjs';
import { TIME_ZONE, horizontalOverflow, launch, openApp, until, withApp, zoned } from '../helpers/harness.mjs';

let env;
before(async () => { env = await launch(); });
after(async () => { await env.close(); });

const NOW = zoned(TIME_ZONE, 2026, 11, 5, 12);

describe('served from /daybook/', () => {
  test('every request stays under the base path, and every resource loads', async () => {
    await withApp(env, { clock: NOW, serviceWorkers: 'allow' }, async ({ page, context }) => {
      await page.evaluate(() => navigator.serviceWorker.ready);
      const urls = [];
      context.on('request', (request) => urls.push(request.url()));
      await page.reload();
      await page.waitForFunction(() => document.querySelectorAll('.day[data-day]').length === 42);
      assert.ok(urls.length > 10);
      for (const url of urls) assert.ok(url.startsWith(env.server.url), url);
      assert.ok(urls.some((url) => url.endsWith('/js/app.js')));
      assert.ok(urls.some((url) => url.endsWith('/style.css')));
    });
    assert.ok(env.server.requests.every((path) => path.startsWith('/daybook')), env.server.requests.filter((path) => !path.startsWith('/daybook')).join());
  });

  test('without the trailing slash it still arrives', async () => {
    const app = await openApp(env, { clock: NOW });
    await app.page.goto(env.server.url.replace(/\/$/, ''));
    await app.page.waitForFunction(() => document.querySelectorAll('.day[data-day]').length === 42);
    assert.equal(new URL(app.page.url()).pathname, '/daybook/');
    await app.finish();
  });

  test('the site really does not work from the root', async () => {
    const response = await fetch(`${env.server.origin}/index.html`);
    assert.equal(response.status, 404);
  });
});

describe('offline', () => {
  test('opens offline after one visit, and a new version wins when back online', async () => {
    const app = await openApp(env, { clock: NOW, serviceWorkers: 'allow', allowProblems: true });
    const { page, context } = app;
    await page.locator('#add-input').fill('Survives offline');
    await page.locator('#add-input').press('Enter');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
      }
    });
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.day[data-day]').length === 42);
    assert.deepEqual(await page.locator('#open-list .task-title').allInnerTexts(), ['Survives offline']);
    assert.equal(await page.locator('.brand').innerText(), 'Daybook');

    // A different query string still opens from the cache.
    await page.goto(`${env.server.url}?anything=1`);
    await page.waitForFunction(() => document.querySelectorAll('.day[data-day]').length === 42);

    await context.setOffline(false);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.day[data-day]').length === 42);
    await context.close();
  });

  test('the service worker is scoped to the site, and a new version wins at once: nothing stale is pinned', async () => {
    const app = await openApp(env, { clock: NOW, serviceWorkers: 'allow' });
    const { page } = app;
    const scope = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
      }
      return registration.scope;
    });
    assert.equal(scope, env.server.url);

    // Deploy a "new version" of the stylesheet. The next load, through the service worker, must get it.
    env.server.overrides.set('style.css', '.new-version-marker { color: red; }');
    try {
      await page.reload();
      await page.waitForFunction(() => document.querySelectorAll('.day[data-day]').length === 42);
      const hasMarker = await page.evaluate(() => [...document.styleSheets].some((sheet) => [...sheet.cssRules].some((rule) => rule.selectorText === '.new-version-marker')));
      assert.equal(hasMarker, true);
    } finally {
      env.server.overrides.delete('style.css');
    }
    await page.reload();
    await app.finish();
  });

  const SW = readFileSync(new URL('../../docs/sw.js', import.meta.url), 'utf8');
  const INDEX = readFileSync(new URL('../../docs/index.html', import.meta.url), 'utf8');
  const fullyLoaded = (page, options) => page.waitForFunction(() => document.querySelectorAll('.day[data-day]').length === 42, null, options);

  async function controlled(page) {
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
      }
    });
  }

  /** Puts a different service worker in charge, the way a deployment would. */
  async function deployWorker(page, source) {
    env.server.overrides.set('sw.js', source);
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      await registration.update();
      const worker = registration.installing ?? registration.waiting;
      if (worker) {
        await new Promise((resolve) => {
          worker.addEventListener('statechange', () => {
            if (worker.state === 'activated') resolve();
          });
        });
      }
    });
  }

  test('a cache write that fails (quota, say) still gives the page the new version', async () => {
    const app = await openApp(env, { serviceWorkers: 'allow' });
    const { page } = app;
    await controlled(page);
    try {
      await deployWorker(page, `Cache.prototype.put = () => Promise.reject(new DOMException('Full', 'QuotaExceededError'));\n${SW}`);
      env.server.overrides.set('index.html', INDEX.replace('<html lang="en">', '<html lang="en" data-version="2">'));
      await page.reload();
      await fullyLoaded(page);
      assert.equal(await page.locator('html').getAttribute('data-version'), '2');
    } finally {
      env.server.overrides.delete('sw.js');
      env.server.overrides.delete('index.html');
    }
    await app.finish();
  });

  test('a broken cache does not take the site down while the network is fine', async () => {
    const app = await openApp(env, { serviceWorkers: 'allow' });
    const { page } = app;
    await controlled(page);
    try {
      await deployWorker(page, `${SW}\nself.addEventListener('activate', () => { caches.open = () => Promise.reject(new DOMException('Broken', 'UnknownError')); });`);
      await page.reload();
      await fullyLoaded(page);
      assert.equal(await page.locator('.brand').innerText(), 'Daybook');
    } finally {
      env.server.overrides.delete('sw.js');
    }
    await app.finish();
  });

  test('a network that accepts the connection and never answers: it opens from the cache in seconds', async () => {
    const app = await openApp(env, { serviceWorkers: 'allow', allowProblems: true });
    const { page, context } = app;
    await page.locator('#add-input').fill('Survives a stall');
    await page.locator('#add-input').press('Enter');
    await controlled(page);
    await page.waitForFunction(async () => (await (await caches.open('daybook-v1')).keys()).length >= 31);
    env.server.stall(true);
    try {
      const started = Date.now();
      await page.goto(env.server.url, { waitUntil: 'commit', timeout: 15000 });
      await fullyLoaded(page, { timeout: 15000 });
      const elapsed = Date.now() - started;
      assert.ok(elapsed < 12000, `took ${elapsed} ms`);
      assert.deepEqual(await page.locator('#open-list .task-title').allInnerTexts(), ['Survives a stall']);
    } finally {
      env.server.stall(false);
    }
    await context.close();
  });

  test('a stall with nothing cached for that file keeps waiting for the network instead of failing', async () => {
    const app = await openApp(env, { serviceWorkers: 'allow' });
    const { page } = app;
    await controlled(page);
    env.server.stall(true);
    // An image, because the page's own policy refuses fetch() outright, before the worker sees it. og.png isn't part
    // of the cached shell, and nothing on the page asks for it.
    const answer = page.evaluate(() => new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(`loaded ${image.naturalWidth}x${image.naturalHeight}`);
      image.onerror = () => resolve('failed');
      image.src = 'og.png';
    }));
    let settled = false;
    answer.then(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 4500));
    assert.equal(settled, false, 'still waiting after the point where a cached copy would have been used');
    env.server.stall(false);
    assert.equal(await answer, 'loaded 1200x630', 'and the network answer gets through when it comes');
    await app.finish();
  });
});

describe('head and PWA', () => {
  test('metadata is there, and the OG image is a real one', async () => {
    await withApp(env, { clock: NOW }, async ({ page }) => {
      assert.equal(await page.title(), 'Daybook');
      const content = (selector) => page.locator(selector).getAttribute('content');
      assert.match(await content('meta[name="description"]'), /calendar and a to-do list/);
      assert.match(await content('meta[name="viewport"]'), /viewport-fit=cover/);
      assert.equal(await content('meta[property="og:image"]'), 'https://brucesweater.github.io/daybook/og.png');
      assert.equal(await content('meta[name="apple-mobile-web-app-capable"]'), 'yes');
      const response = await page.request.get(new URL('og.png', page.url()).href);
      assert.equal(response.ok(), true);
      const manifest = await page.request.get(new URL('manifest.webmanifest', page.url()).href);
      assert.equal((await manifest.json()).display, 'standalone');
      for (const icon of ['icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon.svg']) {
        assert.equal((await page.request.get(new URL(icon, page.url()).href)).ok(), true, icon);
      }
    });
  });

  test('theme colour follows light and dark', async () => {
    for (const [colorScheme, layout, expected] of [
      ['light', 'desktop', '#F5F5F7'], ['dark', 'desktop', '#000000'],
      ['light', 'phone', '#FFFFFF'], ['dark', 'phone', '#1C1C1E'],
    ]) {
      await withApp(env, { clock: NOW, colorScheme, layout }, async ({ page }) => {
        const color = await page.evaluate(() => [...document.querySelectorAll('meta[name="theme-color"]')].find((meta) => matchMedia(meta.media).matches)?.content);
        assert.equal(color, expected);
      });
    }
  });
});

describe('layout', () => {
  test('1000 px and up: top bar, then two cards side by side, about 58 and 42 percent, filling the height', async () => {
    for (const viewport of [{ width: 1000, height: 800 }, { width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
      const app = await openApp(env, { clock: NOW, query: '?demo' });
      await app.page.setViewportSize(viewport);
      const [calendar, todo, bar] = await Promise.all(['#calendar', '#todo', '.topbar'].map((selector) => app.page.locator(selector).boundingBox()));
      assert.equal(await app.page.locator('.tabbar').isVisible(), false);
      assert.equal(calendar.y, todo.y, 'side by side');
      assert.ok(calendar.x + calendar.width <= todo.x, 'calendar first');
      const share = calendar.width / (calendar.width + todo.width);
      assert.ok(Math.abs(share - 0.58) < 0.01, `share ${share}`);
      assert.equal(calendar.height, todo.height);
      assert.ok(bar.height < 64, 'slim');
      assert.ok(calendar.y + calendar.height >= viewport.height - 24 && calendar.y + calendar.height <= viewport.height, 'fills the viewport');
      assert.equal(await app.page.evaluate(() => document.scrollingElement.scrollHeight <= innerHeight), true, 'the page itself does not scroll');
      await app.finish();
    }
  });

  test('a full day fits without scrolling on a laptop, and the grid keeps its rows at 1280 by 720', async () => {
    const day = '2026-11-05';
    const events = ['Breakfast', 'Dentist', 'Lunch', 'Piano', 'Dinner'].map((title, i) => event(`e${i}`, title, day, 480 + i * 120));
    const app = await openApp(env, { clock: NOW, seed: doc(events) });
    const { page } = app;
    const scrolls = () => page.locator('.agenda-scroll').evaluate((node) => node.scrollHeight > node.clientHeight);

    await page.setViewportSize({ width: 1440, height: 900 });
    assert.equal(await scrolls(), false, 'five events at 1440 by 900');

    await page.setViewportSize({ width: 1280, height: 720 });
    const row = await page.locator('#days-pane .week').first().boundingBox();
    assert.ok(row.height >= 42, `row ${row.height}`);
    const agenda = await page.locator('.agenda').boundingBox();
    const card = await page.locator('#calendar').boundingBox();
    assert.ok(Math.abs(agenda.y + agenda.height - (card.y + card.height)) <= 1, 'the agenda runs to the bottom of the card');
    assert.ok(agenda.height >= 240, `agenda ${agenda.height}`);
    assert.equal(await page.locator('#calendar-scroll').evaluate((node) => node.scrollHeight <= node.clientHeight), true, 'only the agenda scrolls');
    await app.finish();
  });

  test('four events show whole at 1280 by 720, with no row fading away', async () => {
    const day = '2026-11-05';
    const events = ['Farmers market', 'Design review', 'Dentist', 'Dinner with the neighbors'].map((title, i) => event(`e${i}`, title, day, 480 + i * 120));
    await withApp(env, { clock: NOW, seed: doc(events) }, async ({ page }) => {
      const [last, scroller] = await Promise.all([page.locator('.agenda-row').last().boundingBox(), page.locator('.agenda-scroll').boundingBox()]);
      assert.ok(last.y + last.height <= scroller.y + scroller.height - 20, `the last row ends at ${last.y + last.height}, the fade starts at ${scroller.y + scroller.height - 20}`);
    });
  });

  for (const [width, height] of [[1280, 600], [1366, 650], [1000, 620]]) {
    test(`a short window at ${width}x${height}: one scroller, the header stays, and the last row comes clear of the card`, async () => {
      const day = '2026-11-05';
      const events = Array.from({ length: 6 }, (_, i) => event(`e${i}`, `Event ${i}`, day, 480 + i * 60));
      const app = await openApp(env, { clock: NOW, seed: doc(events) });
      const { page } = app;
      await page.setViewportSize({ width, height });
      assert.equal(await page.locator('.agenda-scroll').evaluate((node) => getComputedStyle(node).overflowY), 'visible', 'the agenda does not scroll by itself');
      const scroller = page.locator('#calendar-scroll');
      const { before, after } = await scroller.evaluate((node) => {
        const before = node.scrollHeight > node.clientHeight;
        node.scrollTop = node.scrollHeight;
        return { before, after: node.scrollTop };
      });
      assert.ok(before && after > 0, 'the card itself scrolls');
      const [last, card, title] = await Promise.all([page.locator('.agenda-row').last().boundingBox(), page.locator('#calendar').boundingBox(), page.locator('#month-title').boundingBox()]);
      assert.ok(last.y + last.height <= card.y + card.height - 20, `last row ends at ${last.y + last.height}, card at ${card.y + card.height}`);
      assert.ok(title.y >= card.y, 'the month stays in view');
      await until(async () => assert.notEqual(await page.locator('.calendar-head').evaluate((node) => getComputedStyle(node).boxShadow), 'none', 'a hairline under the header once the grid scrolls beneath it'));
      assert.deepEqual(await horizontalOverflow(page), []);
      await app.finish();
    });
  }

  test('a window tall enough keeps the agenda as its own scroller', async () => {
    const app = await openApp(env, { clock: NOW, query: '?demo' });
    await app.page.setViewportSize({ width: 1280, height: 720 });
    assert.equal(await app.page.locator('.agenda-scroll').evaluate((node) => getComputedStyle(node).overflowY), 'auto');
    await app.finish();
  });

  test('a big screen grows the calendar, and No events stays near its heading', async () => {
    const app = await openApp(env, { clock: NOW });
    const { page } = app;
    await page.setViewportSize({ width: 1920, height: 1080 });
    assert.equal(await page.locator('.day-number').first().evaluate((node) => getComputedStyle(node).fontSize), '19px');
    const [heading, empty] = await Promise.all([page.locator('#agenda-title').boundingBox(), page.locator('#agenda-empty').boundingBox()]);
    assert.ok(empty.y + empty.height / 2 - (heading.y + heading.height) < 100, `${empty.y} under a heading at ${heading.y}`);
    await app.finish();
  });

  test('on desktop, the toast sits on the card it is about', async () => {
    for (const viewport of [{ width: 1000, height: 800 }, { width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 2200, height: 1200 }]) {
      const app = await openApp(env, { clock: NOW, query: '?demo' });
      const { page } = app;
      await page.setViewportSize(viewport);
      const check = async (cardSelector) => {
        const [toast, card] = await Promise.all([page.locator('.toast').boundingBox(), page.locator(cardSelector).boundingBox()]);
        const label = `${viewport.width}: ${cardSelector}`;
        assert.ok(toast.x >= card.x && toast.x + toast.width <= card.x + card.width, `${label}: ${toast.x}..${toast.x + toast.width} on ${card.x}..${card.x + card.width}`);
        assert.ok(Math.abs(toast.x + toast.width / 2 - (card.x + card.width / 2)) <= 1, `${label}: centred on it`);
        assert.ok(toast.y + toast.height <= card.y + card.height - 8, `${label}: inside its bottom edge`);
      };
      await page.locator('.agenda-row').first().click();
      await page.locator('#event-delete').click();
      await page.locator('.toast').waitFor();
      await until(() => check('#calendar'));
      await page.locator('#open-list .task-text').first().click();
      await page.locator('#task-delete').click();
      await until(async () => assert.equal(await page.locator('.toast-message').innerText(), 'Task deleted'));
      await until(() => check('#todo'));
      await page.locator('.toast-undo').click();
      await page.locator('#clear-completed').click();
      await until(async () => assert.equal(await page.locator('.toast-message').innerText(), 'Completed tasks cleared'));
      await until(() => check('#todo'));
      await app.finish();
    }
  });

  test('on a phone, the toast is centred above the tab bar, whichever screen it came from', async () => {
    await withApp(env, { clock: NOW, layout: 'phone', query: '?demo' }, async ({ page }) => {
      await page.locator('.agenda-row').first().tap();
      await page.locator('#event-delete').tap();
      await page.locator('.toast').waitFor();
      const toast = await page.locator('.toast').boundingBox();
      assert.ok(Math.abs(toast.x + toast.width / 2 - 195) <= 1, 'centred');
    });
  });

  test('the top bar shares its edges with the cards: the mark over the title, the menu over the +', async () => {
    for (const viewport of [{ width: 1000, height: 800 }, { width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 2200, height: 1200 }]) {
      const app = await openApp(env, { clock: NOW, query: '?demo' });
      const { page } = app;
      await page.setViewportSize(viewport);
      const edges = await page.evaluate(() => {
        const box = (selector) => document.querySelector(selector).getBoundingClientRect();
        // The mark's circle has a radius of 11 in a 24 by 24 box, and the menu's dots end at 20.25.
        const mark = box('.brand-mark');
        const dots = box('#menu-button svg');
        return {
          markLeft: mark.left + mark.width / 24,
          titleLeft: box('#month-title').left,
          dotsRight: dots.left + (dots.width * 20.25) / 24,
          plusRight: box('#focus-add').right,
        };
      });
      assert.ok(Math.abs(edges.markLeft - edges.titleLeft) <= 1, `${viewport.width}: ${JSON.stringify(edges)}`);
      assert.ok(Math.abs(edges.dotsRight - edges.plusRight) <= 1, `${viewport.width}: ${JSON.stringify(edges)}`);
      await app.finish();
    }
  });

  test('on phones, the + stays in one place when switching tabs, and long months still fit beside it', async () => {
    for (const width of [340, 360, 390, 430, 599]) {
      const app = await openApp(env, { clock: NOW, layout: 'phone', reducedMotion: 'reduce' });
      const { page } = app;
      await page.setViewportSize({ width, height: 800 });
      const calendarPlus = await page.locator('#new-event').boundingBox();
      for (let i = 0; i < 12; i += 1) {
        const title = await page.locator('#month-title').boundingBox();
        assert.ok(title.height < 45, `${width}: ${await page.locator('#month-title').innerText()} takes ${title.height} px`);
        assert.ok(title.x + title.width <= calendarPlus.x, 'beside the +');
        await page.locator('#next-month').click();
      }
      await page.locator('#tab-todo').click();
      const todoPlus = await page.locator('#focus-add').boundingBox();
      assert.ok(Math.abs(calendarPlus.x - todoPlus.x) <= 1 && Math.abs(calendarPlus.y - todoPlus.y) <= 1, `${width}: ${JSON.stringify([calendarPlus, todoPlus])}`);
      await app.finish();
    }
  });

  test('sheet fields show focus with the caret, in the accent colour, not with a box', async () => {
    await withApp(env, { clock: NOW }, async ({ page }) => {
      await page.locator('#new-event').click();
      const style = await page.locator('#event-title').evaluate((node) => {
        const computed = getComputedStyle(node);
        return { shadow: computed.boxShadow, caret: computed.caretColor, matched: node.matches(':focus-visible') };
      });
      assert.deepEqual(style, { shadow: 'none', caret: 'rgb(224, 40, 29)', matched: true });
    });
  });

  test('the age line outranks the notes above it', async () => {
    await withApp(env, { clock: NOW, query: '?demo' }, async ({ page }) => {
      const size = (selector) => page.locator(selector).first().evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
      assert.ok(await size('#open-list .task-notes:not([hidden])') < await size('#open-list .task-line'));
    });
  });

  test('Delete is a filled cell in the inset style, not an outlined box', async () => {
    await withApp(env, { clock: NOW, query: '?demo' }, async ({ page }) => {
      await page.locator('.agenda-row').first().click();
      const style = await page.locator('#event-delete').evaluate((node) => {
        const computed = getComputedStyle(node);
        return { background: computed.backgroundColor, shadow: computed.boxShadow, color: computed.color };
      });
      assert.deepEqual(style, { background: 'rgb(245, 245, 247)', shadow: 'none', color: 'rgb(215, 0, 21)' });
    });
  });

  test('hover: one grey fill, no underlines, and task rows answer too', async () => {
    await withApp(env, { clock: NOW, query: '?demo' }, async ({ page }) => {
      const hovered = async (selector, target = selector) => {
        await page.locator(selector).first().hover();
        return until(async () => page.locator(target).first().evaluate((node) => {
          const computed = getComputedStyle(node);
          return { background: computed.backgroundColor, underline: computed.textDecorationLine };
        }));
      };
      const FILL = 'rgba(120, 120, 128, 0.08)';
      await until(async () => assert.deepEqual(await hovered('#go-today'), { background: FILL, underline: 'none' }));
      await until(async () => assert.equal((await hovered('#open-list .task-text')).background, FILL));
      await until(async () => assert.equal((await hovered('#completed-toggle')).background, FILL));
      await until(async () => assert.equal((await hovered('#clear-completed')).background, FILL));
      await until(async () => assert.equal((await hovered('#prev-month')).background, FILL));
    });
  });

  test('the type scale: month 34 bold, section headers 17 semibold, body 17, secondary 13 to 15', async () => {
    for (const [layout, viewport] of [['desktop', { width: 1280, height: 720 }], ['phone', { width: 320, height: 568 }]]) {
      const app = await openApp(env, { clock: NOW, layout, query: '?demo' });
      const { page } = app;
      await page.setViewportSize(viewport);
      const read = (selector) => page.locator(selector).first().evaluate((node) => {
        const style = getComputedStyle(node);
        return { size: parseFloat(style.fontSize), weight: Number(style.fontWeight), tracking: parseFloat(style.letterSpacing) / parseFloat(style.fontSize) };
      });
      const month = await read('#month-title');
      assert.deepEqual([month.size, month.weight], [34, 700]);
      assert.ok(Math.abs(month.tracking + 0.012) < 0.001, 'title tracking');
      assert.equal((await read('#month-year')).weight, 400);
      for (const selector of ['#agenda-title']) {
        const header = await read(selector);
        assert.deepEqual([selector, header.size, header.weight], [selector, 17, 600]);
      }
      const row = await read('.agenda-row-title');
      assert.equal(row.size, 17);
      assert.ok(Math.abs(row.tracking + 0.022) < 0.001, 'body tracking');
      // Smaller text is tracked less tightly than the body, so it can't just inherit the body's pixels. Weekday
      // letters stand alone and aren't tracked.
      for (const selector of ['.saved-line', '.agenda-row-time', '.weekday']) {
        const { size, tracking } = await read(selector);
        assert.ok(size >= 13 && size <= 15, `${selector} is ${size} px`);
        if (selector !== '.weekday') assert.ok(Math.abs(tracking + 0.016) < 0.001, `${selector} tracking ${tracking}`);
      }
      if (layout === 'phone') await page.locator('#tab-todo').click();
      assert.equal((await read('#open-list .task-title')).size, 17);
      for (const selector of ['#todo-count', '#open-list .task-notes:not([hidden])', '#open-list .task-line']) {
        const { size, tracking } = await read(selector);
        assert.ok(size >= 13 && size <= 15, `${selector} is ${size} px`);
        assert.ok(Math.abs(tracking + 0.016) < 0.001, `${selector} tracking ${tracking}`);
      }
      assert.deepEqual([(await read('#completed-toggle')).size, (await read('#completed-toggle')).weight], [17, 600]);
      await app.finish();
    }
  });

  for (const [width, height] of [[1440, 900], [1280, 720], [1000, 800], [820, 1180], [390, 844], [320, 568]]) {
    test(`at ${width}x${height} a day's dot stays with its own number, and a focus ring has room`, async () => {
      const day = '2026-11-05';
      const app = await openApp(env, { clock: NOW, layout: width < 1000 ? 'phone' : 'desktop', seed: doc([event('a', 'A', day, 600), event('b', 'B', '2026-11-04', 600)]) });
      const { page } = app;
      await page.setViewportSize({ width, height });
      const geometry = await page.evaluate(() => {
        const center = (box) => box.top + box.height / 2;
        const number = (d) => document.querySelector(`#days-pane .day[data-day="${d}"] .day-number`).getBoundingClientRect();
        const dot = document.querySelector('#days-pane .day[data-day="2026-11-05"] .day-dot').getBoundingClientRect();
        const firstRow = document.querySelector('#days-pane .day[data-day="2026-11-01"] .day-number').getBoundingClientRect();
        return {
          above: center(dot) - center(number('2026-11-05')),
          below: center(number('2026-11-12')) - center(dot),
          touches: dot.top - number('2026-11-05').bottom,
          roomForRing: firstRow.top - document.querySelector('#days').getBoundingClientRect().top,
        };
      });
      // Numerals are about 12 px tall, so these centres are 6 px further apart than the gaps the eye sees. The dot must
      // read as belonging to the number above it, not float midway between two.
      assert.ok(geometry.below - geometry.above >= 4, `dot ${geometry.above} from its number, ${geometry.below} from the next`);
      assert.ok(geometry.touches >= 0, 'the dot is outside the disc');
      assert.ok(geometry.roomForRing >= 3, `room above the first row: ${geometry.roomForRing}`);
      await app.finish();
    });
  }

  test('the menu lines up with the + below it on desktop and clears the screen edge on phones', async () => {
    const desktop = await openApp(env, { clock: NOW, query: '?demo' });
    await desktop.page.locator('#menu-button').click();
    const [menu, plus] = await Promise.all(['#menu', '#focus-add'].map((selector) => desktop.page.locator(selector).boundingBox()));
    assert.equal(menu.x + menu.width, plus.x + plus.width);
    await desktop.finish();
    for (const [width, height] of [[390, 844], [320, 568]]) {
      const phone = await openApp(env, { clock: NOW, layout: 'phone', query: '?demo' });
      await phone.page.setViewportSize({ width, height });
      await phone.page.locator('#menu-button').click();
      const box = await phone.page.locator('#menu').boundingBox();
      assert.ok(width - (box.x + box.width) >= 8, `${width}: ${width - (box.x + box.width)} px from the edge`);
      assert.ok(box.x >= 8, `${width}: ${box.x} px from the other edge`);
      await phone.finish();
    }
  });

  test('the top bar shows its hairline when the calendar scrolls under it, above the card', async () => {
    const app = await openApp(env, { clock: NOW, layout: 'phone', query: '?demo' });
    const { page } = app;
    await page.setViewportSize({ width: 320, height: 568 });
    const bar = page.locator('.topbar');
    assert.equal(await bar.evaluate((node) => node.classList.contains('is-scrolled-under')), false);
    await page.locator('#calendar-scroll').evaluate((node) => { node.scrollTop = 100; });
    await until(async () => assert.equal(await bar.evaluate((node) => node.classList.contains('is-scrolled-under')), true));
    const paint = await bar.evaluate((node) => {
      const style = getComputedStyle(node);
      return { position: style.position, zIndex: Number(style.zIndex), shadow: style.boxShadow };
    });
    assert.notEqual(paint.position, 'static', 'a static box paints under the card');
    assert.ok(paint.zIndex >= 2, 'and above the screen headers');
    assert.notEqual(paint.shadow, 'none');
    const head = page.locator('.calendar-head');
    assert.equal(await head.evaluate((node) => node.classList.contains('is-scrolled-under')), true);
    assert.equal(await head.evaluate((node) => getComputedStyle(node).boxShadow), 'none', 'the month header scrolls away here, so the top bar has the only line');
    await app.finish();
  });

  test('cards scroll internally with 40 tasks', async () => {
    const seed = messyData(NOW, '2026-11-05');
    await withApp(env, { clock: NOW, seed }, async ({ page }) => {
      const scrolls = await page.locator('#todo-scroll').evaluate((node) => {
        const before = node.scrollTop;
        node.scrollTop = 500;
        return node.scrollHeight > node.clientHeight && node.scrollTop !== before;
      });
      assert.equal(scrolls, true);
      assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), 0);
    });
  });

  test('below 1000 px: one screen at a time, a tab bar, full-bleed card background', async () => {
    await withApp(env, { clock: NOW, layout: 'phone', query: '?demo' }, async ({ page }) => {
      assert.equal(await page.locator('.tabbar').isVisible(), true);
      assert.equal(await page.locator('#calendar').isVisible(), true);
      assert.equal(await page.locator('#todo').isVisible(), false);
      assert.deepEqual(await page.locator('.tab > span:not(.tab-badge)').allInnerTexts(), ['Calendar', 'To-Do']);
      assert.equal(await page.locator('#tab-calendar').getAttribute('aria-current'), 'page');

      await page.locator('#tab-todo').tap();
      assert.equal(await page.locator('#calendar').isVisible(), false);
      assert.equal(await page.locator('#todo').isVisible(), true);
      assert.equal(await page.locator('#tab-todo').getAttribute('aria-current'), 'page');
      assert.equal(await page.locator('#tab-calendar').getAttribute('aria-current'), null);

      const box = await page.locator('#todo').boundingBox();
      assert.equal(box.x, 0);
      assert.equal(box.width, 390);
      assert.equal(await page.locator('#todo').evaluate((node) => getComputedStyle(node).borderTopLeftRadius), '0px');
      const filter = await page.locator('.tabbar').evaluate((node) => getComputedStyle(node).backdropFilter);
      assert.match(filter, /blur/);
    });
  });

  test('the open count shows on the To-Do tab', async () => {
    await withApp(env, { clock: NOW, layout: 'phone', seed: doc([], [task('a', 'A', 1000, NOW), task('b', 'B', 1000, NOW)]) }, async ({ page }) => {
      assert.equal(await page.locator('#todo-badge').innerText(), '2');
      assert.equal(await page.locator('#tab-todo').getAttribute('aria-label'), 'To-Do, 2 open');
    });
    await withApp(env, { clock: NOW, layout: 'phone' }, async ({ page }) => {
      assert.equal(await page.locator('#todo-badge').isVisible(), false);
    });
  });

  test('each screen keeps its scroll position, and a reload keeps the screen', async () => {
    await withApp(env, { clock: NOW, layout: 'phone', seed: messyData(NOW, '2026-11-05') }, async ({ page }) => {
      await page.locator('#tab-todo').tap();
      await page.locator('#todo-scroll').evaluate((node) => { node.scrollTop = 300; });
      await page.locator('#tab-calendar').tap();
      await page.locator('#tab-todo').tap();
      assert.equal(await page.locator('#todo-scroll').evaluate((node) => node.scrollTop), 300);
      await page.reload();
      await page.waitForFunction(() => document.querySelectorAll('.day[data-day]').length === 42);
      assert.equal(await page.locator('#todo').isVisible(), true);
    });
  });

  test('T and N bring up the calendar from the To-Do screen', async () => {
    await withApp(env, { clock: NOW, layout: 'phone' }, async ({ page }) => {
      await page.locator('#tab-todo').tap();
      await page.keyboard.press('t');
      assert.equal(await page.locator('#calendar').isVisible(), true);
    });
  });

  for (const [width, height] of [[320, 568], [390, 844], [820, 1180], [999, 700], [1000, 800], [1280, 720]]) {
    test(`no horizontal scrolling at ${width}x${height}, even with messy data, in every state`, async () => {
      const seed = messyData(NOW, '2026-11-05');
      const phone = width < 1000;
      const app = await openApp(env, { clock: NOW, seed, layout: phone ? 'phone' : 'desktop' });
      const { page } = app;
      await page.setViewportSize({ width, height });
      const check = async (label) => assert.deepEqual(await horizontalOverflow(page), [], label);
      await check('calendar');
      if (phone) await page.locator('#tab-todo').click();
      await page.locator('#completed-toggle').click();
      await check('todo with completed');
      await page.locator('#open-list .task-text').first().click();
      await check('task sheet');
      await page.keyboard.press('Escape');
      await until(async () => assert.equal(await page.locator('dialog[open]').count(), 0));
      if (phone) await page.locator('#tab-calendar').click();
      await page.locator('#new-event').click();
      await check('event sheet');
      await page.keyboard.press('Escape');
      await until(async () => assert.equal(await page.locator('dialog[open]').count(), 0));
      await page.locator('#menu-button').click();
      await check('menu');
      await app.finish();
    });
  }

  test('every month title stays on one line at 320 px', async () => {
    const app = await openApp(env, { clock: NOW, layout: 'phone', reducedMotion: 'reduce' });
    const { page } = app;
    await page.setViewportSize({ width: 320, height: 568 });
    for (let i = 0; i < 12; i += 1) {
      const box = await page.locator('#month-title').boundingBox();
      assert.ok(box.height < 45, `${await page.locator('#month-title').innerText()} takes ${box.height} px`);
      assert.deepEqual(await horizontalOverflow(page), []);
      await page.locator('#next-month').click();
    }
    await app.finish();
  });

  test('landscape on a phone works, with the agenda a short scroll away', async () => {
    const app = await openApp(env, { clock: NOW, layout: 'phone', query: '?demo' });
    const { page } = app;
    await page.setViewportSize({ width: 844, height: 390 });
    assert.deepEqual(await horizontalOverflow(page), []);
    const row = await page.locator('#days-pane .week').first().boundingBox();
    assert.ok(row.height <= 46, `rows stay short: ${row.height}`);
    await page.locator('#calendar-scroll').evaluate((node) => { node.scrollTop = node.scrollHeight; });
    const last = await page.locator('.agenda-row').last().boundingBox();
    const bar = await page.locator('.tabbar').boundingBox();
    assert.ok(last.y + last.height <= bar.y, 'the last agenda row clears the tab bar');
    await app.finish();
  });

  test('a hairline appears under a header once content scrolls beneath it', async () => {
    await withApp(env, { clock: NOW, seed: messyData(NOW, '2026-11-05') }, async ({ page }) => {
      const head = page.locator('.todo-head');
      const hasLine = () => head.evaluate((node) => node.classList.contains('is-scrolled-under'));
      assert.equal(await hasLine(), false);
      await page.locator('#todo-scroll').evaluate((node) => { node.scrollTop = 200; });
      await until(async () => assert.equal(await hasLine(), true));
      await page.locator('#todo-scroll').evaluate((node) => { node.scrollTop = 0; });
      await until(async () => assert.equal(await hasLine(), false));
    });
  });

  test('long titles wrap in the agenda and the list, and nothing is cut off', async () => {
    const seed = messyData(NOW, '2026-11-05');
    const app = await openApp(env, { clock: NOW, seed, layout: 'phone' });
    const { page } = app;
    await page.setViewportSize({ width: 320, height: 568 });
    const titlesFit = await page.locator('.agenda-row-title').evaluateAll((nodes) => nodes.every((node) => node.scrollWidth <= node.clientWidth + 1));
    assert.equal(titlesFit, true);
    await page.locator('#tab-todo').click();
    const tasksFit = await page.locator('#open-list .task-title').evaluateAll((nodes) => nodes.every((node) => node.scrollWidth <= node.clientWidth + 1));
    assert.equal(tasksFit, true);
    await app.finish();
  });

  test('inputs are 16 px or larger, so iOS does not zoom', async () => {
    await withApp(env, { clock: NOW, layout: 'phone' }, async ({ page }) => {
      await page.locator('#new-event').click();
      const sizes = await page.locator('input:not([type="file"]):not([type="checkbox"]), textarea').evaluateAll((nodes) => nodes.map((node) => parseFloat(getComputedStyle(node).fontSize)));
      assert.ok(sizes.length >= 8);
      for (const size of sizes) assert.ok(size >= 16, `font size ${size}`);
    });
  });

  test('tap targets on the phone are comfortably large', async () => {
    await withApp(env, { clock: NOW, layout: 'phone' }, async ({ page }) => {
      for (const selector of ['#prev-month', '#go-today', '#next-month', '#menu-button', '#tab-calendar', '#tab-todo']) {
        const box = await page.locator(selector).boundingBox();
        assert.ok(box.height >= 44, `${selector} height ${box.height}`);
      }
      const cell = await page.locator('#days-pane .day').first().boundingBox();
      assert.ok(cell.width >= 40 && cell.height >= 44, 'grid cells');
    });
  });

  test('tap targets on a tablet are as large as on a phone, in both orientations', async () => {
    for (const viewport of [{ width: 820, height: 1180 }, { width: 1180, height: 820 }]) {
      await withApp(env, { clock: NOW, layout: 'tablet' }, async ({ page }) => {
        await page.setViewportSize(viewport);
        assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true);
        for (const selector of ['#prev-month', '#go-today', '#next-month', '#menu-button']) {
          const box = await page.locator(selector).boundingBox();
          assert.ok(box.height >= 44, `${viewport.width}: ${selector} height ${box.height}`);
        }
        const chevron = await page.locator('#next-month').boundingBox();
        assert.ok(chevron.width >= 44, `${viewport.width}: chevron width ${chevron.width}`);

        // The round + keeps its 36 pt look; its target reaches past the circle.
        const plus = await page.locator('#new-event').boundingBox();
        assert.equal(plus.width, 36);
        const reaches = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('#new-event') !== null, { x: plus.x - 3, y: plus.y + plus.height / 2 });
        assert.equal(reaches, true, `${viewport.width}: the target reaches 3 px past the circle`);
      });
    }
  });

  test('a mouse keeps the slimmer controls on a desktop', async () => {
    await withApp(env, { clock: NOW }, async ({ page }) => {
      assert.equal((await page.locator('#menu-button').boundingBox()).height, 36);
    });
  });
});

describe('safe areas', () => {
  /** Opens the phone layout with real env(safe-area-inset-*) values, which DevTools can emulate. */
  async function withInsets(t, viewport, insets, body) {
    const app = await openApp(env, { clock: NOW, layout: 'phone', query: '?demo', reducedMotion: 'reduce' });
    const { page, context } = app;
    await page.setViewportSize(viewport);
    const cdp = await context.newCDPSession(page);
    try {
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets });
    } catch {
      await context.close();
      t.skip('this Chrome cannot emulate safe areas');
      return;
    }
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.day[data-day]').length === 42);
    await body(page);
    await app.finish();
  }

  const NOTCH = { top: 47, bottom: 34, left: 0, right: 0 };
  const box = (page, selector) => page.locator(selector).first().boundingBox();

  test('a notched phone: the top bar clears the notch and the tab bar clears the home indicator', async (t) => {
    await withInsets(t, { width: 390, height: 844 }, NOTCH, async (page) => {
      const brand = await box(page, '.brand');
      assert.ok(brand.y >= 47, `brand at ${brand.y}`);
      const bar = await box(page, '.tabbar');
      assert.equal(bar.y + bar.height, 844, 'the bar reaches the bottom edge, so its blur does too');
      assert.equal(bar.height, 50 + 34);
      const label = await box(page, '#tab-calendar > span');
      assert.ok(label.y + label.height <= 844 - 34, 'tab labels are above the home indicator');

      await page.locator('#calendar-scroll').evaluate((node) => { node.scrollTop = node.scrollHeight; });
      const last = await box(page, '.agenda-item:last-child');
      assert.ok(last.y + last.height <= bar.y, 'the last agenda row can scroll clear of the bar');
    });
  });

  test('a notched phone: the To-Do list scrolls clear of the bar too', async (t) => {
    await withInsets(t, { width: 390, height: 844 }, NOTCH, async (page) => {
      await page.locator('#tab-todo').click();
      await page.locator('#completed-toggle').click();
      await page.locator('#todo-scroll').evaluate((node) => { node.scrollTop = node.scrollHeight; });
      const last = await box(page, '#done-list .task:last-child');
      const bar = await box(page, '.tabbar');
      assert.ok(last.y + last.height <= bar.y, `row ends ${last.y + last.height}, bar starts ${bar.y}`);
    });
  });

  test('a notched phone: a bottom sheet keeps its last control above the home indicator', async (t) => {
    await withInsets(t, { width: 390, height: 844 }, NOTCH, async (page) => {
      await page.locator('.agenda-row').first().click();
      await until(async () => {
        const sheet = await box(page, '#event-sheet');
        assert.ok(Math.abs(sheet.y + sheet.height - 844) <= 1, `the sheet reaches the bottom edge, not ${sheet.y + sheet.height}`);
        assert.ok(sheet.y >= 47, 'and stays clear of the notch');
      });
      const remove = await box(page, '#event-delete');
      assert.ok(remove.y + remove.height <= 844 - 34, 'Delete Event is above the home indicator');
    });
  });

  test('a notched phone: a tap on the sheet\'s own bottom padding does not cancel it', async (t) => {
    await withInsets(t, { width: 390, height: 844 }, NOTCH, async (page) => {
      await page.locator('#new-event').click();
      await page.locator('#event-title').fill('Half typed');
      await until(async () => assert.equal(await page.locator('#event-sheet').evaluate((node) => node.getAnimations().length), 0));
      await page.waitForTimeout(300);
      const sheet = await box(page, '#event-sheet');
      await page.touchscreen.tap(sheet.x + sheet.width / 2, sheet.y + sheet.height - 12);
      await page.waitForTimeout(400);
      assert.equal(await page.locator('#event-sheet').evaluate((node) => node.open), true);
      assert.equal(await page.locator('#event-title').inputValue(), 'Half typed');

      // The backdrop above it still cancels.
      await page.touchscreen.tap(sheet.x + sheet.width / 2, sheet.y - 20);
      await until(async () => assert.equal(await page.locator('dialog[open]').count(), 0));
    });
  });

  test('a notched phone: the toast floats above the tab bar', async (t) => {
    await withInsets(t, { width: 390, height: 844 }, NOTCH, async (page) => {
      await page.locator('.agenda-row').first().click();
      await page.locator('#event-delete').click();
      const toast = await box(page, '.toast');
      const bar = await box(page, '.tabbar');
      assert.ok(toast.y + toast.height <= bar.y, `toast ends ${toast.y + toast.height}, bar starts ${bar.y}`);
    });
  });

  test('a phone on its side: nothing sits under the notch on either edge', async (t) => {
    await withInsets(t, { width: 844, height: 390 }, { top: 0, bottom: 21, left: 47, right: 47 }, async (page) => {
      assert.deepEqual(await horizontalOverflow(page), []);
      const brand = await box(page, '.brand');
      assert.ok(brand.x >= 47, `brand at ${brand.x}`);
      const menu = await box(page, '#menu-button');
      assert.ok(menu.x + menu.width <= 844 - 47, 'the menu');
      const add = await box(page, '#new-event');
      assert.ok(add.x + add.width <= 844 - 47, 'the + button');
      const title = await box(page, '#month-title');
      assert.ok(title.x >= 47, 'the title');
      assert.ok(Math.abs(brand.x - title.x) <= 1, `the brand at ${brand.x} and the title at ${title.x} share an edge`);
      const label = await box(page, '#tab-calendar > span');
      assert.ok(label.y + label.height <= 390 - 21, 'tab labels');
    });
  });
});

describe('sheets', () => {
  test('desktop: a centred 440 px card with a blurred backdrop', async () => {
    await withApp(env, { clock: NOW }, async ({ page }) => {
      await page.locator('#new-event').click();
      const sheet = page.locator('#event-sheet');
      await until(async () => assert.equal(await sheet.evaluate((node) => node.getAnimations().length), 0));
      const box = await sheet.boundingBox();
      assert.equal(box.width, 440);
      assert.ok(Math.abs(box.x + box.width / 2 - 640) <= 1, 'centred');
      assert.ok(Math.abs(box.y + box.height / 2 - 360) <= 1, 'centred');
      const radius = await sheet.evaluate((node) => getComputedStyle(node).borderTopLeftRadius);
      assert.equal(radius, '20px');
      assert.match(await sheet.evaluate((node) => getComputedStyle(node, '::backdrop').backdropFilter), /blur/);
    });
  });

  test('phone: a bottom sheet that slides up', async () => {
    await withApp(env, { clock: NOW, layout: 'phone' }, async ({ page }) => {
      await page.locator('#new-event').tap();
      const sheet = page.locator('#event-sheet');
      assert.equal(await sheet.evaluate((node) => getComputedStyle(node).animationName), 'sheet-up');
      await until(async () => assert.equal(await sheet.evaluate((node) => node.getAnimations().length), 0));
      const box = await sheet.boundingBox();
      assert.equal(box.x, 0);
      assert.equal(box.width, 390);
      assert.ok(Math.abs(box.y + box.height - 844) <= 1, `bottom at ${box.y + box.height}`);
    });
  });

  test('the switch is a real checkbox with role=switch, and date and time inputs are native', async () => {
    await withApp(env, { clock: NOW }, async ({ page }) => {
      await page.locator('#new-event').click();
      assert.equal(await page.locator('input[type="checkbox"][role="switch"]').count(), 1);
      assert.equal(await page.locator('#event-sheet input[type="date"]').count(), 2);
      assert.equal(await page.locator('#event-sheet input[type="time"]').count(), 2);
      assert.equal(await page.getByRole('switch', { name: 'All-day' }).count(), 1);
    });
  });
});

describe('motion', () => {
  test('Reduce Motion: sheets, toasts and rows change without animating', async () => {
    await withApp(env, { clock: NOW, reducedMotion: 'reduce', seed: doc([], [task('a', 'Essay', 1000, NOW)]) }, async ({ page }) => {
      await page.locator('#new-event').click();
      const animations = () => page.evaluate(() => document.getAnimations().filter((item) => {
        const timing = item.effect.getComputedTiming();
        return timing.duration > 1 && item.playState === 'running';
      }).length);
      assert.equal(await animations(), 0);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('dialog[open]').count(), 0, 'closes at once');
      await page.locator('#next-month').click();
      assert.equal(await page.locator('.days-ghost').count(), 0);
      assert.equal(await animations(), 0);
      await page.locator('.task-text').click();
      await page.locator('#task-delete').click();
      assert.equal(await page.locator('.task').count(), 0, 'row goes at once');
      assert.equal(await page.locator('.toast').count(), 1);
      assert.equal(await animations(), 0);
    });
  });

  test('normal motion stays in the 200 to 300 ms range', async () => {
    await withApp(env, { clock: NOW }, async ({ page }) => {
      await page.locator('#next-month').click();
      const durations = await page.evaluate(() => document.getAnimations().map((item) => item.effect.getComputedTiming().duration));
      assert.ok(durations.length > 0);
      for (const duration of durations) assert.ok(duration >= 200 && duration <= 300, `duration ${duration}`);
    });
  });

  test('a month slide leaves nothing behind', async () => {
    await withApp(env, { clock: NOW }, async ({ page }) => {
      for (let i = 0; i < 5; i += 1) await page.locator('#next-month').click();
      await until(async () => assert.equal(await page.locator('.days-ghost').count(), 0));
      assert.equal(await page.locator('#days-pane .day[tabindex="0"]').count(), 1);
    });
  });
});

describe('no console errors in a whole session', () => {
  for (const layout of ['desktop', 'phone']) {
    test(`${layout}: a busy session stays quiet`, async () => {
      await withApp(env, { layout, query: '?demo' }, async ({ page, problems }) => {
        if (layout === 'phone') await page.locator('#tab-todo').click();
        await page.locator('#add-input').fill('Something');
        await page.locator('#add-input').press('Enter');
        await page.locator('#open-list .check').first().click();
        await page.locator('#completed-toggle').click();
        await page.locator('#open-list .task-text').first().click();
        await page.keyboard.press('Escape');
        await until(async () => assert.equal(await page.locator('dialog[open]').count(), 0));
        if (layout === 'phone') await page.locator('#tab-calendar').click();
        await page.locator('#next-month').click();
        await page.locator('#go-today').click();
        await page.locator('#menu-button').click();
        await page.keyboard.press('Escape');
        assert.deepEqual(problems, []);
      });
    });
  }
});

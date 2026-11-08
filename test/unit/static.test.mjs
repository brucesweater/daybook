// Checks on the published files themselves.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DOCS = join(ROOT, 'docs');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const allFiles = walk(DOCS);
const read = (path) => readFileSync(join(DOCS, path), 'utf8');
const scripts = allFiles.filter((file) => file.endsWith('.js'));
const css = read('style.css');
const html = read('index.html');

test('the files the spec lists exist', () => {
  for (const path of ['index.html', 'style.css', 'manifest.webmanifest', 'sw.js', '.nojekyll', 'og.png', 'js/app.js',
    'icons/favicon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png']) {
    assert.ok(existsSync(join(DOCS, path)), path);
  }
});

test('nothing test-related is published', () => {
  for (const file of allFiles) {
    assert.doesNotMatch(relative(DOCS, file), /test|fixture|node_modules|SPEC|README|screens\/|\.mjs$/i);
  }
});

test('user text never goes through markup APIs', () => {
  for (const file of scripts) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/, file);
  }
});

test('no external requests: the only absolute URLs are the Open Graph tags and the SVG namespace', () => {
  const allowed = new Set(['https://brucesweater.github.io/daybook/', 'https://brucesweater.github.io/daybook/og.png', 'http://www.w3.org/2000/svg']);
  for (const file of [...scripts, join(DOCS, 'index.html'), join(DOCS, 'style.css'), join(DOCS, 'manifest.webmanifest')]) {
    const urls = readFileSync(file, 'utf8').match(/\bhttps?:\/\/[^\s"'<>)]+/g) ?? [];
    for (const url of urls) assert.ok(allowed.has(url), `${relative(DOCS, file)}: ${url}`);
  }
  assert.doesNotMatch(css, /url\(|@import/);
  assert.doesNotMatch(html, /<(script|link|img)[^>]+(src|href)="(https?:)?\/\//);
});

test('every URL is relative', () => {
  for (const [, url] of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    assert.doesNotMatch(url, /^(\/|https?:)/, url);
    assert.ok(existsSync(join(DOCS, url)), `${url} exists`);
  }
  const manifest = JSON.parse(read('manifest.webmanifest'));
  for (const value of [manifest.start_url, manifest.scope, ...manifest.icons.map((icon) => icon.src)]) {
    assert.doesNotMatch(value, /^(\/|https?:)/, value);
  }
});

test('no inline script or style, so the content security policy holds', () => {
  assert.doesNotMatch(html, /<style|\sstyle="|\son[a-z]+="/);
  assert.equal((html.match(/<script/g) ?? []).length, 1);
  assert.match(html, /<script type="module" src="js\/app\.js">/);
  assert.match(html, /Content-Security-Policy/);
});

test('the design tokens match the spec table', () => {
  const spec = readFileSync(join(ROOT, 'SPEC.md'), 'utf8');
  const rows = [...spec.matchAll(/^\| `([a-z0-9-]+)` \| `([^`]+)` \| `([^`]+)` \|/gm)];
  assert.equal(rows.length, 10, 'the table has ten tokens');
  const [lightBlock, darkBlock] = [
    css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)')),
    css.slice(css.indexOf('@media (prefers-color-scheme: dark)'), css.indexOf('/* ---------- Base')),
  ];
  const normalize = (value) => value.replace(/\s+/g, '').toLowerCase();
  const tokenIn = (block, name) => {
    const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(block);
    return match ? normalize(match[1]) : null;
  };
  for (const [, name, light, dark] of rows) {
    assert.equal(tokenIn(lightBlock, name), normalize(light), `${name} light`);
    // A dark value only needs restating when it differs.
    const darkValue = tokenIn(darkBlock, name) ?? tokenIn(lightBlock, name);
    assert.equal(darkValue, normalize(dark), `${name} dark`);
  }
});

test('the type and motion rules are in the stylesheet', () => {
  assert.ok(css.includes('-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'));
  assert.ok(css.includes('cubic-bezier(.32, .72, 0, 1)'));
  assert.match(css, /-webkit-font-smoothing: antialiased/);
  // Tracking as on apple.com: 17 px text, 13 to 15 px text, 34 px titles.
  assert.match(css, /letter-spacing: -\.022em/);
  assert.match(css, /letter-spacing: -\.016em/);
  assert.match(css, /letter-spacing: -\.012em/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /font-variant-numeric: tabular-nums/);
  assert.match(css, /height: 100dvh/);
  assert.match(css, /touch-action: pan-y/);
});

test('backdrop-filter always has its -webkit- twin, for Safari', () => {
  const plain = css.match(/(?<!-webkit-)backdrop-filter:/g) ?? [];
  const prefixed = css.match(/-webkit-backdrop-filter:/g) ?? [];
  assert.equal(plain.length, prefixed.length);
  assert.ok(plain.length > 0);
});

test('no input is smaller than 16 px, which would make iOS zoom', () => {
  const sizes = [...css.matchAll(/(?:\.field|\.add-input|\.date-time input)[^{]*\{[^}]*?font-size:\s*(\d+)px/g)];
  assert.ok(sizes.length >= 3);
  for (const [, size] of sizes) assert.ok(Number(size) >= 16);
});

test('the service worker caches exactly the files that exist', () => {
  const source = read('sw.js');
  const list = /const SHELL = \[([\s\S]*?)\];/.exec(source)[1].match(/'[^']+'/g).map((item) => item.slice(1, -1));
  for (const path of list) {
    if (path !== './') assert.ok(existsSync(join(DOCS, path)), path);
  }
  for (const file of allFiles) {
    const path = relative(DOCS, file);
    if (path.startsWith('js/') || path.startsWith('icons/')) assert.ok(list.includes(path), `${path} is cached`);
  }
});

test('every module is preloaded, so the first load is not a waterfall of imports', () => {
  for (const file of allFiles.filter((path) => relative(DOCS, path).startsWith('js/'))) {
    assert.ok(html.includes(`<link rel="modulepreload" href="${relative(DOCS, file)}">`), relative(DOCS, file));
  }
});

test('interface copy uses typographic apostrophes', () => {
  for (const file of scripts) {
    const code = readFileSync(file, 'utf8').split('\n').filter((line) => !/^\s*(\/\/|\/?\*)/.test(line)).join('\n').replace(/\s\/\/ .*$/gm, '');
    assert.doesNotMatch(code, /[A-Za-z]'[a-z]/, relative(DOCS, file));
  }
  assert.doesNotMatch(html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ''), /[A-Za-z]'[a-z]/);
});

test('the manifest has no id: "./" would resolve against the origin and claim the whole of brucesweater.github.io', () => {
  // With none, the id is the start_url: /daybook/. A relative URL is the only kind this site uses.
  assert.equal(JSON.parse(read('manifest.webmanifest')).id, undefined);
});

test('the manifest is complete', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.name, 'Daybook');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.theme_color);
  assert.ok(manifest.background_color);
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512'));
});

test('the head has what the spec asks for', () => {
  assert.match(html, /<title>Daybook<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]{40,}"/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /rel="apple-touch-icon"/);
  assert.match(html, /name="apple-mobile-web-app-capable"/);
  assert.match(html, /name="apple-mobile-web-app-title"/);
  assert.match(html, /name="theme-color" media="\(prefers-color-scheme: light\)/);
  assert.match(html, /name="theme-color" media="\(prefers-color-scheme: dark\)/);
  assert.match(html, /property="og:title"/);
  assert.match(html, /property="og:image"/);
});

test('og.png is a real 1200 by 630 PNG', () => {
  const png = readFileSync(join(DOCS, 'og.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});

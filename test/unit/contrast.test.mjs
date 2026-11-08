// WCAG contrast worked out from the stylesheet's own tokens.
//
// axe covers most text, but it skips single characters, which is exactly what grid days 1 to 9, the weekday letters
// and a one-digit tab badge are. So those pairs get checked here. It also holds the spec's rule that label-3, which
// doesn't reach 4.5:1 on a card, is only for placeholders and the empty check circle's stroke.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../docs/style.css', import.meta.url), 'utf8');
const lightBlock = css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)'));
const darkBlock = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'), css.indexOf('/* ---------- Base'));

/** A token's colour in a mode, following `var(--other)`. A dark value only appears when it differs from light. */
function token(name, mode) {
  const pattern = new RegExp(`--${name}:\\s*([^;]+);`);
  const match = (mode === 'dark' ? pattern.exec(darkBlock) : null) ?? pattern.exec(lightBlock);
  assert.ok(match, `--${name} exists in ${mode}`);
  const value = match[1].trim();
  const reference = /^var\(--([a-z0-9-]+)\)$/.exec(value);
  if (reference) return token(reference[1], mode);
  assert.match(value, /^#[0-9A-Fa-f]{6}$/, `--${name} is a plain colour in ${mode}`);
  return value;
}

function luminance(hex) {
  const channel = (start) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const WHITE = '#FFFFFF';

test('the arithmetic is right', () => {
  assert.equal(Math.round(contrast('#000000', '#FFFFFF') * 100) / 100, 21);
  assert.equal(contrast('#777777', '#777777'), 1);
  assert.equal(Math.round(contrast('#8E8E93', '#FFFFFF') * 100) / 100, 3.26);
});

for (const mode of ['light', 'dark']) {
  const t = (name) => token(name, mode);

  test(`${mode}: text meets 4.5:1 on what it actually sits on`, () => {
    const pairs = [
      ['primary text on a card', t('label'), t('card')],
      ['primary text on the page, in the top bar', t('label'), t('bg')],
      ['primary text on an inset group', t('label'), t('group')],
      ['secondary text on a card (weekday letters, adjacent days, age lines)', t('label-2'), t('card')],
      ['the saved line on the page', t('label-2'), t('bg')],
      ['today\'s number and text buttons on a card', t('accent-text'), t('card')],
      ['warm age line on a card', t('age-warm'), t('card')],
      ['old age line on a card', t('age-old'), t('card')],
      ['inverted number on the selected-day disc', t('card'), t('label')],
      ['white on the today disc, the + button and the badge', WHITE, t('accent-fill')],
      ['text in the elevated toast and menu', t('label'), t('elevated')],
      ['Undo in the elevated toast', t('accent-text'), t('elevated')],
    ];
    for (const [what, foreground, background] of pairs) {
      const ratio = contrast(foreground, background);
      assert.ok(ratio >= 4.5, `${what}: ${ratio.toFixed(2)}:1`);
    }
  });

  test(`${mode}: shapes that carry meaning meet 3:1`, () => {
    const pairs = [
      ['empty check circle', t('label-3'), t('card')],
      ['focus ring', t('accent-text'), t('card')],
      ['agenda bar', t('accent-text'), t('card')],
      ['a day\'s event dot', t('label-2'), t('card')],
      ['the grey focus ring on a date or time chip, which sits on the inset group', t('label-2'), t('group')],
    ];
    for (const [what, foreground, background] of pairs) {
      const ratio = contrast(foreground, background);
      assert.ok(ratio >= 3, `${what}: ${ratio.toFixed(2)}:1`);
    }
  });

  test(`${mode}: label-3 can't carry tappable text, which is why adjacent-month days use label-2`, () => {
    assert.ok(contrast(t('label-3'), t('card')) < 4.5);
    assert.ok(contrast(t('label-2'), t('card')) >= 4.5);
    assert.match(css, /\.is-adjacent \.day-number \{ color: var\(--label-2\); \}/);
  });
}

test('label-3 misses the 3:1 a focus ring needs on a light inset group, which is why the date chips\' ring is label-2', () => {
  assert.ok(contrast(token('label-3', 'light'), token('group', 'light')) < 3);
});

test('label-3 is only for placeholders and the empty check circle\'s stroke, so nothing in the grid uses it', () => {
  const allowed = ['.check-ring', '.add-input::placeholder', '.field::placeholder'];
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, , body]) => body.includes('var(--label-3)'))
    .map(([, selector]) => selector.replace(/\/\*[\s\S]*?\*\//g, '').trim());
  assert.deepEqual(rules.filter((selector) => !allowed.includes(selector)), [], 'rules using label-3 outside its two jobs');
  assert.deepEqual([...new Set(rules)].sort(), [...allowed].sort());
  assert.match(css, /\.has-event \.day-dot \{ background: var\(--label-2\); \}/);
  // The + in the Add a task row is an icon: label-2, as in the iOS app's add bar, and the accent once it has focus.
  assert.match(css, /\.add-glyph \{[^}]*color: var\(--label-2\);/);
  assert.match(css, /\.add-row:focus-within \.add-glyph \{ color: var\(--accent-text\); \}/);
});

/** A translucent token laid over a solid colour. */
function over(name, mode, background) {
  const pattern = new RegExp(`--${name}:\\s*rgba\\(([^)]+)\\);`);
  const match = (mode === 'dark' ? pattern.exec(darkBlock) : null) ?? pattern.exec(lightBlock);
  assert.ok(match, `--${name} is a translucent colour in ${mode}`);
  const [r, g, b, alpha] = match[1].split(',').map(Number);
  const channel = (value, start) => Math.round(value * alpha + parseInt(background.slice(start, start + 2), 16) * (1 - alpha));
  return `#${[channel(r, 1), channel(g, 3), channel(b, 5)].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

for (const mode of ['light', 'dark']) {
  const t = (name) => token(name, mode);
  const hover = over('hover', mode, t('card'));

  test(`${mode}: text stays at 4.5:1 on the hover fill, and on Delete's inset group`, () => {
    const pairs = [
      ['a text button under the pointer', t('age-old'), hover],
      ['a task title under the pointer', t('label'), hover],
      ['a fresh age line under the pointer', t('label-2'), hover],
      ['a warm age line under the pointer', t('age-warm-hover'), hover],
      ['an old age line under the pointer', t('age-old'), hover],
      ['Delete on its inset group', t('age-old'), t('group')],
      ['Delete under the pointer', t('age-old'), t('group-hover')],
      ['Undo under the pointer', t('age-old'), over('toast-hover', mode, t('elevated'))],
      ['a focused field\'s caret, at the 3:1 a shape needs', t('accent-text'), t('group'), 3],
    ];
    for (const [what, foreground, background, minimum = 4.5] of pairs) {
      const ratio = contrast(foreground, background);
      assert.ok(ratio >= minimum, `${what}: ${ratio.toFixed(2)}:1`);
    }
  });

  test(`${mode}: Delete's hover fill can be told from the group it sits in`, () => {
    assert.notEqual(t('group-hover'), t('group'));
  });
}

test('accent text on an inset group fails in light mode, which is why Delete uses age-old', () => {
  assert.ok(contrast(token('accent-text', 'light'), token('group', 'light')) < 4.5);
  assert.match(/\.danger-btn \{[^}]*\}/.exec(css)[0], /color: var\(--age-old\)/);
});

test('accent text on the hover fill fails in light mode, which is why text buttons deepen under the pointer', () => {
  assert.ok(contrast(token('accent-text', 'light'), over('hover', 'light', token('card', 'light'))) < 4.5);
  assert.match(css, /\.text-btn:not\(:disabled\):hover \{[^}]*color: var\(--age-old\)/);
});

test('the warm age line darkens by a hair under the pointer, because the spec\'s amber misses AA on the hover fill', () => {
  assert.ok(contrast(token('age-warm', 'light'), over('hover', 'light', token('card', 'light'))) < 4.5);
});

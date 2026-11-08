import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthSwipeTurns, rowSwipeAction, speedAtRelease } from '../../docs/js/gesture.js';

const PHONE = 390;

test('speed at release: a finger still moving keeps its speed', () => {
  assert.equal(speedAtRelease(0.8, 1000, 1000), 0.8);
  assert.equal(speedAtRelease(0.8, 1000, 1016), 0.8);
  assert.equal(speedAtRelease(-0.8, 1000, 1100), -0.8);
});

test('speed at release: a finger that stopped before lifting has none, however fast it went', () => {
  assert.equal(speedAtRelease(0.8, 1000, 1101), 0);
  assert.equal(speedAtRelease(-3, 1000, 2000), 0);
});

test('month swipe: far enough turns the month, at any speed, either way', () => {
  assert.equal(monthSwipeTurns({ offset: -98, speed: 0, width: PHONE }), true);
  assert.equal(monthSwipeTurns({ offset: 98, speed: 0, width: PHONE }), true);
  // Exactly a quarter isn't past it.
  assert.equal(monthSwipeTurns({ offset: -97.5, speed: 0, width: PHONE }), false);
  assert.equal(monthSwipeTurns({ offset: 97.5, speed: 0, width: PHONE }), false);
  // Scales with the width.
  assert.equal(monthSwipeTurns({ offset: -98, speed: 0, width: 820 }), false);
});

test('month swipe: a short one needs a flick', () => {
  assert.equal(monthSwipeTurns({ offset: -85, speed: -0.2, width: PHONE }), false);
  assert.equal(monthSwipeTurns({ offset: -85, speed: -0.45, width: PHONE }), false);
  assert.equal(monthSwipeTurns({ offset: -85, speed: -0.46, width: PHONE }), true);
  assert.equal(monthSwipeTurns({ offset: 20, speed: 2, width: PHONE }), true);
});

test('month swipe: a flick back the other way does not turn it', () => {
  assert.equal(monthSwipeTurns({ offset: -85, speed: 2, width: PHONE }), false);
  assert.equal(monthSwipeTurns({ offset: 85, speed: -2, width: PHONE }), false);
});

test('month swipe: no travel, no turn, whatever the speed says', () => {
  assert.equal(monthSwipeTurns({ offset: 0, speed: 5, width: PHONE }), false);
  assert.equal(monthSwipeTurns({ offset: 0, speed: -5, width: PHONE }), false);
});

test('month swipe: a flick that stopped before lifting springs back', () => {
  const speed = speedAtRelease(-2, 1000, 1500);
  assert.equal(monthSwipeTurns({ offset: -85, speed, width: PHONE }), false);
});

test('row swipe: a tiny one closes, whatever the speed', () => {
  assert.equal(rowSwipeAction({ offset: 0, speed: 0, width: PHONE }), 'close');
  assert.equal(rowSwipeAction({ offset: 30, speed: 5, width: PHONE }), 'close');
  assert.equal(rowSwipeAction({ offset: 56, speed: 5, width: PHONE }), 'close');
});

test('row swipe: a middling one opens on the Delete button', () => {
  assert.equal(rowSwipeAction({ offset: 57, speed: 0, width: PHONE }), 'open');
  assert.equal(rowSwipeAction({ offset: 214, speed: 0.6, width: PHONE }), 'open');
});

test('row swipe: a far one deletes, at any speed', () => {
  assert.equal(rowSwipeAction({ offset: 215, speed: 0, width: PHONE }), 'delete');
  assert.equal(rowSwipeAction({ offset: 215, speed: -1, width: PHONE }), 'delete');
  // Exactly 55 percent isn't past it.
  assert.equal(rowSwipeAction({ offset: PHONE * 0.55, speed: 0, width: PHONE }), 'open');
});

test('row swipe: a middling flick deletes', () => {
  assert.equal(rowSwipeAction({ offset: 70, speed: 0.61, width: PHONE }), 'delete');
});

test('row swipe: flick, pause, lift opens the button and deletes nothing', () => {
  const speed = speedAtRelease(2, 1000, 1500);
  assert.equal(rowSwipeAction({ offset: 70, speed, width: PHONE }), 'open');
});

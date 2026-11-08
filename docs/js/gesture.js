// What a swipe means when the finger lifts. Plain numbers in, plain answers out. Offsets are how far the finger has
// travelled, widths are in pixels, and speeds are in pixels per millisecond.

/** A finger still moving this recently when it lifts is flicking. Any longer ago, it had stopped. */
const FLICK_WINDOW_MS = 100;

const MONTH_SWIPE_FRACTION = 0.25;
const MONTH_FLICK_SPEED = 0.45;

const ROW_OPEN_DISTANCE = 56;
const ROW_DELETE_FRACTION = 0.55;
const ROW_FLICK_SPEED = 0.6;

/**
 * The speed a swipe ends with. Speed is measured between moves, and a finger holding still sends none, so the last
 * measurement goes stale: without this, flicking, pausing and then lifting would still count as a flick.
 */
export function speedAtRelease(speed, lastMoveTime, releaseTime) {
  return releaseTime - lastMoveTime > FLICK_WINDOW_MS ? 0 : speed;
}

/**
 * Whether a swipe across the grid turns the month: far enough, or a flick the same way the finger travelled.
 * @param offset Signed. Negative means the finger went left.
 * @param speed Signed, like offset. Use speedAtRelease.
 */
export function monthSwipeTurns({ offset, speed, width }) {
  if (offset === 0) return false;
  if (Math.abs(offset) > width * MONTH_SWIPE_FRACTION) return true;
  return Math.abs(speed) > MONTH_FLICK_SPEED && Math.sign(speed) === Math.sign(offset);
}

/**
 * What a left swipe on a row does on release: `delete`, `open` (on its Delete button) or `close`.
 * @param offset How far left it has travelled.
 * @param speed Positive means moving left. Use speedAtRelease.
 */
export function rowSwipeAction({ offset, speed, width }) {
  if (offset > width * ROW_DELETE_FRACTION) return 'delete';
  if (offset <= ROW_OPEN_DISTANCE) return 'close';
  return speed > ROW_FLICK_SPEED ? 'delete' : 'open';
}

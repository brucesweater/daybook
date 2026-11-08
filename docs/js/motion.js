// Animation helpers. Only what changed moves, for 200 to 300 ms, on an iOS-like curve; Reduce Motion turns
// all of it off.

export const EASE = 'cubic-bezier(.32,.72,0,1)';
export const DURATION = 280;

/**
 * Past this many rows at once, as in an import, nobody can follow the motion, and measuring each row forces a layout
 * of all the others: 8000 rows froze the tab for 84 seconds.
 */
const MOST_ROWS_ANIMATED = 20;

export function reducedMotion() {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Runs a Web Animation, unless motion is off. `done` always runs, exactly once. */
export function animate(node, keyframes, options = {}, done = () => {}) {
  if (reducedMotion() || typeof node.animate !== 'function') {
    done();
    return null;
  }
  const animation = node.animate(keyframes, { duration: DURATION, easing: EASE, ...options });
  let finished = false;
  const finish = () => {
    if (!finished) {
      finished = true;
      done();
    }
  };
  animation.addEventListener('finish', finish);
  animation.addEventListener('cancel', finish);
  return animation;
}

/** A list row opens up into place. */
export function enter(node) {
  const height = node.offsetHeight;
  node.classList.add('is-animating');
  animate(
    node,
    [
      { height: '0px', opacity: 0 },
      { height: `${height}px`, opacity: 1 },
    ],
    {},
    () => node.classList.remove('is-animating'),
  );
}

/** A list row closes up and goes away. */
export function leave(node) {
  node.classList.add('leaving', 'is-animating');
  node.inert = true;
  node.setAttribute('aria-hidden', 'true');
  animate(
    node,
    [
      { height: `${node.offsetHeight}px`, opacity: 1 },
      { height: '0px', opacity: 0 },
    ],
    { duration: 260 },
    () => node.remove(),
  );
}

/**
 * Makes a list's children match `items`, reusing rows by key so focus and running transitions survive.
 * A row that's going away closes where it is, and the rows around it don't move: inserting them in front of it would
 * throw it to the bottom of the list and drop any focus they hold.
 * `onLeave` runs before a row that holds focus goes away.
 */
export function syncList(list, items, { keyOf, create, update, animated = true, onLeave = () => {} }) {
  const isLive = (node) => !node.classList.contains('leaving');
  const staying = new Set(items.map(keyOf));
  /** The first row from `start` on that keeps its place, which is what the next row gets lined up against. */
  const nextStaying = (start) => {
    let node = start;
    while (node && !(isLive(node) && staying.has(node.dataset.key))) node = node.nextElementSibling;
    return node;
  };

  const rows = new Map();
  for (const node of list.children) {
    if (isLive(node)) rows.set(node.dataset.key, node);
  }

  const entering = [];
  let cursor = nextStaying(list.firstElementChild);
  for (const item of items) {
    const key = keyOf(item);
    let row = rows.get(key);
    if (row) {
      rows.delete(key);
    } else {
      row = create(item);
      row.dataset.key = key;
      entering.push(row);
    }
    update(row, item);
    if (row === cursor) cursor = nextStaying(cursor.nextElementSibling);
    else list.insertBefore(row, cursor);
  }

  const animateLeaving = animated && rows.size <= MOST_ROWS_ANIMATED;
  for (const row of rows.values()) {
    if (row.contains(document.activeElement)) onLeave(row);
    if (animateLeaving) leave(row);
    else row.remove();
  }
  if (animated && entering.length <= MOST_ROWS_ANIMATED) entering.forEach(enter);
}

// Small DOM helpers. User text only ever goes in through text nodes and textContent, never as markup.

/**
 * Creates an element. `props` become attributes, except `class`. A null or false value leaves the attribute
 * off. Children may be nodes or strings; strings become text nodes.
 */
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') node.className = value;
    else node.setAttribute(name, value === true ? '' : value);
  }
  node.append(...children.filter((child) => child !== null && child !== undefined));
  return node;
}

export function byId(id) {
  return document.getElementById(id);
}

/** A fresh copy of the first element in a <template>. */
export function fromTemplate(id) {
  return byId(id).content.firstElementChild.cloneNode(true);
}

/** Sets text only if it changed, so a live region or selection isn't disturbed for nothing. */
export function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

/** Whether keyboard focus is somewhere the user is typing. */
export function isField(node) {
  return !!node && node.matches?.('input, textarea, select, [contenteditable="true"]');
}

/**
 * Ignores the click a press would otherwise produce, and no later one, so a real tap right afterwards counts.
 * @param fingerDown True when called during the press, false when called as it ends.
 */
export function swallowNextClick(fingerDown = false) {
  const swallow = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const remove = () => {
    removeEventListener('click', swallow, true);
    removeEventListener('pointerup', removeSoon, true);
    removeEventListener('pointercancel', remove, true);
  };
  const removeSoon = () => setTimeout(remove, 80);
  addEventListener('click', swallow, { capture: true, once: true });
  if (fingerDown) {
    addEventListener('pointerup', removeSoon, true);
    addEventListener('pointercancel', remove, true);
  } else {
    removeSoon();
  }
}

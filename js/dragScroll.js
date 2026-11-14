// A mouse drag scrolls what is under it, the way a finger does on a phone. Some touchscreens
// deliver a finger as a mouse (DrumOS's do), and on them a page only scrolls this way. A press
// that moves less than DRAG_THRESHOLD_PX stays a click, so tapping notes and buttons still works.

// how far a press moves before it is a scroll rather than a click
const DRAG_THRESHOLD_PX = 10;
// where a drag selects text instead
const TEXT_ENTRY = 'input, textarea, select, [contenteditable="true"]';
const SCROLLABLE_OVERFLOW = /(auto|scroll)/;

/** The nearest element around `el` that scrolls vertically, or the page. */
function verticalScrollerAround(el) {
  for (let node = el; node && node !== document.body; node = node.parentElement) {
    const scrolls = node.scrollHeight > node.clientHeight;
    if (scrolls && SCROLLABLE_OVERFLOW.test(getComputedStyle(node).overflowY)) return node;
  }
  return document.scrollingElement;
}

/** The nearest element around `el` that scrolls horizontally, or the page. */
function horizontalScrollerAround(el) {
  for (let node = el; node && node !== document.body; node = node.parentElement) {
    const scrolls = node.scrollWidth > node.clientWidth;
    if (scrolls && SCROLLABLE_OVERFLOW.test(getComputedStyle(node).overflowX)) return node;
  }
  return document.scrollingElement;
}

/** The click that ends a scroll would land on whatever the drag ended over: drop it. */
function swallowNextClick() {
  const swallow = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener('click', swallow, { capture: true, once: true });
  // a drag that ends on another element gets no click at all
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
}

export function installDragScroll() {
  let drag = null;
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest(TEXT_ENTRY)) return;
      drag = {
        x: e.clientX,
        y: e.clientY,
        vertical: verticalScrollerAround(e.target),
        horizontal: horizontalScrollerAround(e.target),
        scrolling: false,
      };
    },
    true
  );
  window.addEventListener(
    'pointermove',
    (e) => {
      if (!drag) return;
      const dx = drag.x - e.clientX;
      const dy = drag.y - e.clientY;
      if (!drag.scrolling) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        drag.scrolling = true;
      }
      drag.vertical.scrollBy(0, dy);
      drag.horizontal.scrollBy(dx, 0);
      drag.x = e.clientX;
      drag.y = e.clientY;
    },
    true
  );
  const end = () => {
    if (drag && drag.scrolling) swallowNextClick();
    drag = null;
  };
  window.addEventListener('pointerup', end, true);
  window.addEventListener('pointercancel', end, true);
  // a drag scrolls instead of selecting text
  window.addEventListener(
    'selectstart',
    (e) => {
      if (drag) e.preventDefault();
    },
    true
  );
}

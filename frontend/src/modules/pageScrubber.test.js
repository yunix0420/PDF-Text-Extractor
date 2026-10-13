import test from 'node:test';
import assert from 'node:assert/strict';
import { PageScrubber } from './pageScrubber.js';

class MockElement {
  constructor(height = 200) {
    this.style = {};
    this.classList = {
      add: (cls) => { this[cls] = true; },
      remove: (cls) => { this[cls] = false; },
      contains: (cls) => Boolean(this[cls])
    };
    this.textContent = '';
    this.listeners = {};
    this.attributes = {};
    this.height = height;
    this.offsetHeight = 32;
    this.offsetTop = 0;
  }

  setAttribute(attr, val) {
    this.attributes[attr] = String(val);
  }

  getAttribute(attr) {
    return this.attributes[attr];
  }

  addEventListener(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }

  dispatchEvent(event, payload = {}) {
    const list = this.listeners[event] || [];
    const evt = {
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() {},
      ...payload
    };
    for (const fn of list) {
      fn(evt);
    }
  }

  getBoundingClientRect() {
    return { top: 0, height: this.height, bottom: this.height, left: 0, width: 22 };
  }

  contains(child) {
    return child === this;
  }
}

test('PageScrubber: hides when numPages <= 1, shows when numPages > 1', () => {
  const containerEl = new MockElement();
  const trackEl = new MockElement(200);
  const thumbEl = new MockElement(32);
  const badgeEl = new MockElement();

  const scrubber = new PageScrubber({
    trackEl,
    thumbEl,
    badgeEl,
    containerEl,
    onPageChange: () => {}
  });

  scrubber.setDocInfo(1, 1);
  assert.equal(containerEl.style.display, 'none');

  scrubber.setDocInfo(50, 1);
  assert.equal(containerEl.style.display, 'flex');
  assert.equal(thumbEl.style.top, '0px');
  assert.equal(badgeEl.textContent, 'Page 1 of 50');
});

test('PageScrubber: updates thumb position and badge text proportionally', () => {
  const containerEl = new MockElement();
  const trackEl = new MockElement(200);
  const thumbEl = new MockElement(32);
  const badgeEl = new MockElement();

  const scrubber = new PageScrubber({
    trackEl,
    thumbEl,
    badgeEl,
    containerEl,
    onPageChange: () => {}
  });

  // Track height = 200, thumb height = 32 -> maxTravel = 168
  scrubber.setDocInfo(10, 1);
  assert.equal(thumbEl.style.top, '0px');

  scrubber.update(10); // Last page -> ratio = 1 -> 168px
  assert.equal(thumbEl.style.top, '168px');
  assert.equal(badgeEl.textContent, 'Page 10 of 10');

  scrubber.update(5); // Middle page -> ratio = 4/9 -> Math.round(4/9 * 168) = 75px
  assert.equal(thumbEl.style.top, '75px');
  assert.equal(badgeEl.textContent, 'Page 5 of 10');
});

test('PageScrubber: off-center thumb click preserves position without jumping pages', () => {
  const containerEl = new MockElement();
  const trackEl = new MockElement(200);
  const thumbEl = new MockElement(32);
  const badgeEl = new MockElement();

  let changedPage = null;
  const scrubber = new PageScrubber({
    trackEl,
    thumbEl,
    badgeEl,
    containerEl,
    onPageChange: (p) => { changedPage = p; }
  });

  scrubber.setDocInfo(100, 10);
  // Initial page 10: ratio = 9/99 ~ 0.0909 -> thumb top ~ 15px
  const initialThumbTop = thumbEl.style.top;

  // Click on the thumb near its top edge (e.g. Y = 17, while thumb spans 15..47)
  trackEl.dispatchEvent('pointerdown', {
    button: 0,
    clientY: 17,
    target: thumbEl,
    pointerId: 1
  });

  // Off-center click on the thumb must NOT change the page or jump the thumb
  assert.equal(changedPage, null);
  assert.equal(thumbEl.style.top, initialThumbTop);
  assert.equal(scrubber.isDragging, true);

  // Release without dragging
  trackEl.dispatchEvent('pointerup', { pointerId: 1 });
  assert.equal(changedPage, null);
  assert.equal(scrubber.isDragging, false);
});

test('PageScrubber: clicking track outside thumb jumps immediately to target page', () => {
  const containerEl = new MockElement();
  const trackEl = new MockElement(200);
  const thumbEl = new MockElement(32);
  const badgeEl = new MockElement();

  let changedPage = null;
  const scrubber = new PageScrubber({
    trackEl,
    thumbEl,
    badgeEl,
    containerEl,
    onPageChange: (p) => { changedPage = p; }
  });

  scrubber.setDocInfo(10, 1);
  // Current page 1: thumb is at 0px..32px.
  // Click near the bottom at Y = 180 (well outside thumb)
  trackEl.dispatchEvent('pointerdown', {
    button: 0,
    clientY: 180,
    target: trackEl,
    pointerId: 1
  });

  // Should immediately jump to the corresponding page
  assert.notEqual(changedPage, null);
  assert.equal(changedPage, 10);
  assert.equal(scrubber.isDragging, true);

  trackEl.dispatchEvent('pointerup', { pointerId: 1 });
  assert.equal(scrubber.isDragging, false);
});

test('PageScrubber: keyboard navigation on thumb changes pages', () => {
  const containerEl = new MockElement();
  const trackEl = new MockElement(200);
  const thumbEl = new MockElement(32);
  const badgeEl = new MockElement();

  const pages = [];
  const scrubber = new PageScrubber({
    trackEl,
    thumbEl,
    badgeEl,
    containerEl,
    onPageChange: (p) => {
      pages.push(p);
      scrubber.update(p);
    }
  });

  scrubber.setDocInfo(50, 10);

  // ArrowDown increments by 1
  thumbEl.dispatchEvent('keydown', { key: 'ArrowDown' });
  assert.equal(pages[pages.length - 1], 11);

  // ArrowUp decrements by 1
  thumbEl.dispatchEvent('keydown', { key: 'ArrowUp' });
  assert.equal(pages[pages.length - 1], 10);

  // PageDown jumps by 10
  thumbEl.dispatchEvent('keydown', { key: 'PageDown' });
  assert.equal(pages[pages.length - 1], 20);

  // PageUp decrements by 10
  thumbEl.dispatchEvent('keydown', { key: 'PageUp' });
  assert.equal(pages[pages.length - 1], 10);

  // End goes to last page
  thumbEl.dispatchEvent('keydown', { key: 'End' });
  assert.equal(pages[pages.length - 1], 50);

  // Home goes to first page
  thumbEl.dispatchEvent('keydown', { key: 'Home' });
  assert.equal(pages[pages.length - 1], 1);
});

test('PageScrubber: hide() resets state and hides container', () => {
  const containerEl = new MockElement();
  const trackEl = new MockElement(200);
  const thumbEl = new MockElement(32);
  const badgeEl = new MockElement();

  const scrubber = new PageScrubber({
    trackEl,
    thumbEl,
    badgeEl,
    containerEl,
    onPageChange: () => {}
  });

  scrubber.setDocInfo(20, 5);
  assert.equal(containerEl.style.display, 'flex');

  scrubber.hide();
  assert.equal(containerEl.style.display, 'none');
  assert.equal(scrubber.numPages, 1);
  assert.equal(scrubber.currentPage, 1);
});

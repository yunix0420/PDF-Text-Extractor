/**
 * PageScrubber Controller
 * Provides an interactive vertical page scrubber anchored to the left of the PDF viewport.
 * Enables quick page skipping across small and large documents alike with rock-solid stability.
 */
export class PageScrubber {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.trackEl
   * @param {HTMLElement} options.thumbEl
   * @param {HTMLElement} options.badgeEl
   * @param {HTMLElement} options.containerEl
   * @param {(page: number) => void} options.onPageChange
   */
  constructor({ trackEl, thumbEl, badgeEl, containerEl, onPageChange }) {
    this.trackEl = trackEl;
    this.thumbEl = thumbEl;
    this.badgeEl = badgeEl;
    this.containerEl = containerEl;
    this.onPageChange = onPageChange;

    this.numPages = 1;
    this.currentPage = 1;
    this.isDragging = false;
    this.grabOffsetY = 0;
    this.pendingPage = null;
    this.throttleTimer = null;

    this.bindEvents();
    this.initResizeObserver();
  }

  initResizeObserver() {
    if (typeof ResizeObserver !== 'undefined' && this.trackEl) {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.numPages > 1 && !this.isDragging) {
          this.update(this.currentPage);
        }
      });
      this.resizeObserver.observe(this.trackEl);
    }
  }

  bindEvents() {
    if (!this.trackEl) return;

    const onPointerDown = (e) => {
      if (this.numPages <= 1) return;
      if (e.button !== 0) return; // Primary click only
      e.preventDefault();
      e.stopPropagation();

      const rect = this.trackEl.getBoundingClientRect();
      const thumbHeight = this.thumbEl ? (this.thumbEl.offsetHeight || 32) : 32;
      const maxTravel = Math.max(0, rect.height - thumbHeight);
      const currentRatio = (this.numPages > 1) ? (this.currentPage - 1) / (this.numPages - 1) : 0;
      const currentThumbTop = (this.thumbEl && this.thumbEl.style && this.thumbEl.style.top)
        ? parseFloat(this.thumbEl.style.top)
        : (currentRatio * maxTravel);

      const clickYInTrack = e.clientY - rect.top;
      // Generous vertical check so clicking anywhere along the thumb (or subpixel margins) grabs the thumb
      const isVerticallyOnThumb = (clickYInTrack >= (currentThumbTop - 2) && clickYInTrack <= (currentThumbTop + thumbHeight + 2));
      const isThumbTarget = (e.target === this.thumbEl || (this.thumbEl && this.thumbEl.contains && this.thumbEl.contains(e.target)));
      const isThumbClick = isThumbTarget || isVerticallyOnThumb;

      this.isDragging = true;
      if (this.containerEl) {
        this.containerEl.classList.add('dragging');
      }

      try {
        if (typeof this.trackEl.setPointerCapture === 'function') {
          this.trackEl.setPointerCapture(e.pointerId);
        }
      } catch (err) {}

      if (isThumbClick) {
        // User clicked on the thumb: preserve exact grab offset so thumb does NOT jump
        this.grabOffsetY = Math.max(0, Math.min(clickYInTrack - currentThumbTop, thumbHeight));
      } else {
        // User clicked on the track outside thumb: jump thumb center to click position
        this.grabOffsetY = thumbHeight / 2;
        this.updateFromPointer(e, true);
      }
    };

    const onPointerMove = (e) => {
      if (!this.isDragging) return;
      e.preventDefault();
      e.stopPropagation();
      this.updateFromPointer(e, false);
    };

    const onPointerUp = (e) => {
      if (!this.isDragging) return;
      e.preventDefault();
      e.stopPropagation();

      this.isDragging = false;
      this.grabOffsetY = 0;
      if (this.containerEl) {
        this.containerEl.classList.remove('dragging');
      }

      try {
        if (typeof this.trackEl.releasePointerCapture === 'function') {
          this.trackEl.releasePointerCapture(e.pointerId);
        }
      } catch (err) {}

      // Guaranteed immediate render of the target page on drag release
      if (this.throttleTimer) {
        clearTimeout(this.throttleTimer);
        this.throttleTimer = null;
      }
      if (this.pendingPage !== null && this.onPageChange) {
        this.onPageChange(this.pendingPage);
      }
      this.pendingPage = null;
    };

    this.trackEl.addEventListener('pointerdown', onPointerDown);
    this.trackEl.addEventListener('pointermove', onPointerMove);
    this.trackEl.addEventListener('pointerup', onPointerUp);
    this.trackEl.addEventListener('pointercancel', onPointerUp);

    // Fallback global pointerup to ensure drag always cleanly terminates
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerup', (e) => {
        if (this.isDragging) {
          onPointerUp(e);
        }
      });
    }

    // Keyboard support on the thumb for accessibility
    if (this.thumbEl) {
      if (typeof this.thumbEl.setAttribute === 'function') {
        this.thumbEl.setAttribute('tabindex', '0');
        this.thumbEl.setAttribute('role', 'slider');
        this.thumbEl.setAttribute('aria-label', 'Page Scrubber');
      }
      this.thumbEl.addEventListener('keydown', (e) => {
        if (this.numPages <= 1) return;
        let delta = 0;
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') delta = -1;
        else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') delta = 1;
        else if (e.key === 'PageUp') delta = -10;
        else if (e.key === 'PageDown') delta = 10;
        else if (e.key === 'Home') delta = -this.numPages;
        else if (e.key === 'End') delta = this.numPages;

        if (delta !== 0) {
          e.preventDefault();
          const targetPage = Math.max(1, Math.min(this.currentPage + delta, this.numPages));
          if (targetPage !== this.currentPage && this.onPageChange) {
            this.onPageChange(targetPage);
          }
        }
      });
    }
  }

  updateFromPointer(e, immediate = false) {
    const rect = this.trackEl.getBoundingClientRect();
    if (rect.height <= 0) return;

    const thumbHeight = this.thumbEl ? (this.thumbEl.offsetHeight || 32) : 32;
    const maxTravel = Math.max(0, rect.height - thumbHeight);
    if (maxTravel <= 0) return;

    const grabOffset = (this.grabOffsetY !== undefined) ? this.grabOffsetY : (thumbHeight / 2);
    const desiredThumbTop = (e.clientY - rect.top) - grabOffset;
    const clampedThumbTop = Math.max(0, Math.min(desiredThumbTop, maxTravel));
    const ratio = clampedThumbTop / maxTravel;
    const page = Math.max(1, Math.min(Math.round(1 + ratio * (this.numPages - 1)), this.numPages));

    this.setThumbPosition(clampedThumbTop, thumbHeight);
    this.updateBadge(page);

    this.pendingPage = page;

    if (immediate) {
      if (this.throttleTimer) {
        clearTimeout(this.throttleTimer);
        this.throttleTimer = null;
      }
      if (this.onPageChange) {
        this.onPageChange(page);
      }
    } else {
      // Live throttled rendering (~60ms) while actively dragging
      if (!this.throttleTimer) {
        this.throttleTimer = setTimeout(() => {
          this.throttleTimer = null;
          if (this.pendingPage !== null && this.onPageChange) {
            this.onPageChange(this.pendingPage);
          }
        }, 60);
      }
    }
  }

  setThumbPosition(thumbTopPx, thumbHeight = 32) {
    const rounded = Math.round(thumbTopPx);
    if (this.thumbEl && this.thumbEl.style) {
      this.thumbEl.style.top = `${rounded}px`;
    }
    if (this.badgeEl && this.badgeEl.style) {
      this.badgeEl.style.top = `${Math.round(rounded + thumbHeight / 2)}px`;
    }
  }

  updateBadge(page) {
    if (this.badgeEl) {
      this.badgeEl.textContent = `Page ${page} of ${this.numPages}`;
    }
    if (this.thumbEl && typeof this.thumbEl.setAttribute === 'function') {
      this.thumbEl.setAttribute('aria-valuenow', String(page));
      this.thumbEl.setAttribute('aria-valuemin', '1');
      this.thumbEl.setAttribute('aria-valuemax', String(this.numPages));
    }
  }

  setDocInfo(numPages, currentPage = 1) {
    this.numPages = numPages || 1;
    this.currentPage = currentPage;

    if (this.numPages > 1) {
      if (this.containerEl) {
        this.containerEl.style.display = 'flex';
      }
      this.update(this.currentPage);
    } else {
      this.hide();
    }
  }

  update(currentPage) {
    this.currentPage = currentPage;
    if (this.isDragging) return; // Do not interrupt active dragging

    if (this.numPages > 1 && this.trackEl) {
      const rect = this.trackEl.getBoundingClientRect();
      const thumbHeight = this.thumbEl ? (this.thumbEl.offsetHeight || 32) : 32;
      const maxTravel = Math.max(0, rect.height - thumbHeight);
      const ratio = (this.numPages > 1) ? (this.currentPage - 1) / (this.numPages - 1) : 0;
      const thumbTopPx = ratio * maxTravel;

      this.setThumbPosition(thumbTopPx, thumbHeight);
      this.updateBadge(this.currentPage);
    }
  }

  hide() {
    if (this.containerEl) {
      this.containerEl.style.display = 'none';
    }
    this.numPages = 1;
    this.currentPage = 1;
    this.pendingPage = null;
    this.grabOffsetY = 0;
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
  }
}

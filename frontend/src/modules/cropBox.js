/**
 * Crop Box Controller
 * Manages the interactive selection overlay, coordinate transformations, and gestures via Interact.js.
 */

import interact from 'interactjs';

export const DEFAULT_COORDS = { left: 194, top: 337, right: 402, bottom: 505 };

/**
 * Calculates dynamically centered crop box coordinates based on page viewport dimensions.
 * Computes edge lengths (width and height) of the page and places an appropriately sized
 * crop box (neither too big nor too small) directly at the center of the page.
 *
 * @param {{ width: number, height: number }} viewport - Page viewport (at scale 1.0)
 * @returns {{ left: number, top: number, right: number, bottom: number }}
 */
export function calculateCenteredCropBox(viewport) {
  if (!viewport || !viewport.width || !viewport.height) {
    return DEFAULT_COORDS;
  }
  const pageWidth = viewport.width;
  const pageHeight = viewport.height;

  // Appropriate size: ~35% of page width and ~20% of page height.
  // Clamped with safety bounds so it remains comfortable to drag and resize on any format.
  const cropWidth = Math.min(Math.max(60, Math.round(pageWidth * 0.35)), Math.round(pageWidth * 0.8));
  const cropHeight = Math.min(Math.max(40, Math.round(pageHeight * 0.20)), Math.round(pageHeight * 0.8));

  const left = Math.round((pageWidth - cropWidth) / 2);
  const top = Math.round((pageHeight - cropHeight) / 2);

  return {
    left,
    top,
    right: left + cropWidth,
    bottom: top + cropHeight
  };
}

export class CropBoxController {
  /**
   * @param {Object} elements
   * @param {HTMLElement} elements.cropBoxEl
   * @param {HTMLInputElement} elements.inputLeft
   * @param {HTMLInputElement} elements.inputTop
   * @param {HTMLInputElement} elements.inputRight
   * @param {HTMLInputElement} elements.inputBottom
   * @param {() => void} [elements.onCoordinatesChanged]
   */
  constructor({ cropBoxEl, inputLeft, inputTop, inputRight, inputBottom, onCoordinatesChanged }) {
    this.cropBoxEl = cropBoxEl;
    this.inputLeft = inputLeft;
    this.inputTop = inputTop;
    this.inputRight = inputRight;
    this.inputBottom = inputBottom;
    this.onCoordinatesChanged = onCoordinatesChanged;

    this.isVisible = true;
    this.currentScale = 1.0;

    if (typeof document !== 'undefined') {
      this.initInteract();
      this.initInputListeners();
      this.initVisibilityToggles();
    }
  }

  /**
   * Sets current scale used for coordinate scaling calculations.
   * @param {number} scale
   */
  setScale(scale) {
    this.currentScale = scale;
  }

  /**
   * Returns unscaled document crop box coordinates.
   * @returns {{ left: number, top: number, right: number, bottom: number }}
   */
  getCoordinates() {
    return {
      left: parseFloat(this.inputLeft.value) || 0,
      top: parseFloat(this.inputTop.value) || 0,
      right: parseFloat(this.inputRight.value) || 0,
      bottom: parseFloat(this.inputBottom.value) || 0
    };
  }

  /**
   * Sets coordinate values in inputs and updates visual crop box.
   * @param {{ left: number, top: number, right: number, bottom: number }} coords
   */
  setCoordinates(coords) {
    this.inputLeft.value = Math.round(coords.left);
    this.inputTop.value = Math.round(coords.top);
    this.inputRight.value = Math.round(coords.right);
    this.inputBottom.value = Math.round(coords.bottom);
    this.updateVisualBox();
  }


  /**
   * Resets crop box coordinates. If a page is provided, dynamically positions
   * the box at the center of the page with appropriate size based on edge lengths.
   * @param {any} [page] - Active PDF.js page object
   */
  reset(page) {
    if (page && typeof page.getViewport === 'function') {
      const viewport = page.getViewport({ scale: 1.0 });
      this.setCoordinates(calculateCenteredCropBox(viewport));
    } else if (page && page.width && page.height) {
      this.setCoordinates(calculateCenteredCropBox(page));
    } else {
      this.setCoordinates(DEFAULT_COORDS);
    }
  }

  /**
   * Updates visual crop box position and size from input values.
   */
  updateVisualBox() {
    if (!this.cropBoxEl) return;
    const coords = this.getCoordinates();
    const scale = this.currentScale;

    const scaledLeft = coords.left * scale;
    const scaledTop = coords.top * scale;
    const scaledWidth = Math.max((coords.right - coords.left) * scale, 16);
    const scaledHeight = Math.max((coords.bottom - coords.top) * scale, 16);

    this.cropBoxEl.style.left = `${scaledLeft}px`;
    this.cropBoxEl.style.top = `${scaledTop}px`;
    this.cropBoxEl.style.width = `${scaledWidth}px`;
    this.cropBoxEl.style.height = `${scaledHeight}px`;

    this.cropBoxEl.setAttribute('data-x', String(scaledLeft));
    this.cropBoxEl.setAttribute('data-y', String(scaledTop));

    // Dynamic handle sizing: dynamically scale handle size if box is compact so they NEVER overlap
    const minDim = Math.min(scaledWidth, scaledHeight);
    const handleSize = Math.max(6, Math.min(14, Math.floor(minDim * 0.45)));
    const handleOffset = -Math.round(handleSize / 2);
    this.cropBoxEl.style.setProperty('--handle-size', `${handleSize}px`);
    this.cropBoxEl.style.setProperty('--handle-offset', `${handleOffset}px`);

    if (this.onCoordinatesChanged) {
      this.onCoordinatesChanged();
    }
  }

  /**
   * Updates input field numbers from the visual crop box element.
   */
  updateInputsFromVisual() {
    if (!this.cropBoxEl) return;
    const scale = this.currentScale;

    const scaledLeft = parseFloat(this.cropBoxEl.getAttribute('data-x')) || 0;
    const scaledTop = parseFloat(this.cropBoxEl.getAttribute('data-y')) || 0;
    const scaledWidth = parseFloat(this.cropBoxEl.style.width) || 0;
    const scaledHeight = parseFloat(this.cropBoxEl.style.height) || 0;

    this.inputLeft.value = Math.round(scaledLeft / scale);
    this.inputTop.value = Math.round(scaledTop / scale);
    this.inputRight.value = Math.round((scaledLeft + scaledWidth) / scale);
    this.inputBottom.value = Math.round((scaledTop + scaledHeight) / scale);

    if (this.onCoordinatesChanged) {
      this.onCoordinatesChanged();
    }
  }

  /**
   * Sets visibility state of the crop box on screen.
   * @param {boolean} visible
   */
  setVisibility(visible) {
    this.isVisible = visible;
    if (!this.cropBoxEl) return;

    this.cropBoxEl.classList.toggle('hidden', !visible);

    const iconEyeVis = document.getElementById('icon-eye-visible');
    const iconEyeHid = document.getElementById('icon-eye-hidden');
    const textToggle = document.getElementById('text-toggle-crop-box');
    const btnToggle = document.getElementById('btn-toggle-crop-box');

    const tbIconVis = document.getElementById('tb-icon-eye-visible');
    const tbIconHid = document.getElementById('tb-icon-eye-hidden');
    const btnToolbarToggle = document.getElementById('btn-toolbar-toggle-crop-box');

    if (iconEyeVis) iconEyeVis.style.display = visible ? 'inline-block' : 'none';
    if (iconEyeHid) iconEyeHid.style.display = visible ? 'none' : 'inline-block';
    if (textToggle) textToggle.textContent = visible ? 'Hide Area' : 'Show Area';
    if (btnToggle) {
      const title = visible ? 'Hide selection area on PDF' : 'Show selection area on PDF';
      btnToggle.title = title;
      btnToggle.setAttribute('aria-label', title);
    }

    if (tbIconVis) tbIconVis.style.display = visible ? 'inline-block' : 'none';
    if (tbIconHid) tbIconHid.style.display = visible ? 'none' : 'inline-block';
    if (btnToolbarToggle) {
      const title = visible ? 'Hide selection area (Ctrl + H)' : 'Show selection area (Ctrl + H)';
      btnToolbarToggle.title = title;
      btnToolbarToggle.setAttribute('aria-label', title);
    }
  }

  toggleVisibility() {
    this.setVisibility(!this.isVisible);
  }

  initInteract() {
    this.ensureHandles();

    interact('.crop-box')
      .draggable({
        modifiers: [
          interact.modifiers.restrictRect({
            restriction: 'parent'
          })
        ],
        listeners: {
          move: (event) => {
            const target = event.target;
            const x = (parseFloat(target.getAttribute('data-x')) || 0) + event.dx;
            const y = (parseFloat(target.getAttribute('data-y')) || 0) + event.dy;

            target.style.left = `${x}px`;
            target.style.top = `${y}px`;
            target.setAttribute('data-x', String(x));
            target.setAttribute('data-y', String(y));

            this.updateInputsFromVisual();
          }
        }
      })
      .resizable({
        edges: { left: true, right: true, bottom: true, top: true },
        margin: 6,
        modifiers: [
          interact.modifiers.restrictEdges({
            outer: 'parent'
          }),
          interact.modifiers.restrictSize({
            min: { width: 16, height: 16 }
          })
        ],
        listeners: {
          move: (event) => {
            const target = event.target;
            let x = parseFloat(target.getAttribute('data-x')) || 0;
            let y = parseFloat(target.getAttribute('data-y')) || 0;

            target.style.width = `${event.rect.width}px`;
            target.style.height = `${event.rect.height}px`;

            x += event.deltaRect.left;
            y += event.deltaRect.top;

            target.style.left = `${x}px`;
            target.style.top = `${y}px`;
            target.setAttribute('data-x', String(x));
            target.setAttribute('data-y', String(y));

            const minDim = Math.min(event.rect.width, event.rect.height);
            const handleSize = Math.max(6, Math.min(14, Math.floor(minDim * 0.45)));
            const handleOffset = -Math.round(handleSize / 2);
            target.style.setProperty('--handle-size', `${handleSize}px`);
            target.style.setProperty('--handle-offset', `${handleOffset}px`);

            this.updateInputsFromVisual();
          }
        }
      })
      .actionChecker((pointer, event, action) => {
        const target = event && event.target;
        if (target) {
          const handle = target.closest ? target.closest('.crop-handle') : null;
          if (handle) {
            if (handle.classList.contains('crop-handle-tl')) {
              return { name: 'resize', edges: { top: true, left: true, bottom: false, right: false } };
            }
            if (handle.classList.contains('crop-handle-tr')) {
              return { name: 'resize', edges: { top: true, right: true, bottom: false, left: false } };
            }
            if (handle.classList.contains('crop-handle-bl')) {
              return { name: 'resize', edges: { bottom: true, left: true, top: false, right: false } };
            }
            if (handle.classList.contains('crop-handle-br')) {
              return { name: 'resize', edges: { bottom: true, right: true, top: false, left: false } };
            }
          }
        }
        return action;
      });
  }

  /**
   * Ensures the 4 corner 270-degree handle elements are present inside cropBoxEl.
   */
  ensureHandles() {
    if (!this.cropBoxEl) return;
    if (this.cropBoxEl.querySelector('.crop-handle')) return;

    const handles = [
      { cls: 'crop-handle-tl', path: 'M 7,7 L 7,14 A 7,7 0 1,1 14,7 Z', title: 'Resize Top-Left' },
      { cls: 'crop-handle-tr', path: 'M 7,7 L 0,7 A 7,7 0 1,1 7,14 Z', title: 'Resize Top-Right' },
      { cls: 'crop-handle-bl', path: 'M 7,7 L 14,7 A 7,7 0 1,1 7,0 Z', title: 'Resize Bottom-Left' },
      { cls: 'crop-handle-br', path: 'M 7,7 L 7,0 A 7,7 0 1,1 0,7 Z', title: 'Resize Bottom-Right' }
    ];

    handles.forEach((h) => {
      const el = document.createElement('div');
      el.className = `crop-handle ${h.cls}`;
      el.title = h.title;
      el.setAttribute('data-handle', h.cls.replace('crop-handle-', ''));
      el.innerHTML = `<svg viewBox="0 0 14 14"><path d="${h.path}" fill="#dc3545" /></svg>`;
      this.cropBoxEl.appendChild(el);
    });
  }

  initInputListeners() {
    const inputs = [this.inputLeft, this.inputTop, this.inputRight, this.inputBottom];
    inputs.forEach(input => {
      if (input) {
        input.addEventListener('input', () => {
          this.updateVisualBox();
        });
      }
    });
  }

  initVisibilityToggles() {
    const btnToggle = document.getElementById('btn-toggle-crop-box');
    const btnToolbarToggle = document.getElementById('btn-toolbar-toggle-crop-box');

    if (btnToggle) btnToggle.addEventListener('click', () => this.toggleVisibility());
    if (btnToolbarToggle) btnToolbarToggle.addEventListener('click', () => this.toggleVisibility());

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        this.toggleVisibility();
      }
    });
  }
}

/**
 * Desktop Context Menu
 * Provides native desktop feel with context-sensitive right-click menus, shortcut labels,
 * and boundary-aware positioning.
 */

export class ContextMenuManager {
  /**
   * @param {Object} handlers
   * @param {() => any} handlers.getViewer
   * @param {() => any} handlers.getCropBox
   * @param {() => void} handlers.onResetCoords
   * @param {() => void} handlers.onSavePreset
   * @param {() => void} handlers.onDeletePreset
   * @param {() => void} handlers.onUnloadPDF
   */
  constructor(handlers) {
    this.handlers = handlers;
    this.initListeners();
  }

  hide() {
    const existing = document.getElementById('app-context-menu');
    if (existing) {
      existing.remove();
    }
  }

  /**
   * Shows a custom context menu at the specified coordinates.
   * @param {Array<{ label?: string, shortcut?: string, disabled?: boolean, action?: () => void, type?: string }>} items
   * @param {number} clientX
   * @param {number} clientY
   */
  show(items, clientX, clientY) {
    this.hide();
    if (!items || items.length === 0) return;

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.id = 'app-context-menu';

    items.forEach(item => {
      if (item.type === 'separator') {
        const sep = document.createElement('div');
        sep.className = 'context-menu-separator';
        menu.appendChild(sep);
      } else {
        const el = document.createElement('div');
        el.className = 'context-menu-item' + (item.disabled ? ' disabled' : '');

        const labelSpan = document.createElement('span');
        labelSpan.textContent = item.label;
        el.appendChild(labelSpan);

        if (item.shortcut) {
          const shortcutSpan = document.createElement('span');
          shortcutSpan.className = 'context-menu-shortcut';
          shortcutSpan.textContent = item.shortcut;
          el.appendChild(shortcutSpan);
        }

        if (!item.disabled && item.action) {
          el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            this.hide();
            item.action();
          });
        }
        menu.appendChild(el);
      }
    });

    document.body.appendChild(menu);

    // Keep within viewport boundaries
    const rect = menu.getBoundingClientRect();
    let x = clientX;
    let y = clientY;

    if (x + rect.width > window.innerWidth - 8) {
      x = Math.max(8, window.innerWidth - rect.width - 8);
    }
    if (y + rect.height > window.innerHeight - 8) {
      y = Math.max(8, window.innerHeight - rect.height - 8);
    }
    if (x < 8) x = 8;
    if (y < 8) y = 8;

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
  }

  initListeners() {
    // Dismiss on outside click, window blur, resize, or escape
    document.addEventListener('pointerdown', (e) => {
      const menu = document.getElementById('app-context-menu');
      if (menu && !menu.contains(e.target)) {
        this.hide();
      }
    });

    window.addEventListener('blur', () => this.hide());
    window.addEventListener('resize', () => this.hide());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hide();
      }
    });

    // Intercept window contextmenu
    window.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      this.hide();

      const target = e.target;
      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      const isResult = target && (target.id === 'result-box' || target.closest('#result-box'));
      const isLivePreview = target && (target.id === 'live-preview-box' || target.closest('#live-preview-box'));
      const isPreview = target && (target.closest('#pdf-preview-area') || target.closest('#canvas-container') || target.id === 'crop-box');
      const isPresetSelect = target && target.id === 'preset-selector';

      // 1. Text input context menu
      if (isInput) {
        const inputEl = target;
        inputEl.focus();

        const isReadOnly = inputEl.readOnly || inputEl.disabled;
        const s = inputEl.selectionStart;
        const end = inputEl.selectionEnd;
        const hasSelection = s !== undefined && end !== undefined && s !== end;
        const hasValue = Boolean(inputEl.value && inputEl.value.length > 0);

        const menuItems = [
          {
            label: 'Cut',
            shortcut: 'Ctrl+X',
            disabled: isReadOnly || !hasSelection,
            action: () => {
              const selStart = inputEl.selectionStart;
              const selEnd = inputEl.selectionEnd;
              const val = inputEl.value.substring(selStart, selEnd);
              if (val) {
                navigator.clipboard.writeText(val).catch(() => {});
                inputEl.value = inputEl.value.substring(0, selStart) + inputEl.value.substring(selEnd);
                inputEl.setSelectionRange(selStart, selStart);
                inputEl.dispatchEvent(new Event('input', { bubbles: true }));
              }
              inputEl.focus();
            }
          },
          {
            label: 'Copy',
            shortcut: 'Ctrl+C',
            disabled: !hasSelection && !hasValue,
            action: () => {
              const selStart = inputEl.selectionStart;
              const selEnd = inputEl.selectionEnd;
              const isSelected = selStart !== undefined && selEnd !== undefined && selStart !== selEnd;
              const val = isSelected ? inputEl.value.substring(selStart, selEnd) : inputEl.value;
              if (val) {
                navigator.clipboard.writeText(val).catch(() => {});
              }
              inputEl.focus();
            }
          },
          {
            label: 'Paste',
            shortcut: 'Ctrl+V',
            disabled: isReadOnly,
            action: async () => {
              try {
                const text = await navigator.clipboard.readText();
                if (text !== undefined && text !== null) {
                  const selStart = inputEl.selectionStart ?? inputEl.value.length;
                  const selEnd = inputEl.selectionEnd ?? inputEl.value.length;
                  inputEl.value = inputEl.value.substring(0, selStart) + text + inputEl.value.substring(selEnd);
                  inputEl.setSelectionRange(selStart + text.length, selStart + text.length);
                  inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                }
              } catch (err) {
                inputEl.focus();
                document.execCommand('paste');
              }
              inputEl.focus();
            }
          },
          {
            label: 'Delete',
            shortcut: 'Del',
            disabled: isReadOnly || !hasSelection,
            action: () => {
              const selStart = inputEl.selectionStart;
              const selEnd = inputEl.selectionEnd;
              if (selStart !== undefined && selEnd !== undefined && selStart !== selEnd) {
                inputEl.value = inputEl.value.substring(0, selStart) + inputEl.value.substring(selEnd);
                inputEl.setSelectionRange(selStart, selStart);
                inputEl.dispatchEvent(new Event('input', { bubbles: true }));
              }
              inputEl.focus();
            }
          },
          { type: 'separator' },
          {
            label: 'Select All',
            shortcut: 'Ctrl+A',
            disabled: !hasValue,
            action: () => {
              inputEl.focus();
              inputEl.select();
            }
          }
        ];

        this.show(menuItems, e.clientX, e.clientY);
        return;
      }

      // 2. Result box context menu
      if (isResult) {
        const resultEl = document.getElementById('result-box');
        const text = resultEl ? resultEl.textContent.trim() : '';
        if (text) {
          const selectedText = window.getSelection ? window.getSelection().toString() : '';
          const menuItems = [
            {
              label: 'Copy',
              shortcut: 'Ctrl+C',
              disabled: false,
              action: () => {
                navigator.clipboard.writeText(selectedText || text).catch(() => {});
              }
            },
            {
              label: 'Select All',
              shortcut: 'Ctrl+A',
              disabled: false,
              action: () => {
                if (window.getSelection && document.createRange) {
                  const range = document.createRange();
                  range.selectNodeContents(resultEl);
                  const sel = window.getSelection();
                  sel.removeAllRanges();
                  sel.addRange(range);
                }
              }
            }
          ];
          this.show(menuItems, e.clientX, e.clientY);
          return;
        }
      }

      // 3. Live Preview box context menu
      if (isLivePreview) {
        const previewEl = document.getElementById('live-preview-box');
        const text = previewEl && !previewEl.classList.contains('empty') ? previewEl.textContent.trim() : '';
        if (text) {
          const selectedText = window.getSelection ? window.getSelection().toString() : '';
          const menuItems = [
            {
              label: 'Copy',
              shortcut: 'Ctrl+C',
              disabled: false,
              action: () => {
                navigator.clipboard.writeText(selectedText || text).catch(() => {});
              }
            },
            {
              label: 'Select All',
              shortcut: 'Ctrl+A',
              disabled: false,
              action: () => {
                if (window.getSelection && document.createRange) {
                  const range = document.createRange();
                  range.selectNodeContents(previewEl);
                  const sel = window.getSelection();
                  sel.removeAllRanges();
                  sel.addRange(range);
                }
              }
            }
          ];
          this.show(menuItems, e.clientX, e.clientY);
          return;
        }
      }

      // 4. PDF Preview area context menu
      const viewer = this.handlers.getViewer();
      const cropBox = this.handlers.getCropBox();

      if (isPreview && viewer && viewer.pdfDoc && viewer.pdfPage) {
        const menuItems = [
          {
            label: 'Zoom In',
            shortcut: 'Ctrl + Scroll Up',
            disabled: viewer.currentScale >= viewer.getMaxScale(),
            action: async () => {
              viewer.userHasManuallyZoomed = true;
              await viewer.zoomFromCenter(viewer.currentScale + 0.25);
            }
          },
          {
            label: 'Zoom Out',
            shortcut: 'Ctrl + Scroll Down',
            disabled: viewer.currentScale <= viewer.getMinScale(),
            action: async () => {
              viewer.userHasManuallyZoomed = true;
              await viewer.zoomFromCenter(viewer.currentScale - 0.25);
            }
          },
          {
            label: 'Fit to Viewport',
            shortcut: '',
            disabled: false,
            action: async () => {
              if (!viewer.pdfPage) return;
              viewer.userHasManuallyZoomed = false;
              viewer.currentScale = viewer.calculateFitScale(viewer.pdfPage);
              if (viewer.zoomInput) {
                viewer.zoomInput.value = Math.round(viewer.currentScale * 100);
              }
              await viewer.renderPDFPage();
            }
          },
          {
            label: 'Reset Zoom (100%)',
            shortcut: '',
            disabled: false,
            action: async () => {
              viewer.userHasManuallyZoomed = true;
              await viewer.zoomFromCenter(1.0);
            }
          },
          { type: 'separator' },
          {
            label: cropBox && cropBox.isVisible ? 'Hide Selection Area' : 'Show Selection Area',
            shortcut: 'Ctrl+H',
            disabled: false,
            action: () => {
              if (cropBox) cropBox.toggleVisibility();
            }
          },
          {
            label: 'Reset Crop Coordinates',
            shortcut: '',
            disabled: false,
            action: () => {
              this.handlers.onResetCoords();
            }
          },
          {
            label: 'Save as Preset...',
            shortcut: '',
            disabled: false,
            action: () => {
              this.handlers.onSavePreset();
            }
          },
          { type: 'separator' },
          {
            label: 'Unload PDF...',
            shortcut: '',
            disabled: false,
            action: () => {
              this.handlers.onUnloadPDF();
            }
          }
        ];

        this.show(menuItems, e.clientX, e.clientY);
        return;
      }

      // 5. Preset Selector context menu
      if (isPresetSelect) {
        const selectorEl = target;
        const selected = selectorEl.value;
        if (selected) {
          const menuItems = [
            {
              label: `Delete Preset "${selected}"`,
              shortcut: '',
              disabled: false,
              action: () => {
                this.handlers.onDeletePreset();
              }
            }
          ];
          this.show(menuItems, e.clientX, e.clientY);
          return;
        }
      }
    });
  }
}

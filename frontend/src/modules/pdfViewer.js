/**
 * PDF Viewer Engine
 * Manages PDF.js document loading, double-buffered canvas rendering, zoom & pan navigation,
 * and mouse gestures.
 */

import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ReadPDFFile } from '../../wailsjs/go/main/App';
import { PageScrubber } from './pageScrubber.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export class PDFViewer {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.previewArea
   * @param {HTMLCanvasElement} options.canvas
   * @param {HTMLElement} options.container
   * @param {HTMLInputElement} options.zoomInput
   * @param {HTMLInputElement} options.pageInput
   * @param {HTMLElement} options.pageCountEl
   * @param {HTMLElement} options.placeholderEl
   * @param {HTMLElement} options.toolbarEl
   * @param {(page: any, textContent: any) => void} [options.onPageLoaded]
   * @param {(scale: number) => void} [options.onScaleChanged]
   */
  constructor({
    previewArea,
    canvas,
    container,
    zoomInput,
    pageInput,
    pageCountEl,
    placeholderEl,
    toolbarEl,
    displayWrapperEl,
    scrubberTrackEl,
    scrubberThumbEl,
    scrubberBadgeEl,
    scrubberContainerEl,
    onPageLoaded,
    onScaleChanged
  }) {
    this.previewArea = previewArea;
    this.canvas = canvas;
    this.container = container;
    this.zoomInput = zoomInput;
    this.pageInput = pageInput;
    this.pageCountEl = pageCountEl;
    this.placeholderEl = placeholderEl;
    this.toolbarEl = toolbarEl;
    this.displayWrapperEl = displayWrapperEl;

    this.scrubber = null;
    if (scrubberTrackEl) {
      this.scrubber = new PageScrubber({
        trackEl: scrubberTrackEl,
        thumbEl: scrubberThumbEl,
        badgeEl: scrubberBadgeEl,
        containerEl: scrubberContainerEl,
        onPageChange: (targetPage) => {
          this.loadPage(targetPage);
        }
      });
    }

    this.onPageLoaded = onPageLoaded;
    this.onScaleChanged = onScaleChanged;

    this.pdfDoc = null;
    this.pdfPage = null;
    this.currentPageNum = 1;
    this.currentScale = 1.0;
    this.lastRenderedScale = 1.0;
    this.userHasManuallyZoomed = false;

    this.renderTask = null;
    this.isLoadingPage = false;
    this.pendingPageNum = null;

    // Double buffering canvas to prevent flickering during redraws
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenContext = this.offscreenCanvas.getContext('2d', { alpha: false });

    // Focal point tracking for smooth zooming
    this.isVisualZooming = false;
    this.focalPoint = { docX: 0, docY: 0, screenX: 0, screenY: 0 };

    // Panning state
    this.isDragging = false;
    this.startX = 0;
    this.startY = 0;
    this.scrollLeft = 0;
    this.scrollTop = 0;
    this.rafPanningId = null;
    this.targetScrollLeft = 0;
    this.targetScrollTop = 0;

    // Mouse wheel accumulator for page flicking
    this.wheelAccumulator = 0;
    this.wheelAccumulatorTimer = null;
    this.zoomTimeout = null;

    this.initPanning();
    this.initWheelZoomAndScroll();
    this.initResizeObserver();
    this.initToolbarControls();
  }

  getMinScale() {
    return 0.1;
  }

  getMaxScale() {
    return 5.0;
  }

  calculateFitScale(page = this.pdfPage) {
    if (!page) return 1.0;
    const rect = this.previewArea.getBoundingClientRect();
    const width = rect.width || this.previewArea.clientWidth || 600;
    const height = rect.height || this.previewArea.clientHeight || 500;

    // Tight 8px margin: 8px top/bottom/left/right + 1px border on each side = 18px overhead
    // Subtracting 24px guarantees zero scrollbar appearance across all DPI and subpixel displays
    const availableWidth = Math.max(width - 24, 50);
    const availableHeight = Math.max(height - 24, 50);

    const baseViewport = page.getViewport({ scale: 1.0 });
    const scaleX = availableWidth / baseViewport.width;
    const scaleY = availableHeight / baseViewport.height;

    let fitScale = Math.min(scaleX, scaleY);
    return Math.max(this.getMinScale(), Math.min(fitScale, this.getMaxScale()));
  }

  getZoomLadder() {
    const STANDARD_PRESETS = [0.10, 0.25, 0.33, 0.50, 0.67, 0.75, 1.00, 1.25, 1.50, 2.00, 3.00, 4.00, 5.00];
    const ladder = [...STANDARD_PRESETS];
    if (this.pdfPage) {
      const fitScale = this.calculateFitScale(this.pdfPage);
      if (!ladder.some(p => Math.abs(p - fitScale) < 0.015)) {
        ladder.push(fitScale);
        ladder.sort((a, b) => a - b);
      }
    }
    return ladder;
  }

  getNextZoomInScale() {
    const ladder = this.getZoomLadder();
    for (const step of ladder) {
      if (step > this.currentScale + 0.008) {
        return step;
      }
    }
    return this.getMaxScale();
  }

  getNextZoomOutScale() {
    const ladder = this.getZoomLadder();
    for (let i = ladder.length - 1; i >= 0; i--) {
      if (ladder[i] < this.currentScale - 0.008) {
        return ladder[i];
      }
    }
    return this.getMinScale();
  }

  initiateZoom(screenX, screenY) {
    if (!this.isVisualZooming) {
      this.isVisualZooming = true;
      this.focalPoint.screenX = screenX;
      this.focalPoint.screenY = screenY;

      // Position relative to the canvas inside previewArea
      const isHorizOverflow = this.canvas && (this.canvas.width > this.previewArea.clientWidth);
      const isVertOverflow = this.canvas && ((this.canvas.height + 20) > this.previewArea.clientHeight);
      const canvasLeft = this.container ? this.container.offsetLeft : 0;
      const canvasTop = this.container ? this.container.offsetTop : 0;

      if (isHorizOverflow) {
        this.focalPoint.docX = (screenX + this.previewArea.scrollLeft - canvasLeft) / this.lastRenderedScale;
        this.focalOriginX = `${this.focalPoint.docX * this.lastRenderedScale}px`;
      } else {
        // Lock horizontally to 50% (exact center) when document fits inside the viewport
        this.focalPoint.docX = (this.canvas ? this.canvas.width / 2 : 0) / this.lastRenderedScale;
        this.focalOriginX = '50%';
      }

      if (isVertOverflow) {
        this.focalPoint.docY = (screenY + this.previewArea.scrollTop - canvasTop) / this.lastRenderedScale;
        this.focalOriginY = `${this.focalPoint.docY * this.lastRenderedScale}px`;
      } else {
        // Lock vertically to 50% (exact center) when document fits inside the viewport
        this.focalPoint.docY = (this.canvas ? this.canvas.height / 2 : 0) / this.lastRenderedScale;
        this.focalOriginY = '50%';
      }

      this.container.style.transformOrigin = `${this.focalOriginX} ${this.focalOriginY}`;
    }
  }

  applyVisualScale() {
    const ratio = this.currentScale / this.lastRenderedScale;
    const projectedWidth = this.canvas ? this.canvas.width * ratio : 0;
    const isHorizOverflow = projectedWidth > this.previewArea.clientWidth;

    const projectedHeight = this.canvas ? this.canvas.height * ratio : 0;
    const isVertOverflow = (projectedHeight + 20) > this.previewArea.clientHeight;

    // Keep origin strictly 50% horizontally and vertically whenever the scaled document fits inside the viewport
    const originX = !isHorizOverflow ? '50%' : (this.focalOriginX || '50%');
    const originY = !isVertOverflow ? '50%' : (this.focalOriginY || '50%');
    this.container.style.transformOrigin = `${originX} ${originY}`;
    this.container.style.transform = `scale(${ratio})`;
  }

  async renderPDFPage() {
    if (!this.pdfPage) return;

    const viewport = this.pdfPage.getViewport({ scale: this.currentScale });

    if (this.renderTask !== null) {
      this.renderTask.cancel();
      this.renderTask = null;
    }

    this.offscreenCanvas.height = viewport.height;
    this.offscreenCanvas.width = viewport.width;

    const renderContext = {
      canvasContext: this.offscreenContext,
      viewport: viewport
    };

    try {
      this.renderTask = this.pdfPage.render(renderContext);
      await this.renderTask.promise;
    } catch (err) {
      if (err.name !== 'RenderingCancelledException') {
        console.error('PDF rendering error:', err);
      }
      return;
    }

    this.container.style.transform = 'none';

    this.canvas.height = viewport.height;
    this.canvas.width = viewport.width;
    const ctx = this.canvas.getContext('2d', { alpha: false });
    ctx.drawImage(this.offscreenCanvas, 0, 0);

    // Enforce centering restrictions: when width/height <= displayer bounds, document MUST be centered
    const isHorizOverflow = viewport.width > this.previewArea.clientWidth;
    if (isHorizOverflow) {
      this.previewArea.classList.add('overflowing-x');
    } else {
      this.previewArea.classList.remove('overflowing-x');
      this.previewArea.scrollLeft = 0;
    }

    const isVertOverflow = (viewport.height + 20) > this.previewArea.clientHeight;
    if (isVertOverflow) {
      this.previewArea.classList.add('overflowing-y');
      this.container.style.marginTop = '8px';
      this.container.style.marginBottom = '8px';
    } else {
      this.previewArea.classList.remove('overflowing-y');
      this.previewArea.scrollTop = 0;
      // Calculate true symmetric vertical centering when zoomed out below/at Fit Page
      const clientH = this.previewArea.clientHeight;
      const freeH = clientH - (viewport.height + 2); // 2px for container border
      const vertMargin = Math.max(8, Math.floor(freeH / 2));
      this.container.style.marginTop = `${vertMargin}px`;
      this.container.style.marginBottom = `${vertMargin}px`;
    }

    if (this.isVisualZooming) {
      if (isHorizOverflow) {
        const targetScrollLeft = (this.focalPoint.docX * this.currentScale) - this.focalPoint.screenX;
        const maxScrollLeft = Math.max(0, this.previewArea.scrollWidth - this.previewArea.clientWidth);
        this.previewArea.scrollLeft = Math.max(0, Math.min(targetScrollLeft, maxScrollLeft));
      } else {
        this.previewArea.scrollLeft = 0;
      }

      if (isVertOverflow) {
        const targetScrollTop = (this.focalPoint.docY * this.currentScale) - this.focalPoint.screenY;
        const maxScrollTop = Math.max(0, this.previewArea.scrollHeight - this.previewArea.clientHeight);
        this.previewArea.scrollTop = Math.max(0, Math.min(targetScrollTop, maxScrollTop));
      } else {
        this.previewArea.scrollTop = 0;
      }

      this.isVisualZooming = false;
    }

    this.lastRenderedScale = this.currentScale;

    if (this.onScaleChanged) {
      this.onScaleChanged(this.currentScale);
    }
  }

  zoomFromCenter(newScale) {
    const targetScale = Math.max(this.getMinScale(), Math.min(newScale, this.getMaxScale()));
    if (Math.abs(targetScale - this.currentScale) < 0.005) {
      return; // Scale did not change, DO NOT initiate zoom or shift anything
    }

    const rect = this.previewArea.getBoundingClientRect();
    this.initiateZoom(rect.width / 2, rect.height / 2);

    this.currentScale = targetScale;

    if (this.zoomInput) {
      this.zoomInput.value = Math.round(this.currentScale * 100);
    }
    this.applyVisualScale();
    return this.renderPDFPage();
  }

  async loadPage(pageNum) {
    if (!this.pdfDoc) return;
    if (pageNum < 1) pageNum = 1;
    if (pageNum > this.pdfDoc.numPages) pageNum = this.pdfDoc.numPages;

    this.currentPageNum = pageNum;
    if (this.pageInput) {
      this.pageInput.value = this.currentPageNum;
    }
    if (this.scrubber) {
      this.scrubber.update(this.currentPageNum);
    }

    if (this.isLoadingPage) {
      this.pendingPageNum = pageNum;
      return;
    }

    this.isLoadingPage = true;
    try {
      while (pageNum !== null) {
        const pageToLoad = pageNum;
        this.pendingPageNum = null;

        this.pdfPage = await this.pdfDoc.getPage(pageToLoad);
        const textContent = await this.pdfPage.getTextContent();

        if (!this.userHasManuallyZoomed) {
          this.currentScale = this.calculateFitScale(this.pdfPage);
          if (this.zoomInput) {
            this.zoomInput.value = Math.round(this.currentScale * 100);
          }
        }

        await this.renderPDFPage();

        if (this.onPageLoaded) {
          this.onPageLoaded(this.pdfPage, textContent);
        }

        pageNum = this.pendingPageNum;
      }
    } catch (err) {
      console.error('Error loading PDF page:', err);
    } finally {
      this.isLoadingPage = false;
    }
  }

  async loadDocument(path) {
    if (this.pdfDoc) {
      try {
        await this.pdfDoc.destroy();
      } catch (e) {}
      this.pdfDoc = null;
      this.pdfPage = null;
    }

    let loadingTask = null;

    // 1. Primary: On-demand HTTP range streaming via Wails AssetServer
    // Allows 200MB+ / 6,000+ page documents to load instantly by only requesting needed byte chunks
    try {
      const streamUrl = `/api/pdf?path=${encodeURIComponent(path)}`;
      const probe = await fetch(streamUrl, {
        method: 'HEAD',
        headers: { Range: 'bytes=0-0' }
      });
      const contentType = (probe.headers.get('content-type') || '').toLowerCase();
      const acceptRanges = (probe.headers.get('accept-ranges') || '').toLowerCase();

      // Only attempt HTTP streaming if the response is genuinely a PDF or byte stream.
      // Vite dev server returns text/html (200 OK) for unmatched routes, which is NOT a valid PDF!
      const isPdfStream = (probe.status === 206 || probe.ok) &&
        !contentType.includes('text/html') &&
        (contentType.includes('application/pdf') || contentType.includes('application/octet-stream') || acceptRanges === 'bytes');

      if (isPdfStream) {
        const streamTask = pdfjsLib.getDocument({
          url: streamUrl,
          disableAutoFetch: true,
          disableStream: false,
          rangeChunkSize: 65536
        });
        this.pdfDoc = await streamTask.promise;
      } else {
        console.warn(`Streaming endpoint returned non-PDF content (${contentType || 'empty'}), falling back to direct IPC read.`);
      }
    } catch (streamErr) {
      console.warn('Streaming endpoint unavailable or failed, falling back to direct IPC read:', streamErr);
    }

    // 2. Fallback: Direct IPC memory transfer if streaming route is unavailable or failed
    if (!this.pdfDoc) {
      const rawData = await ReadPDFFile(path);
      let pdfData;
      if (typeof rawData === 'string') {
        const binaryString = atob(rawData);
        const len = binaryString.length;
        pdfData = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          pdfData[i] = binaryString.charCodeAt(i);
        }
      } else if (rawData instanceof Uint8Array) {
        pdfData = rawData;
      } else if (Array.isArray(rawData)) {
        pdfData = new Uint8Array(rawData);
      } else {
        throw new Error('Unsupported PDF data format returned from backend');
      }

      const directTask = pdfjsLib.getDocument({
        data: pdfData,
        disableAutoFetch: true
      });
      this.pdfDoc = await directTask.promise;
    }
    if (this.pageCountEl) {
      this.pageCountEl.textContent = String(this.pdfDoc.numPages);
    }

    this.userHasManuallyZoomed = false;

    // Window size adjustment if needed
    if (window.runtime) {
      if (window.runtime.WindowSetMinSize) {
        window.runtime.WindowSetMinSize(950, 600);
      }
      try {
        let isMax = false;
        let isFs = false;
        if (window.runtime.WindowIsMaximised) isMax = await window.runtime.WindowIsMaximised();
        if (window.runtime.WindowIsFullscreen) isFs = await window.runtime.WindowIsFullscreen();
        const hasEnoughSpace = isMax || isFs || (window.innerWidth >= 1000 && window.innerHeight >= 650);
        if (!hasEnoughSpace && window.runtime.WindowSetSize) {
          window.runtime.WindowSetSize(1100, 720);
        }
      } catch (err) {
        console.warn('Window size adjustment check error:', err);
      }
    }

    this.placeholderEl.style.display = 'none';
    this.toolbarEl.style.display = 'flex';
    if (this.displayWrapperEl) {
      this.displayWrapperEl.style.display = 'flex';
    }
    this.previewArea.style.display = 'block';

    if (this.scrubber && this.pdfDoc) {
      this.scrubber.setDocInfo(this.pdfDoc.numPages, 1);
    }

    await this.loadPage(1);
    return this.pdfDoc;
  }

  async unloadDocument() {
    if (this.pdfDoc) {
      try {
        await this.pdfDoc.destroy();
      } catch (e) {}
      this.pdfDoc = null;
      this.pdfPage = null;
    }

    this.currentPageNum = 1;
    if (this.pageInput) this.pageInput.value = 1;
    if (this.pageCountEl) this.pageCountEl.textContent = '1';

    if (this.canvas) {
      const ctx = this.canvas.getContext('2d');
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    this.placeholderEl.style.display = 'flex';
    this.toolbarEl.style.display = 'none';
    if (this.displayWrapperEl) {
      this.displayWrapperEl.style.display = 'none';
    }
    this.previewArea.style.display = 'none';

    if (this.scrubber) {
      this.scrubber.hide();
    }
  }

  initPanning() {
    this.previewArea.addEventListener('mousedown', (e) => {
      const cropBoxEl = document.getElementById('crop-box');
      if (cropBoxEl && (e.target === cropBoxEl || cropBoxEl.contains(e.target))) return;
      if (e.target.closest('#pdf-page-scrubber') || e.target.closest('.pdf-page-scrubber')) return;
      if (e.button !== 0) return;

      this.isDragging = true;
      this.previewArea.classList.add('grabbing');
      this.startX = e.pageX - this.previewArea.offsetLeft;
      this.startY = e.pageY - this.previewArea.offsetTop;
      this.scrollLeft = this.previewArea.scrollLeft;
      this.scrollTop = this.previewArea.scrollTop;
    });

    const stopDragging = () => {
      this.isDragging = false;
      this.previewArea.classList.remove('grabbing');
      if (this.rafPanningId) {
        cancelAnimationFrame(this.rafPanningId);
        this.rafPanningId = null;
      }
    };

    this.previewArea.addEventListener('mouseleave', stopDragging);
    this.previewArea.addEventListener('mouseup', stopDragging);
    if (typeof window !== 'undefined') {
      window.addEventListener('mouseup', stopDragging);
    }

    this.previewArea.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      e.preventDefault();
      const x = e.pageX - this.previewArea.offsetLeft;
      const y = e.pageY - this.previewArea.offsetTop;

      // Restrict horizontal panning if document is not overflowing horizontally
      const canScrollX = this.canvas && (this.canvas.width > this.previewArea.clientWidth);
      if (canScrollX) {
        this.targetScrollLeft = this.scrollLeft - (x - this.startX) * 1.5;
      } else {
        this.targetScrollLeft = 0;
      }

      // Restrict vertical panning if document is not overflowing vertically
      const canScrollY = this.canvas && ((this.canvas.height + 20) > this.previewArea.clientHeight);
      if (canScrollY) {
        this.targetScrollTop = this.scrollTop - (y - this.startY) * 1.5;
      } else {
        this.targetScrollTop = 0;
      }

      if (!this.rafPanningId) {
        this.rafPanningId = requestAnimationFrame(() => {
          this.previewArea.scrollLeft = this.targetScrollLeft;
          this.previewArea.scrollTop = this.targetScrollTop;
          this.rafPanningId = null;
        });
      }
    });
  }

  initWheelZoomAndScroll() {
    this.previewArea.addEventListener('wheel', (e) => {
      // Ctrl + Wheel: Zoom in / out with Adobe Acrobat-style Fit Page snap
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.userHasManuallyZoomed = true;

        const rect = this.previewArea.getBoundingClientRect();
        this.initiateZoom(e.clientX - rect.left, e.clientY - rect.top);

        const fitScale = this.calculateFitScale(this.pdfPage);
        const STEP = 0.10;
        const isZoomIn = e.deltaY < 0;

        let newScale;
        if (isZoomIn) {
          // If strictly below fitScale and normal step would reach or cross it, snap to fitScale first
          if (this.currentScale < (fitScale - 0.005) && (this.currentScale + STEP) >= (fitScale - 0.005)) {
            newScale = fitScale;
          } else {
            newScale = this.currentScale + STEP;
          }
        } else {
          // If strictly above fitScale and normal step would reach or cross it, snap to fitScale first
          if (this.currentScale > (fitScale + 0.005) && (this.currentScale - STEP) <= (fitScale + 0.005)) {
            newScale = fitScale;
          } else {
            newScale = this.currentScale - STEP;
          }
        }

        this.currentScale = Math.max(this.getMinScale(), Math.min(newScale, this.getMaxScale()));

        if (this.zoomInput) {
          this.zoomInput.value = Math.round(this.currentScale * 100);
        }
        this.applyVisualScale();

        if (this.zoomTimeout) clearTimeout(this.zoomTimeout);
        this.zoomTimeout = setTimeout(async () => {
          this.zoomTimeout = null;
          await this.renderPDFPage();
        }, 100);
        return;
      }

      // Normal wheel: Page flicking when full page is visible
      const fitScale = this.calculateFitScale(this.pdfPage);
      const isWholePageVisible = this.currentScale <= fitScale + 0.01;

      if (isWholePageVisible) {
        e.preventDefault();

        let normDeltaY = e.deltaY;
        if (e.deltaMode === 1) normDeltaY *= 30;
        else if (e.deltaMode === 2) normDeltaY *= 100;

        this.wheelAccumulator += normDeltaY;

        if (this.wheelAccumulatorTimer) clearTimeout(this.wheelAccumulatorTimer);
        this.wheelAccumulatorTimer = setTimeout(() => {
          this.wheelAccumulator = 0;
        }, 150);

        const TICK_THRESHOLD = 50;
        if (this.wheelAccumulator >= TICK_THRESHOLD) {
          this.wheelAccumulator = 0;
          if (this.pdfDoc && this.currentPageNum < this.pdfDoc.numPages) {
            this.loadPage(this.currentPageNum + 1);
          }
        } else if (this.wheelAccumulator <= -TICK_THRESHOLD) {
          this.wheelAccumulator = 0;
          if (this.currentPageNum > 1) {
            this.loadPage(this.currentPageNum - 1);
          }
        }
      }
    }, { passive: false });
  }

  initResizeObserver() {
    let resizeDebounceTimer = null;
    const observer = new ResizeObserver(() => {
      if (!this.pdfPage) return;
      if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);

      resizeDebounceTimer = setTimeout(async () => {
        if (!this.pdfPage) return;
        if (!this.userHasManuallyZoomed) {
          const fitScale = this.calculateFitScale(this.pdfPage);
          if (Math.abs(fitScale - this.currentScale) > 0.01) {
            this.currentScale = fitScale;
            if (this.zoomInput) {
              this.zoomInput.value = Math.round(this.currentScale * 100);
            }
            await this.renderPDFPage();
            return;
          }
        }

        // When manually zoomed, ensure centering is maintained if resizing window eliminates overflow
        if (this.canvas) {
          const isHorizOverflow = this.canvas.width > this.previewArea.clientWidth;
          if (isHorizOverflow) {
            this.previewArea.classList.add('overflowing-x');
          } else {
            this.previewArea.classList.remove('overflowing-x');
            this.previewArea.scrollLeft = 0;
          }

          const isVertOverflow = (this.canvas.height + 20) > this.previewArea.clientHeight;
          if (isVertOverflow) {
            this.previewArea.classList.add('overflowing-y');
            this.container.style.marginTop = '8px';
            this.container.style.marginBottom = '8px';
          } else {
            this.previewArea.classList.remove('overflowing-y');
            this.previewArea.scrollTop = 0;
            const clientH = this.previewArea.clientHeight;
            const freeH = clientH - (this.canvas.height + 2);
            const vertMargin = Math.max(8, Math.floor(freeH / 2));
            this.container.style.marginTop = `${vertMargin}px`;
            this.container.style.marginBottom = `${vertMargin}px`;
          }
        }
      }, 50);
    });

    observer.observe(this.previewArea);
  }

  initToolbarControls() {
    const btnZoomIn = document.getElementById('btn-zoom-in');
    const btnZoomOut = document.getElementById('btn-zoom-out');
    const btnFitPage = document.getElementById('btn-fit-page');
    const btnPrevPage = document.getElementById('btn-prev-page');
    const btnNextPage = document.getElementById('btn-next-page');
    const btnFullscreen = document.getElementById('btn-fullscreen');

    if (btnZoomIn) {
      btnZoomIn.addEventListener('click', async () => {
        const nextScale = this.getNextZoomInScale();
        if (Math.abs(nextScale - this.currentScale) < 0.005) return;
        this.userHasManuallyZoomed = true;
        await this.zoomFromCenter(nextScale);
      });
    }

    if (btnZoomOut) {
      btnZoomOut.addEventListener('click', async () => {
        const nextScale = this.getNextZoomOutScale();
        if (Math.abs(nextScale - this.currentScale) < 0.005) return;
        this.userHasManuallyZoomed = true;
        await this.zoomFromCenter(nextScale);
      });
    }

    if (this.zoomInput) {
      this.zoomInput.addEventListener('change', async () => {
        this.userHasManuallyZoomed = true;
        let zoomVal = parseFloat(this.zoomInput.value);
        if (isNaN(zoomVal) || zoomVal <= 0) zoomVal = 100;
        await this.zoomFromCenter(zoomVal / 100.0);
      });
    }

    if (btnFitPage) {
      btnFitPage.addEventListener('click', async () => {
        if (!this.pdfPage) return;
        this.userHasManuallyZoomed = false;
        this.currentScale = this.calculateFitScale(this.pdfPage);
        if (this.zoomInput) {
          this.zoomInput.value = Math.round(this.currentScale * 100);
        }
        await this.renderPDFPage();
      });
    }

    if (btnPrevPage) {
      btnPrevPage.addEventListener('click', async () => {
        if (this.currentPageNum > 1) {
          await this.loadPage(this.currentPageNum - 1);
        }
      });
    }

    if (btnNextPage) {
      btnNextPage.addEventListener('click', async () => {
        if (this.pdfDoc && this.currentPageNum < this.pdfDoc.numPages) {
          await this.loadPage(this.currentPageNum + 1);
        }
      });
    }

    if (this.pageInput) {
      this.pageInput.addEventListener('change', async () => {
        let pageNum = parseInt(this.pageInput.value, 10);
        if (isNaN(pageNum)) pageNum = this.currentPageNum;
        await this.loadPage(pageNum);
      });
    }

    if (btnFullscreen) {
      const iconExpand = document.getElementById('fullscreen-icon-expand');
      const iconCompress = document.getElementById('fullscreen-icon-compress');

      const updateFullscreenIcon = async () => {
        let isFs = false;
        if (window.runtime && window.runtime.WindowIsFullscreen) {
          try {
            isFs = await window.runtime.WindowIsFullscreen();
          } catch (e) {}
        } else if (document.fullscreenElement) {
          isFs = true;
        }
        if (iconExpand && iconCompress) {
          iconExpand.style.display = isFs ? 'none' : 'block';
          iconCompress.style.display = isFs ? 'block' : 'none';
        }
      };

      btnFullscreen.addEventListener('click', async () => {
        if (window.runtime && window.runtime.WindowFullscreen && window.runtime.WindowUnfullscreen) {
          try {
            let isFs = false;
            if (window.runtime.WindowIsFullscreen) {
              isFs = await window.runtime.WindowIsFullscreen();
            }
            if (isFs) {
              window.runtime.WindowUnfullscreen();
            } else {
              window.runtime.WindowFullscreen();
            }
            setTimeout(updateFullscreenIcon, 150);
            return;
          } catch (e) {
            console.warn('Wails fullscreen toggle failed:', e);
          }
        }

        if (window.runtime && window.runtime.WindowToggleMaximise) {
          window.runtime.WindowToggleMaximise();
        } else if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
        setTimeout(updateFullscreenIcon, 150);
      });

      document.addEventListener('fullscreenchange', updateFullscreenIcon);
    }
  }
}

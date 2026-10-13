/**
 * PDF Text Extractor - Main Application Controller
 * Orchestrates modular components: PDF viewer, interactive crop box, preset manager,
 * dialogs, and text extraction engine.
 */

import './style.css';
import { SelectPDF, SelectFolder, GenerateExcel } from '../wailsjs/go/main/App';
import {
  showConfirmDialog,
  showPromptDialog,
  showErrorDialog,
  showLoadingModal,
  hideLoadingModal,
  showExtractProgressModal,
  initAboutModal,
  setDialogDismissCallback,
  getAppVersion
} from './modules/dialogs.js';
import { renderPresetOptions, savePreset, deletePreset, loadPresets } from './modules/presets.js';
import { parsePageRange, extractTextFromPDF, extractTextFromPage } from './modules/extractor.js';
import { CropBoxController, DEFAULT_COORDS } from './modules/cropBox.js';
import { PDFViewer } from './modules/pdfViewer.js';
import { ContextMenuManager } from './modules/contextMenu.js';

// DOM Element References
const appLayoutEl = document.querySelector('.app-layout');
const pdfPlaceholder = document.getElementById('pdf-placeholder');
const pdfToolbar = document.getElementById('pdf-toolbar');
const pdfPreviewArea = document.getElementById('pdf-preview-area');
const pdfCanvas = document.getElementById('pdf-canvas');
const canvasContainer = document.getElementById('canvas-container');
const livePreviewBox = document.getElementById('live-preview-box');
const previewPageNumSpan = document.getElementById('preview-page-num');

const btnSelectPdf = document.getElementById('btn-select-pdf');
const btnUnloadPdf = document.getElementById('btn-unload-pdf');
const btnToolbarUnload = document.getElementById('btn-toolbar-unload');
const btnSelectFolder = document.getElementById('btn-select-folder');
const btnExtract = document.getElementById('btn-extract');
const btnResetCoords = document.getElementById('btn-reset-coords');
const btnSavePreset = document.getElementById('btn-save-preset');
const btnDeletePreset = document.getElementById('btn-delete-preset');
const presetSelector = document.getElementById('preset-selector');

const zoomInput = document.getElementById('zoom-input');
const pageInput = document.getElementById('page-input');
const pageCountSpan = document.getElementById('page-count');

const pdfPathInput = document.getElementById('pdf-path');
const pageRangeInput = document.getElementById('page-range');
const btnAllPages = document.getElementById('btn-all-pages');
const excelFilenameInput = document.getElementById('excel-filename');
const outputFormatSelect = document.getElementById('output-format');
const excelFolderInput = document.getElementById('excel-folder');
const resultBox = document.getElementById('result-box');

const cropBoxEl = document.getElementById('crop-box');
const inputLeft = document.getElementById('crop-left');
const inputTop = document.getElementById('crop-top');
const inputRight = document.getElementById('crop-right');
const inputBottom = document.getElementById('crop-bottom');

let currentPageTextContent = null;

// Helpers
function getPdfBaseName(fullPath) {
  if (!fullPath) return '';
  const filename = fullPath.split(/[/\\]/).pop();
  return filename.replace(/\.[^/.]+$/, '');
}

function updateFilenamePlaceholder(pdfPath) {
  const baseName = getPdfBaseName(pdfPath);
  if (baseName) {
    excelFilenameInput.placeholder = `extracted_pdf_${baseName}`;
  } else {
    excelFilenameInput.placeholder = 'extracted_pdf_filename';
  }
}

function showResult(message, isSuccess) {
  resultBox.textContent = message;
  resultBox.className = `result ${isSuccess ? 'success' : 'error'}`;
}

// Live Preview Update
function updateLivePreview() {
  if (!livePreviewBox) return;

  if (previewPageNumSpan) {
    previewPageNumSpan.textContent = String(viewer.currentPageNum);
  }

  if (!viewer.pdfPage || !currentPageTextContent) {
    livePreviewBox.textContent = '(No text detected in selected crop area)';
    livePreviewBox.className = 'live-preview-box selectable-text empty';
    return;
  }

  const coords = cropBox.getCoordinates();
  const text = extractTextFromPage(viewer.pdfPage, currentPageTextContent, coords);

  if (text) {
    livePreviewBox.textContent = text;
    livePreviewBox.className = 'live-preview-box selectable-text';
  } else {
    livePreviewBox.textContent = '(No text detected in selected crop area)';
    livePreviewBox.className = 'live-preview-box selectable-text empty';
  }
}

// Interactive Crop Box Initialization
const cropBox = new CropBoxController({
  cropBoxEl,
  inputLeft,
  inputTop,
  inputRight,
  inputBottom,
  onCoordinatesChanged: () => {
    updateLivePreview();
  }
});

// PDF Viewer Initialization
const viewer = new PDFViewer({
  previewArea: pdfPreviewArea,
  canvas: pdfCanvas,
  container: canvasContainer,
  zoomInput,
  pageInput,
  pageCountEl: pageCountSpan,
  placeholderEl: pdfPlaceholder,
  toolbarEl: pdfToolbar,
  displayWrapperEl: document.getElementById('pdf-display-wrapper'),
  scrubberContainerEl: document.getElementById('pdf-page-scrubber'),
  scrubberTrackEl: document.getElementById('scrubber-track'),
  scrubberThumbEl: document.getElementById('scrubber-thumb'),
  scrubberBadgeEl: document.getElementById('scrubber-badge'),
  onPageLoaded: (page, textContent) => {
    currentPageTextContent = textContent;
    updateLivePreview();
  },
  onScaleChanged: (scale) => {
    cropBox.setScale(scale);
    cropBox.updateVisualBox();
  }
});

// Desktop Context Menu Manager
const contextMenu = new ContextMenuManager({
  getViewer: () => viewer,
  getCropBox: () => cropBox,
  onResetCoords: () => btnResetCoords.click(),
  onSavePreset: () => btnSavePreset.click(),
  onDeletePreset: () => btnDeletePreset.click(),
  onUnloadPDF: () => unloadPDF()
});

setDialogDismissCallback(() => contextMenu.hide());
initAboutModal();

// Sidebar Position Toggle (Left / Right)
const SIDEBAR_POS_KEY = 'pdf_extractor_sidebar_pos';
const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');

const ICON_SIDEBAR_LEFT = `
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="9 18 15 12 9 6"></polyline>
  </svg>
`;

const ICON_SIDEBAR_RIGHT = `
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="15 18 9 12 15 6"></polyline>
  </svg>
`;

function setSidebarPosition(pos, save = true) {
  const isRight = pos === 'right';
  appLayoutEl.classList.toggle('sidebar-right', isRight);

  if (btnToggleSidebar) {
    btnToggleSidebar.innerHTML = isRight ? ICON_SIDEBAR_RIGHT : ICON_SIDEBAR_LEFT;
    const title = isRight ? 'Move Menu to Left' : 'Move Menu to Right';
    btnToggleSidebar.title = title;
    btnToggleSidebar.setAttribute('aria-label', title);
  }

  if (save) {
    try {
      localStorage.setItem(SIDEBAR_POS_KEY, isRight ? 'right' : 'left');
    } catch (e) {}
  }
}

function initSidebarPosition() {
  let saved = 'left';
  try {
    saved = localStorage.getItem(SIDEBAR_POS_KEY) || 'left';
  } catch (e) {}
  setSidebarPosition(saved, false);
}

if (btnToggleSidebar) {
  btnToggleSidebar.addEventListener('click', () => {
    const isCurrentlyRight = appLayoutEl.classList.contains('sidebar-right');
    setSidebarPosition(isCurrentlyRight ? 'left' : 'right', true);
  });
}
initSidebarPosition();

// Presets Wiring
renderPresetOptions(presetSelector);

btnResetCoords.addEventListener('click', () => {
  cropBox.reset(viewer.pdfPage);
  if (presetSelector) presetSelector.value = '';
});

btnSavePreset.addEventListener('click', async () => {
  const name = await showPromptDialog({
    title: 'Save Preset',
    message: 'Enter a name for this preset:',
    placeholder: 'Preset name',
    confirmText: 'Save',
    cancelText: 'Cancel'
  });

  if (!name || name.trim() === '') return;
  const cleanName = name.trim();
  savePreset(cleanName, cropBox.getCoordinates());
  renderPresetOptions(presetSelector);
  presetSelector.value = cleanName;
  showResult(`Preset "${cleanName}" saved!`, true);
});

btnDeletePreset.addEventListener('click', async () => {
  const selected = presetSelector.value;
  if (!selected) return;

  const confirmed = await showConfirmDialog({
    title: 'Delete Preset',
    message: `Are you sure you want to delete preset "${selected}"?`,
    confirmText: 'Delete',
    cancelText: 'Cancel',
    isDanger: true
  });

  if (confirmed) {
    deletePreset(selected);
    renderPresetOptions(presetSelector);
    showResult(`Preset "${selected}" deleted.`, true);
  }
});

presetSelector.addEventListener('change', () => {
  const selected = presetSelector.value;
  if (!selected) return;
  const presets = loadPresets();
  const preset = presets[selected];
  if (preset) {
    cropBox.setCoordinates(preset);
  }
});

// Clear preset selection dropdown whenever user edits coordinates manually
[inputLeft, inputTop, inputRight, inputBottom].forEach(input => {
  if (input) {
    input.addEventListener('input', () => {
      if (presetSelector) presetSelector.value = '';
    });
  }
});

// Page Range "All" Button
if (btnAllPages) {
  btnAllPages.addEventListener('click', () => {
    if (viewer.pdfDoc && viewer.pdfDoc.numPages > 0) {
      pageRangeInput.value = viewer.pdfDoc.numPages === 1 ? '1' : `1-${viewer.pdfDoc.numPages}`;
      pageRangeInput.focus();
    }
  });
}

// Unload PDF Workflow
async function unloadPDF() {
  if (!viewer.pdfDoc && !pdfPathInput.value) return;

  const confirmed = await showConfirmDialog({
    title: 'Unload PDF',
    message: 'Are you sure you want to unload the current PDF?',
    confirmText: 'Unload',
    cancelText: 'Cancel',
    isDanger: true
  });
  if (!confirmed) return;

  await viewer.unloadDocument();
  currentPageTextContent = null;

  pdfPathInput.value = '';
  excelFilenameInput.value = '';
  updateFilenamePlaceholder('');
  if (pageRangeInput) {
    pageRangeInput.value = '';
    pageRangeInput.placeholder = 'All pages (e.g. 5-10, 12)';
  }
  if (presetSelector) presetSelector.value = '';

  cropBox.setCoordinates(DEFAULT_COORDS);

  if (livePreviewBox) {
    livePreviewBox.textContent = '(No text detected in selected crop area)';
    livePreviewBox.className = 'live-preview-box selectable-text empty';
  }
  resultBox.className = 'result';
  resultBox.textContent = '';

  if (btnUnloadPdf) btnUnloadPdf.style.display = 'none';
  appLayoutEl.classList.add('no-pdf');
}

if (btnUnloadPdf) btnUnloadPdf.addEventListener('click', unloadPDF);
if (btnToolbarUnload) btnToolbarUnload.addEventListener('click', unloadPDF);

// PDF Loading Workflow
async function loadPDFPreview(path) {
  showLoadingModal('Loading PDF Document', 'Connecting and reading document structure...');
  try {
    await viewer.loadDocument(path);
    pdfPathInput.value = path;
    updateFilenamePlaceholder(path);

    if (pageRangeInput && viewer.pdfDoc) {
      pageRangeInput.placeholder = `All pages (1-${viewer.pdfDoc.numPages}) or e.g. 5-10, 12`;
    }

    if (presetSelector) presetSelector.value = '';
    cropBox.setScale(viewer.currentScale);
    cropBox.reset(viewer.pdfPage);
    cropBox.setVisibility(true);

    if (btnUnloadPdf) btnUnloadPdf.style.display = 'inline-flex';
    appLayoutEl.classList.remove('no-pdf');
    showResult(`Successfully loaded ${viewer.pdfDoc.numPages} page${viewer.pdfDoc.numPages === 1 ? '' : 's'}.`, true);
  } catch (err) {
    console.error('Error loading PDF preview:', err);
    await showErrorDialog({
      title: 'Failed to Open PDF',
      message: `Could not load the selected PDF file:\n\n${err.message || err}\n\nPlease verify that the file exists, is not corrupted or password-protected, and is accessible.`
    });
    showResult(`Error loading PDF preview: ${err.message || err}`, false);
  } finally {
    hideLoadingModal();
  }
}

async function handlePDFDrop(path) {
  if (viewer.pdfDoc !== null) {
    const confirmed = await showConfirmDialog({
      title: 'Open New PDF',
      message: 'A PDF is already loaded. Do you want to load the new one and discard current progress?',
      confirmText: 'Open',
      cancelText: 'Cancel'
    });
    if (!confirmed) return;
  }
  await loadPDFPreview(path);
}

// File Selection Listeners
btnSelectPdf.addEventListener('click', async () => {
  try {
    const path = await SelectPDF();
    if (path) {
      await handlePDFDrop(path);
    }
  } catch (err) {
    await showErrorDialog({
      title: 'File Selection Error',
      message: `Failed to select PDF file:\n\n${err.message || err}`
    });
    showResult(`Error selecting PDF: ${err}`, false);
  }
});

btnSelectFolder.addEventListener('click', async () => {
  try {
    const path = await SelectFolder();
    if (path) {
      excelFolderInput.value = path;
    }
  } catch (err) {
    await showErrorDialog({
      title: 'Folder Selection Error',
      message: `Failed to select destination folder:\n\n${err.message || err}`
    });
    showResult(`Error selecting destination folder: ${err}`, false);
  }
});

// Drag and Drop Handlers
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  appLayoutEl.classList.add('dragover');
});

document.addEventListener('dragleave', (e) => {
  e.preventDefault();
  appLayoutEl.classList.remove('dragover');
});

document.addEventListener('drop', async (e) => {
  e.preventDefault();
  appLayoutEl.classList.remove('dragover');
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    const file = e.dataTransfer.files[0];
    if (file.path && file.path.toLowerCase().endsWith('.pdf')) {
      await handlePDFDrop(file.path);
    }
  }
});

if (window.runtime && window.runtime.OnFileDrop) {
  window.runtime.OnFileDrop(async (x, y, paths) => {
    appLayoutEl.classList.remove('dragover');
    if (paths && paths.length > 0) {
      const path = paths[0];
      if (path.toLowerCase().endsWith('.pdf')) {
        await handlePDFDrop(path);
      }
    }
  }, false);
}

// Text Extraction Workflow
btnExtract.addEventListener('click', async () => {
  try {
    const pdfPath = pdfPathInput.value;
    const folderPath = excelFolderInput.value;
    const format = (outputFormatSelect && outputFormatSelect.value) ? outputFormatSelect.value : '.xlsx';

    if (!pdfPath) {
      await showErrorDialog({
        title: 'Missing PDF File',
        message: 'Please select an input PDF file before starting text extraction.'
      });
      showResult('Please select an input PDF file first.', false);
      return;
    }

    if (!viewer.pdfDoc) {
      await showErrorDialog({
        title: 'PDF Not Loaded',
        message: 'The PDF is still loading or has not been loaded. Please open a valid PDF file first.'
      });
      showResult('PDF is still loading or not selected.', false);
      return;
    }

    let filename = excelFilenameInput.value.trim();
    if (!filename) {
      const pdfBaseName = getPdfBaseName(pdfPath);
      filename = pdfBaseName ? `extracted_pdf_${pdfBaseName}` : 'extracted_pdf_output';
    }

    filename = filename.replace(/\.(xlsx|csv)$/i, '');
    const finalFilename = `${filename}${format}`;
    const sep = folderPath.includes('\\') ? '\\' : '/';
    const excelPath = folderPath ? `${folderPath.replace(/[/\\]+$/, '')}${sep}${finalFilename}` : finalFilename;

    let selectedPages = [];
    try {
      selectedPages = parsePageRange(pageRangeInput ? pageRangeInput.value : '', viewer.pdfDoc.numPages);
    } catch (rangeErr) {
      await showErrorDialog({
        title: 'Invalid Page Range',
        message: `The entered page range is invalid:\n\n${rangeErr.message}\n\nPlease enter valid page numbers (e.g. 1-10, 15) or leave empty for all pages.`
      });
      showResult(`Invalid page range: ${rangeErr.message}`, false);
      return;
    }

    const cropCoordinates = cropBox.getCoordinates();

    btnExtract.disabled = true;
    btnExtract.textContent = `Processing (0/${selectedPages.length})...`;
    resultBox.className = 'result';

    const progressModal = showExtractProgressModal({
      totalPages: selectedPages.length
    });

    try {
      const extractedData = await extractTextFromPDF(
        viewer.pdfDoc,
        cropCoordinates,
        selectedPages,
        (current, total) => {
          btnExtract.textContent = `Processing (${current}/${total})...`;
          progressModal.updateProgress(current, total);
        },
        () => progressModal.isCancelled()
      );

      const wasCancelled = progressModal.isCancelled();
      progressModal.close();

      if (extractedData.length === 0) {
        if (wasCancelled) {
          showResult('Extraction cancelled by user.', false);
        } else {
          await showErrorDialog({
            title: 'No Data Extracted',
            message: 'No text could be extracted from the specified pages and crop area.'
          });
        }
        return;
      }

      const appVerInfo = await getAppVersion();
      const metadata = {
        extractionDate: new Date().toLocaleString(),
        pdfPath: pdfPath,
        cropBox: cropCoordinates,
        totalPages: extractedData.length,
        appVersion: appVerInfo.version || ''
      };

      const msg = await GenerateExcel(extractedData, excelPath, metadata);
      if (wasCancelled) {
        showResult(`${msg} (Cancelled early: saved ${extractedData.length} of ${selectedPages.length} pages)`, true);
      } else {
        showResult(msg, true);
      }
    } catch (extractErr) {
      progressModal.close();
      await showErrorDialog({
        title: 'Extraction Error',
        message: `Failed during text extraction or spreadsheet generation:\n\n${extractErr.message || extractErr}`
      });
      showResult(`Extraction failed: ${extractErr.message || extractErr}`, false);
    } finally {
      btnExtract.disabled = false;
      btnExtract.textContent = 'Start Extraction';
    }
  } catch (topLevelErr) {
    console.error('Unhandled extraction error:', topLevelErr);
    await showErrorDialog({
      title: 'Extraction Error',
      message: `An unexpected error occurred:\n\n${topLevelErr.message || topLevelErr}`
    });
    showResult(`Extraction failed: ${topLevelErr.message || topLevelErr}`, false);
    btnExtract.disabled = false;
    btnExtract.textContent = 'Start Extraction';
  }
});

// Auto-select numeric inputs on double-click
document.addEventListener('dblclick', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type === 'number') {
    e.target.select();
  }
});

/**
 * Desktop Modal Dialogs
 * Provides asynchronous custom confirm, prompt, and about dialogs.
 */

import { APP_VERSION, APP_VERSION_DATE } from '../version.js';

let onDismissCallback = null;

export function setDialogDismissCallback(fn) {
  onDismissCallback = fn;
}

/**
 * Display a custom confirmation dialog.
 * @param {Object} options
 * @param {string} [options.title='Confirmation']
 * @param {string} options.message
 * @param {string} [options.confirmText='OK']
 * @param {string} [options.cancelText='Cancel']
 * @param {boolean} [options.isDanger=false]
 * @returns {Promise<boolean>}
 */
export function showConfirmDialog({
  title = 'Confirmation',
  message,
  confirmText = 'OK',
  cancelText = 'Cancel',
  isDanger = false
}) {
  if (onDismissCallback) onDismissCallback();

  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal');
    const titleEl = document.getElementById('confirm-modal-title');
    const bodyEl = document.getElementById('confirm-modal-body');
    const okBtn = document.getElementById('btn-confirm-modal-ok');
    const cancelBtn = document.getElementById('btn-confirm-modal-cancel');
    const closeBtn = document.getElementById('btn-confirm-modal-close');

    if (!modal || !okBtn || !cancelBtn) {
      resolve(false);
      return;
    }

    titleEl.textContent = title;
    bodyEl.textContent = message;
    okBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;
    okBtn.className = isDanger ? 'btn-danger' : '';

    modal.style.display = 'flex';
    okBtn.focus();

    function cleanup(result) {
      modal.style.display = 'none';
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      closeBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onOverlay);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }

    function onOk(e) {
      if (e) e.preventDefault();
      cleanup(true);
    }

    function onCancel(e) {
      if (e) e.preventDefault();
      cleanup(false);
    }

    function onOverlay(e) {
      if (e.target === modal) cleanup(false);
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        cleanup(document.activeElement !== cancelBtn);
      }
    }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    closeBtn.addEventListener('click', onCancel);
    modal.addEventListener('click', onOverlay);
    document.addEventListener('keydown', onKey);
  });
}

/**
 * Display a custom prompt modal dialog.
 * @param {Object} options
 * @param {string} [options.title='Input']
 * @param {string} [options.message='Please enter a value:']
 * @param {string} [options.defaultValue='']
 * @param {string} [options.placeholder='']
 * @param {string} [options.confirmText='Save']
 * @param {string} [options.cancelText='Cancel']
 * @returns {Promise<string|null>}
 */
export function showPromptDialog({
  title = 'Input',
  message = 'Please enter a value:',
  defaultValue = '',
  placeholder = '',
  confirmText = 'Save',
  cancelText = 'Cancel'
}) {
  if (onDismissCallback) onDismissCallback();

  return new Promise((resolve) => {
    const modal = document.getElementById('prompt-modal');
    const titleEl = document.getElementById('prompt-modal-title');
    const labelEl = document.getElementById('prompt-modal-label');
    const inputEl = document.getElementById('prompt-modal-input');
    const okBtn = document.getElementById('btn-prompt-modal-ok');
    const cancelBtn = document.getElementById('btn-prompt-modal-cancel');
    const closeBtn = document.getElementById('btn-prompt-modal-close');

    if (!modal || !okBtn || !cancelBtn || !inputEl) {
      resolve(null);
      return;
    }

    titleEl.textContent = title;
    labelEl.textContent = message;
    inputEl.value = defaultValue;
    inputEl.placeholder = placeholder;
    okBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;

    modal.style.display = 'flex';
    inputEl.focus();
    inputEl.select();

    function cleanup(result) {
      modal.style.display = 'none';
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      closeBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onOverlay);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }

    function onOk(e) {
      if (e) e.preventDefault();
      const val = inputEl.value.trim();
      if (!val) {
        inputEl.focus();
        return;
      }
      cleanup(val);
    }

    function onCancel(e) {
      if (e) e.preventDefault();
      cleanup(null);
    }

    function onOverlay(e) {
      if (e.target === modal) cleanup(null);
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onOk();
      }
    }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    closeBtn.addEventListener('click', onCancel);
    modal.addEventListener('click', onOverlay);
    document.addEventListener('keydown', onKey);
  });
}

/**
 * Asynchronously loads about items from the Go backend (which reads about/about.csv).
 */
export async function refreshAboutModalContent() {
  if (typeof document === 'undefined') return;
  const tableBody = document.getElementById('about-table-body');
  if (!tableBody) return;

  let items = null;
  if (typeof window !== 'undefined' && window.go && window.go.main && window.go.main.App && window.go.main.App.GetAboutInfo) {
    try {
      items = await window.go.main.App.GetAboutInfo();
    } catch (err) {
      console.warn('Failed to load about metadata from backend:', err);
    }
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    items = [
      { key: 'Developer', value: 'Yunus Sorgunçay' },
      { key: 'Version', value: APP_VERSION },
      { key: 'Version Date', value: APP_VERSION_DATE },
      { key: 'Repository', value: 'https://github.com/yunix0420/PDF-Text-Extractor', link: 'https://github.com/yunix0420/PDF-Text-Extractor' },
      { key: 'GitHub Profile', value: 'https://github.com/yunix0420', link: 'https://github.com/yunix0420' },
      { key: 'License', value: 'MIT', link: 'https://opensource.org/licenses/MIT' }
    ];
  }

  tableBody.innerHTML = '';
  items.forEach((item) => {
    if (!item || !item.key) return;
    const tr = document.createElement('tr');

    const tdLabel = document.createElement('td');
    tdLabel.className = 'info-label';
    tdLabel.textContent = `${item.key}:`;

    const tdVal = document.createElement('td');
    tdVal.className = 'info-value';

    const link = (item.link || '').trim();
    const hasValidUrl = /^https?:\/\//i.test(link);

    if (hasValidUrl) {
      const a = document.createElement('a');
      a.href = link;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = item.value || link;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof window !== 'undefined' && window.go && window.go.main && window.go.main.App && window.go.main.App.OpenURL) {
          window.go.main.App.OpenURL(link);
        } else if (typeof window !== 'undefined') {
          window.open(link, '_blank', 'noopener,noreferrer');
        }
      });
      tdVal.appendChild(a);
    } else {
      tdVal.textContent = item.value || '';
    }

    tr.appendChild(tdLabel);
    tr.appendChild(tdVal);
    tableBody.appendChild(tr);
  });
}

/**
 * Cached version info to avoid redundant backend calls.
 */
let cachedVersionInfo = null;

/**
 * Returns the application version and version date { version, versionDate } from the backend,
 * falling back to the canonical APP_VERSION and APP_VERSION_DATE constants.
 * @returns {Promise<{ version: string, versionDate: string }>}
 */
export async function getAppVersion() {
  if (cachedVersionInfo) {
    return cachedVersionInfo;
  }

  if (typeof window !== 'undefined' && window.go && window.go.main && window.go.main.App && window.go.main.App.GetAppVersion) {
    try {
      const info = await window.go.main.App.GetAppVersion();
      if (info && (info.version || info.versionDate)) {
        cachedVersionInfo = {
          version: info.version || APP_VERSION,
          versionDate: info.versionDate || APP_VERSION_DATE
        };
        return cachedVersionInfo;
      }
    } catch (err) {
      console.warn('Failed to get app version from backend:', err);
    }
  }

  cachedVersionInfo = {
    version: APP_VERSION,
    versionDate: APP_VERSION_DATE
  };
  return cachedVersionInfo;
}

/**
 * Initializes About modal handlers.
 */
export function initAboutModal() {
  const modal = document.getElementById('about-modal');
  const btnAbout = document.getElementById('btn-about');
  const btnClose = document.getElementById('btn-close-about');
  const btnOk = document.getElementById('btn-ok-about');

  if (!modal) return;

  const open = () => {
    if (onDismissCallback) onDismissCallback();
    refreshAboutModalContent();
    modal.style.display = 'flex';
  };

  const close = () => {
    modal.style.display = 'none';
  };

  if (btnAbout) btnAbout.addEventListener('click', open);
  if (btnClose) btnClose.addEventListener('click', close);
  if (btnOk) btnOk.addEventListener('click', close);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.style.display === 'flex') {
      close();
    }
  });

  // Pre-load content on initialization
  refreshAboutModalContent();

  return { open, close };
}

/**
 * Display a custom desktop error / alert modal dialog.
 * @param {Object} options
 * @param {string} [options.title='Application Error']
 * @param {string} options.message
 * @returns {Promise<void>}
 */
export function showErrorDialog({ title = 'Application Error', message = '' }) {
  if (onDismissCallback) onDismissCallback();

  return new Promise((resolve) => {
    const modal = document.getElementById('error-modal');
    const titleEl = document.getElementById('error-modal-title');
    const bodyEl = document.getElementById('error-modal-body');
    const okBtn = document.getElementById('btn-error-modal-ok');
    const closeBtn = document.getElementById('btn-error-modal-close');

    if (!modal || !okBtn) {
      alert(`${title}\n\n${message}`);
      resolve();
      return;
    }

    if (titleEl) {
      titleEl.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        ${title}
      `;
    }
    if (bodyEl) bodyEl.textContent = message;

    modal.style.display = 'flex';
    okBtn.focus();

    function cleanup() {
      modal.style.display = 'none';
      okBtn.removeEventListener('click', onOk);
      if (closeBtn) closeBtn.removeEventListener('click', onOk);
      modal.removeEventListener('click', onOverlay);
      document.removeEventListener('keydown', onKey);
      resolve();
    }

    function onOk(e) {
      if (e) e.preventDefault();
      cleanup();
    }

    function onOverlay(e) {
      if (e.target === modal) cleanup();
    }

    function onKey(e) {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        cleanup();
      }
    }

    okBtn.addEventListener('click', onOk);
    if (closeBtn) closeBtn.addEventListener('click', onOk);
    modal.addEventListener('click', onOverlay);
    document.addEventListener('keydown', onKey);
  });
}

/**
 * Displays the modal loading indicator.
 * @param {string} [title='Loading PDF Document...']
 * @param {string} [message='Reading document pages and structure']
 */
export function showLoadingModal(title = 'Loading PDF Document...', message = 'Reading document pages and structure') {
  const modal = document.getElementById('loading-modal');
  const titleEl = document.getElementById('loading-modal-title');
  const msgEl = document.getElementById('loading-modal-message');
  if (!modal) return;
  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;
  modal.style.display = 'flex';
}

/**
 * Hides the modal loading indicator.
 */
export function hideLoadingModal() {
  const modal = document.getElementById('loading-modal');
  if (modal) modal.style.display = 'none';
}

/**
 * Displays an active extraction progress modal with cancellation capability.
 * @param {Object} options
 * @param {number} options.totalPages
 * @returns {{ updateProgress: (current: number, total: number) => void, isCancelled: () => boolean, close: () => void }}
 */
export function showExtractProgressModal({ totalPages = 1 }) {
  const modal = document.getElementById('extract-progress-modal');
  const statusEl = document.getElementById('extract-progress-status');
  const fillEl = document.getElementById('extract-progress-fill');
  const pagesEl = document.getElementById('extract-progress-pages');
  const percentEl = document.getElementById('extract-progress-percent');
  const cancelBtn = document.getElementById('btn-extract-cancel');

  let cancelled = false;

  if (modal) {
    if (fillEl) fillEl.style.width = '0%';
    if (pagesEl) pagesEl.textContent = `Page 0 / ${totalPages}`;
    if (percentEl) percentEl.textContent = '0%';
    if (statusEl) statusEl.textContent = `Processing page 1 of ${totalPages}...`;
    if (cancelBtn) {
      cancelBtn.disabled = false;
      cancelBtn.textContent = 'Cancel';
    }
    modal.style.display = 'flex';
  }

  function onCancelClick() {
    cancelled = true;
    if (statusEl) statusEl.textContent = 'Cancelling extraction...';
    if (cancelBtn) {
      cancelBtn.disabled = true;
      cancelBtn.textContent = 'Cancelling...';
    }
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', onCancelClick);
  }

  return {
    updateProgress(current, total) {
      const pct = Math.round((current / total) * 100);
      if (fillEl) fillEl.style.width = `${pct}%`;
      if (pagesEl) pagesEl.textContent = `Page ${current} / ${total}`;
      if (percentEl) percentEl.textContent = `${pct}%`;
      if (statusEl && !cancelled) statusEl.textContent = `Processing page ${current} of ${total}...`;
    },
    isCancelled() {
      return cancelled;
    },
    close() {
      if (cancelBtn) {
        cancelBtn.removeEventListener('click', onCancelClick);
      }
      if (modal) modal.style.display = 'none';
    }
  };
}


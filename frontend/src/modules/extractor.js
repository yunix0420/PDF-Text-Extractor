/**
 * Text Extraction Engine
 * Provides page range parsing and coordinate-bounded text extraction from PDF pages.
 */

/**
 * Parses user page range input (e.g. "1-5, 8, 11-15") into an ordered array of page numbers.
 * @param {string} inputStr
 * @param {number} totalPages
 * @returns {number[]} Sorted, deduplicated array of 1-indexed page numbers.
 * @throws {Error} If syntax is invalid or page numbers are out of bounds.
 */
export function parsePageRange(inputStr, totalPages) {
  if (!inputStr || typeof inputStr !== 'string') {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const trimmed = inputStr.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'all') {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const parts = trimmed.split(',');
  const pageSet = new Set();

  for (const part of parts) {
    const segment = part.trim();
    if (!segment) continue;

    if (segment.includes('-')) {
      const rangeParts = segment.split('-').map(s => s.trim());
      if (rangeParts.length !== 2 || rangeParts[0] === '' || rangeParts[1] === '') {
        throw new Error(`"${segment}" is not a valid range format (e.g. 5-10)`);
      }

      if (!/^\d+$/.test(rangeParts[0]) || !/^\d+$/.test(rangeParts[1])) {
        throw new Error(`Invalid page number in range "${segment}"`);
      }

      const start = parseInt(rangeParts[0], 10);
      const end = parseInt(rangeParts[1], 10);

      if (start < 1 || start > totalPages) {
        throw new Error(`Page ${start} is out of bounds (document has ${totalPages} pages)`);
      }
      if (end < 1 || end > totalPages) {
        throw new Error(`Page ${end} is out of bounds (document has ${totalPages} pages)`);
      }

      const min = Math.min(start, end);
      const max = Math.max(start, end);
      for (let p = min; p <= max; p++) {
        pageSet.add(p);
      }
    } else {
      if (!/^\d+$/.test(segment)) {
        throw new Error(`Invalid page number "${segment}"`);
      }

      const pageNum = parseInt(segment, 10);
      if (pageNum < 1 || pageNum > totalPages) {
        throw new Error(`Page ${pageNum} is out of bounds (document has ${totalPages} pages)`);
      }

      pageSet.add(pageNum);
    }
  }

  if (pageSet.size === 0) {
    throw new Error('No valid pages found in specified page range');
  }

  return Array.from(pageSet).sort((a, b) => a - b);
}

/**
 * Extracts text items from a single page's textContent within a given crop bounding box.
 * @param {any} pdfPage
 * @param {any} textContent
 * @param {{ left: number, top: number, right: number, bottom: number }} cropBox
 * @returns {string} Extracted text string
 */
export function extractTextFromPage(pdfPage, textContent, cropBox) {
  if (!pdfPage || !textContent || !textContent.items) return '';

  const viewport = pdfPage.getViewport({ scale: 1.0 });
  const pageItems = [];

  for (const item of textContent.items) {
    if (!item.str) continue;

    const x = item.transform[4];
    const y = item.transform[5];

    const [vx, vy] = viewport.convertToViewportPoint(x, y);
    const itemHeight = item.height || Math.abs(item.transform[3]) || 10;
    const textCenterY = vy - (itemHeight / 2);

    if (vx >= cropBox.left && vx <= cropBox.right) {
      if (textCenterY >= cropBox.top && textCenterY <= cropBox.bottom) {
        pageItems.push({ x: vx, str: item.str });
      }
    }
  }

  // Sort horizontally left-to-right
  pageItems.sort((a, b) => a.x - b.x);

  return pageItems.map(item => item.str).join('').trim();
}

/**
 * Extracts coordinate-bounded text across multiple pages in a PDF document.
 * @param {any} doc - PDF.js document object
 * @param {{ left: number, top: number, right: number, bottom: number }} cropBox
 * @param {number[]} pageNumbers - Array of 1-indexed page numbers
 * @param {(current: number, total: number) => void} [onProgress]
 * @param {() => boolean} [shouldCancel]
 * @returns {Promise<Array<{ page: number, number: string }>>}
 */
export function extractTextFromPDF(doc, cropBox, pageNumbers, onProgress, shouldCancel) {
  const totalCount = pageNumbers.length;
  const results = [];

  return (async () => {
    for (let idx = 0; idx < totalCount; idx++) {
      if (shouldCancel && shouldCancel()) {
        break;
      }

      const pageNum = pageNumbers[idx];
      if (onProgress) {
        onProgress(idx + 1, totalCount);
      }

      const page = await doc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const extractedText = extractTextFromPage(page, textContent, cropBox);

      results.push({ page: pageNum, text: extractedText, number: extractedText });
      page.cleanup();

      // Yield execution to maintain UI responsiveness and detect user cancellation
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    return results;
  })();
}

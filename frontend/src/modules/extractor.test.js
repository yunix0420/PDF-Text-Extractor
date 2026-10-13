import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePageRange, extractTextFromPage, extractTextFromPDF } from './extractor.js';

test('parsePageRange: empty or null returns all pages', () => {
  assert.deepEqual(parsePageRange('', 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(parsePageRange('all', 3), [1, 2, 3]);
  assert.deepEqual(parsePageRange(null, 4), [1, 2, 3, 4]);
});

test('parsePageRange: individual numbers and ranges', () => {
  assert.deepEqual(parsePageRange('1, 3, 5', 10), [1, 3, 5]);
  assert.deepEqual(parsePageRange('2-5, 8', 10), [2, 3, 4, 5, 8]);
  assert.deepEqual(parsePageRange('5-2', 10), [2, 3, 4, 5]);
});

test('parsePageRange: deduplication and sorting', () => {
  assert.deepEqual(parsePageRange('4, 2, 2-4, 1', 10), [1, 2, 3, 4]);
});

test('parsePageRange: throws on out of bounds page', () => {
  assert.throws(() => parsePageRange('11', 10), /out of bounds/);
  assert.throws(() => parsePageRange('0', 10), /out of bounds/);
  assert.throws(() => parsePageRange('5-15', 10), /out of bounds/);
});

test('parsePageRange: throws on malformed range', () => {
  assert.throws(() => parsePageRange('abc', 10), /Invalid page number/);
  assert.throws(() => parsePageRange('1-2-3', 10), /not a valid range format/);
});

test('extractTextFromPage: filters text within bounding box and sorts left-to-right', () => {
  const fakePage = {
    getViewport: () => ({
      convertToViewportPoint: (x, y) => [x, y]
    })
  };

  const fakeTextContent = {
    items: [
      { str: 'InsideLeft', transform: [1, 0, 0, 10, 50, 50] },
      { str: 'InsideRight', transform: [1, 0, 0, 10, 70, 50] },
      { str: 'OutsideX', transform: [1, 0, 0, 10, 150, 50] },
      { str: 'OutsideY', transform: [1, 0, 0, 10, 50, 200] },
    ]
  };

  const cropBox = { left: 40, top: 30, right: 100, bottom: 80 };
  const text = extractTextFromPage(fakePage, fakeTextContent, cropBox);
  assert.equal(text, 'InsideLeftInsideRight');
});

test('extractTextFromPDF: extracts text across pages and reports progress', async () => {
  const fakeDoc = {
    getPage: async (pageNum) => ({
      getViewport: () => ({ convertToViewportPoint: (x, y) => [x, y] }),
      getTextContent: async () => ({
        items: [{ str: `PageText${pageNum}`, transform: [1, 0, 0, 10, 50, 50] }]
      }),
      cleanup: () => {}
    })
  };

  const progressUpdates = [];
  const results = await extractTextFromPDF(
    fakeDoc,
    { left: 0, top: 0, right: 200, bottom: 200 },
    [1, 2, 3],
    (curr, total) => progressUpdates.push(`${curr}/${total}`)
  );

  assert.equal(results.length, 3);
  assert.deepEqual(results, [
    { page: 1, text: 'PageText1', number: 'PageText1' },
    { page: 2, text: 'PageText2', number: 'PageText2' },
    { page: 3, text: 'PageText3', number: 'PageText3' }
  ]);
  assert.deepEqual(progressUpdates, ['1/3', '2/3', '3/3']);
});

test('extractTextFromPDF: stops early when shouldCancel returns true', async () => {
  let callCount = 0;
  const fakeDoc = {
    getPage: async (pageNum) => {
      callCount++;
      return {
        getViewport: () => ({ convertToViewportPoint: (x, y) => [x, y] }),
        getTextContent: async () => ({
          items: [{ str: `PageText${pageNum}`, transform: [1, 0, 0, 10, 50, 50] }]
        }),
        cleanup: () => {}
      };
    }
  };

  let cancelNow = false;
  const results = await extractTextFromPDF(
    fakeDoc,
    { left: 0, top: 0, right: 200, bottom: 200 },
    [1, 2, 3, 4, 5],
    (curr) => {
      if (curr === 2) cancelNow = true;
    },
    () => cancelNow
  );

  assert.equal(results.length, 2);
  assert.equal(callCount, 2);
  assert.deepEqual(results, [
    { page: 1, text: 'PageText1', number: 'PageText1' },
    { page: 2, text: 'PageText2', number: 'PageText2' }
  ]);
});


import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCenteredCropBox, CropBoxController, DEFAULT_COORDS } from './cropBox.js';

test('calculateCenteredCropBox: centers crop box symmetrically for portrait A4', () => {
  const viewport = { width: 595, height: 842 };
  const coords = calculateCenteredCropBox(viewport);

  const expectedWidth = Math.round(595 * 0.35); // 208
  const expectedHeight = Math.round(842 * 0.20); // 168
  const expectedLeft = Math.round((595 - expectedWidth) / 2); // 194
  const expectedTop = Math.round((842 - expectedHeight) / 2); // 337

  assert.equal(coords.left, expectedLeft);
  assert.equal(coords.top, expectedTop);
  assert.equal(coords.right, expectedLeft + expectedWidth);
  assert.equal(coords.bottom, expectedTop + expectedHeight);

  // Assert horizontal centering symmetry
  const leftMargin = coords.left;
  const rightMargin = viewport.width - coords.right;
  assert.ok(Math.abs(leftMargin - rightMargin) <= 1, 'Horizontal margins must be symmetrically centered');

  // Assert vertical centering symmetry
  const topMargin = coords.top;
  const bottomMargin = viewport.height - coords.bottom;
  assert.ok(Math.abs(topMargin - bottomMargin) <= 1, 'Vertical margins must be symmetrically centered');
});

test('calculateCenteredCropBox: centers crop box symmetrically for landscape document', () => {
  const viewport = { width: 842, height: 595 };
  const coords = calculateCenteredCropBox(viewport);

  const expectedWidth = Math.round(842 * 0.35); // 295
  const expectedHeight = Math.round(595 * 0.20); // 119
  const expectedLeft = Math.round((842 - expectedWidth) / 2); // 274
  const expectedTop = Math.round((595 - expectedHeight) / 2); // 238

  assert.equal(coords.left, expectedLeft);
  assert.equal(coords.top, expectedTop);
  assert.equal(coords.right, expectedLeft + expectedWidth);
  assert.equal(coords.bottom, expectedTop + expectedHeight);

  const leftMargin = coords.left;
  const rightMargin = viewport.width - coords.right;
  assert.ok(Math.abs(leftMargin - rightMargin) <= 1);
});

test('calculateCenteredCropBox: falls back to DEFAULT_COORDS for null or invalid viewport', () => {
  assert.deepEqual(calculateCenteredCropBox(null), DEFAULT_COORDS);
  assert.deepEqual(calculateCenteredCropBox({}), DEFAULT_COORDS);
  assert.deepEqual(calculateCenteredCropBox({ width: 0, height: 0 }), DEFAULT_COORDS);
});

test('CropBoxController.reset: dynamically positions box using page.getViewport()', () => {
  const inputLeft = { value: '0' };
  const inputTop = { value: '0' };
  const inputRight = { value: '0' };
  const inputBottom = { value: '0' };

  let changed = false;
  const controller = new CropBoxController({
    cropBoxEl: null,
    inputLeft,
    inputTop,
    inputRight,
    inputBottom,
    onCoordinatesChanged: () => { changed = true; }
  });

  const mockPage = {
    getViewport: ({ scale }) => {
      assert.equal(scale, 1.0);
      return { width: 612, height: 792 };
    }
  };

  controller.reset(mockPage);

  const expectedWidth = Math.round(612 * 0.35); // 214
  const expectedHeight = Math.round(792 * 0.20); // 158
  const expectedLeft = Math.round((612 - expectedWidth) / 2); // 199
  const expectedTop = Math.round((792 - expectedHeight) / 2); // 317

  assert.equal(parseInt(inputLeft.value, 10), expectedLeft);
  assert.equal(parseInt(inputTop.value, 10), expectedTop);
  assert.equal(parseInt(inputRight.value, 10), expectedLeft + expectedWidth);
  assert.equal(parseInt(inputBottom.value, 10), expectedTop + expectedHeight);

  const coords = controller.getCoordinates();
  assert.equal(coords.left, expectedLeft);
  assert.equal(coords.top, expectedTop);
  assert.equal(coords.right, expectedLeft + expectedWidth);
  assert.equal(coords.bottom, expectedTop + expectedHeight);
});

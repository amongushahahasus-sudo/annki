import test from 'node:test';
import assert from 'node:assert/strict';
import { maskPixels } from '../src/lib/mask';

function transform(color: number[], sensitivity = 60): number[] {
  const pixel = new Uint8ClampedArray([...color, 255]);
  maskPixels(pixel, sensitivity);
  return [...pixel];
}

test('red answers, dark red, pink, orange and antialiased red blend into paper', () => {
  const paper = transform([255, 255, 255]);
  for (const ink of [[255, 0, 0], [100, 0, 0], [240, 80, 130], [255, 160, 20], [255, 210, 210]]) {
    assert.deepEqual(transform(ink), paper, `${ink} should disappear`);
  }
});

test('black questions and blue ink remain distinct from the paper', () => {
  const paper = transform([255, 255, 255]);
  assert.deepEqual(transform([0, 0, 0]), [0, 0, 0, 255]);
  assert.notDeepEqual(transform([0, 40, 220]), paper);
  assert.ok(transform([0, 40, 220])[2] > 150);
  assert.deepEqual(transform([120, 120, 120]), [120, 105, 104, 255]);
});

test('sensitivity broadens faint red detection while keeping neutral gray', () => {
  const ink = [210, 192, 192];
  const paper = transform([255, 255, 255]);
  assert.notDeepEqual(transform(ink, 0), paper);
  assert.deepEqual(transform(ink, 100), paper);
  assert.notDeepEqual(transform([192, 192, 192], 100), paper);
});

test('alpha is preserved and sensitivity is bounded', () => {
  const pixel = new Uint8ClampedArray([255, 0, 0, 128]);
  maskPixels(pixel, 999);
  assert.deepEqual([...pixel], [255, 224, 221, 128]);
  assert.deepEqual(transform([255, 210, 210], -999), transform([255, 210, 210], 0));
});

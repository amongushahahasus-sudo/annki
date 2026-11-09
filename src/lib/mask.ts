/**
 * Removes red-family ink from an RGBA image and tints the paper coral.
 * Works on rendered pixels, so scanned PDFs and outlined text work too.
 * Sensitivity broadens the accepted red hue range; it is not opacity.
 */
export function maskPixels(data: Uint8ClampedArray, sensitivity = 60): void {
  const level = Math.max(0, Math.min(100, sensitivity));
  const minDominance = 38 - level * 0.3;
  const paper = [255, 224, 221] as const;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const dominance = r - Math.max(g, b);
    const isRed = r > 35 && dominance > minDominance;

    // Replace the ink itself rather than placing a transparent rectangle over it.
    if (isRed) {
      data[i] = paper[0];
      data[i + 1] = paper[1];
      data[i + 2] = paper[2];
    } else {
      data[i] = r;
      data[i + 1] = (g * paper[1]) / 255;
      data[i + 2] = (b * paper[2]) / 255;
    }
  }
}

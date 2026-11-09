import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { maskPixels } from './mask';

GlobalWorkerOptions.workerSrc = pdfWorker;

export { maskPixels } from './mask';
export type { PDFDocumentProxy } from 'pdfjs-dist';

/** PDF.js transfers its input buffer to its worker; preserve the caller's copy. */
export async function openPdf(data: Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  const assets = new URL(`${import.meta.env.BASE_URL}pdfjs/`, window.location.href).href;
  const task = getDocument({
    data: data.slice(),
    password,
    cMapUrl: `${assets}cmaps/`,
    standardFontDataUrl: `${assets}standard_fonts/`,
    wasmUrl: `${assets}wasm/`,
    // All font/CMap/decoder support files are served from the same static app.
    useSystemFonts: true,
  });
  try {
    return await task.promise;
  } catch (error) {
    await task.destroy();
    throw error;
  }
}

/** Renders one page, with a bounded pixel budget for large/scanned sheets. */
export async function renderPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  maxWidth = 1400,
): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(Math.max(1, Math.min(pdf.numPages, pageNumber)));
  const baseViewport = page.getViewport({ scale: 1 });
  const requestedScale = Math.max(0.1, maxWidth / baseViewport.width);
  const pixelBudgetScale = Math.sqrt(12_000_000 / (baseViewport.width * baseViewport.height));
  const viewport = page.getViewport({ scale: Math.min(requestedScale, pixelBudgetScale) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('PDFを表示するための描画機能を利用できません。');
  await page.render({ canvasContext: context, canvas, viewport, background: '#ffffff' }).promise;
  page.cleanup();
  return canvas;
}

export function applyRedSheet(source: HTMLCanvasElement, sensitivity = 60): HTMLCanvasElement {
  const result = document.createElement('canvas');
  result.width = source.width;
  result.height = source.height;
  const context = result.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('赤シートを表示するための描画機能を利用できません。');
  context.drawImage(source, 0, 0);
  const pixels = context.getImageData(0, 0, source.width, source.height);
  maskPixels(pixels.data, sensitivity);
  context.putImageData(pixels, 0, 0);
  return result;
}

export async function renderPdfPage(data: Uint8Array, pageNumber: number, maxWidth = 1400) {
  const pdf = await openPdf(data);
  try {
    return { original: await renderPage(pdf, pageNumber, maxWidth), totalPages: pdf.numPages };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/**
 * Утилиты для режима «Аутпейнт»: размер холста и композиция заготовки.
 * Browser-only (canvas).
 */

import { STANDARD_SIZES, STANDARD_SIZES_GPT_IMAGE_2 } from './imageResize';
import { isOpenAIImageModel } from './nanoBananaModelConfig';

/**
 * @param {string} imageSize - '1K' | '2K' | '4K'
 * @param {string} aspectRatio - e.g. '16:9'
 * @param {Array} [sizes]
 * @returns {{ width: number, height: number, aspectRatio: string, imageSize: string }}
 */
export function getOutpaintCanvasSize(imageSize, aspectRatio, sizes = STANDARD_SIZES) {
  const found = sizes.find((s) => s.imageSize === imageSize && s.aspectRatio === aspectRatio);
  if (!found) {
    throw new Error(`Неизвестный размер холста: ${imageSize} ${aspectRatio}`);
  }
  return found;
}

/**
 * Размер холста из сетки конкретного провайдера.
 * Для GPT эта же сетка используется в параметре size Image API.
 */
export function getOutpaintCanvasSizeForModel(imageSize, aspectRatio, model) {
  return getOutpaintCanvasSize(
    imageSize,
    aspectRatio,
    isOpenAIImageModel(model) ? STANDARD_SIZES_GPT_IMAGE_2 : STANDARD_SIZES,
  );
}

/**
 * Центрирование прямоугольника на холсте.
 */
export function centerOutpaintOffset(canvasW, canvasH, rectW, rectH) {
  return {
    x: Math.round((canvasW - rectW) / 2),
    y: Math.round((canvasH - rectH) / 2),
  };
}

/** Создать слой для холста. */
export function createOutpaintLayer(item, canvasW, canvasH, dropPos = null) {
  const naturalW = item.naturalWidth || 256;
  const naturalH = item.naturalHeight || 256;
  const previewUrl = item.previewUrl;
  const { width, height } = defaultOutpaintLayerSize(naturalW, naturalH, canvasW, canvasH);

  let x;
  let y;
  if (dropPos) {
    x = Math.round(dropPos.x - width / 2);
    y = Math.round(dropPos.y - height / 2);
  } else {
    const centered = centerOutpaintOffset(canvasW, canvasH, width, height);
    x = centered.x;
    y = centered.y;
  }

  return {
    id: item.id,
    previewUrl,
    x,
    y,
    width,
    height,
    naturalWidth: naturalW,
    naturalHeight: naturalH,
  };
}

/** Начальный размер слоя: натуральный, но не больше ~90% холста по длинной стороне. */
export function defaultOutpaintLayerSize(naturalW, naturalH, canvasW, canvasH) {
  let w = naturalW;
  let h = naturalH;
  const maxW = canvasW * 0.9;
  const maxH = canvasH * 0.9;
  if (w > maxW || h > maxH) {
    const scale = Math.min(maxW / w, maxH / h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }
  return { width: Math.max(16, w), height: Math.max(16, h) };
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось загрузить изображение'));
    img.src = src;
  });
}

/**
 * @param {{ data: string, mimeType?: string }} image — base64 без префикса data:
 * @returns {Promise<{ width: number, height: number }>}
 */
export async function getImagePixelSize(image) {
  const mime = image.mimeType || 'image/png';
  const src = `data:${mime};base64,${image.data}`;
  const el = await loadImageElement(src);
  return { width: el.naturalWidth, height: el.naturalHeight };
}

/**
 * Белый холст + слои (порядок массива = порядок отрисовки).
 * @param {Array<{ imageData: string, mimeType?: string, x: number, y: number, width: number, height: number }>} layers
 * @returns {Promise<{ data: string, mimeType: string }>}
 */
export async function composeOutpaintLayers({ layers, canvasW, canvasH }) {
  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasW, canvasH);

  for (const layer of layers) {
    const mime = layer.mimeType || 'image/png';
    const src = `data:${mime};base64,${layer.imageData}`;
    const img = await loadImageElement(src);
    ctx.drawImage(img, layer.x, layer.y, layer.width, layer.height);
  }

  const dataUrl = canvas.toDataURL('image/png');
  return { data: dataUrl.split(',')[1], mimeType: 'image/png' };
}

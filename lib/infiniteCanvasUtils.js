import { drawCroppedLayerImage, normalizeLayerCrop } from './layerCrop';

const DEFAULT_DROP_MAX = 400;

/** N экранных px при родительском scale(zoom) → мировые единицы */
export function screenPx(n, zoom) {
  const z = zoom > 0 ? zoom : 1;
  return n / z;
}

/**
 * @param {File} file
 * @returns {Promise<{ url: string, naturalWidth: number, naturalHeight: number }>}
 */
export function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith('image/')) {
      reject(new Error('Not an image'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({
      url,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
    });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}

/**
 * @param {number} naturalW
 * @param {number} naturalH
 * @param {number} [maxDim]
 */
export function defaultLayerSize(naturalW, naturalH, maxDim = DEFAULT_DROP_MAX) {
  if (!naturalW || !naturalH) return { width: maxDim, height: maxDim };
  const scale = maxDim / Math.max(naturalW, naturalH);
  if (scale >= 1) return { width: naturalW, height: naturalH };
  return {
    width: Math.round(naturalW * scale),
    height: Math.round(naturalH * scale),
  };
}

/**
 * @param {DOMRect} containerRect
 * @param {{ panX: number, panY: number, zoom: number }} viewport
 * @param {number} clientX
 * @param {number} clientY
 */
export function screenToWorld(containerRect, viewport, clientX, clientY) {
  const localX = clientX - containerRect.left;
  const localY = clientY - containerRect.top;
  return {
    x: (localX - viewport.panX) / viewport.zoom,
    y: (localY - viewport.panY) / viewport.zoom,
  };
}

export function createLayerId() {
  return `layer_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

const MIN_ZOOM_FIT = 0.1;

/**
 * @param {Array<{ x: number, y: number, width: number, height: number }>} layers
 * @param {number} containerW
 * @param {number} containerH
 * @param {number} [padding]
 */
export function fitViewportToLayers(layers, containerW, containerH, padding = 48) {
  if (!layers.length) {
    return { panX: containerW / 2, panY: containerH / 2, zoom: 1 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const l of layers) {
    minX = Math.min(minX, l.x);
    minY = Math.min(minY, l.y);
    maxX = Math.max(maxX, l.x + l.width);
    maxY = Math.max(maxY, l.y + l.height);
  }
  const contentW = Math.max(maxX - minX, 1);
  const contentH = Math.max(maxY - minY, 1);
  const zoom = Math.min(
    (containerW - padding * 2) / contentW,
    (containerH - padding * 2) / contentH,
    2,
  );
  const panX = (containerW - contentW * zoom) / 2 - minX * zoom;
  const panY = (containerH - contentH * zoom) / 2 - minY * zoom;
  return { panX, panY, zoom: Math.max(zoom, MIN_ZOOM_FIT) };
}

const GRID_CROSS_COLOR = '#c7c7cc';
export const ISOMETRIC_GRID_SIZE = 40;
/** Минимальное расстояние между крестиками на экране (CSS px). */
const MIN_GRID_SCREEN_SPACING = 16;
/** Жёсткий потолок числа крестиков за один кадр. */
const MAX_GRID_CROSS_COUNT = 3500;

/**
 * Шаг сетки с прореживанием при отдалении: base, 2×, 4×, 8×…
 * @param {number} gridSize
 * @param {number} zoom
 * @param {number} [viewW]
 * @param {number} [viewH]
 */
export function getEffectiveGridStep(gridSize, zoom, viewW = 0, viewH = 0) {
  const base = Number(gridSize);
  if (!base || base < 1 || !zoom || zoom <= 0) return base || 20;

  let step = base;
  const maxStep = base * 65536;

  while (step * zoom < MIN_GRID_SCREEN_SPACING && step < maxStep) {
    step *= 2;
  }

  if (viewW > 0 && viewH > 0) {
    const worldW = viewW / zoom;
    const worldH = viewH / zoom;
    while (step < maxStep) {
      const cols = Math.ceil(worldW / step) + 1;
      const rows = Math.ceil(worldH / step) + 1;
      if (cols * rows <= MAX_GRID_CROSS_COUNT) break;
      step *= 2;
    }
  }

  return step;
}

/**
 * Крестик 3×3 CSS-пикселя с центром в (cx, cy).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx
 * @param {number} cy
 */
function fillGridCross(ctx, cx, cy) {
  ctx.fillRect(cx, cy - 1, 1, 1);
  ctx.fillRect(cx - 1, cy, 1, 1);
  ctx.fillRect(cx, cy, 1, 1);
  ctx.fillRect(cx + 1, cy, 1, 1);
  ctx.fillRect(cx, cy + 1, 1, 1);
}

/**
 * Узлы сетки в экранных координатах — размер крестика не зависит от zoom.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 * @param {{ panX: number, panY: number, zoom: number }} viewport
 * @param {number} gridSize
 */
export function drawGridCrosses(ctx, width, height, viewport, gridSize) {
  const base = Number(gridSize);
  if (!base || base < 1 || width <= 0 || height <= 0) return;

  const { panX, panY, zoom } = viewport;
  const step = getEffectiveGridStep(base, zoom, width, height);

  const worldLeft = -panX / zoom;
  const worldTop = -panY / zoom;
  const worldRight = (width - panX) / zoom;
  const worldBottom = (height - panY) / zoom;

  const startGx = Math.floor(worldLeft / step) * step;
  const startGy = Math.floor(worldTop / step) * step;

  ctx.fillStyle = GRID_CROSS_COLOR;

  for (let gx = startGx; gx <= worldRight; gx += step) {
    for (let gy = startGy; gy <= worldBottom; gy += step) {
      fillGridCross(ctx, Math.round(gx * zoom + panX), Math.round(gy * zoom + panY));
    }
  }
}

/**
 * Изометрическая сетка из двух семейств симметричных наклонных линий.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 * @param {{ panX: number, panY: number, zoom: number }} viewport
 * @param {number} gridSize
 * @param {number} gridAngle угол линий относительно горизонтали, в градусах
 */
export function drawIsometricGrid(
  ctx,
  width,
  height,
  viewport,
  gridSize,
  gridAngle = 30,
  style = {},
) {
  const base = Number(gridSize);
  if (!base || base < 1 || width <= 0 || height <= 0) return;

  const { panX, panY, zoom } = viewport;
  const step = getEffectiveGridStep(base, zoom, width, height) * zoom;
  const angle = Math.min(85, Math.max(5, Number(gridAngle) || 30));
  const slope = Math.tan((angle * Math.PI) / 180);
  const overscan = height + width * slope;

  ctx.beginPath();
  ctx.strokeStyle = style.strokeStyle || GRID_CROSS_COLOR;
  ctx.lineWidth = style.lineWidth || 1;

  for (const direction of [-1, 1]) {
    const originIntercept = panY - direction * panX * slope;
    const minIntercept = -width * slope;
    const maxIntercept = height + width * slope;
    const start = Math.floor((minIntercept - originIntercept) / step) * step + originIntercept;

    for (let intercept = start; intercept <= maxIntercept; intercept += step) {
      ctx.moveTo(-overscan, intercept - direction * overscan * slope);
      ctx.lineTo(width + overscan, intercept + direction * (width + overscan) * slope);
    }
  }

  ctx.stroke();
}

/**
 * Ячейка изометрической сетки, содержащая точку в мировых координатах.
 * @param {{ x: number, y: number }} point
 * @param {number} gridSize
 * @param {number} gridAngle
 */
export function getIsometricCellAtPoint(point, gridSize, gridAngle = 30) {
  const size = Math.max(1, Number(gridSize) || ISOMETRIC_GRID_SIZE);
  const angle = Math.min(85, Math.max(5, Number(gridAngle) || 30));
  const slope = Math.tan((angle * Math.PI) / 180);
  return {
    u: Math.floor((point.y - point.x * slope) / size),
    v: Math.floor((point.y + point.x * slope) / size),
  };
}

/**
 * Вершины ромба изометрической сетки в мировых координатах.
 * @param {{ u: number, v: number }} cell
 * @param {number} gridSize
 * @param {number} gridAngle
 */
export function getIsometricCellPolygon(cell, gridSize, gridAngle = 30) {
  const size = Math.max(1, Number(gridSize) || ISOMETRIC_GRID_SIZE);
  const angle = Math.min(85, Math.max(5, Number(gridAngle) || 30));
  const slope = Math.tan((angle * Math.PI) / 180);
  const a0 = cell.u * size;
  const a1 = (cell.u + 1) * size;
  const b0 = cell.v * size;
  const b1 = (cell.v + 1) * size;
  const intersection = (a, b) => ({
    x: (b - a) / (2 * slope),
    y: (a + b) / 2,
  });
  return [
    intersection(a0, b0),
    intersection(a0, b1),
    intersection(a1, b1),
    intersection(a1, b0),
  ];
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{ u: number, v: number, color: string }>} tiles
 * @param {number} gridSize
 * @param {number} gridAngle
 * @param {string|null} overrideColor
 */
export function drawIsometricTiles(
  ctx,
  tiles,
  gridSize,
  gridAngle = 30,
  overrideColor = null,
) {
  for (const tile of tiles || []) {
    const points = getIsometricCellPolygon(tile, gridSize, gridAngle);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      ctx.lineTo(points[index].x, points[index].y);
    }
    ctx.closePath();
    ctx.fillStyle = overrideColor || tile.color;
    ctx.fill();
  }
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ panX: number, panY: number, zoom: number }} viewport
 * @param {number} gridSize
 * @param {'dots'|'isometric'} gridType
 * @param {number} gridAngle
 * @param {{ strokeStyle?: string, lineWidth?: number }} style
 */
export function paintGridCanvas(canvas, viewport, gridSize, gridType = 'dots', gridAngle = 30, style = {}) {
  const rect = canvas.getBoundingClientRect();
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);
  if (w <= 0 || h <= 0) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = h * dpr;

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (gridType === 'isometric') drawIsometricGrid(ctx, w, h, viewport, gridSize, gridAngle, style);
  else drawGridCrosses(ctx, w, h, viewport, gridSize);
}

/**
 * @param {number} pxW
 * @param {number} pxH
 * @param {number|string} gridSize
 */
export function getLayerSizeDisplay(pxW, pxH, gridSize) {
  const base = Math.max(1, Number(gridSize) || 20);
  const w = Math.round(pxW);
  const h = Math.round(pxH);
  const rawGw = pxW / base;
  const rawGh = pxH / base;
  const gridW = Math.round(rawGw * 10) / 10;
  const gridH = Math.round(rawGh * 10) / 10;
  const gridWWhole = Math.abs(rawGw - Math.round(rawGw)) < 0.001;
  const gridHWhole = Math.abs(rawGh - Math.round(rawGh)) < 0.001;
  return { w, h, gridW, gridH, gridWWhole, gridHWhole };
}

/**
 * @param {{ width: number, height: number, naturalWidth?: number, naturalHeight?: number }} layer
 * @returns {number|null}
 */
export function getLayerScalePercent(layer) {
  const nw = layer.naturalWidth;
  const nh = layer.naturalHeight;
  if (!nw || !nh) return null;
  return Math.round(((layer.width / nw + layer.height / nh) / 2) * 100);
}

/**
 * @param {{ id: string, url: string, naturalWidth?: number, naturalHeight?: number }} layer
 */
export async function resolveLayerNaturalSize(layer) {
  if (layer.naturalWidth && layer.naturalHeight) {
    return { naturalWidth: layer.naturalWidth, naturalHeight: layer.naturalHeight };
  }
  const img = await loadImageElement(layer.url);
  return { naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight };
}

/**
 * @param {{ x: number, y: number, width: number, height: number }} layer
 * @param {number} naturalWidth
 * @param {number} naturalHeight
 */
export function buildNaturalSizePatch(layer, naturalWidth, naturalHeight) {
  const cx = layer.x + layer.width / 2;
  const cy = layer.y + layer.height / 2;
  const crop = normalizeLayerCrop(layer);
  const width = naturalWidth * crop.width;
  const height = naturalHeight * crop.height;
  return {
    naturalWidth,
    naturalHeight,
    width,
    height,
    x: Math.round(cx - width / 2),
    y: Math.round(cy - height / 2),
  };
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось загрузить изображение'));
    img.src = src;
  });
}

/**
 * @param {{ id: string, url: string, width: number, height: number }} layer
 */
export async function downloadLayerImage(layer) {
  const img = await loadImageElement(layer.url);
  const w = Math.max(1, Math.round(layer.width));
  const h = Math.max(1, Math.round(layer.height));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  drawCroppedLayerImage(ctx, img, layer, 0, 0, w, h);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Не удалось экспортировать изображение');
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = `outpaint_${String(layer.id).replace(/^layer_/, '')}.png`;
  a.click();
  URL.revokeObjectURL(blobUrl);
}

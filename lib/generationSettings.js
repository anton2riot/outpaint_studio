import { getOutpaintCanvasSizeForModel } from './outpaintCompose';
import { isOpenAIImageModel } from './nanoBananaModelConfig';

/** Base set without 0.5K (regular / pro) */
export const IMAGE_SIZE_OPTIONS = ['1K', '2K', '4K'];

/** 0.5K is only for NanoBanana 2 (see settings-modal.html, gemini.js imageSize "512") */
export function getImageSizeOptionsForModel(model) {
  if (model === 'nb2') return ['0.5K', '1K', '2K', '4K'];
  if (model === 'gpt-image-2') return ['1K', '2K'];
  if (isOpenAIImageModel(model)) return ['1K', '2K', '4K'];
  return IMAGE_SIZE_OPTIONS;
}

/**
 * @param {string} imageSize
 * @param {string} model
 */
export function coerceImageSizeForModel(imageSize, model) {
  const options = getImageSizeOptionsForModel(model);
  if (options.includes(imageSize)) return imageSize;
  return options[0] || '1K';
}

export const ASPECT_RATIO_OPTIONS = [
  '1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9',
];

/**
 * @param {string} imageSize
 * @param {string} aspectRatio
 */
export function getGenerationDimensions(imageSize, aspectRatio, model) {
  return getOutpaintCanvasSizeForModel(imageSize, aspectRatio, model);
}

/**
 * @param {string} imageSize
 * @param {string} aspectRatio
 */
export function formatResolutionLabel(imageSize, aspectRatio, model) {
  const { width, height } = getGenerationDimensions(imageSize, aspectRatio, model);
  return `${width}\u00d7${height}`;
}

/**
 * At 100%, the snapshot frame has the same pixel dimensions as generation (1K/2K/4K).
 * @param {string} imageSize
 * @param {string} aspectRatio
 */
export function snapshotDisplaySize(imageSize, aspectRatio, model) {
  return getGenerationDimensions(imageSize, aspectRatio, model);
}

/**
 * centerX
 * centerY
 * @param {string} [imageSize]
 * @param {string} [aspectRatio]
 * @param {string} [model]
 */
export function createSnapshotFrame(centerX, centerY, imageSize = '2K', aspectRatio = '16:9', model = 'nb2') {
  const { width, height } = snapshotDisplaySize(imageSize, aspectRatio, model);
  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
    imageSize,
    aspectRatio,
    model,
  };
}

/**
 * Preserve generation proportions when imageSize, aspectRatio, or model changes.
 * @param {{ x: number, y: number, width: number, height: number, imageSize: string, aspectRatio: string, model?: string }} frame
 * @param {string} imageSize
 * @param {string} aspectRatio
 * @param {string} [model]
 */
/**
 * @param {{ width: number, height: number, imageSize: string, aspectRatio: string }} frame
 * @returns {number}
 */
export function getSnapshotScalePercent(frame) {
  const { width: refW, height: refH } = snapshotDisplaySize(
    frame.imageSize,
    frame.aspectRatio,
    frame.model,
  );
  return Math.round(((frame.width / refW + frame.height / refH) / 2) * 100);
}

/**
 * @param {{ x: number, y: number, width: number, height: number, imageSize: string, aspectRatio: string }} frame
 */
export function resetSnapshotToDefaultSize(frame) {
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;
  const { width, height } = snapshotDisplaySize(frame.imageSize, frame.aspectRatio, frame.model);
  return {
    ...frame,
    width,
    height,
    x: Math.round(cx - width / 2),
    y: Math.round(cy - height / 2),
  };
}

export function applySnapshotSettings(frame, imageSize, aspectRatio, model) {
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;
  const oldGen = getGenerationDimensions(frame.imageSize, frame.aspectRatio, frame.model);
  const scale = (frame.width / oldGen.width + frame.height / oldGen.height) / 2;
  const newGen = getGenerationDimensions(imageSize, aspectRatio, model || frame.model);
  const width = Math.round(newGen.width * scale);
  const height = Math.round(newGen.height * scale);
  return {
    ...frame,
    imageSize,
    aspectRatio,
    model: model || frame.model || 'nb2',
    width,
    height,
    x: cx - width / 2,
    y: cy - height / 2,
  };
}

/**
 * @param {{ x: number, y: number, width: number, height: number, imageSize: string, aspectRatio: string }} frame
 * @param {string} handle
 * @param {number} dx
 * @param {number} dy
 * @param {number} [minSize]
 */
export function resizeSnapshotFrame(frame, handle, dx, dy, minSize = 120) {
  const { width: pxW, height: pxH } = getGenerationDimensions(
    frame.imageSize,
    frame.aspectRatio,
    frame.model,
  );
  const aspect = pxW / pxH;

  let width = frame.width;
  let height = frame.height;
  let x = frame.x;
  let y = frame.y;

  if (handle === 'se') {
    width = Math.max(minSize, frame.width + dx);
    height = width / aspect;
  } else if (handle === 'sw') {
    width = Math.max(minSize, frame.width - dx);
    height = width / aspect;
    x = frame.x + frame.width - width;
    y = frame.y + frame.height - height;
  } else if (handle === 'ne') {
    width = Math.max(minSize, frame.width + dx);
    height = width / aspect;
    y = frame.y + frame.height - height;
  } else if (handle === 'nw') {
    width = Math.max(minSize, frame.width - dx);
    height = width / aspect;
    x = frame.x + frame.width - width;
    y = frame.y + frame.height - height;
  } else if (handle === 'e') {
    width = Math.max(minSize, frame.width + dx);
    height = width / aspect;
  } else if (handle === 'w') {
    width = Math.max(minSize, frame.width - dx);
    height = width / aspect;
    x = frame.x + frame.width - width;
  } else if (handle === 's') {
    height = Math.max(minSize / aspect, frame.height + dy);
    width = height * aspect;
  } else if (handle === 'n') {
    height = Math.max(minSize / aspect, frame.height - dy);
    width = height * aspect;
    y = frame.y + frame.height - height;
  }

  return { x, y, width, height };
}

const STORAGE_KEY = 'outpaint-studio-generation';

export function loadStudioGenerationDefaults() {
  if (typeof window === 'undefined') {
    return { imageSize: '2K', aspectRatio: '16:9', model: 'nb2' };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { imageSize: '2K', aspectRatio: '16:9', model: 'nb2' };
    const parsed = JSON.parse(raw);
    const model = parsed.model || 'nb2';
    const allowedSizes = getImageSizeOptionsForModel(model);
    const imageSize = allowedSizes.includes(parsed.imageSize) ? parsed.imageSize : '2K';
    const aspectRatio = ASPECT_RATIO_OPTIONS.includes(parsed.aspectRatio) ? parsed.aspectRatio : '16:9';
    return { imageSize, aspectRatio, model };
  } catch {
    return { imageSize: '2K', aspectRatio: '16:9', model: 'nb2' };
  }
}

export function saveStudioGenerationDefaults(imageSize, aspectRatio, model) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ imageSize, aspectRatio, model: model || 'nb2' }));
  } catch (_) {}
}

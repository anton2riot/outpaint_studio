/**
 * Utilities for fitting images to standard Nanobanana Pro sizes.
 *
 * Standard sizes combine resolution (1K/2K/4K) and
 * aspect ratio (10 options), for 30 predefined sizes in total.
 *
 * Source for 1K sizes: https://ai.google.dev/gemini-api/docs/image-generation
 * 2K and 4K scale proportionally (×2 and ×4).
 *
 * padImageToStandardSize and cropAndRestoreImage only run in the browser (canvas).
 */

/** NanoBanana 2 uses imageSize "512" in the Gemini API. Sizes match settings-modal.html */
const STANDARD_SIZES_0_5K = [
  { width: 512, height: 512, aspectRatio: '1:1' },
  { width: 424, height: 632, aspectRatio: '2:3' },
  { width: 632, height: 424, aspectRatio: '3:2' },
  { width: 448, height: 600, aspectRatio: '3:4' },
  { width: 600, height: 448, aspectRatio: '4:3' },
  { width: 384, height: 688, aspectRatio: '9:16' },
  { width: 688, height: 384, aspectRatio: '16:9' },
  { width: 792, height: 336, aspectRatio: '21:9' },
];

const STANDARD_SIZES_1K = [
  { width: 1024, height: 1024, aspectRatio: '1:1' },
  { width: 832,  height: 1248, aspectRatio: '2:3' },
  { width: 1248, height: 832,  aspectRatio: '3:2' },
  { width: 864,  height: 1152, aspectRatio: '3:4' },
  { width: 1152, height: 864,  aspectRatio: '4:3' },
  { width: 896,  height: 1120, aspectRatio: '4:5' },
  { width: 1120, height: 896,  aspectRatio: '5:4' },
  { width: 768,  height: 1344, aspectRatio: '9:16' },
  { width: 1344, height: 768,  aspectRatio: '16:9' },
  { width: 1536, height: 658,  aspectRatio: '21:9' },
];

const RESOLUTION_TIERS = [
  { scale: 1, imageSize: '1K' },
  { scale: 2, imageSize: '2K' },
  { scale: 4, imageSize: '4K' },
];

export const STANDARD_SIZES = [];
for (const base of STANDARD_SIZES_0_5K) {
  STANDARD_SIZES.push({ ...base, imageSize: '0.5K' });
}
for (const tier of RESOLUTION_TIERS) {
  for (const base of STANDARD_SIZES_1K) {
    STANDARD_SIZES.push({
      width: base.width * tier.scale,
      height: base.height * tier.scale,
      aspectRatio: base.aspectRatio,
      imageSize: tier.imageSize,
    });
  }
}

// GPT Image size table. The model requires both sides to be multiples of 16,
// max edge ≤ 3840, total px ∈ [655_360, 8_294_400], long:short ≤ 3.
// All sizes below match the exact aspect ratio and are multiples of 16.
// GPT Image 2.5 has a separate 4K tier within the allowed limits.
const STANDARD_SIZES_GPT_IMAGE_2_1K = [
  { width: 1024, height: 1024, aspectRatio: '1:1' },   // exact
  { width: 832,  height: 1248, aspectRatio: '2:3' },   // 2/3 = 0.6667 exact
  { width: 1248, height: 832,  aspectRatio: '3:2' },
  { width: 864,  height: 1152, aspectRatio: '3:4' },   // 3/4 = 0.75 exact
  { width: 1152, height: 864,  aspectRatio: '4:3' },
  { width: 896,  height: 1120, aspectRatio: '4:5' },   // 4/5 = 0.80 exact
  { width: 1120, height: 896,  aspectRatio: '5:4' },
  { width: 720,  height: 1280, aspectRatio: '9:16' },  // 9/16 = 0.5625 exact
  { width: 1280, height: 720,  aspectRatio: '16:9' },
  { width: 1680, height: 720,  aspectRatio: '21:9' },  // 21/9 = 2.333 exact
];

const GPT_IMAGE_2_TIERS = [
  { scale: 1, imageSize: '1K' },
  { scale: 2, imageSize: '2K' },
];

export const STANDARD_SIZES_GPT_IMAGE_2 = [];
for (const tier of GPT_IMAGE_2_TIERS) {
  for (const base of STANDARD_SIZES_GPT_IMAGE_2_1K) {
    STANDARD_SIZES_GPT_IMAGE_2.push({
      width: base.width * tier.scale,
      height: base.height * tier.scale,
      aspectRatio: base.aspectRatio,
      imageSize: tier.imageSize,
    });
  }
}

const STANDARD_SIZES_GPT_IMAGE_25_4K = [
  { width: 2048, height: 2048, aspectRatio: '1:1' },
  { width: 2304, height: 3456, aspectRatio: '2:3' },
  { width: 3456, height: 2304, aspectRatio: '3:2' },
  { width: 2400, height: 3200, aspectRatio: '3:4' },
  { width: 3200, height: 2400, aspectRatio: '4:3' },
  { width: 2560, height: 3200, aspectRatio: '4:5' },
  { width: 3200, height: 2560, aspectRatio: '5:4' },
  { width: 2160, height: 3840, aspectRatio: '9:16' },
  { width: 3840, height: 2160, aspectRatio: '16:9' },
  { width: 3808, height: 1632, aspectRatio: '21:9' },
].map((size) => ({ ...size, imageSize: '4K' }));

STANDARD_SIZES_GPT_IMAGE_2.push(...STANDARD_SIZES_GPT_IMAGE_25_4K);

/**
 * Find the closest standard size for an input image.
 *
 * Algorithm:
 * 1. Exact match → return without padding
 * 2. Sizes where BOTH sides >= input → smallest area
 * 3. Fallback: closest aspect ratio at the highest available tier
 *
 * @param {number} inputW
 * @param {number} inputH
 * @param {string} [maxImageSize] - limit the maximum tier ('1K', '2K', '4K')
 * @param {object} [opts]
 * @param {Array} [opts.sizes] - custom standard-size table (instead of STANDARD_SIZES)
 * @returns {{ width, height, aspectRatio, imageSize, exactMatch, oversized? }}
 */
export function findBestStandardSize(inputW, inputH, maxImageSize, opts = {}) {
  const sizes = opts.sizes || STANDARD_SIZES;
  const tierOrder = ['0.5K', '1K', '2K', '4K'];
  const maxTierIdx = maxImageSize ? tierOrder.indexOf(maxImageSize) : tierOrder.length - 1;
  const allowedTiers = new Set(
    (maxTierIdx >= 0 ? tierOrder.slice(0, maxTierIdx + 1) : tierOrder)
  );
  const pool = sizes.filter(s => allowedTiers.has(s.imageSize));

  const exact = pool.find(s => s.width === inputW && s.height === inputH);
  if (exact) return { ...exact, exactMatch: true };

  const candidates = pool.filter(s => s.width >= inputW && s.height >= inputH);

  if (candidates.length > 0) {
    const inputRatio = inputW / inputH;
    candidates.sort((a, b) => {
      const areaDiff = (a.width * a.height) - (b.width * b.height);
      if (areaDiff !== 0) return areaDiff;
      return Math.abs(a.width / a.height - inputRatio) - Math.abs(b.width / b.height - inputRatio);
    });
    return { ...candidates[0], exactMatch: false };
  }

  const inputRatio = inputW / inputH;
  // Find the highest available tier in the pool (important for the GPT grid without 4K).
  const availableTiers = tierOrder.filter(t => pool.some(s => s.imageSize === t));
  const topTier = availableTiers[availableTiers.length - 1];
  const fallback = pool.filter(s => s.imageSize === topTier);
  fallback.sort((a, b) =>
    Math.abs(a.width / a.height - inputRatio) - Math.abs(b.width / b.height - inputRatio)
  );
  return { ...fallback[0], exactMatch: false, oversized: true };
}

/**
 * Fit an image to a standard Nanobanana Pro size.
 * Scale the image until it reaches one side,
 * then fill the remaining space with white.
 *
 * Browser-only (canvas).
 *
 * @param {{ data: string, mimeType: string }} imageData - base64 image
 * @returns {Promise<{
 *   paddedImage: { data: string, mimeType: string },
 *   paddingInfo: object|null,
 *   standardSize: object,
 *   promptSuffix: string
 * }>}
 */
export async function padImageToStandardSize(imageData, maxImageSize, opts = {}) {
  const img = new Image();
  const dataUrl = `data:${imageData.mimeType};base64,${imageData.data}`;

  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = dataUrl;
  });

  const inputW = img.width;
  const inputH = img.height;
  const standard = findBestStandardSize(inputW, inputH, maxImageSize, opts);

  if (standard.exactMatch) {
    return {
      paddedImage: imageData,
      paddingInfo: null,
      standardSize: standard,
      promptSuffix: '',
    };
  }

  const { width: targetW, height: targetH } = standard;

  const scale = Math.min(targetW / inputW, targetH / inputH);
  const scaledW = Math.round(inputW * scale);
  const scaledH = Math.round(inputH * scale);

  const offsetX = Math.round((targetW - scaledW) / 2);
  const offsetY = Math.round((targetH - scaledH) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.drawImage(img, offsetX, offsetY, scaledW, scaledH);

  const resultDataUrl = canvas.toDataURL('image/png');
  const base64 = resultDataUrl.split(',')[1];

  // When the image exceeds the max tier (oversized), don't upscale back
  // to the original dimensions — stay within the limit.
  const restoreW = standard.oversized ? scaledW : inputW;
  const restoreH = standard.oversized ? scaledH : inputH;

  const paddingInfo = {
    originalWidth: restoreW,
    originalHeight: restoreH,
    targetWidth: targetW,
    targetHeight: targetH,
    scaledWidth: scaledW,
    scaledHeight: scaledH,
    offsetX,
    offsetY,
    scale,
  };

  const promptSuffix =
    '\n\nThe image has white padding bars on the edges. Ignore them in your analysis. ' +
    'In your output, reproduce identical white padding bars on the edges, pixel-for-pixel.';

  return {
    paddedImage: { data: base64, mimeType: 'image/png' },
    paddingInfo,
    standardSize: standard,
    promptSuffix,
  };
}

/**
 * Halve the image dimensions (for the 0.5K option).
 * Generate at 1K, then downscale the result to about 512 px.
 *
 * Browser-only (canvas).
 *
 * @param {string} imageDataUrl - image data URL (usually a 1K result from Gemini)
 * @returns {Promise<string>} - data URL of the downscaled image
 */
export async function downscaleImageHalf(imageDataUrl) {
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = imageDataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width / 2);
  canvas.height = Math.round(img.height / 2);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

/**
 * Remove white padding from the result and scale it back
 * to the original dimensions of the input image.
 *
 * Browser-only (canvas).
 *
 * @param {string} imageDataUrl - data URL of the Gemini result
 * @param {object} paddingInfo - padding metadata from padImageToStandardSize
 * @returns {Promise<string>} - data URL of the cropped image at its original size
 */
export async function cropAndRestoreImage(imageDataUrl, paddingInfo) {
  if (!paddingInfo) return imageDataUrl;

  const { originalWidth, originalHeight, scaledWidth, scaledHeight, offsetX, offsetY,
          targetWidth, targetHeight } = paddingInfo;

  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = imageDataUrl;
  });

  // If the result has a different size, scale the offsets proportionally
  const scaleX = img.width / targetWidth;
  const scaleY = img.height / targetHeight;
  const cropX = Math.round(offsetX * scaleX);
  const cropY = Math.round(offsetY * scaleY);
  const cropW = Math.round(scaledWidth * scaleX);
  const cropH = Math.round(scaledHeight * scaleY);

  const resultCanvas = document.createElement('canvas');
  resultCanvas.width = originalWidth;
  resultCanvas.height = originalHeight;
  const ctx = resultCanvas.getContext('2d');
  ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, originalWidth, originalHeight);

  return resultCanvas.toDataURL('image/png');
}

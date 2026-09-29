import { getOutpaintCanvasSize, getOutpaintCanvasSizeForModel } from './outpaintCompose';
import {
  drawGridCrosses,
  drawIsometricGrid,
  drawIsometricTiles,
  getIsometricCellPolygon,
  ISOMETRIC_GRID_SIZE,
} from './infiniteCanvasUtils';
import { NANO_BANANA_API_MODELS, isOpenAIImageModel } from './nanoBananaModelConfig';
import { getUserApiKeyForJob } from './userApiKeys';
import {
  drawCroppedLayerImage,
  isLayerCropped,
  normalizeLayerCrop,
} from './layerCrop';

const BP = typeof window !== 'undefined' ? (process.env.NEXT_PUBLIC_BASE_PATH || '') : '';

/** @type {Map<string, Blob>} */
const studioImageBlobCache = new Map();

export function getCachedStudioImageBlob(imageId) {
  return studioImageBlobCache.get(imageId) || null;
}

async function blobToComposedImage(blob) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read the image'));
    reader.readAsDataURL(blob);
  });
  const [header, data] = dataUrl.split(',');
  const mimeType = header.match(/data:([^;]+)/)?.[1] || 'image/png';
  return { data, mimeType };
}

export function studioImageUrl(imageId) {
  return `${BP}/api/outpaint-studio-image?id=${encodeURIComponent(imageId)}&v=2`;
}

/**
 * @param {{ variants?: Array<{ imageId: string }>, generationMeta?: { inputImageId?: string, inputMaskImageId?: string } }} layer
 * @returns {string[]}
 */
export function collectStudioImageIds(layer) {
  const ids = new Set();
  const variants = layer?.variants || [];
  if (variants.length > 0) {
    for (const v of variants) {
      if (v?.imageId) ids.add(v.imageId);
    }
  } else if (layer?.id) {
    ids.add(layer.id);
  }
  if (layer?.generationMeta?.inputImageId) {
    ids.add(layer.generationMeta.inputImageId);
  }
  if (layer?.generationMeta?.inputMaskImageId) {
    ids.add(layer.generationMeta.inputMaskImageId);
  }
  return [...ids];
}

/**
 * URL for reading the file before saving it to the server.
 * @param {Array} layers
 * @param {string} imageId
 */
export function resolveStudioImageSourceUrl(layers, imageId) {
  for (const layer of layers || []) {
    const url = layer.url || '';
    if (url.includes(`id=${encodeURIComponent(imageId)}`) || url.includes(`id=${imageId}`)) {
      return url;
    }
    if (url.startsWith('blob:') && layer.id === imageId && !layer.variants?.length) {
      return url;
    }
  }
  return studioImageUrl(imageId);
}

/**
 * @param {object} layer
 * @returns {object}
 */
export function normalizeStudioLayer(layer) {
  const variants = layer.variants?.length
    ? layer.variants
    : [{ imageId: layer.id }];
  const activeVariantIndex = Math.min(
    layer.activeVariantIndex ?? 0,
    variants.length - 1,
  );
  const imageId = variants[activeVariantIndex]?.imageId || layer.id;
  return {
    ...layer,
    variants,
    activeVariantIndex,
    // Each variant imageId is immutable. A stable URL lets the browser
    // reuse the downloaded file when switching variants.
    url: studioImageUrl(imageId),
    regenerating: false,
  };
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load the image'));
    img.src = src;
  });
}

async function cropComposedImage(image, layer) {
  if (!isLayerCropped(layer)) return image;
  const mimeType = image.mimeType || 'image/png';
  const img = await loadImageElement(`data:${mimeType};base64,${image.data}`);
  const crop = normalizeLayerCrop(layer);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * crop.width));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * crop.height));
  drawCroppedLayerImage(
    canvas.getContext('2d'),
    img,
    layer,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return {
    data: canvas.toDataURL('image/png').split(',')[1],
    mimeType: 'image/png',
  };
}

/**
 * An empty frame starts regular generation instead of outpainting.
 * @param {object} snapshot
 * @param {Array} layers
 * @param {Array} drawings
 */
export function isSnapshotGenerationMode(
  snapshot,
  layers,
  drawings = [],
  tilePaints = [],
  gridSize = ISOMETRIC_GRID_SIZE,
  gridAngle = 30,
) {
  const hasLayer = (layers || []).some((layer) => (
    layer.x < snapshot.x + snapshot.width
    && layer.x + layer.width > snapshot.x
    && layer.y < snapshot.y + snapshot.height
    && layer.y + layer.height > snapshot.y
  ));
  const hasDrawing = (drawings || []).some((drawing) => {
    if (drawing.mode === 'erase' || !drawing.points?.length) return false;
    const radius = Math.max(0, Number(drawing.width) || 0) / 2;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    drawing.points.forEach((point) => {
      minX = Math.min(minX, point.x - radius);
      minY = Math.min(minY, point.y - radius);
      maxX = Math.max(maxX, point.x + radius);
      maxY = Math.max(maxY, point.y + radius);
    });
    return minX < snapshot.x + snapshot.width
      && maxX > snapshot.x
      && minY < snapshot.y + snapshot.height
      && maxY > snapshot.y;
  });
  const hasTile = (tilePaints || []).some((tile) => {
    const points = getIsometricCellPolygon(tile, gridSize, gridAngle);
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    return Math.min(...xs) < snapshot.x + snapshot.width
      && Math.max(...xs) > snapshot.x
      && Math.min(...ys) < snapshot.y + snapshot.height
      && Math.max(...ys) > snapshot.y;
  });
  return !hasLayer && !hasDrawing && !hasTile;
}

function drawStrokeOnContext(ctx, drawing) {
  const points = drawing.points || [];
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  if (points.length === 1) {
    ctx.lineTo(points[0].x + 0.01, points[0].y);
  } else if (points.length === 2) {
    ctx.lineTo(points[1].x, points[1].y);
  } else {
    for (let index = 1; index < points.length - 1; index += 1) {
      const point = points[index];
      const next = points[index + 1];
      ctx.quadraticCurveTo(
        point.x,
        point.y,
        (point.x + next.x) / 2,
        (point.y + next.y) / 2,
      );
    }
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
  }
  ctx.lineWidth = Math.max(1, Number(drawing.width) || 1);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = drawing.color || '#1c1c1e';
  ctx.stroke();
}

function drawSnapshotStrokes(ctx, drawings, snapshot, scale, mask = false) {
  const drawingCanvas = document.createElement('canvas');
  drawingCanvas.width = ctx.canvas.width;
  drawingCanvas.height = ctx.canvas.height;
  const drawingCtx = drawingCanvas.getContext('2d');
  drawingCtx.save();
  drawingCtx.translate(-snapshot.x * scale, -snapshot.y * scale);
  drawingCtx.scale(scale, scale);
  for (const drawing of drawings || []) {
    drawingCtx.globalCompositeOperation = drawing.mode === 'erase'
      ? 'destination-out'
      : 'source-over';
    drawStrokeOnContext(
      drawingCtx,
      mask ? { ...drawing, color: '#ffffff' } : drawing,
    );
  }
  drawingCtx.restore();
  ctx.drawImage(drawingCanvas, 0, 0);
}

function drawSnapshotTiles(ctx, tilePaints, snapshot, scale, tileGrid, mask = false) {
  if (!tilePaints?.length) return;
  ctx.save();
  ctx.translate(-snapshot.x * scale, -snapshot.y * scale);
  ctx.scale(scale, scale);
  drawIsometricTiles(
    ctx,
    tilePaints,
    tileGrid?.size || ISOMETRIC_GRID_SIZE,
    tileGrid?.angle || 30,
    mask ? '#ffffff' : null,
  );
  ctx.restore();
}

/**
 * @param {object} snapshot
 * @param {Array} layers
 * @param {number} canvasW
 * @param {number} canvasH
 * @param {{ type: 'isometric', angle: number, size?: number }|null} referenceGrid
 * @param {boolean} includeMask
 * @param {Array} drawings
 * @param {Array} tilePaints
 * @param {{ size?: number, angle?: number }} tileGrid
 * @param {{ mimeType?: 'image/png'|'image/jpeg', quality?: number }} output
 */
export async function composeSnapshotBackground(
  snapshot,
  layers,
  canvasW,
  canvasH,
  referenceGrid = null,
  includeMask = false,
  drawings = [],
  tilePaints = [],
  tileGrid = {},
  output = {},
) {
  const scale = canvasW / snapshot.width;

  const intersectingLayers = layers.filter((layer) => (
    layer.x < snapshot.x + snapshot.width
    && layer.x + layer.width > snapshot.x
    && layer.y < snapshot.y + snapshot.height
    && layer.y + layer.height > snapshot.y
  ));

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasW, canvasH);

  const maskCanvas = includeMask ? document.createElement('canvas') : null;
  if (maskCanvas) {
    maskCanvas.width = canvasW;
    maskCanvas.height = canvasH;
  }
  const maskCtx = maskCanvas?.getContext('2d') || null;

  if (referenceGrid?.type === 'isometric') {
    drawIsometricGrid(
      ctx,
      canvasW,
      canvasH,
      { panX: -snapshot.x * scale, panY: -snapshot.y * scale, zoom: scale },
      referenceGrid.size || tileGrid.size || ISOMETRIC_GRID_SIZE,
      referenceGrid.angle,
      { strokeStyle: 'rgba(142, 142, 147, 0.26)', lineWidth: 1 },
    );
  } else if (referenceGrid?.type === 'dots') {
    drawGridCrosses(
      ctx,
      canvasW,
      canvasH,
      { panX: -snapshot.x * scale, panY: -snapshot.y * scale, zoom: scale },
      referenceGrid.size || ISOMETRIC_GRID_SIZE,
    );
  }

  // Layer order: grid, painted cells, drawing, images.
  drawSnapshotTiles(ctx, tilePaints, snapshot, scale, tileGrid);
  if (maskCtx) drawSnapshotTiles(maskCtx, tilePaints, snapshot, scale, tileGrid, true);
  drawSnapshotStrokes(ctx, drawings, snapshot, scale);
  if (maskCtx) drawSnapshotStrokes(maskCtx, drawings, snapshot, scale, true);

  for (const layer of intersectingLayers) {
    try {
      const img = await loadImageElement(layer.url);
      drawCroppedLayerImage(
        ctx,
        img,
        layer,
        (layer.x - snapshot.x) * scale,
        (layer.y - snapshot.y) * scale,
        layer.width * scale,
        layer.height * scale,
      );
      if (maskCtx) {
        drawCroppedLayerImage(
          maskCtx,
          img,
          layer,
          (layer.x - snapshot.x) * scale,
          (layer.y - snapshot.y) * scale,
          layer.width * scale,
          layer.height * scale,
        );
      }
    } catch (e) {
      console.error('composeSnapshotBackground layer draw failed:', e);
    }
  }

  // Only the mask alpha channel matters: transparent areas are redrawn,
  // opaque areas are preserved. Uniform RGB greatly reduces the PNG size.
  if (maskCtx) {
    maskCtx.globalCompositeOperation = 'source-in';
    maskCtx.fillStyle = '#ffffff';
    maskCtx.fillRect(0, 0, canvasW, canvasH);
    maskCtx.globalCompositeOperation = 'source-over';
  }

  const mimeType = output.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  const quality = Number.isFinite(Number(output.quality)) ? Number(output.quality) : 0.92;
  const dataUrl = canvas.toDataURL(mimeType, quality);
  const result = { data: dataUrl.split(',')[1], mimeType };
  if (maskCanvas) {
    result.mask = {
      data: maskCanvas.toDataURL('image/png').split(',')[1],
      mimeType: 'image/png',
    };
  }
  return result;
}

/**
 * @param {string} id
 * @param {Blob} blob
 */
export async function putStudioImage(id, blob) {
  studioImageBlobCache.set(id, blob);
  const res = await fetch(`${BP}/api/outpaint-studio-image?id=${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': blob.type || 'image/png' },
    body: blob,
  });
  if (!res.ok) throw new Error('Failed to save the image');
  return studioImageUrl(id);
}

/**
 * @param {string} inputImageId
 */
export async function loadInputImageForJob(inputImageId) {
  const cached = studioImageBlobCache.get(inputImageId);
  if (cached) return blobToComposedImage(cached);

  const res = await fetch(studioImageUrl(inputImageId));
  if (!res.ok) throw new Error('Failed to load the input image');
  const blob = await res.blob();
  studioImageBlobCache.set(inputImageId, blob);
  return blobToComposedImage(blob);
}

function getActiveLayerImageId(layer) {
  if (!layer) return null;
  const variants = layer.variants || [];
  return variants[layer.activeVariantIndex ?? 0]?.imageId || layer.id || null;
}

async function loadSnapshotReferenceImages(references, layers) {
  const resolved = [];
  for (const reference of references || []) {
    if (reference.kind === 'layer') {
      const layer = (layers || []).find((item) => item.id === reference.layerId);
      if (!layer) continue;
      const imageId = getActiveLayerImageId(layer);
      if (!imageId) continue;
      let image;
      try {
        image = await loadInputImageForJob(imageId);
      } catch (_) {
        const response = await fetch(layer.url);
        if (!response.ok) throw new Error('Failed to load the linked image');
        const blob = await response.blob();
        await putStudioImage(imageId, blob);
        image = await loadInputImageForJob(imageId);
      }
      image = await cropComposedImage(image, layer);
      resolved.push({
        meta: {
          ...reference,
          imageId,
          ...(isLayerCropped(layer) ? { crop: normalizeLayerCrop(layer) } : {}),
        },
        image,
      });
      continue;
    }
    if (reference.imageId) {
      resolved.push({
        meta: reference,
        image: await loadInputImageForJob(reference.imageId),
      });
    }
  }
  return resolved;
}

/**
 * @param {object} frame
 * @param {string} template
 */
export function buildOutpaintFullPrompt(frame, globalContext, template) {
  // Compatibility with the previous buildOutpaintFullPrompt(frame, template) call.
  if (typeof globalContext === 'string') {
    template = globalContext;
    globalContext = {};
  }
  const userBlock = frame.prompt
    ? `\n\nAdditional instructions from the user:\n${frame.prompt}`
    : '';
  const globalPrompt = globalContext?.prompt?.trim();
  const globalBlock = globalContext?.imageId
    ? `\n\nInstructions involving the shared reference image${globalPrompt ? `:\n${globalPrompt}` : '.'}`
    : globalPrompt
      ? `\n\nGlobal instructions for every generation:\n${globalPrompt}`
      : '';
  return template
    .replace('{REF_STYLE_BLOCK}', '')
    .replace('{USER_PROMPT_BLOCK}', `${userBlock}${globalBlock}`);
}

/**
 * In regular generation mode, send only the instructions entered by the user,
 * without the outpainting system prompt or internal explanations.
 */
export function buildGenerationFullPrompt(frame, globalContext) {
  return [frame.prompt?.trim(), globalContext?.prompt?.trim()]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * @param {object} frame
 * @param {string} fullPrompt
 * @param {{ data: string, mimeType: string }} composed
 */
export function buildStudioJobParams(
  frame,
  fullPrompt,
  composed,
  referenceImages,
  nativeInpaint = false,
  generationMode = false,
) {
  const isGpt = isOpenAIImageModel(frame.model);
  const modelName = NANO_BANANA_API_MODELS[frame.model || 'nb2'] || NANO_BANANA_API_MODELS.nb2;
  const useNanoBananaPro = frame.model !== 'regular' && !isGpt;
  const additionalImages = Array.isArray(referenceImages)
    ? referenceImages.filter(Boolean)
    : (referenceImages ? [referenceImages] : []);
  const images = generationMode
    ? additionalImages
    : [composed, ...additionalImages];

  if (isGpt) {
    return {
      kind: 'openai-image',
      params: {
        prompt: fullPrompt,
        images,
        generationMode,
        ...(nativeInpaint && composed?.mask ? { mask: composed.mask, nativeInpaint: true } : {}),
        modelName,
        imageSize: frame.imageSize,
        aspectRatio: frame.aspectRatio,
        imageQuality: 'auto',
      },
    };
  }

  return {
    kind: 'gemini',
    params: {
      prompt: fullPrompt,
      images,
      generationMode,
      modelName,
      useNanoBananaPro,
      thinkingLevel: 'low',
      mediaResolution: 'media_resolution_high',
      imageSize: frame.imageSize,
      aspectRatio: frame.aspectRatio,
      showThoughts: false,
    },
  };
}

/**
 * @param {object} frame
 * @param {string} fullPrompt
 * @param {ReturnType<typeof buildStudioJobParams>} jobSpec
 * @param {string|null} inputImageId
 * @param {string} [snapshotFrameId]
 */
export function buildGenerationMeta(
  frame,
  fullPrompt,
  jobSpec,
  inputImageId,
  inputMaskImageId,
  snapshotFrameId,
  globalContext,
  generationSettings = {},
  references = [],
) {
  const { kind, params } = jobSpec;
  return {
    inputImageId,
    inputMaskImageId: inputMaskImageId || null,
    globalContext: globalContext?.imageId ? {
      imageId: globalContext.imageId,
      prompt: globalContext.prompt || '',
    } : globalContext?.prompt ? {
      prompt: globalContext.prompt,
    } : null,
    references,
    referenceGrid: !generationSettings.generationMode
      && generationSettings.gridType === 'isometric'
      && generationSettings.drawGridInReference
      ? {
          type: 'isometric',
          angle: Math.min(35, Math.max(22, Number(generationSettings.gridAngle) || 30)),
          size: Math.max(5, Number(generationSettings.gridSize) || ISOMETRIC_GRID_SIZE),
        }
      : null,
    tileGrid: generationSettings.gridType === 'isometric' ? {
      angle: Math.min(35, Math.max(22, Number(generationSettings.gridAngle) || 30)),
      size: Math.max(5, Number(generationSettings.gridSize) || ISOMETRIC_GRID_SIZE),
    } : null,
    userPrompt: frame.prompt || '',
    fullPrompt,
    snapshotFrameId: snapshotFrameId || null,
    imageSize: frame.imageSize,
    aspectRatio: frame.aspectRatio,
    model: frame.model || 'nb2',
    kind,
    modelName: params.modelName,
    useNanoBananaPro: params.useNanoBananaPro ?? false,
    thinkingLevel: params.thinkingLevel || 'low',
    mediaResolution: params.mediaResolution || 'media_resolution_high',
    imageQuality: params.imageQuality || 'standard',
    nativeInpaint: params.nativeInpaint === true,
    generationMode: generationSettings.generationMode === true,
    showThoughts: params.showThoughts ?? false,
  };
}

/**
 * @param {object} generationMeta
 * @param {{ snapshotFrames?: Array, layers?: Array, drawings?: Array, tilePaints?: Array, excludeLayerId?: string }} [ctx]
 */
export async function buildJobParamsFromMeta(generationMeta, ctx = {}) {
  const { snapshotFrames, layers, drawings, tilePaints, excludeLayerId } = ctx;
  let composed = null;

  if (!generationMeta.generationMode) {
    try {
      composed = await loadInputImageForJob(generationMeta.inputImageId);
      if (generationMeta.nativeInpaint) {
        composed.mask = await loadInputImageForJob(generationMeta.inputMaskImageId);
      }
    } catch (loadErr) {
      const frame = snapshotFrames?.find((f) => f.id === generationMeta.snapshotFrameId);
      if (!frame || (!layers?.length && !drawings?.length && !tilePaints?.length)) throw loadErr;

      const { width: canvasW, height: canvasH } = getOutpaintCanvasSizeForModel(
        generationMeta.imageSize,
        generationMeta.aspectRatio,
        generationMeta.model,
      );
      const backgroundLayers = layers.filter((l) => {
        if (excludeLayerId && l.id === excludeLayerId) return false;
        if (l.generationMeta?.snapshotFrameId === generationMeta.snapshotFrameId) return false;
        return true;
      });
      composed = await composeSnapshotBackground(
        frame,
        backgroundLayers,
        canvasW,
        canvasH,
        generationMeta.referenceGrid || null,
        generationMeta.nativeInpaint === true,
        drawings || [],
        tilePaints || [],
        generationMeta.tileGrid || {},
      );

      try {
        const inputBlob = await (await fetch(`data:${composed.mimeType};base64,${composed.data}`)).blob();
        await putStudioImage(generationMeta.inputImageId, inputBlob);
        if (generationMeta.nativeInpaint && composed.mask && generationMeta.inputMaskImageId) {
          const maskBlob = await (await fetch(
            `data:${composed.mask.mimeType};base64,${composed.mask.data}`,
          )).blob();
          await putStudioImage(generationMeta.inputMaskImageId, maskBlob);
        }
      } catch (_) {}
    }
  }

  const frame = {
    model: generationMeta.model,
    imageSize: generationMeta.imageSize,
    aspectRatio: generationMeta.aspectRatio,
  };
  const globalReferenceImage = generationMeta.globalContext?.imageId
    ? await loadInputImageForJob(generationMeta.globalContext.imageId)
    : null;
  const referenceImages = await Promise.all((generationMeta.references || []).map(async (reference) => {
    const image = await loadInputImageForJob(reference.imageId);
    return reference.crop
      ? cropComposedImage(image, { crop: reference.crop })
      : image;
  }));
  return buildStudioJobParams(
    frame,
    generationMeta.fullPrompt,
    composed,
    [globalReferenceImage, ...referenceImages],
    generationMeta.nativeInpaint === true && !generationMeta.generationMode,
    generationMeta.generationMode === true,
  );
}

/**
 * @param {object} frame
 */
export function clearSnapshotGeneratingState(frame, error) {
  return {
    ...frame,
    status: 'idle',
    generatingTotal: undefined,
    generatingDone: undefined,
    generatingErrors: undefined,
    ...(error ? { error } : {}),
  };
}

/**
 * Clear an in-flight status left after reload.
 * @param {object} frame
 */
export function normalizeSnapshotFrameOnLoad(frame) {
  let normalized = frame.status === 'generating'
    ? clearSnapshotGeneratingState(frame, 'Generation was interrupted')
    : frame;

  if (!isOpenAIImageModel(frame.model) || !frame.width || !frame.height) return normalized;

  const legacy = getOutpaintCanvasSize(frame.imageSize, frame.aspectRatio);
  const current = getOutpaintCanvasSizeForModel(frame.imageSize, frame.aspectRatio, frame.model);
  const legacyRatio = legacy.width / legacy.height;
  const currentRatio = normalized.width / normalized.height;
  const targetRatio = current.width / current.height;

  // Old GPT frames used the Gemini size grid. Migrate only those,
  // preserving the center and custom scale.
  if (
    Math.abs(currentRatio - legacyRatio) < 0.001
    && Math.abs(legacyRatio - targetRatio) >= 0.001
  ) {
    const scale = (
      normalized.width / legacy.width
      + normalized.height / legacy.height
    ) / 2;
    const width = Math.round(current.width * scale);
    const height = Math.round(current.height * scale);
    const centerX = normalized.x + normalized.width / 2;
    const centerY = normalized.y + normalized.height / 2;
    normalized = {
      ...normalized,
      x: Math.round(centerX - width / 2),
      y: Math.round(centerY - height / 2),
      width,
      height,
    };
  }

  return normalized;
}

/**
 * Do not persist in-flight generation to disk.
 * @param {object} frame
 */
export function sanitizeSnapshotFrameForSave(frame) {
  if (frame.status !== 'generating') {
    const { generatingTotal, generatingDone, generatingErrors, ...rest } = frame;
    return rest;
  }
  const { generatingTotal, generatingDone, generatingErrors, status, ...rest } = frame;
  return { ...rest, status: 'idle' };
}

/**
 * @param {object} frame
 * @param {Array} layers
 */
export async function prepareSnapshotGeneration(
  frame,
  layers,
  globalContext = {},
  generationSettings = {},
  drawings = [],
  tilePaints = [],
) {
  const { width: canvasW, height: canvasH } = getOutpaintCanvasSizeForModel(
    frame.imageSize,
    frame.aspectRatio,
    frame.model,
  );

  const generationMode = isSnapshotGenerationMode(
    frame,
    layers,
    drawings,
    tilePaints,
    generationSettings.gridSize,
    generationSettings.gridAngle,
  );
  const referenceGrid = !generationMode
    && generationSettings.gridType === 'isometric'
    && generationSettings.drawGridInReference
    ? {
        type: 'isometric',
        angle: Math.min(35, Math.max(22, Number(generationSettings.gridAngle) || 30)),
        size: Math.max(5, Number(generationSettings.gridSize) || ISOMETRIC_GRID_SIZE),
      }
    : null;
  const nativeInpaint = !generationMode
    && generationSettings.nativeInpaint === true
    && isOpenAIImageModel(frame.model);
  const composed = generationMode
    ? null
    : await composeSnapshotBackground(
        frame,
        layers,
        canvasW,
        canvasH,
        referenceGrid,
        nativeInpaint,
        drawings,
        tilePaints,
        {
          size: Math.max(5, Number(generationSettings.gridSize) || ISOMETRIC_GRID_SIZE),
          angle: Math.min(35, Math.max(22, Number(generationSettings.gridAngle) || 30)),
        },
      );

  let fullPrompt;
  if (generationMode) {
    fullPrompt = buildGenerationFullPrompt(frame, globalContext);
  } else {
    const resPrompt = await fetch(`${BP}/api/prompt${nativeInpaint ? '?mode=native-inpaint' : ''}`);
    if (!resPrompt.ok) throw new Error('Failed to load the system prompt');
    const { prompt: template } = await resPrompt.json();
    fullPrompt = buildOutpaintFullPrompt(frame, globalContext, template);
  }
  const globalReferenceImage = globalContext.imageId
    ? await loadInputImageForJob(globalContext.imageId)
    : null;
  const resolvedReferences = await loadSnapshotReferenceImages(frame.referenceImages, layers);
  fullPrompt = (fullPrompt || '').trim();
  if (generationMode && !fullPrompt) throw new Error('Enter a prompt to generate an image');
  const jobSpec = buildStudioJobParams(
    frame,
    fullPrompt,
    composed,
    [globalReferenceImage, ...resolvedReferences.map((reference) => reference.image)],
    nativeInpaint,
    generationMode,
  );

  const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const inputImageId = generationMode ? null : `geninput_${batchId}`;
  const inputMaskImageId = nativeInpaint ? `genmask_${batchId}` : null;
  if (composed) {
    const inputBlob = await (await fetch(`data:${composed.mimeType};base64,${composed.data}`)).blob();
    await putStudioImage(inputImageId, inputBlob);
  }
  if (nativeInpaint && composed.mask) {
    const maskBlob = await (await fetch(
      `data:${composed.mask.mimeType};base64,${composed.mask.data}`,
    )).blob();
    await putStudioImage(inputMaskImageId, maskBlob);
  }

  const generationMeta = buildGenerationMeta(
    frame,
    fullPrompt,
    jobSpec,
    inputImageId,
    inputMaskImageId,
    frame.id,
    globalContext,
    { ...generationSettings, generationMode },
    resolvedReferences.map((reference) => reference.meta),
  );

  return {
    canvasW,
    canvasH,
    batchId,
    jobSpec,
    generationMeta,
    placement: {
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
    },
  };
}

export function createVariantImageId() {
  return `var_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createLayerId() {
  return `layer_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * @param {object} layer
 * @param {string} variantImageId
 * @param {string} url
 */
export function appendLayerVariant(layer, variantImageId, url) {
  const variants = layer.variants?.length
    ? [...layer.variants, { imageId: variantImageId }]
    : [{ imageId: layer.id }, { imageId: variantImageId }];
  return {
    ...layer,
    variants,
    activeVariantIndex: variants.length - 1,
    url,
    isNewResult: true,
    regenerating: false,
  };
}

/**
 * @param {object} base
 * @param {string} layerId
 * @param {string} variantImageId
 * @param {string} url
 * @param {object} generationMeta
 * @param {object} placement
 * @param {number} canvasW
 * @param {number} canvasH
 */
export function createGeneratedLayer({
  layerId,
  variantImageId,
  url,
  generationMeta,
  placement,
  canvasW,
  canvasH,
}) {
  return {
    id: layerId,
    url,
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
    naturalWidth: canvasW,
    naturalHeight: canvasH,
    variants: [{ imageId: variantImageId }],
    activeVariantIndex: 0,
    generationMeta,
    isNewResult: true,
    regenerating: false,
  };
}

/**
 * @param {object} layer
 * @param {number} delta
 */
export function cycleLayerVariant(layer, delta) {
  const variants = layer.variants?.length ? layer.variants : [{ imageId: layer.id }];
  if (variants.length <= 1) return layer;
  const n = variants.length;
  const next = (layer.activeVariantIndex + delta + n) % n;
  const imageId = variants[next].imageId;
  return {
    ...layer,
    activeVariantIndex: next,
    // A stable URL reuses the downloaded and decoded image.
    url: studioImageUrl(imageId),
  };
}

/** Generates through this product’s API and returns the result file. */
export async function generateStudioImage(jobSpec) {
  const apiKey = getUserApiKeyForJob(jobSpec.kind);
  if (!apiKey) throw new Error('Enter the selected model’s API key in Settings');
  const res = await fetch(`${BP}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...jobSpec,
      apiKey,
    }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || `Generation failed: ${res.status}`);
  }
  return res.blob();
}

/**
 * Persist the outpaint-studio board: metadata and image files on the server.
 */

import {
  collectStudioImageIds,
  getCachedStudioImageBlob,
  normalizeSnapshotFrameOnLoad,
  normalizeStudioLayer,
  resolveStudioImageSourceUrl,
  sanitizeSnapshotFrameForSave,
  studioImageUrl,
} from './outpaintStudioGenerate';

const BP = typeof window !== 'undefined' ? (process.env.NEXT_PUBLIC_BASE_PATH || '') : '';

function apiUrl(path) {
  return `${BP}${path}`;
}

async function blobFromLayerUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to read layer image: ${res.status}`);
  return res.blob();
}

async function ensureStudioImageOnServer(imageId, sourceUrl) {
  const existing = await fetch(studioImageUrl(imageId));
  if (existing.ok) return;

  const cached = getCachedStudioImageBlob(imageId);
  let blob = cached;
  if (!blob) {
    try {
      blob = await blobFromLayerUrl(sourceUrl);
    } catch (err) {
      if (imageId.startsWith('geninput_')) {
        console.warn('outpaint studio: geninput missing on disk, skip re-upload', imageId);
        return;
      }
      throw err;
    }
  }
  const res = await fetch(apiUrl(`/api/outpaint-studio-image?id=${encodeURIComponent(imageId)}`), {
    method: 'PUT',
    headers: { 'Content-Type': blob.type || 'image/png' },
    body: blob,
  });
  if (!res.ok) throw new Error(`Image save failed: ${imageId}`);
}

/**
 * @param {Object} state
 * @param {Array} state.layers
 * @param {Array} state.snapshotFrames
 * @param {Object} state.viewport
 * @param {string|null} state.selectedLayerId
 */
export async function saveOutpaintStudioBoard(state) {
  const layerMeta = (state.layers || []).map((layer) => ({
    id: layer.id,
    x: layer.x,
    y: layer.y,
    width: layer.width,
    height: layer.height,
    naturalWidth: layer.naturalWidth,
    naturalHeight: layer.naturalHeight,
    ...(layer.locked ? { locked: true } : {}),
    ...(layer.crop ? { crop: layer.crop } : {}),
    ...(layer.variants?.length ? { variants: layer.variants } : {}),
    ...(layer.activeVariantIndex !== undefined ? { activeVariantIndex: layer.activeVariantIndex } : {}),
    ...(layer.generationMeta ? { generationMeta: layer.generationMeta } : {}),
    ...(layer.isNewResult ? { isNewResult: true } : {}),
  }));

  const imageIds = new Set();
  for (const layer of state.layers || []) {
    for (const id of collectStudioImageIds(layer)) {
      imageIds.add(id);
    }
  }

  await Promise.all([...imageIds].map(async (imageId) => {
    const sourceUrl = resolveStudioImageSourceUrl(state.layers, imageId);
    await ensureStudioImageOnServer(imageId, sourceUrl);
  }));

  const res = await fetch(apiUrl('/api/outpaint-studio'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      layers: layerMeta,
      snapshotFrames: (state.snapshotFrames || []).map(sanitizeSnapshotFrameForSave),
      exportFrames: state.exportFrames || [],
      drawings: state.drawings || [],
      tilePaints: state.tilePaints || [],
      viewport: state.viewport || null,
      selectedLayerId: state.selectedLayerId || null,
      gridType: state.gridType === 'isometric' ? 'isometric' : 'dots',
      gridAngle: Number.isFinite(Number(state.gridAngle))
        ? Math.min(35, Math.max(22, Number(state.gridAngle)))
        : 30,
      drawGridInReference: state.drawGridInReference === true,
      nativeInpaint: state.nativeInpaint === true,
      gridSize: state.gridSize !== undefined ? state.gridSize : 20,
      snapToGrid: state.snapToGrid !== undefined ? state.snapToGrid : true,
      snapToElements: state.snapToElements !== undefined ? state.snapToElements : true,
      globalContext: state.globalContext || { prompt: '', imageId: null, imageName: '' },
    }),
  });
  if (!res.ok) throw new Error(`Board save failed: ${res.status}`);
}

/**
 * @returns {Promise<{ layers: Array, snapshotFrames: Array, viewport: Object|null, selectedLayerId: string|null }|null>}
 */
export async function loadOutpaintStudioBoard() {
  const res = await fetch(apiUrl('/api/outpaint-studio'), { cache: 'no-store' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to load the board: ${res.status}`);
  }
  const data = await res.json();
  if (!data) return null;

  const layers = (data.layers || []).map(normalizeStudioLayer);

  return {
    layers,
    snapshotFrames: (data.snapshotFrames || []).map(normalizeSnapshotFrameOnLoad),
    exportFrames: Array.isArray(data.exportFrames) ? data.exportFrames : [],
    drawings: Array.isArray(data.drawings) ? data.drawings : [],
    tilePaints: Array.isArray(data.tilePaints) ? data.tilePaints : [],
    viewport: data.viewport || { panX: 0, panY: 0, zoom: 1 },
    selectedLayerId: data.selectedLayerId || null,
    gridType: data.gridType === 'isometric' ? 'isometric' : 'dots',
    gridAngle: Number.isFinite(Number(data.gridAngle))
      ? Math.min(35, Math.max(22, Number(data.gridAngle)))
      : 30,
    drawGridInReference: data.drawGridInReference === true,
    nativeInpaint: data.nativeInpaint === true,
    gridSize: data.gridSize !== undefined ? data.gridSize : 20,
    snapToGrid: data.snapToGrid !== undefined ? data.snapToGrid : true,
    snapToElements: data.snapToElements !== undefined ? data.snapToElements : true,
    globalContext: data.globalContext || { prompt: '', imageId: null, imageName: '' },
  };
}

let saveTimer = null;
let saveInFlight = false;
let pendingState = null;

/**
 * @param {Object} state
 * @param {(status: 'saving'|'saved'|'error') => void} [onStatus]
 */
export function scheduleSaveOutpaintStudioBoard(state, onStatus) {
  pendingState = state;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    if (!pendingState) return;
    const toSave = pendingState;
    pendingState = null;
    saveInFlight = true;
    onStatus?.('saving');
    try {
      await saveOutpaintStudioBoard(toSave);
      onStatus?.('saved');
    } catch (err) {
      console.error('outpaint studio save:', err);
      onStatus?.('error');
    } finally {
      saveInFlight = false;
      if (pendingState && !saveTimer) {
        scheduleSaveOutpaintStudioBoard(pendingState, onStatus);
      }
    }
  }, 600);
}

export function revokeLayerUrls(layers) {
  for (const layer of layers || []) {
    if (layer?.url?.startsWith('blob:')) {
      try { URL.revokeObjectURL(layer.url); } catch (_) {}
    }
  }
}

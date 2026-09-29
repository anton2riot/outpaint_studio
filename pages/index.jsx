import React, { useState, useRef, useCallback, useEffect } from 'react';

import Head from 'next/head';

import InfiniteCanvas from '../components/InfiniteCanvas';

import StudioToolbar from '../components/StudioToolbar';

import ApiKeysDialog from '../components/ApiKeysDialog';
import CanvasSettingsDialog from '../components/CanvasSettingsDialog';
import { isOpenAIImageModel } from '../lib/nanoBananaModelConfig';
import { getUserApiKeyForJob } from '../lib/userApiKeys';
import { requireUser } from '../lib/requestAuth';

import { getClipboardImageFiles } from '../lib/clipboardImages';
import { useHoveredImagePaste } from '../lib/useHoveredImagePaste';

import {

  loadStudioGenerationDefaults,

  saveStudioGenerationDefaults,

} from '../lib/generationSettings';

import {

  loadOutpaintStudioBoard,

  scheduleSaveOutpaintStudioBoard,

  revokeLayerUrls,

} from '../lib/outpaintStudioPersist';

import {
  appendLayerVariant,
  buildJobParamsFromMeta,
  clearSnapshotGeneratingState,
  createGeneratedLayer,
  createVariantImageId,
  generateStudioImage,
  prepareSnapshotGeneration,
  putStudioImage,
} from '../lib/outpaintStudioGenerate';



const BP = process.env.NEXT_PUBLIC_BASE_PATH || '';

export async function getServerSideProps({ req, res }) {
  await requireUser(req, res);
  return { props: {} };
}

const ACCENT_COLOR = '#007AFF';
const HISTORY_LIMIT = 100;

const MenuIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const SettingsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75" />
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.74v.5a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const KeyIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
    <circle cx="8" cy="15" r="4" stroke="currentColor" strokeWidth="1.75" />
    <path d="m11 12 8-8m-2 2 2 2m-5 1 2 2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const HistoryIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M3 12a9 9 0 1 0 3-6.71L3 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3 4v4h4M12 7v5l3 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PromptIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
    <path d="M8 9h8M8 13h5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
  </svg>
);

const ImageIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
    <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.75" />
    <circle cx="8.5" cy="8.5" r="1.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="m21 15-5-5L5 21" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function isEditableTarget(target) {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function undoableCanvasState(layers, snapshotFrames, drawings = [], tilePaints = [], exportFrames = []) {
  return {
    layers: layers.map(({ regenerating, isNewResult, ...layer }) => layer),
    snapshotFrames: snapshotFrames.map(({
      status,
      error,
      generatingTotal,
      generatingDone,
      generatingErrors,
      ...frame
    }) => frame),
    drawings,
    tilePaints,
    exportFrames,
  };
}

function canvasContentChanged(
  beforeLayers,
  beforeFrames,
  afterLayers,
  afterFrames,
  beforeDrawings = [],
  afterDrawings = [],
  beforeTilePaints = [],
  afterTilePaints = [],
  beforeExportFrames = [],
  afterExportFrames = [],
) {
  return JSON.stringify(undoableCanvasState(beforeLayers, beforeFrames, beforeDrawings, beforeTilePaints, beforeExportFrames))
    !== JSON.stringify(undoableCanvasState(afterLayers, afterFrames, afterDrawings, afterTilePaints, afterExportFrames));
}



export default function OutpaintStudioPage() {

  const canvasRef = useRef(null);

  const wrapRef = useRef(null);
  const globalReferenceInputRef = useRef(null);
  const globalReferencePasteTargetRef = useRef(null);
  const menuRef = useRef(null);

  const layersRef = useRef([]);
  const snapshotFramesRef = useRef([]);
  const exportFramesRef = useRef([]);
  const drawingsRef = useRef([]);
  const tilePaintsRef = useRef([]);
  const selectedLayerIdRef = useRef(null);
  const selectedSnapshotIdRef = useRef(null);
  const selectedExportFrameIdRef = useRef(null);
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const historyTransactionRef = useRef(null);
  const retainedBlobUrlsRef = useRef(new Set());

  const hydratedRef = useRef(false);
  const skipSaveOnceRef = useRef(false);
  const batchLayersRef = useRef({});
  const batchProgressRef = useRef({});
  const batchFrameRef = useRef({});
  const cancelledBatchesRef = useRef(new Set());



  const [layers, setLayers] = useState([]);

  const [selectedLayerId, setSelectedLayerId] = useState(null);

  const [viewport, setViewport] = useState({ panX: 0, panY: 0, zoom: 1 });

  const [screenPixelRatio, setScreenPixelRatio] = useState(1);

  const [snapshotFrames, setSnapshotFrames] = useState([]);

  const [exportFrames, setExportFrames] = useState([]);

  const [drawings, setDrawings] = useState([]);

  const [tilePaints, setTilePaints] = useState([]);

  const [activeTool, setActiveTool] = useState('select');

  const [brushColor, setBrushColor] = useState('#1c1c1e');

  const [brushSize, setBrushSize] = useState(8);

  const [eraserSize, setEraserSize] = useState(28);

  const [tileColor, setTileColor] = useState('#ffcc00');

  const [tileBrushSize, setTileBrushSize] = useState(1);

  const [toolSettingsDismissVersion, setToolSettingsDismissVersion] = useState(0);

  const [selectedSnapshotId, setSelectedSnapshotId] = useState(null);

  const [selectedExportFrameId, setSelectedExportFrameId] = useState(null);

  const [generationDefaults, setGenerationDefaults] = useState({

    imageSize: '2K',

    aspectRatio: '16:9',

    model: 'nb2',

  });

  const [boardLoading, setBoardLoading] = useState(true);
  const [boardLoadError, setBoardLoadError] = useState('');

  const [gridSize, setGridSize] = useState(20);

  const [gridType, setGridType] = useState('dots');

  const [gridAngle, setGridAngle] = useState(30);

  const [drawGridInReference, setDrawGridInReference] = useState(false);

  const [nativeInpaint, setNativeInpaint] = useState(false);

  const [snapToGrid, setSnapToGrid] = useState(true);

  const [snapToElements, setSnapToElements] = useState(true);

  const [globalContext, setGlobalContext] = useState({ prompt: '', imageId: null, imageName: '' });
  const [globalContextOpen, setGlobalContextOpen] = useState(false);
  const [globalReferenceUploading, setGlobalReferenceUploading] = useState(false);
  const [globalContextError, setGlobalContextError] = useState('');

  const [menuOpen, setMenuOpen] = useState(false);
  const [canvasSettingsOpen, setCanvasSettingsOpen] = useState(false);
  const [apiKeysOpen, setApiKeysOpen] = useState(false);
  const [requiredApiKeyProvider, setRequiredApiKeyProvider] = useState(null);

  const requireApiKeyForModel = useCallback((model) => {
    const kind = isOpenAIImageModel(model) ? 'openai-image' : 'gemini';
    if (getUserApiKeyForJob(kind)) return true;
    setRequiredApiKeyProvider(kind === 'openai-image' ? 'openai' : 'gemini');
    setApiKeysOpen(true);
    return false;
  }, []);

  useEffect(() => {
    const syncScreenPixelRatio = () => {
      setScreenPixelRatio(window.devicePixelRatio || 1);
    };

    syncScreenPixelRatio();
    window.addEventListener('resize', syncScreenPixelRatio);
    return () => window.removeEventListener('resize', syncScreenPixelRatio);
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeMenu = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const closeMenuOnEscape = (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeMenu);
    window.addEventListener('keydown', closeMenuOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeMenu);
      window.removeEventListener('keydown', closeMenuOnEscape);
    };
  }, [menuOpen]);



  layersRef.current = layers;
  snapshotFramesRef.current = snapshotFrames;
  exportFramesRef.current = exportFrames;
  drawingsRef.current = drawings;
  tilePaintsRef.current = tilePaints;
  selectedLayerIdRef.current = selectedLayerId;
  selectedSnapshotIdRef.current = selectedSnapshotId;
  selectedExportFrameIdRef.current = selectedExportFrameId;

  const retainBlobUrls = useCallback((items) => {
    items.forEach((layer) => {
      if (layer?.url?.startsWith('blob:')) retainedBlobUrlsRef.current.add(layer.url);
    });
  }, []);

  const captureCanvasHistory = useCallback(() => ({
    layers: layersRef.current.map((layer) => (
      layer.regenerating ? { ...layer, regenerating: false } : layer
    )),
    snapshotFrames: snapshotFramesRef.current.map((frame) => (
      frame.status === 'generating' ? clearSnapshotGeneratingState(frame) : frame
    )),
    drawings: drawingsRef.current,
    tilePaints: tilePaintsRef.current,
    exportFrames: exportFramesRef.current,
    selectedLayerId: selectedLayerIdRef.current,
    selectedSnapshotId: selectedSnapshotIdRef.current,
    selectedExportFrameId: selectedExportFrameIdRef.current,
  }), []);

  const pushUndoSnapshot = useCallback((snapshot) => {
    undoStackRef.current.push(snapshot);
    if (undoStackRef.current.length > HISTORY_LIMIT) undoStackRef.current.shift();
    redoStackRef.current = [];
  }, []);

  const recordCanvasChange = useCallback((
    beforeLayers,
    beforeFrames,
    afterLayers,
    afterFrames,
    beforeDrawings = drawingsRef.current,
    afterDrawings = drawingsRef.current,
    beforeTilePaints = tilePaintsRef.current,
    afterTilePaints = tilePaintsRef.current,
    beforeExportFrames = exportFramesRef.current,
    afterExportFrames = exportFramesRef.current,
  ) => {
    if (!hydratedRef.current || !canvasContentChanged(
      beforeLayers,
      beforeFrames,
      afterLayers,
      afterFrames,
      beforeDrawings,
      afterDrawings,
      beforeTilePaints,
      afterTilePaints,
      beforeExportFrames,
      afterExportFrames,
    )) return;
    if (historyTransactionRef.current) {
      historyTransactionRef.current.changed = true;
      return;
    }
    pushUndoSnapshot(captureCanvasHistory());
  }, [captureCanvasHistory, pushUndoSnapshot]);

  const beginCanvasHistoryTransaction = useCallback((type = 'canvas') => {
    if (!hydratedRef.current) return;
    const active = historyTransactionRef.current;
    if (active?.type === type) return;
    if (active?.changed && canvasContentChanged(
      active.before.layers,
      active.before.snapshotFrames,
      layersRef.current,
      snapshotFramesRef.current,
      active.before.drawings,
      drawingsRef.current,
      active.before.tilePaints,
      tilePaintsRef.current,
      active.before.exportFrames,
      exportFramesRef.current,
    )) {
      pushUndoSnapshot(active.before);
    }
    historyTransactionRef.current = {
      before: captureCanvasHistory(),
      changed: false,
      type,
    };
  }, [captureCanvasHistory, pushUndoSnapshot]);

  const endCanvasHistoryTransaction = useCallback((type = 'canvas') => {
    const transaction = historyTransactionRef.current;
    if (!transaction || transaction.type !== type) return;
    historyTransactionRef.current = null;
    if (!transaction.changed) return;
    if (canvasContentChanged(
      transaction.before.layers,
      transaction.before.snapshotFrames,
      layersRef.current,
      snapshotFramesRef.current,
      transaction.before.drawings,
      drawingsRef.current,
      transaction.before.tilePaints,
      tilePaintsRef.current,
      transaction.before.exportFrames,
      exportFramesRef.current,
    )) {
      pushUndoSnapshot(transaction.before);
    }
  }, [pushUndoSnapshot]);

  const restoreCanvasHistory = useCallback((snapshot) => {
    historyTransactionRef.current = null;
    retainBlobUrls([...layersRef.current, ...snapshot.layers]);
    layersRef.current = snapshot.layers;
    snapshotFramesRef.current = snapshot.snapshotFrames;
    drawingsRef.current = snapshot.drawings || [];
    tilePaintsRef.current = snapshot.tilePaints || [];
    exportFramesRef.current = snapshot.exportFrames || [];
    selectedLayerIdRef.current = snapshot.selectedLayerId;
    selectedSnapshotIdRef.current = snapshot.selectedSnapshotId;
    selectedExportFrameIdRef.current = snapshot.selectedExportFrameId;
    setLayers(snapshot.layers);
    setSnapshotFrames(snapshot.snapshotFrames);
    setDrawings(snapshot.drawings || []);
    setTilePaints(snapshot.tilePaints || []);
    setExportFrames(snapshot.exportFrames || []);
    setSelectedLayerId(snapshot.selectedLayerId);
    setSelectedSnapshotId(snapshot.selectedSnapshotId);
    setSelectedExportFrameId(snapshot.selectedExportFrameId || null);

    const frame = snapshot.snapshotFrames[snapshot.snapshotFrames.length - 1];
    if (frame) {
      setGenerationDefaults({
        imageSize: frame.imageSize,
        aspectRatio: frame.aspectRatio,
        model: frame.model || 'nb2',
      });
    }
  }, [retainBlobUrls]);

  const undo = useCallback(() => {
    const target = undoStackRef.current.pop();
    if (!target) return false;
    redoStackRef.current.push(captureCanvasHistory());
    restoreCanvasHistory(target);
    return true;
  }, [captureCanvasHistory, restoreCanvasHistory]);

  const redo = useCallback(() => {
    const target = redoStackRef.current.pop();
    if (!target) return false;
    undoStackRef.current.push(captureCanvasHistory());
    restoreCanvasHistory(target);
    return true;
  }, [captureCanvasHistory, restoreCanvasHistory]);

  useEffect(() => {
    const handleHistoryShortcut = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      const isZ = event.code === 'KeyZ' || key === 'z';
      const isY = event.code === 'KeyY' || key === 'y';
      const wantsUndo = isZ && !event.shiftKey;
      const wantsRedo = isY || (isZ && event.shiftKey);
      if (!wantsUndo && !wantsRedo) return;
      const handled = wantsUndo ? undo() : redo();
      if (handled) event.preventDefault();
    };
    window.addEventListener('keydown', handleHistoryShortcut);
    return () => window.removeEventListener('keydown', handleHistoryShortcut);
  }, [undo, redo]);

  useEffect(() => {

    setGenerationDefaults(loadStudioGenerationDefaults());

  }, []);



  useEffect(() => {

    let cancelled = false;
    let loaded = false;

    (async () => {

      try {

        const saved = await loadOutpaintStudioBoard();

        if (cancelled) return;

        if (saved) {

          setLayers(saved.layers || []);

          setSnapshotFrames(saved.snapshotFrames || []);

          setExportFrames(saved.exportFrames || []);

          setDrawings(saved.drawings || []);

          setTilePaints(saved.tilePaints || []);

          setViewport(saved.viewport || { panX: 0, panY: 0, zoom: 1 });

          setSelectedLayerId(saved.selectedLayerId);

          if (saved.gridSize !== undefined) {
            setGridSize(saved.gridSize);
          }

          if (saved.gridType !== undefined) {
            setGridType(saved.gridType);
          }

          if (saved.gridAngle !== undefined) {
            setGridAngle(saved.gridAngle);
          }

          if (saved.drawGridInReference !== undefined) {
            setDrawGridInReference(saved.drawGridInReference);
          }

          if (saved.nativeInpaint !== undefined) {
            setNativeInpaint(saved.nativeInpaint);
          }

          if (saved.snapToGrid !== undefined) {
            setSnapToGrid(saved.snapToGrid);
          }

          if (saved.snapToElements !== undefined) {
            setSnapToElements(saved.snapToElements);
          }

          if (saved.globalContext) {
            setGlobalContext({
              prompt: saved.globalContext.prompt || '',
              imageId: saved.globalContext.imageId || null,
              imageName: saved.globalContext.imageName || '',
            });
          }

          const defaultFrame = saved.snapshotFrames?.[0];

          if (defaultFrame) {

            setGenerationDefaults({

              imageSize: defaultFrame.imageSize,

              aspectRatio: defaultFrame.aspectRatio,

              model: defaultFrame.model || 'nb2',

            });

          }

        }
        loaded = true;

      } catch (err) {

        console.error('outpaint studio load:', err);
        if (!cancelled) setBoardLoadError(err.message || 'Failed to load the board');

      } finally {

        if (!cancelled && loaded) {

          hydratedRef.current = true;

          undoStackRef.current = [];

          redoStackRef.current = [];

          skipSaveOnceRef.current = true;

          setBoardLoading(false);

        }

      }

    })();

    return () => {

      cancelled = true;

      revokeLayerUrls([
        ...layersRef.current,
        ...Array.from(retainedBlobUrlsRef.current, (url) => ({ url })),
      ]);

    };

  }, []);



  useEffect(() => {

    if (!hydratedRef.current || boardLoading) return undefined;

    if (skipSaveOnceRef.current) {

      skipSaveOnceRef.current = false;

      return undefined;

    }

    scheduleSaveOutpaintStudioBoard({

      layers,

      snapshotFrames,

      exportFrames,

      drawings,

      tilePaints,

      viewport,

      selectedLayerId,

      gridSize,

      gridType,

      gridAngle,

      drawGridInReference,

      nativeInpaint,

      snapToGrid,

      snapToElements,

      globalContext,

    });

    if (window.opener) {
      try {
        window.opener.postMessage({
          type: 'outpaint-canvas-changed',
          layers,
          selectedLayerId,
        }, '*');
      } catch (e) {
        console.warn('postMessage to opener failed:', e);
      }
    }

    return undefined;

  }, [layers, snapshotFrames, exportFrames, drawings, tilePaints, viewport, selectedLayerId, boardLoading, gridSize, gridType, gridAngle, drawGridInReference, nativeInpaint, snapToGrid, snapToElements, globalContext]);



  useEffect(() => {

    const el = wrapRef.current;

    if (!el || boardLoading) return undefined;

    const ro = new ResizeObserver(() => {

      const rect = el.getBoundingClientRect();

      if (layers.length === 0 && snapshotFrames.length === 0 && exportFrames.length === 0 && drawings.length === 0 && tilePaints.length === 0 && rect.width > 0) {

        setViewport((v) => ({

          ...v,

          panX: rect.width / 2,

          panY: rect.height / 2,

        }));

      }

    });

    ro.observe(el);

    return () => ro.disconnect();

  }, [layers.length, snapshotFrames.length, exportFrames.length, drawings.length, tilePaints.length, boardLoading]);



  const handleLayersChange = useCallback((next) => {
    const previous = layersRef.current;
    retainBlobUrls([...previous, ...next]);
    recordCanvasChange(previous, snapshotFramesRef.current, next, snapshotFramesRef.current);
    layersRef.current = next;
    setLayers(next);
  }, [recordCanvasChange, retainBlobUrls]);



  const handleSnapshotFramesChange = useCallback((frames) => {
    const previous = snapshotFramesRef.current;
    recordCanvasChange(layersRef.current, previous, layersRef.current, frames);
    snapshotFramesRef.current = frames;
    setSnapshotFrames(frames);

    const frame = frames[frames.length - 1];

    if (frame) {

      saveStudioGenerationDefaults(frame.imageSize, frame.aspectRatio, frame.model);

      setGenerationDefaults({
        imageSize: frame.imageSize,
        aspectRatio: frame.aspectRatio,
        model: frame.model || 'nb2',
      });

    }

  }, []);



  const handleResetZoom = useCallback(() => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;

    setViewport((current) => {
      const currentZoom = current.zoom > 0 ? current.zoom : 1;
      const targetZoom = 1 / screenPixelRatio;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const worldCenterX = (centerX - current.panX) / currentZoom;
      const worldCenterY = (centerY - current.panY) / currentZoom;
      return {
        ...current,
        zoom: targetZoom,
        panX: centerX - worldCenterX * targetZoom,
        panY: centerY - worldCenterY * targetZoom,
      };
    });
  }, [screenPixelRatio]);



  const applyVariantToBatch = useCallback((batchId, {
    variantImageId,
    url,
    generationMeta,
    placement,
    canvasW,
    canvasH,
  }) => {
    if (!batchLayersRef.current[batchId]) {
      batchLayersRef.current[batchId] = variantImageId;
    }
    const layerId = batchLayersRef.current[batchId];
    const currentLayers = layersRef.current;
    const existing = currentLayers.find((l) => l.id === layerId);
    const nextLayers = existing
      ? currentLayers.map((l) => (
        l.id === layerId ? appendLayerVariant(l, variantImageId, url) : l
      ))
      : [...currentLayers, createGeneratedLayer({
        layerId,
        variantImageId,
        url,
        generationMeta,
        placement,
        canvasW,
        canvasH,
      })];
    handleLayersChange(nextLayers);
    setSelectedLayerId(layerId);
  }, [handleLayersChange]);

  const finishBatchJob = useCallback((frameId, batchId, total, errorMsg) => {
    if (!batchProgressRef.current[batchId]) {
      batchProgressRef.current[batchId] = { done: 0, errors: [] };
    }
    const prog = batchProgressRef.current[batchId];
    prog.done += 1;
    if (errorMsg) prog.errors.push(errorMsg);

    const cancelled = cancelledBatchesRef.current.has(batchId);

    if (!cancelled) {
      setSnapshotFrames((prev) => prev.map((f) => (
        f.id === frameId ? { ...f, generatingDone: prog.done } : f
      )));
    }

    if (prog.done < total) return;

    const errors = prog.errors;
    delete batchProgressRef.current[batchId];
    delete batchLayersRef.current[batchId];
    delete batchFrameRef.current[batchId];
    cancelledBatchesRef.current.delete(batchId);

    if (cancelled) return;

    setSnapshotFrames((prev) => prev.map((f) => {
      if (f.id !== frameId) return f;
      if (errors.length === total) {
        return {
          ...f,
          status: 'error',
          error: errors[0] || 'Generation failed',
          generatingTotal: undefined,
          generatingDone: undefined,
        };
      }
      return {
        ...f,
        status: 'idle',
        error: errors.length ? `Some variants could not be generated (${errors.length})` : undefined,
        generatingTotal: undefined,
        generatingDone: undefined,
      };
    }));
  }, []);

  const runStudioJobForBatch = useCallback(async ({
    frameId,
    batchId,
    jobSpec,
    generationMeta,
    placement,
    canvasW,
    canvasH,
    jobIndex,
    total,
  }) => {
    let errorMsg = null;
    try {
      const imgBlob = await generateStudioImage(jobSpec);
      const variantImageId = createVariantImageId();
      const url = await putStudioImage(variantImageId, imgBlob);
      applyVariantToBatch(batchId, {
        variantImageId,
        url,
        generationMeta,
        placement,
        canvasW,
        canvasH,
      });
    } catch (err) {
      console.error('Studio job failed:', err);
      errorMsg = err.message || 'Generation failed';
    }
    finishBatchJob(frameId, batchId, total, errorMsg);
  }, [applyVariantToBatch, finishBatchJob]);

  const handleSnapshotGenerate = useCallback(async (frameId, variantCount = 1) => {
    const frame = snapshotFrames.find((f) => f.id === frameId);
    if (!frame || frame.status === 'generating') return;
    if (!requireApiKeyForModel(frame.model)) return;

    const total = Math.max(1, Math.min(4, variantCount));

    setSnapshotFrames((prev) =>
      prev.map((f) => (f.id === frameId ? {
        ...f,
        status: 'generating',
        error: undefined,
        generatingTotal: total,
        generatingDone: 0,
        generatingErrors: undefined,
      } : f))
    );

    try {
      const prep = await prepareSnapshotGeneration(frame, layersRef.current, globalContext, {
        gridType,
        gridAngle,
        gridSize,
        drawGridInReference,
        nativeInpaint,
      }, drawingsRef.current, tilePaintsRef.current);
      const { batchId, jobSpec, generationMeta, placement, canvasW, canvasH } = prep;
      batchFrameRef.current[batchId] = frameId;

      await Promise.all(
        Array.from({ length: total }, (_, jobIndex) => runStudioJobForBatch({
          frameId,
          batchId,
          jobSpec,
          generationMeta,
          placement,
          canvasW,
          canvasH,
          jobIndex,
          total,
        })),
      );
    } catch (err) {
      console.error('Generation error:', err);
      setSnapshotFrames((prev) =>
        prev.map((f) => (f.id === frameId ? {
          ...f,
          status: 'error',
          error: err.message,
          generatingTotal: undefined,
          generatingDone: undefined,
        } : f))
      );
    }
  }, [snapshotFrames, runStudioJobForBatch, globalContext, gridType, gridAngle, gridSize, drawGridInReference, nativeInpaint, requireApiKeyForModel]);

  const handleSnapshotCancelGeneration = useCallback((frameId) => {
    Object.entries(batchFrameRef.current).forEach(([batchId, fId]) => {
      if (fId === frameId) cancelledBatchesRef.current.add(batchId);
    });
    setSnapshotFrames((prev) => prev.map((f) => (
      f.id === frameId ? clearSnapshotGeneratingState(f) : f
    )));
  }, [recordCanvasChange]);

  const handleDrawingsChange = useCallback((next) => {
    const previous = drawingsRef.current;
    recordCanvasChange(
      layersRef.current,
      snapshotFramesRef.current,
      layersRef.current,
      snapshotFramesRef.current,
      previous,
      next,
    );
    drawingsRef.current = next;
    setDrawings(next);
  }, [recordCanvasChange]);

  const handleTilePaintsChange = useCallback((next) => {
    const previous = tilePaintsRef.current;
    recordCanvasChange(
      layersRef.current,
      snapshotFramesRef.current,
      layersRef.current,
      snapshotFramesRef.current,
      drawingsRef.current,
      drawingsRef.current,
      previous,
      next,
    );
    tilePaintsRef.current = next;
    setTilePaints(next);
  }, [recordCanvasChange]);

  const uploadGlobalReference = useCallback(async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setGlobalContextError('Only image files can be selected');
      return;
    }

    setGlobalReferenceUploading(true);
    setGlobalContextError('');
    try {
      const imageId = `globalref_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await putStudioImage(imageId, file);
      setGlobalContext((prev) => ({ ...prev, imageId, imageName: file.name }));
    } catch (err) {
      console.error('Global reference upload:', err);
      setGlobalContextError(err.message || 'Failed to load the image');
    } finally {
      setGlobalReferenceUploading(false);
    }
  }, []);

  const handleExportFramesChange = useCallback((frames) => {
    const previous = exportFramesRef.current;
    recordCanvasChange(
      layersRef.current,
      snapshotFramesRef.current,
      layersRef.current,
      snapshotFramesRef.current,
      drawingsRef.current,
      drawingsRef.current,
      tilePaintsRef.current,
      tilePaintsRef.current,
      previous,
      frames,
    );
    exportFramesRef.current = frames;
    setExportFrames(frames);
  }, [recordCanvasChange]);

  const handleGlobalReferenceFile = useCallback((event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    uploadGlobalReference(file);
  }, [uploadGlobalReference]);

  const handleGlobalReferencePaste = useCallback((event) => {
    const file = getClipboardImageFiles(event.clipboardData)[0];
    if (!file) return;
    event.preventDefault();
    event.stopPropagation();
    uploadGlobalReference(file);
  }, [uploadGlobalReference]);

  useHoveredImagePaste(
    globalReferencePasteTargetRef,
    ([file]) => uploadGlobalReference(file),
    !globalContextOpen || globalReferenceUploading,
  );

  const handleLayerRegenerate = useCallback(async (layerId) => {
    const layer = layersRef.current.find((l) => l.id === layerId);
    if (!layer?.generationMeta || layer.regenerating) return;
    if (!requireApiKeyForModel(layer.generationMeta.model)) return;

    setLayers((prev) => prev.map((l) => (
      l.id === layerId ? { ...l, regenerating: true } : l
    )));

    try {
      const jobSpec = await buildJobParamsFromMeta(layer.generationMeta, {
        snapshotFrames: snapshotFramesRef.current,
        layers: layersRef.current,
        drawings: drawingsRef.current,
        tilePaints: tilePaintsRef.current,
        excludeLayerId: layerId,
      });
      const imgBlob = await generateStudioImage(jobSpec);
      const variantImageId = createVariantImageId();
      const url = await putStudioImage(variantImageId, imgBlob);
      handleLayersChange(layersRef.current.map((l) => {
        if (l.id !== layerId) return l;
        return appendLayerVariant(l, variantImageId, url);
      }));
    } catch (err) {
      console.error('Regenerate error:', err);
      setLayers((prev) => prev.map((l) => (
        l.id === layerId ? { ...l, regenerating: false } : l
      )));
    }
  }, [handleLayersChange, requireApiKeyForModel]);



  const zoomPercent = Math.round(viewport.zoom * screenPixelRatio * 100);

  return (

    <>

      <Head>

        <title>Outpaint Studio — Canvas</title>

      </Head>

      <div className="studio-app">

        <header className="topbar">
          <div className="app-menu" ref={menuRef}>
            <button
              type="button"
              aria-label="Menu"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              data-tooltip="Menu"
              onClick={() => setMenuOpen((open) => !open)}
              className={`btn btn-icon menu-trigger studio-tooltip${menuOpen ? ' active' : ''}`}
            >
              <MenuIcon />
            </button>
            {menuOpen && (
              <div className="app-menu-popover" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    window.location.assign(`${BP}/history`);
                  }}
                >
                  <HistoryIcon />
                  Generation history
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setCanvasSettingsOpen(true);
                  }}
                >
                  <SettingsIcon />
                  Settings
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setRequiredApiKeyProvider(null);
                    setApiKeysOpen(true);
                  }}
                >
                  <KeyIcon />
                  Set API keys
                </button>
              </div>
            )}
          </div>

          <button

            type="button"

            onClick={() => {
              setGlobalContextError('');
              setGlobalContextOpen(true);
            }}

            disabled={boardLoading}

            data-tooltip="Shared prompt and reference for all new generations"

            className={`btn studio-tooltip${globalContext.imageId || globalContext.prompt.trim() ? ' btn-context-active' : ''}`}

          >

            <span>Context</span>
            <span
              className={`context-indicator${globalContext.prompt.trim() ? ' active' : ''}`}
              aria-label={globalContext.prompt.trim() ? 'Prompt set' : 'No prompt set'}
            >
              <PromptIcon />
            </span>
            <span
              className={`context-indicator${globalContext.imageId ? ' active' : ''}`}
              aria-label={globalContext.imageId ? 'Image set' : 'No image set'}
            >
              <ImageIcon />
            </span>

          </button>

          <button
            type="button"
            className={`zoom-indicator studio-tooltip${zoomPercent === 100 ? ' active' : ''}`}
            onClick={handleResetZoom}
            disabled={boardLoading}
            data-tooltip="Canvas zoom. Click for 1 image px = 1 screen px"
          >
            Canvas {zoomPercent}%
          </button>


        </header>



        <div className="studio-workspace">

          <StudioToolbar

            accentColor={ACCENT_COLOR}

            onUpload={() => canvasRef.current?.openFilePicker()}

            onSnapshot={() => canvasRef.current?.placeSnapshotAtCenter()}

            onExport={() => canvasRef.current?.placeExportFrameAtCenter()}

            uploadDisabled={boardLoading}

            activeTool={activeTool}

            onToolChange={setActiveTool}

            brushColor={brushColor}

            brushSize={brushSize}

            onBrushColorChange={setBrushColor}

            onBrushSizeChange={setBrushSize}

            eraserSize={eraserSize}

            onEraserSizeChange={setEraserSize}

            tileColor={tileColor}

            onTileColorChange={setTileColor}

            tileBrushSize={tileBrushSize}

            onTileBrushSizeChange={setTileBrushSize}

            tileToolDisabled={gridType !== 'isometric'}

            settingsDismissVersion={toolSettingsDismissVersion}

          />

          <div ref={wrapRef} className="canvas-wrap">

            {boardLoadError && (
              <div role="alert" className="board-load-error">
                <p>{boardLoadError}</p>
                <button type="button" className="btn" onClick={() => window.location.reload()}>
                  Retry
                </button>
              </div>
            )}

            {!boardLoading && (

              <InfiniteCanvas

                ref={canvasRef}

                layers={layers}

                onLayersChange={handleLayersChange}

                selectedLayerId={selectedLayerId}

                onSelectedLayerIdChange={setSelectedLayerId}

                accentColor={ACCENT_COLOR}

                viewport={viewport}

                onViewportChange={setViewport}

                snapshotFrames={snapshotFrames}

                onSnapshotFramesChange={handleSnapshotFramesChange}

                exportFrames={exportFrames}

                onExportFramesChange={handleExportFramesChange}

                selectedExportFrameId={selectedExportFrameId}

                onSelectedExportFrameIdChange={setSelectedExportFrameId}

                drawings={drawings}

                onDrawingsChange={handleDrawingsChange}

                activeTool={activeTool}

                onToolChange={setActiveTool}

                brushColor={brushColor}

                brushSize={brushSize}

                eraserSize={eraserSize}

                tilePaints={tilePaints}

                onTilePaintsChange={handleTilePaintsChange}

                tileColor={tileColor}

                tileBrushSize={tileBrushSize}

                onToolActionStart={() => setToolSettingsDismissVersion((version) => version + 1)}

                selectedSnapshotId={selectedSnapshotId}

                onSelectedSnapshotIdChange={setSelectedSnapshotId}

                generationDefaults={generationDefaults}

                onSnapshotGenerate={handleSnapshotGenerate}

                onSnapshotCancelGeneration={handleSnapshotCancelGeneration}

                onLayerRegenerate={handleLayerRegenerate}

                onHistoryTransactionStart={beginCanvasHistoryTransaction}

                onHistoryTransactionEnd={endCanvasHistoryTransaction}

                gridSize={gridSize}

                gridType={gridType}

                gridAngle={gridAngle}

                snapToGrid={gridType === 'dots' && snapToGrid}

                snapToElements={snapToElements}

                globalContext={globalContext}

                onOpenGlobalContext={() => setGlobalContextOpen(true)}

              />

            )}

          </div>

        </div>

        {globalContextOpen && (

          <div

            role="dialog"

            aria-modal="true"

            aria-label="Shared generation context"

            className="dialog-backdrop"

            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setGlobalContextOpen(false);
            }}

          >

            <div
              className="dialog-panel"
              style={{ maxWidth: '460px' }}
              onPaste={handleGlobalReferencePaste}
            >

              <div className="dialog-header">

                <div>

                  <div className="dialog-title">Shared context</div>

                  <div className="dialog-subtitle">Added to all new requests.</div>

                </div>

                <button type="button" onClick={() => setGlobalContextOpen(false)} className="btn btn-icon" aria-label="Close"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2.5 2.5l9 9m0-9l-9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></button>

              </div>

              <label className="form-label">

                Instruction for all requests

                <textarea

                  value={globalContext.prompt}

                  onChange={(event) => setGlobalContext((prev) => ({ ...prev, prompt: event.target.value }))}

                  placeholder="For example: follow the style and color palette of the reference"

                  rows={4}

                  className="form-control"

                />

              </label>

              <div ref={globalReferencePasteTargetRef} data-image-paste-target>
              <div className="dialog-section-title">Additional image</div>

              <input ref={globalReferenceInputRef} type="file" accept="image/*" onChange={handleGlobalReferenceFile} style={{ display: 'none' }} />

              {globalContext.imageId ? (

                <div className="reference-card">

                  <img src={`${BP}/api/outpaint-studio-image?id=${encodeURIComponent(globalContext.imageId)}`} alt="Additional reference" />

                  <span className="reference-name">{globalContext.imageName || 'Image selected'}</span>

                  <button type="button" onClick={() => setGlobalContext((prev) => ({ ...prev, imageId: null, imageName: '' }))} className="btn btn-danger btn-sm">Remove</button>

                </div>

              ) : (

                <div className="form-hint">Optional. Choose a file or paste an image from the clipboard (Ctrl+V).</div>

              )}

              <button type="button" disabled={globalReferenceUploading} onClick={() => globalReferenceInputRef.current?.click()} className="btn btn-accent" style={{ marginTop: '12px' }}>

                {globalReferenceUploading ? 'Uploading...' : globalContext.imageId ? 'Replace image' : 'Add image'}

              </button>

              {globalContext.imageId && (
                <div className="form-hint">To replace the image, hover here and press Ctrl+V.</div>
              )}
              </div>

              {globalContextError && <div className="form-error">{globalContextError}</div>}

            </div>

          </div>

        )}

        {canvasSettingsOpen && (
          <CanvasSettingsDialog
            gridType={gridType}
            onGridTypeChange={(nextGridType) => {
              setGridType(nextGridType);
              if (nextGridType !== 'isometric' && activeTool === 'tile') setActiveTool('select');
            }}
            gridAngle={gridAngle}
            onGridAngleChange={setGridAngle}
            drawGridInReference={drawGridInReference}
            onDrawGridInReferenceChange={setDrawGridInReference}
            nativeInpaint={nativeInpaint}
            onNativeInpaintChange={setNativeInpaint}
            gridSize={gridSize}
            onGridSizeChange={setGridSize}
            snapToGrid={snapToGrid}
            onSnapToGridChange={setSnapToGrid}
            snapToElements={snapToElements}
            onSnapToElementsChange={setSnapToElements}
            onClose={() => setCanvasSettingsOpen(false)}
          />
        )}

        {apiKeysOpen && (
          <ApiKeysDialog
            accentColor={ACCENT_COLOR}
            requiredProvider={requiredApiKeyProvider}
            onClose={() => {
              setApiKeysOpen(false);
              setRequiredApiKeyProvider(null);
            }}
          />
        )}

      </div>

    </>

  );

}

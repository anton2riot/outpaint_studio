import React, {
  useRef, useCallback, useEffect, useLayoutEffect, useState, useMemo, forwardRef, useImperativeHandle,
} from 'react';
import {
  collectInfiniteSnapTargets,
  snapMoveRect,
  snapResizeRect,
} from '../lib/outpaintSnap';
import {
  loadImageFromFile,
  defaultLayerSize,
  screenToWorld,
  createLayerId,
  paintGridCanvas,
  getIsometricCellAtPoint,
  getIsometricCellPolygon,
  getLayerSizeDisplay,
  getLayerScalePercent,
  resolveLayerNaturalSize,
  buildNaturalSizePatch,
  downloadLayerImage,
  screenPx,
} from '../lib/infiniteCanvasUtils';
import {
  createSnapshotFrame,
  applySnapshotSettings,
  resizeSnapshotFrame,
  resetSnapshotToDefaultSize,
  coerceImageSizeForModel,
} from '../lib/generationSettings';
import SnapshotFrame from './SnapshotFrame';
import ExportFrame from './ExportFrame';
import ScreenSpacePanel from './ScreenSpacePanel';
import { STUDIO_EXPORT_DRAG_TYPE, STUDIO_SNAPSHOT_DRAG_TYPE } from './StudioToolbar';
import {
  composeSnapshotBackground,
  cycleLayerVariant,
  isSnapshotGenerationMode,
  putStudioImage,
  studioImageUrl,
} from '../lib/outpaintStudioGenerate';
import { useHoveredImagePaste } from '../lib/useHoveredImagePaste';
import { getLayerImageStyle, isLayerCropped, normalizeLayerCrop } from '../lib/layerCrop';

const MIN_LAYER_SIZE = 16;
const HANDLE_SIZE = 8;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
const LAYER_SEAM_OVERLAP_PX = 0.75;
const EMPTY_SNAP_CONTEXT = { xTargets: [], yTargets: [] };

const RESIZE_HANDLES = ['nw', 'ne', 'se', 'sw'];
const CROP_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function strokePath(points) {
  if (!points?.length) return '';
  if (points.length === 1) {
    const point = points[0];
    return `M ${point.x} ${point.y} L ${point.x + 0.01} ${point.y}`;
  }
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    const midX = (point.x + next.x) / 2;
    const midY = (point.y + next.y) / 2;
    path += ` Q ${point.x} ${point.y} ${midX} ${midY}`;
  }
  const last = points[points.length - 1];
  path += ` L ${last.x} ${last.y}`;
  return path;
}

function drawingBounds(actions) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxWidth = 0;
  actions.forEach((action) => {
    maxWidth = Math.max(maxWidth, Number(action.width) || 0);
    (action.points || []).forEach((point) => {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    });
  });
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 1, height: 1 };
  const padding = maxWidth + 16;
  return {
    x: minX - padding,
    y: minY - padding,
    width: Math.max(1, maxX - minX + padding * 2),
    height: Math.max(1, maxY - minY + padding * 2),
  };
}

function getTileBrushCells(cell, brushSize) {
  const size = Math.max(1, Math.min(10, Math.round(Number(brushSize) || 1)));
  const startU = cell.u - Math.floor((size - 1) / 2);
  const startV = cell.v - Math.floor((size - 1) / 2);
  const cells = [];
  for (let uOffset = 0; uOffset < size; uOffset += 1) {
    for (let vOffset = 0; vOffset < size; vOffset += 1) {
      cells.push({ u: startU + uOffset, v: startV + vOffset });
    }
  }
  return cells;
}

function drawingActionBounds(action) {
  const points = action.points || [];
  if (!points.length) return null;
  const radius = Math.max(0.5, (Number(action.width) || 1) / 2);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  points.forEach((point) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  });
  return {
    x: minX - radius,
    y: minY - radius,
    width: maxX - minX + radius * 2,
    height: maxY - minY + radius * 2,
  };
}

function rectsIntersect(a, b) {
  return a.x <= b.x + b.width
    && a.x + a.width >= b.x
    && a.y <= b.y + b.height
    && a.y + a.height >= b.y;
}

function sameDrawingIds(a, b) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function layerGroupBounds(layers) {
  if (!layers.length) return null;
  const left = Math.min(...layers.map((layer) => layer.x));
  const top = Math.min(...layers.map((layer) => layer.y));
  const right = Math.max(...layers.map((layer) => layer.x + layer.width));
  const bottom = Math.max(...layers.map((layer) => layer.y + layer.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function createReferenceId(prefix = 'reference') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function referenceCurvePath(rect, endX, endY) {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const dx = endX - centerX;
  const dy = endY - centerY;
  if (dx === 0 && dy === 0) {
    return `M ${centerX} ${rect.top + rect.height} L ${endX} ${endY}`;
  }
  const halfWidth = rect.width / 2;
  const halfHeight = rect.height / 2;
  const horizontalScale = dx === 0 ? Infinity : halfWidth / Math.abs(dx);
  const verticalScale = dy === 0 ? Infinity : halfHeight / Math.abs(dy);
  const scale = Math.min(horizontalScale, verticalScale);
  const startX = centerX + dx * scale;
  const startY = centerY + dy * scale;
  const normalX = horizontalScale <= verticalScale ? Math.sign(dx) : 0;
  const normalY = verticalScale < horizontalScale ? Math.sign(dy) : 0;
  const distance = Math.max(1, Math.hypot(endX - startX, endY - startY));
  const directionX = (endX - startX) / distance;
  const directionY = (endY - startY) / distance;
  const bend = Math.max(36, Math.min(140, distance * 0.35));

  return `M ${startX} ${startY} C ${startX + normalX * bend} ${startY + normalY * bend}, ${endX - directionX * bend} ${endY - directionY * bend}, ${endX} ${endY}`;
}

function handleCursor(handle) {
  const map = {
    nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize',
    se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize',
  };
  return map[handle] || 'default';
}

const GRID_FRACTION_COLOR = '#ff9500';
const NEW_LAYER_OUTLINE_COLOR = '#007aff';

function NewLayerPulseOutline({ width, height, zoom }) {
  const stroke = screenPx(1, zoom);
  const inset = screenPx(0.5, zoom);
  return (
    <>
      <style>{`
        @keyframes new-layer-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
      <svg
        aria-hidden
        width={width}
        height={height}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          overflow: 'visible',
          pointerEvents: 'none',
          zIndex: 2,
        }}
      >
        <rect
          x={-inset}
          y={-inset}
          width={width + stroke}
          height={height + stroke}
          fill="none"
          stroke={NEW_LAYER_OUTLINE_COLOR}
          strokeWidth={stroke}
          shapeRendering="crispEdges"
          style={{ animation: 'new-layer-pulse 1.2s ease-in-out infinite' }}
        />
      </svg>
    </>
  );
}

function StableLayerImage({ layer, onReady }) {
  const [displayedUrl, setDisplayedUrl] = useState(layer.url);

  useEffect(() => {
    if (!layer.url || layer.url === displayedUrl) {
      onReady(layer.id, layer.url);
      return undefined;
    }

    let cancelled = false;
    const nextImage = new Image();
    nextImage.decoding = 'async';
    nextImage.onload = async () => {
      try {
        await nextImage.decode();
      } catch (_) {
        // onload already confirms that the image is ready to display.
      }
      if (cancelled) return;
      setDisplayedUrl(layer.url);
      onReady(layer.id, layer.url);
    };
    nextImage.onerror = () => {
      if (!cancelled) onReady(layer.id, layer.url);
    };
    nextImage.src = layer.url;

    return () => {
      cancelled = true;
    };
  }, [displayedUrl, layer.id, layer.url, onReady]);

  return (
    <img
      src={displayedUrl}
      alt=""
      draggable={false}
      style={{
        width: '100%',
        height: '100%',
        ...getLayerImageStyle(layer),
        display: 'block',
        pointerEvents: 'none',
        userSelect: 'none',
        opacity: layer.regenerating ? 0.55 : 1,
      }}
    />
  );
}

function CropSourcePreview({ layer, zoom }) {
  const crop = normalizeLayerCrop(layer);
  const fullWidth = layer.width / crop.width;
  const fullHeight = layer.height / crop.height;
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: -crop.x * fullWidth,
        top: -crop.y * fullHeight,
        width: fullWidth,
        height: fullHeight,
        pointerEvents: 'none',
        opacity: 0.24,
        outline: `${screenPx(1, zoom)}px dashed #007aff`,
        outlineOffset: -screenPx(1, zoom),
      }}
    >
      <img
        src={layer.url}
        alt=""
        draggable={false}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  );
}

function LayerSizeLabel({ width, height, gridSize }) {
  const { w, h, gridW, gridH, gridWWhole, gridHWhole } = getLayerSizeDisplay(width, height, gridSize);
  return (
    <span>
      {w}
      ×
      {h}
      {' px ('}
      <span style={gridWWhole ? undefined : { color: GRID_FRACTION_COLOR }}>{gridW.toFixed(1)}</span>
      ×
      <span style={gridHWhole ? undefined : { color: GRID_FRACTION_COLOR }}>{gridH.toFixed(1)}</span>
      )
    </span>
  );
}

function LayerSelectionBar({
  layer,
  gridSize,
  zoom,
  cropActive,
  onToggleCrop,
  onResetScale,
  onResetCrop,
  onDownload,
  onRemove,
  onPrevVariant,
  onNextVariant,
  onRegenerate,
  onToggleLocked,
  variantLoading,
}) {
  const scalePercent = getLayerScalePercent(layer);
  const isNaturalScale = scalePercent === 100;
  const variants = layer.variants?.length ? layer.variants : null;
  const variantCount = variants?.length || 0;
  const variantIndex = layer.activeVariantIndex ?? 0;
  const canRegenerate = Boolean(layer.generationMeta);
  const cropped = isLayerCropped(layer);
  const iconBtn = (bg, size, color = '#000') => ({
    border: 'none',
    backgroundColor: bg,
    color,
    width: size,
    height: size,
    borderRadius: '50%',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    flexShrink: 0,
    boxSizing: 'border-box',
  });

  return (
    <ScreenSpacePanel
      zoom={zoom}
      attach="below"
      frameWidth={layer.width}
      gap={8}
      visible
      onPointerDown={(e) => e.stopPropagation()}
      panelStyle={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        backgroundColor: 'rgba(255,255,255,0.96)',
        padding: '5px 8px',
        borderRadius: 16,
        border: '1px solid rgba(229,229,234,0.9)',
        color: '#000',
        fontSize: 11,
        fontFamily: 'ui-monospace, "SF Mono", Consolas, monospace',
        whiteSpace: 'nowrap',
        boxShadow: '0 2px 4px rgba(0,0,0,0.06), 0 12px 28px rgba(0,0,0,0.1)',
        backdropFilter: 'blur(18px) saturate(160%)',
        zIndex: 25,
      }}
    >
      {variantCount > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onPrevVariant(); }}
            disabled={variantLoading}
            style={iconBtn('#f2f2f7', 18, '#3c3c43')}
            className="studio-tooltip"
            data-tooltip="Previous variant"
          >
            <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span style={{ fontSize: 10, color: '#8e8e93' }}>
            {variantIndex + 1}
            /
            {variantCount}
          </span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onNextVariant(); }}
            disabled={variantLoading}
            style={iconBtn('#f2f2f7', 18, '#3c3c43')}
            className="studio-tooltip"
            data-tooltip="Next variant"
          >
            <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          <span style={{ color: '#c7c7cc' }}>·</span>
        </>
      )}
      <LayerSizeLabel width={layer.width} height={layer.height} gridSize={gridSize} />
      {scalePercent != null && (
        <>
          <span style={{ color: '#c7c7cc' }}>·</span>
          {isNaturalScale || layer.locked ? (
            <span>{scalePercent}%</span>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onResetScale();
              }}
              style={{
                border: 'none',
                padding: 0,
                background: 'transparent',
                color: GRID_FRACTION_COLOR,
                font: 'inherit',
                cursor: 'pointer',
              }}
              className="studio-tooltip"
              data-tooltip="Set zoom to 100%"
            >
              {scalePercent}%
            </button>
          )}
        </>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleCrop();
        }}
        style={iconBtn(cropActive ? '#007aff' : '#f2f2f7', 18, cropActive ? '#fff' : '#3c3c43')}
        className="studio-tooltip"
        data-tooltip={cropActive ? 'Finish cropping' : 'Crop'}
        aria-label={cropActive ? 'Finish cropping' : 'Crop'}
        aria-pressed={cropActive}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M7 3v14a2 2 0 0 0 2 2h12M3 7h12a2 2 0 0 1 2 2v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {canRegenerate && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (!layer.regenerating) onRegenerate();
          }}
          disabled={layer.regenerating}
          style={{
            border: 'none',
            backgroundColor: layer.regenerating ? '#e5e5ea' : '#1c1c1e',
            color: '#fff',
            fontSize: 10,
            fontWeight: 600,
            height: 22,
            padding: '0 8px',
            borderRadius: 999,
            cursor: layer.regenerating ? 'not-allowed' : 'pointer',
            lineHeight: 1,
            flexShrink: 0,
            opacity: layer.regenerating ? 0.6 : 1,
          }}
          className="studio-tooltip"
          data-tooltip="Regenerate with the same inputs"
        >
          {layer.regenerating ? '...' : 'Regenerate'}
        </button>
      )}
      {cropped && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onResetCrop();
          }}
          style={iconBtn('#e5f1ff', 18, '#007aff')}
          className="studio-tooltip"
          data-tooltip="Reset crop"
          aria-label="Reset crop"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M4 7v5h5M20 17v-5h-5M6.1 16.5A8 8 0 0 0 19 12M17.9 7.5A8 8 0 0 0 5 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleLocked();
        }}
        style={iconBtn(layer.locked ? '#1c1c1e' : '#f2f2f7', 18, layer.locked ? '#fff' : '#3c3c43')}
        className="studio-tooltip"
        data-tooltip={layer.locked ? 'Unlock' : 'Lock'}
        aria-label={layer.locked ? 'Unlock image' : 'Lock image'}
        aria-pressed={Boolean(layer.locked)}
      >
        {layer.locked ? (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
            <path d="M8 11V7a4 4 0 0 1 7.5-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDownload();
        }}
        style={iconBtn('#f2f2f7', 18, '#3c3c43')}
        className="studio-tooltip"
        data-tooltip="Download image"
      >
        <svg
          width={9}
          height={9}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        style={{
          ...iconBtn('#ffe5e3', 18, '#ff3b30'),
        }}
        className="studio-tooltip"
        data-tooltip="Delete"
        aria-label="Delete image"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m5 5v6m4-6v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </ScreenSpacePanel>
  );
}

function MultiLayerSelectionBar({
  layers,
  frameWidth,
  gridSize,
  zoom,
  onResetScale,
  onToggleLocked,
  onRemove,
}) {
  const first = layers[0];
  const commonSize = layers.every((layer) => (
    layer.width === first.width && layer.height === first.height
  ));
  const scalePercent = getLayerScalePercent(first);
  const commonScale = scalePercent != null && layers.every((layer) => (
    getLayerScalePercent(layer) === scalePercent
  ));
  const allLocked = layers.every((layer) => layer.locked);
  const anyLocked = layers.some((layer) => layer.locked);
  const iconBtn = (bg, color = '#3c3c43') => ({
    border: 'none',
    backgroundColor: bg,
    color,
    width: 22,
    height: 22,
    borderRadius: '50%',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    flexShrink: 0,
    boxSizing: 'border-box',
  });

  return (
    <ScreenSpacePanel
      zoom={zoom}
      attach="below"
      frameWidth={frameWidth}
      gap={8}
      visible
      onPointerDown={(event) => event.stopPropagation()}
      panelStyle={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        backgroundColor: 'rgba(255,255,255,0.96)',
        padding: '5px 8px',
        borderRadius: 16,
        border: '1px solid rgba(229,229,234,0.9)',
        color: '#000',
        fontSize: 11,
        fontFamily: 'ui-monospace, "SF Mono", Consolas, monospace',
        whiteSpace: 'nowrap',
        boxShadow: '0 2px 4px rgba(0,0,0,0.06), 0 12px 28px rgba(0,0,0,0.1)',
        backdropFilter: 'blur(18px) saturate(160%)',
        zIndex: 25,
      }}
    >
      <span>{layers.length} image{layers.length === 1 ? '' : 's'}</span>
      {commonSize && (
        <>
          <span style={{ color: '#c7c7cc' }}>·</span>
          <LayerSizeLabel width={first.width} height={first.height} gridSize={gridSize} />
        </>
      )}
      {commonScale && (
        <>
          <span style={{ color: '#c7c7cc' }}>·</span>
          {scalePercent === 100 || anyLocked ? (
            <span>{scalePercent}%</span>
          ) : (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onResetScale();
              }}
              style={{
                border: 'none',
                padding: 0,
                background: 'transparent',
                color: GRID_FRACTION_COLOR,
                font: 'inherit',
                cursor: 'pointer',
              }}
              className="studio-tooltip"
              data-tooltip="Set overall zoom to 100%"
            >
              {scalePercent}%
            </button>
          )}
        </>
      )}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onToggleLocked();
        }}
        style={iconBtn(allLocked ? '#1c1c1e' : '#f2f2f7', allLocked ? '#fff' : '#3c3c43')}
        className="studio-tooltip"
        data-tooltip={allLocked ? 'Unlock all' : 'Lock all'}
        aria-label={allLocked ? 'Unlock selected images' : 'Lock selected images'}
      >
        {allLocked ? (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
            <path d="M8 11V7a4 4 0 0 1 7.5-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        style={iconBtn('#ffe5e3', '#ff3b30')}
        className="studio-tooltip"
        data-tooltip="Delete selected"
        aria-label="Delete selected images"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m5 5v6m4-6v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </ScreenSpacePanel>
  );
}

function handleStyle(handle, w, h, zoom) {
  const hs = screenPx(HANDLE_SIZE, zoom);
  const base = {
    position: 'absolute',
    width: hs,
    height: hs,
    backgroundColor: '#fff',
    border: `${screenPx(1, zoom)}px solid #007aff`,
    borderRadius: screenPx(2, zoom),
    zIndex: 20,
    boxSizing: 'border-box',
  };
  const off = -hs / 2;
  if (handle === 'nw') return { ...base, left: off, top: off, cursor: handleCursor(handle) };
  if (handle === 'n') return { ...base, left: w / 2 + off, top: off, cursor: handleCursor(handle) };
  if (handle === 'ne') return { ...base, left: w + off, top: off, cursor: handleCursor(handle) };
  if (handle === 'e') return { ...base, left: w + off, top: h / 2 + off, cursor: handleCursor(handle) };
  if (handle === 'se') return { ...base, left: w + off, top: h + off, cursor: handleCursor(handle) };
  if (handle === 's') return { ...base, left: w / 2 + off, top: h + off, cursor: handleCursor(handle) };
  if (handle === 'sw') return { ...base, left: off, top: h + off, cursor: handleCursor(handle) };
  if (handle === 'w') return { ...base, left: off, top: h / 2 + off, cursor: handleCursor(handle) };
  return base;
}

/**
 * @typedef {Object} CanvasLayer
 * @property {string} id
 * @property {string} url
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {number} [naturalWidth]
 * @property {number} [naturalHeight]
 * @property {boolean} [locked]
 */

/**
 * @param {Object} props
 * @param {CanvasLayer[]} props.layers
 * @param {(layers: CanvasLayer[]) => void} props.onLayersChange
 * @param {string|null} props.selectedLayerId
 * @param {(id: string|null) => void} props.onSelectedLayerIdChange
 * @param {string} [props.accentColor]
 * @param {{ panX: number, panY: number, zoom: number }} [props.viewport]
 * @param {(v: { panX: number, panY: number, zoom: number }) => void} [props.onViewportChange]
 * @param {Array} [props.snapshotFrames]
 * @param {(frames: Array) => void} [props.onSnapshotFramesChange]
 * @param {Array} [props.exportFrames]
 * @param {(frames: Array) => void} [props.onExportFramesChange]
 * @param {string|null} [props.selectedExportFrameId]
 * @param {(id: string|null) => void} [props.onSelectedExportFrameIdChange]
 * @param {string|null} [props.selectedSnapshotId]
 * @param {(id: string|null) => void} [props.onSelectedSnapshotIdChange]
 * @param {{ imageSize: string, aspectRatio: string, model: string }} [props.generationDefaults]
 * @param {(frameId: string, variantCount?: number) => void} [props.onSnapshotGenerate]
 * @param {(layerId: string) => void} [props.onLayerRegenerate]
 * @param {(frameId: string) => void} [props.onSnapshotCancelGeneration]
 * @param {(type?: string) => void} [props.onHistoryTransactionStart]
 * @param {(type?: string) => void} [props.onHistoryTransactionEnd]
 * @param {Array} [props.drawings]
 * @param {(drawings: Array) => void} [props.onDrawingsChange]
 * @param {'select'|'crop'|'draw'|'erase'|'tile'} [props.activeTool]
 * @param {(tool: 'select'|'crop'|'draw'|'erase'|'tile') => void} [props.onToolChange]
 * @param {string} [props.brushColor]
 * @param {number} [props.brushSize]
 * @param {number} [props.eraserSize]
 * @param {() => void} [props.onToolActionStart]
 * @param {Array<{ u: number, v: number, color: string }>} [props.tilePaints]
 * @param {(tiles: Array) => void} [props.onTilePaintsChange]
 * @param {string|null} [props.tileColor]
 * @param {number} [props.tileBrushSize]
 */
const InfiniteCanvas = forwardRef(function InfiniteCanvas({
  layers,
  onLayersChange,
  selectedLayerId,
  onSelectedLayerIdChange,
  accentColor = '#007AFF',
  viewport: controlledViewport,
  onViewportChange,
  snapshotFrames = [],
  onSnapshotFramesChange,
  exportFrames = [],
  onExportFramesChange,
  selectedExportFrameId = null,
  onSelectedExportFrameIdChange,
  selectedSnapshotId = null,
  onSelectedSnapshotIdChange,
  generationDefaults = { imageSize: '2K', aspectRatio: '16:9', model: 'nb2' },
  onSnapshotGenerate,
  onLayerRegenerate,
  onSnapshotCancelGeneration,
  onHistoryTransactionStart,
  onHistoryTransactionEnd,
  drawings = [],
  onDrawingsChange,
  activeTool = 'select',
  onToolChange,
  brushColor = '#1c1c1e',
  brushSize = 8,
  eraserSize = 28,
  tilePaints = [],
  onTilePaintsChange,
  tileColor = '#ffcc00',
  tileBrushSize = 1,
  onToolActionStart,
  gridType = 'dots',
  gridAngle = 30,
  gridSize = 20,
  snapToGrid = true,
  snapToElements = true,
  globalContext = {},
  onOpenGlobalContext,
}, ref) {
  const containerRef = useRef(null);
  const gridCanvasRef = useRef(null);
  const interactionRef = useRef(null);
  const fileInputRef = useRef(null);
  const snapHotkeyDownRef = useRef(false);
  const stateRef = useRef(null);
  const referenceAnchorElsRef = useRef(new Map());
  const linkDragRef = useRef(null);
  const activeStrokeRef = useRef(null);
  const activeStrokePathElsRef = useRef(new Set());
  const drawingFrameRef = useRef(null);
  const brushCursorRef = useRef(null);
  const drawingsRef = useRef(drawings);
  const tilePaintsRef = useRef(tilePaints);
  const selectedLayerIdsRef = useRef(selectedLayerId ? [selectedLayerId] : []);
  const activeTilePointerRef = useRef(null);
  const drawingMaskPrefixRef = useRef(`drawing_mask_${Math.random().toString(36).slice(2, 9)}`);

  const [internalViewport, setInternalViewport] = useState({ panX: 0, panY: 0, zoom: 1 });
  const [interacting, setInteracting] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [isGridOverlayActive, setIsGridOverlayActive] = useState(false);
  const [variantLoad, setVariantLoad] = useState(null);
  const [linkDrag, setLinkDrag] = useState(null);
  const [referenceAnchors, setReferenceAnchors] = useState({});
  const [activeStroke, setActiveStroke] = useState(null);
  const [selectedLayerIds, setSelectedLayerIds] = useState(
    selectedLayerId ? [selectedLayerId] : [],
  );
  const [selectedDrawingIds, setSelectedDrawingIds] = useState([]);
  const [tileHoverCell, setTileHoverCell] = useState(null);
  const [drawingSelectionRect, setDrawingSelectionRect] = useState(null);
  const [savingExportFrameId, setSavingExportFrameId] = useState(null);
  linkDragRef.current = linkDrag;
  drawingsRef.current = drawings;
  tilePaintsRef.current = tilePaints;
  selectedLayerIdsRef.current = selectedLayerIds;

  useEffect(() => () => {
    if (drawingFrameRef.current !== null) cancelAnimationFrame(drawingFrameRef.current);
  }, []);

  useEffect(() => {
    const nextIds = activeTool === 'select'
      ? selectedDrawingIds.filter((id) => drawings.some((drawing) => drawing.id === id))
      : [];
    if (!sameDrawingIds(selectedDrawingIds, nextIds)) setSelectedDrawingIds(nextIds);
  }, [activeTool, drawings, selectedDrawingIds]);

  useEffect(() => {
    const validIds = selectedLayerIdsRef.current.filter((id) => (
      layers.some((layer) => layer.id === id)
    ));
    let nextIds = validIds;
    if (selectedLayerId && !validIds.includes(selectedLayerId)) nextIds = [selectedLayerId];
    if (!selectedLayerId && validIds.length) nextIds = [];
    if (!sameDrawingIds(selectedLayerIdsRef.current, nextIds)) {
      selectedLayerIdsRef.current = nextIds;
      setSelectedLayerIds(nextIds);
    }
  }, [layers, selectedLayerId]);

  const selectedVariantIdsToPreload = useMemo(() => {
    const layer = layers.find((item) => item.id === selectedLayerId);
    if (!layer?.variants || layer.variants.length < 2) return [];
    return layer.variants
      .filter((_, index) => index !== (layer.activeVariantIndex ?? 0))
      .map((variant) => variant.imageId)
      .filter(Boolean);
  }, [layers, selectedLayerId]);
  const selectedVariantIdsToPreloadKey = selectedVariantIdsToPreload.join('|');

  useEffect(() => {
    // After loading a saved board, only the active variant is in memory.
    // Preload the others so switching variants does not wait on the network.
    if (!selectedVariantIdsToPreloadKey) return;
    selectedVariantIdsToPreloadKey.split('|').forEach((imageId) => {
      const image = new Image();
      image.decoding = 'async';
      image.src = studioImageUrl(imageId);
    });
  }, [selectedVariantIdsToPreloadKey]);

  const viewport = controlledViewport ?? internalViewport;
  const setViewport = useCallback((next) => {
    const value = typeof next === 'function' ? next(viewport) : next;
    if (onViewportChange) onViewportChange(value);
    else setInternalViewport(value);
  }, [viewport, onViewportChange]);

  const zoom = viewport.zoom;

  const setLayerSelection = useCallback((ids) => {
    const validIdSet = new Set(layers.map((layer) => layer.id));
    const nextIds = [...new Set(ids)].filter((id) => validIdSet.has(id));
    if (sameDrawingIds(selectedLayerIdsRef.current, nextIds)) return;
    selectedLayerIdsRef.current = nextIds;
    setSelectedLayerIds(nextIds);
    onSelectedLayerIdChange(nextIds[0] || null);
  }, [layers, onSelectedLayerIdChange]);

  const updateLayer = useCallback((layerId, patch) => {
    onLayersChange(layers.map((l) => (l.id === layerId ? { ...l, ...patch } : l)));
  }, [layers, onLayersChange]);

  const cycleLayerVariantBy = useCallback((layerId, delta) => {
    const layer = layers.find((item) => item.id === layerId);
    if (!layer) return;
    const nextLayer = cycleLayerVariant(layer, delta);
    setVariantLoad({ layerId, url: nextLayer.url });
    onLayersChange(layers.map((l) => (
      l.id === layerId ? nextLayer : l
    )));
  }, [layers, onLayersChange]);

  const finishVariantLoad = useCallback((layerId, url) => {
    setVariantLoad((pending) => (
      pending?.layerId === layerId && pending.url === url ? null : pending
    ));
  }, []);

  const removeLayers = useCallback((layerIds) => {
    const removedIds = new Set(layerIds);
    if (!removedIds.size) return;
    onLayersChange(layers.filter((layer) => !removedIds.has(layer.id)));
    if (onSnapshotFramesChange) {
      onSnapshotFramesChange(snapshotFrames.map((frame) => ({
        ...frame,
        referenceImages: (frame.referenceImages || []).filter((reference) => (
          reference.kind !== 'layer' || !removedIds.has(reference.layerId)
        )),
      })));
    }
    setLayerSelection(selectedLayerIdsRef.current.filter((id) => !removedIds.has(id)));
  }, [layers, onLayersChange, onSnapshotFramesChange, snapshotFrames, setLayerSelection]);

  const removeLayer = useCallback((layerId) => {
    removeLayers([layerId]);
  }, [removeLayers]);

  const addSnapshotReferenceCard = useCallback((frameId) => {
    const reference = {
      id: createReferenceId(),
      kind: 'empty',
    };
    onSnapshotFramesChange?.(snapshotFrames.map((frame) => (
      frame.id === frameId
        ? { ...frame, referenceImages: [...(frame.referenceImages || []), reference] }
        : frame
    )));
  }, [onSnapshotFramesChange, snapshotFrames]);

  const setSnapshotReferenceFile = useCallback(async (frameId, referenceId, file) => {
    if (!file?.type?.startsWith('image/')) throw new Error('Choose an image');
    const imageId = createReferenceId('reference_image');
    await putStudioImage(imageId, file);
    onSnapshotFramesChange?.(snapshotFrames.map((frame) => (
      frame.id === frameId
        ? {
            ...frame,
            referenceImages: (frame.referenceImages || []).map((reference) => (
              reference.id === referenceId
                ? {
                    id: reference.id,
                    kind: 'upload',
                    imageId,
                    name: file.name || 'Image',
                  }
                : reference
            )),
          }
        : frame
    )));
  }, [onSnapshotFramesChange, snapshotFrames]);

  const removeSnapshotReference = useCallback((frameId, referenceId) => {
    onSnapshotFramesChange?.(snapshotFrames.map((frame) => (
      frame.id === frameId
        ? {
            ...frame,
            referenceImages: (frame.referenceImages || []).filter((reference) => reference.id !== referenceId),
          }
        : frame
    )));
  }, [onSnapshotFramesChange, snapshotFrames]);

  const registerReferenceAnchor = useCallback((frameId, referenceId, node) => {
    const key = `${frameId}:${referenceId}`;
    if (node) referenceAnchorElsRef.current.set(key, node);
    else referenceAnchorElsRef.current.delete(key);
  }, []);

  const startReferenceLink = useCallback((event, frameId, referenceId) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const canvasRect = containerRef.current?.getBoundingClientRect();
    const anchorRect = event.currentTarget.getBoundingClientRect();
    if (!canvasRect) return;
    setLinkDrag({
      frameId,
      referenceId,
      sourceRect: {
        left: anchorRect.left - canvasRect.left,
        top: anchorRect.top - canvasRect.top,
        width: anchorRect.width,
        height: anchorRect.height,
      },
      currentX: event.clientX - canvasRect.left,
      currentY: event.clientY - canvasRect.top,
      hoverLayerId: null,
    });
  }, []);

  useEffect(() => {
    if (!linkDrag) return undefined;
    const onMove = (event) => {
      const canvasRect = containerRef.current?.getBoundingClientRect();
      if (!canvasRect) return;
      const localX = event.clientX - canvasRect.left;
      const localY = event.clientY - canvasRect.top;
      const worldX = (localX - viewport.panX) / viewport.zoom;
      const worldY = (localY - viewport.panY) / viewport.zoom;
      const hit = [...layers].reverse().find((layer) => (
        worldX >= layer.x && worldX <= layer.x + layer.width
        && worldY >= layer.y && worldY <= layer.y + layer.height
      ));
      setLinkDrag((current) => current ? {
        ...current,
        currentX: localX,
        currentY: localY,
        hoverLayerId: hit?.id || null,
      } : null);
    };
    const onUp = () => {
      const active = linkDragRef.current;
      if (active?.hoverLayerId) {
        onSnapshotFramesChange?.(snapshotFrames.map((frame) => {
          if (frame.id !== active.frameId) return frame;
          return {
            ...frame,
            referenceImages: (frame.referenceImages || []).map((reference) => (
              reference.id === active.referenceId
                ? {
                    id: reference.id,
                    kind: 'layer',
                    layerId: active.hoverLayerId,
                  }
                : reference
            )),
          };
        }));
      }
      setLinkDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [Boolean(linkDrag), layers, onSnapshotFramesChange, snapshotFrames, viewport]);

  useLayoutEffect(() => {
    const canvasRect = containerRef.current?.getBoundingClientRect();
    if (!canvasRect) return undefined;
    const next = {};
    referenceAnchorElsRef.current.forEach((node, frameId) => {
      const rect = node.getBoundingClientRect();
      next[frameId] = {
        left: rect.left - canvasRect.left,
        top: rect.top - canvasRect.top,
        width: rect.width,
        height: rect.height,
      };
    });
    setReferenceAnchors(next);
    return undefined;
  }, [snapshotFrames, viewport, selectedSnapshotId]);

  const resetLayerToNaturalSize = useCallback(async (layer) => {
    if (layer.locked) return;
    try {
      const { naturalWidth, naturalHeight } = await resolveLayerNaturalSize(layer);
      updateLayer(layer.id, buildNaturalSizePatch(layer, naturalWidth, naturalHeight));
    } catch (err) {
      console.error('Reset scale failed:', err);
    }
  }, [updateLayer]);

  const resetLayersToNaturalSize = useCallback(async (targetLayers) => {
    const unlockedLayers = targetLayers.filter((layer) => !layer.locked);
    if (!unlockedLayers.length) return;
    try {
      const patches = await Promise.all(unlockedLayers.map(async (layer) => {
        const { naturalWidth, naturalHeight } = await resolveLayerNaturalSize(layer);
        return [layer.id, buildNaturalSizePatch(layer, naturalWidth, naturalHeight)];
      }));
      const patchById = new Map(patches);
      onLayersChange(layers.map((layer) => (
        patchById.has(layer.id) ? { ...layer, ...patchById.get(layer.id) } : layer
      )));
    } catch (err) {
      console.error('Reset group scale failed:', err);
    }
  }, [layers, onLayersChange]);

  const setLayersLocked = useCallback((layerIds, locked) => {
    const targetIds = new Set(layerIds);
    onLayersChange(layers.map((layer) => (
      targetIds.has(layer.id) ? { ...layer, locked } : layer
    )));
  }, [layers, onLayersChange]);

  const addLayerAt = useCallback(async (file, worldX, worldY) => {
    try {
      const { url, naturalWidth, naturalHeight } = await loadImageFromFile(file);
      const { width, height } = defaultLayerSize(naturalWidth, naturalHeight);
      const layer = {
        id: createLayerId(),
        url,
        x: worldX - width / 2,
        y: worldY - height / 2,
        width,
        height,
        naturalWidth,
        naturalHeight,
      };
      onLayersChange([...layers, layer]);
      onSelectedLayerIdChange(layer.id);
    } catch (err) {
      console.error('InfiniteCanvas: failed to add image', err);
    }
  }, [layers, onLayersChange, onSelectedLayerIdChange]);

  const addFilesAt = useCallback(async (files, worldX, worldY) => {
    const imageFiles = Array.from(files).filter((f) => f.type?.startsWith('image/'));
    let offset = 0;
    for (const file of imageFiles) {
      await addLayerAt(file, worldX + offset, worldY + offset);
      offset += 24;
    }
  }, [addLayerAt]);

  useHoveredImagePaste(containerRef, async (files) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const worldCenter = screenToWorld(
      rect,
      viewport,
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    await addFilesAt(files, worldCenter.x, worldCenter.y);
  });

  const startPan = useCallback((e) => {
    interactionRef.current = {
      kind: 'pan',
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPanX: viewport.panX,
      startPanY: viewport.panY,
    };
    setIsPanning(true);
  }, [viewport.panX, viewport.panY]);

  const startLayerInteraction = useCallback((e, layerId, mode) => {
    const isPanMode = e.button === 1 || e.altKey;
    if (isPanMode) {
      e.preventDefault();
      e.stopPropagation();
      startPan(e);
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const layer = layers.find((l) => l.id === layerId);
    if (!layer) return;
    setSelectedDrawingIds([]);
    onSelectedSnapshotIdChange?.(null);
    onSelectedExportFrameIdChange?.(null);
    const currentSelection = selectedLayerIdsRef.current;
    const nextSelection = currentSelection.includes(layerId) ? currentSelection : [layerId];
    setLayerSelection(nextSelection);
    if (layer.isNewResult) {
      onLayersChange(layers.map((l) => (l.id === layerId ? { ...l, isNewResult: false } : l)));
    }
    if (layer.locked && (mode === 'move' || mode.startsWith('resize-'))) return;
    const movingIds = mode === 'move'
      ? nextSelection.filter((id) => !layers.find((item) => item.id === id)?.locked)
      : [layerId];
    const movingIdSet = new Set(movingIds);
    const startLayers = layers
      .filter((item) => movingIdSet.has(item.id))
      .map((item) => ({ ...item }));
    if (!startLayers.length) return;
    onHistoryTransactionStart?.('pointer');
    interactionRef.current = {
      kind: 'layer',
      mode,
      layerId,
      layerIds: movingIds,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startLayer: { ...layer },
      startLayers,
      snapCtx: collectInfiniteSnapTargets(
        layers.filter((item) => !movingIdSet.has(item.id)),
        null,
        snapshotFrames,
      ),
    };
    setInteracting(true);
  }, [layers, onLayersChange, setLayerSelection, onSelectedSnapshotIdChange, onSelectedExportFrameIdChange, onHistoryTransactionStart, snapshotFrames, startPan]);

  const startSnapshotInteraction = useCallback((e, frameId, mode) => {
    const isPanMode = e.button === 1 || e.altKey;
    if (isPanMode) {
      e.preventDefault();
      e.stopPropagation();
      startPan(e);
      return;
    }
    if (e.button !== 0) return;
    const frame = snapshotFrames.find((f) => f.id === frameId);
    if (!frame || !onSnapshotFramesChange) return;
    e.preventDefault();
    e.stopPropagation();
    onHistoryTransactionStart?.('pointer');
    setSelectedDrawingIds([]);
    onSelectedSnapshotIdChange?.(frameId);
    onSelectedExportFrameIdChange?.(null);
    setLayerSelection([]);
    interactionRef.current = {
      kind: 'snapshot',
      frameId,
      mode,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startFrame: { ...frame },
      snapCtx: collectInfiniteSnapTargets(layers, null, snapshotFrames, frameId),
    };
    setInteracting(true);
  }, [snapshotFrames, onSnapshotFramesChange, onSelectedSnapshotIdChange, onSelectedExportFrameIdChange, setLayerSelection, onHistoryTransactionStart, layers, startPan]);

  const startExportFrameInteraction = useCallback((e, frameId, mode) => {
    const isPanMode = e.button === 1 || e.altKey;
    if (isPanMode) {
      e.preventDefault();
      e.stopPropagation();
      startPan(e);
      return;
    }
    if (e.button !== 0) return;
    const frame = exportFrames.find((item) => item.id === frameId);
    if (!frame || !onExportFramesChange) return;
    e.preventDefault();
    e.stopPropagation();
    onHistoryTransactionStart?.('pointer');
    setSelectedDrawingIds([]);
    setLayerSelection([]);
    onSelectedSnapshotIdChange?.(null);
    onSelectedExportFrameIdChange?.(frameId);
    interactionRef.current = {
      kind: 'export-frame',
      frameId,
      mode,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startFrame: { ...frame },
      snapCtx: collectInfiniteSnapTargets(layers, null, [...snapshotFrames, ...exportFrames], frameId),
    };
    setInteracting(true);
  }, [exportFrames, onExportFramesChange, onHistoryTransactionStart, onSelectedExportFrameIdChange, setLayerSelection, onSelectedSnapshotIdChange, layers, snapshotFrames, startPan]);

  useEffect(() => {
    if (!interacting && !isPanning) return undefined;

    const onMove = (e) => {
      const d = interactionRef.current;
      if (!d) return;

      if (d.kind === 'pan') {
        const dx = e.clientX - d.startClientX;
        const dy = e.clientY - d.startClientY;
        setViewport({
          ...viewport,
          panX: d.startPanX + dx,
          panY: d.startPanY + dy,
        });
        return;
      }

      if (d.kind === 'drawing' && onDrawingsChange) {
        const dx = (e.clientX - d.startClientX) / zoom;
        const dy = (e.clientY - d.startClientY) / zoom;
        onDrawingsChange(drawingsRef.current.map((drawing) => {
          const startPoints = d.startPointsById[drawing.id];
          if (!startPoints) return drawing;
          return {
            ...drawing,
            points: startPoints.map((point) => ({
              x: point.x + dx,
              y: point.y + dy,
            })),
          };
        }));
        return;
      }

      if (d.kind === 'drawing-selection') {
        const currentX = d.startWorldX + (e.clientX - d.startClientX) / zoom;
        const currentY = d.startWorldY + (e.clientY - d.startClientY) / zoom;
        const selectionRect = {
          x: Math.min(d.startWorldX, currentX),
          y: Math.min(d.startWorldY, currentY),
          width: Math.abs(currentX - d.startWorldX),
          height: Math.abs(currentY - d.startWorldY),
        };
        const nextDrawingIds = drawingsRef.current
          .filter((drawing) => drawing.mode !== 'erase')
          .filter((drawing) => {
            const bounds = drawingActionBounds(drawing);
            return bounds && rectsIntersect(bounds, selectionRect);
          })
          .map((drawing) => drawing.id);
        const nextLayerIds = layers
          .filter((layer) => rectsIntersect(layer, selectionRect))
          .map((layer) => layer.id);
        setDrawingSelectionRect(selectionRect);
        const visibleDrawingIds = nextLayerIds.length ? [] : nextDrawingIds;
        setSelectedDrawingIds((previous) => (
          sameDrawingIds(previous, visibleDrawingIds) ? previous : visibleDrawingIds
        ));
        setLayerSelection(nextLayerIds);
        return;
      }

      const forceSnapping = snapHotkeyDownRef.current;
      const snapCtx = snapToElements || forceSnapping ? d.snapCtx : EMPTY_SNAP_CONTEXT;
      const shouldSnapToGrid = snapToGrid || forceSnapping;

      if (d.kind === 'snapshot' && onSnapshotFramesChange) {
        const dx = (e.clientX - d.startClientX) / zoom;
        const dy = (e.clientY - d.startClientY) / zoom;
        const s = d.startFrame;

        if (d.mode === 'move') {
          const snapped = snapMoveRect(
            { x: s.x + dx, y: s.y + dy, width: s.width, height: s.height },
            snapCtx,
            8,
            shouldSnapToGrid,
            gridSize,
          );
          const nextFrames = snapshotFrames.map((f) =>
            f.id === d.frameId
              ? {
                  ...s,
                  x: snapped.x,
                  y: snapped.y,
                }
              : f
          );
          onSnapshotFramesChange(nextFrames);
          return;
        }

        if (d.mode.startsWith('resize-')) {
          const handle = d.mode.slice(7);
          const ratio = s.width / s.height;

          const changeX = handle.includes('e') ? dx : -dx;
          const changeY = handle.includes('s') ? dy : -dy;

          const targetWidth = s.width + changeX;
          const targetHeight = s.height + changeY;

          const useWidth = Math.abs(changeX) > Math.abs(changeY * ratio);

          let width, height;
          if (useWidth) {
            width = targetWidth;
            height = targetWidth / ratio;
          } else {
            height = targetHeight;
            width = targetHeight * ratio;
          }

          const minW = Math.max(120, 120 * ratio);
          const minH = minW / ratio;

          if (width < minW) {
            width = minW;
            height = minH;
          }

          let x = s.x;
          let y = s.y;

          if (handle.includes('w')) {
            x = s.x + s.width - width;
          }
          if (handle.includes('n')) {
            y = s.y + s.height - height;
          }

          // Apply snapping on the dominant axis to preserve aspect ratio
          if (useWidth) {
            const mockHandle = handle.includes('w') ? 'w' : 'e';
            const snapRes = snapResizeRect({ x, y: s.y, width, height: s.height }, mockHandle, snapCtx, 8, shouldSnapToGrid, gridSize);

            width = snapRes.width;
            height = width / ratio;
            x = snapRes.x;
            if (handle.includes('n')) {
              y = s.y + s.height - height;
            } else {
              y = s.y;
            }
          } else {
            const mockHandle = handle.includes('n') ? 'n' : 's';
            const snapRes = snapResizeRect({ x: s.x, y, width: s.width, height }, mockHandle, snapCtx, 8, shouldSnapToGrid, gridSize);

            height = snapRes.height;
            width = height * ratio;
            y = snapRes.y;
            if (handle.includes('w')) {
              x = s.x + s.width - width;
            } else {
              x = s.x;
            }
          }

          // Final sanity check
          if (width < minW) {
            width = minW;
            height = minH;
            if (handle.includes('w')) {
              x = s.x + s.width - width;
            }
            if (handle.includes('n')) {
              y = s.y + s.height - height;
            }
          }

          const nextFrames = snapshotFrames.map((f) =>
            f.id === d.frameId
              ? {
                  ...f,
                  x: Math.round(x),
                  y: Math.round(y),
                  width: Math.round(width),
                  height: Math.round(height),
                }
              : f
          );
          onSnapshotFramesChange(nextFrames);
        }
        return;
      }

      if (d.kind === 'export-frame' && onExportFramesChange) {
        const dx = (e.clientX - d.startClientX) / zoom;
        const dy = (e.clientY - d.startClientY) / zoom;
        const start = d.startFrame;
        let nextFrame = start;

        if (d.mode === 'move') {
          const snapped = snapMoveRect(
            { x: start.x + dx, y: start.y + dy, width: start.width, height: start.height },
            snapCtx,
            8,
            shouldSnapToGrid,
            gridSize,
          );
          nextFrame = { ...start, x: Math.round(snapped.x), y: Math.round(snapped.y) };
        } else if (d.mode.startsWith('resize-')) {
          const handle = d.mode.slice(7);
          const resized = snapResizeRect(
            {
              x: handle.includes('w') ? start.x + dx : start.x,
              y: handle.includes('n') ? start.y + dy : start.y,
              width: start.width + (handle.includes('e') ? dx : handle.includes('w') ? -dx : 0),
              height: start.height + (handle.includes('s') ? dy : handle.includes('n') ? -dy : 0),
            },
            handle,
            snapCtx,
            8,
            shouldSnapToGrid,
            gridSize,
          );
          let { x, y, width, height } = resized;
          if (width < MIN_LAYER_SIZE) {
            width = MIN_LAYER_SIZE;
            x = handle.includes('w') ? start.x + start.width - width : start.x;
          }
          if (height < MIN_LAYER_SIZE) {
            height = MIN_LAYER_SIZE;
            y = handle.includes('n') ? start.y + start.height - height : start.y;
          }
          nextFrame = {
            ...start,
            x: Math.round(x),
            y: Math.round(y),
            width: Math.round(width),
            height: Math.round(height),
          };
        }

        onExportFramesChange(exportFrames.map((frame) => (
          frame.id === d.frameId ? nextFrame : frame
        )));
        return;
      }

      const dx = (e.clientX - d.startClientX) / zoom;
      const dy = (e.clientY - d.startClientY) / zoom;
      const s = d.startLayer;

      if (d.mode.startsWith('crop-')) {
        const handle = d.mode.slice(5);
        const crop = normalizeLayerCrop(s);
        const fullWidth = s.width / crop.width;
        const fullHeight = s.height / crop.height;
        const fullLeft = s.x - crop.x * fullWidth;
        const fullTop = s.y - crop.y * fullHeight;
        const fullRight = fullLeft + fullWidth;
        const fullBottom = fullTop + fullHeight;
        const minWidth = Math.min(MIN_LAYER_SIZE, s.width);
        const minHeight = Math.min(MIN_LAYER_SIZE, s.height);

        let left = s.x;
        let top = s.y;
        let right = s.x + s.width;
        let bottom = s.y + s.height;

        if (handle.includes('w')) {
          left = Math.min(right - minWidth, Math.max(fullLeft, s.x + dx));
        }
        if (handle.includes('e')) {
          right = Math.max(left + minWidth, Math.min(fullRight, s.x + s.width + dx));
        }
        if (handle.includes('n')) {
          top = Math.min(bottom - minHeight, Math.max(fullTop, s.y + dy));
        }
        if (handle.includes('s')) {
          bottom = Math.max(top + minHeight, Math.min(fullBottom, s.y + s.height + dy));
        }

        updateLayer(d.layerId, {
          x: left,
          y: top,
          width: right - left,
          height: bottom - top,
          crop: {
            x: (left - fullLeft) / fullWidth,
            y: (top - fullTop) / fullHeight,
            width: (right - left) / fullWidth,
            height: (bottom - top) / fullHeight,
          },
        });
        return;
      }

      if (d.mode === 'move') {
        const snapped = snapMoveRect(
          { x: s.x + dx, y: s.y + dy, width: s.width, height: s.height },
          snapCtx,
          8,
          shouldSnapToGrid,
          gridSize,
        );
        const moveX = snapped.x - s.x;
        const moveY = snapped.y - s.y;
        const startById = new Map(d.startLayers.map((layer) => [layer.id, layer]));
        onLayersChange(layers.map((layer) => {
          const start = startById.get(layer.id);
          return start
            ? { ...layer, x: start.x + moveX, y: start.y + moveY }
            : layer;
        }));
        return;
      }

      if (d.mode.startsWith('resize-')) {
        const handle = d.mode.slice(7);
        const ratio = s.width / s.height;

        const changeX = handle.includes('e') ? dx : -dx;
        const changeY = handle.includes('s') ? dy : -dy;

        const targetWidth = s.width + changeX;
        const targetHeight = s.height + changeY;

        const useWidth = Math.abs(changeX) > Math.abs(changeY * ratio);

        let width, height;
        if (useWidth) {
          width = targetWidth;
          height = targetWidth / ratio;
        } else {
          height = targetHeight;
          width = targetHeight * ratio;
        }

        const minW = Math.max(MIN_LAYER_SIZE, MIN_LAYER_SIZE * ratio);
        const minH = minW / ratio;

        if (width < minW) {
          width = minW;
          height = minH;
        }

        let x = s.x;
        let y = s.y;

        if (handle.includes('w')) {
          x = s.x + s.width - width;
        }
        if (handle.includes('n')) {
          y = s.y + s.height - height;
        }

        // Apply snapping on the dominant axis to preserve aspect ratio
        let snapped;
        if (useWidth) {
          const mockHandle = handle.includes('w') ? 'w' : 'e';
          const snapRes = snapResizeRect({ x, y: s.y, width, height: s.height }, mockHandle, snapCtx, 8, shouldSnapToGrid, gridSize);

          width = snapRes.width;
          height = width / ratio;
          x = snapRes.x;
          if (handle.includes('n')) {
            y = s.y + s.height - height;
          } else {
            y = s.y;
          }
        } else {
          const mockHandle = handle.includes('n') ? 'n' : 's';
          const snapRes = snapResizeRect({ x: s.x, y, width: s.width, height }, mockHandle, snapCtx, 8, shouldSnapToGrid, gridSize);

          height = snapRes.height;
          width = height * ratio;
          y = snapRes.y;
          if (handle.includes('w')) {
            x = s.x + s.width - width;
          } else {
            x = s.x;
          }
        }

        // Final sanity check to ensure minimum size is respected even after snapping
        if (width < minW) {
          width = minW;
          height = minH;
          if (handle.includes('w')) {
            x = s.x + s.width - width;
          }
          if (handle.includes('n')) {
            y = s.y + s.height - height;
          }
        }

        updateLayer(d.layerId, {
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(width),
          height: Math.round(height),
        });
      }
    };

    const onUp = () => {
      const interaction = interactionRef.current;
      interactionRef.current = null;
      setInteracting(false);
      setIsPanning(false);
      if (interaction?.kind === 'drawing-selection') setDrawingSelectionRect(null);
      if (
        interaction?.kind === 'layer'
        || interaction?.kind === 'snapshot'
        || interaction?.kind === 'export-frame'
        || interaction?.kind === 'drawing'
      ) {
        onHistoryTransactionEnd?.('pointer');
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [interacting, isPanning, zoom, layers, updateLayer, onLayersChange, setLayerSelection, setViewport, viewport, snapshotFrames, onSnapshotFramesChange, exportFrames, onExportFramesChange, onDrawingsChange, onHistoryTransactionEnd, snapToGrid, snapToElements, gridSize]);

  useEffect(() => {
    const onKeyDown = (e) => {
      const target = e.target;
      const isTextEditing = target instanceof HTMLElement
        && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      const isEditable = target instanceof HTMLElement
        && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName));

      if (e.code === 'Space' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!isEditable) {
          e.preventDefault();
          snapHotkeyDownRef.current = true;
        }
      }
      if (e.code === 'KeyQ' && !e.ctrlKey && !e.metaKey && !e.altKey && !isEditable) {
        e.preventDefault();
        setIsGridOverlayActive(true);
      }
      if (
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
        && !e.ctrlKey
        && !e.metaKey
        && !e.altKey
        && !e.shiftKey
        && !isTextEditing
      ) {
        if (selectedLayerIds.length !== 1) return;
        const selectedLayer = layers.find((layer) => layer.id === selectedLayerId);
        const canCycleVariants = selectedLayer?.variants?.length > 1
          && variantLoad?.layerId !== selectedLayerId;
        if (canCycleVariants) {
          e.preventDefault();
          cycleLayerVariantBy(selectedLayerId, e.key === 'ArrowLeft' ? -1 : 1);
          return;
        }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (selectedDrawingIds.length && onDrawingsChange) {
          e.preventDefault();
          const selectedIds = new Set(selectedDrawingIds);
          onDrawingsChange(drawings.filter((drawing) => !selectedIds.has(drawing.id)));
          setSelectedDrawingIds([]);
          return;
        }
        if (selectedSnapshotId && onSnapshotFramesChange) {
          e.preventDefault();
          onSnapshotFramesChange(snapshotFrames.filter((f) => f.id !== selectedSnapshotId));
          onSelectedSnapshotIdChange?.(null);
          return;
        }
        if (selectedExportFrameId && onExportFramesChange) {
          e.preventDefault();
          onExportFramesChange(exportFrames.filter((frame) => frame.id !== selectedExportFrameId));
          onSelectedExportFrameIdChange?.(null);
          return;
        }
        if (!selectedLayerIds.length) return;
        e.preventDefault();
        removeLayers(selectedLayerIds);
      }
    };
    const onKeyUp = (e) => {
      if (e.code === 'Space') snapHotkeyDownRef.current = false;
      if (e.code === 'KeyQ') setIsGridOverlayActive(false);
    };
    const onBlur = () => {
      snapHotkeyDownRef.current = false;
      setIsGridOverlayActive(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [
    selectedLayerId,
    selectedLayerIds,
    selectedDrawingIds,
    removeLayer,
    removeLayers,
    selectedSnapshotId,
    snapshotFrames,
    onSnapshotFramesChange,
    onSelectedSnapshotIdChange,
    selectedExportFrameId,
    exportFrames,
    onExportFramesChange,
    onSelectedExportFrameIdChange,
    layers,
    variantLoad,
    cycleLayerVariantBy,
    drawings,
    onDrawingsChange,
  ]);

  useEffect(() => {
    const onCopy = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const {
        layers,
        selectedLayerId,
        snapshotFrames,
        selectedSnapshotId,
        onSnapshotFramesChange,
      } = stateRef.current;

      if (selectedLayerId) {
        const layer = layers.find((l) => l.id === selectedLayerId);
        if (layer) {
          e.preventDefault();
          try {
            e.clipboardData.setData('application/x-outpaint-studio-layer', JSON.stringify(layer));
            e.clipboardData.setData('text/plain', layer.url || layer.id);
            sessionStorage.setItem('outpaint_studio_copied_layer', JSON.stringify(layer));
            sessionStorage.removeItem('outpaint_studio_copied_snapshot');
          } catch (err) {
            console.warn('Failed to copy layer to clipboard:', err);
          }
          return;
        }
      }

      if (selectedSnapshotId && onSnapshotFramesChange) {
        const frame = snapshotFrames.find((f) => f.id === selectedSnapshotId);
        if (frame) {
          e.preventDefault();
          try {
            e.clipboardData.setData('application/x-outpaint-studio-snapshot', JSON.stringify(frame));
            e.clipboardData.setData('text/plain', frame.id);
            sessionStorage.setItem('outpaint_studio_copied_snapshot', JSON.stringify(frame));
            sessionStorage.removeItem('outpaint_studio_copied_layer');
          } catch (err) {
            console.warn('Failed to copy snapshot frame to clipboard:', err);
          }
        }
      }
    };

    const onPaste = async (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const {
        layers,
        onLayersChange,
        onSelectedLayerIdChange,
        viewport,
        snapshotFrames,
        onSnapshotFramesChange,
        onSelectedSnapshotIdChange,
      } = stateRef.current;

      try {
        const layerData = e.clipboardData?.getData('application/x-outpaint-studio-layer');
        let layerObj = null;

        if (layerData) {
          try {
            layerObj = JSON.parse(layerData);
          } catch (_) {}
        }

        if (!layerObj) {
          try {
            const stored = sessionStorage.getItem('outpaint_studio_copied_layer');
            if (stored) {
              layerObj = JSON.parse(stored);
            }
          } catch (_) {}
        }

        if (layerObj && layerObj.url) {
          e.preventDefault();

          const newId = createLayerId();
          const offset = 40;

          const newLayer = {
            ...layerObj,
            id: newId,
            x: layerObj.x + offset,
            y: layerObj.y + offset,
            isNewResult: false,
          };

          try {
            sessionStorage.setItem('outpaint_studio_copied_layer', JSON.stringify(newLayer));
          } catch (_) {}

          onLayersChange([...layers, newLayer]);
          onSelectedLayerIdChange(newId);
          return;
        }

        const frameData = e.clipboardData?.getData('application/x-outpaint-studio-snapshot');
        let frameObj = null;

        if (frameData) {
          try {
            frameObj = JSON.parse(frameData);
          } catch (_) {}
        }

        if (!frameObj) {
          try {
            const stored = sessionStorage.getItem('outpaint_studio_copied_snapshot');
            if (stored) {
              frameObj = JSON.parse(stored);
            }
          } catch (_) {}
        }

        if (frameObj && onSnapshotFramesChange) {
          e.preventDefault();

          const newId = 'snap_' + Date.now();
          const offset = 40;

          const newFrame = {
            ...frameObj,
            id: newId,
            x: frameObj.x + offset,
            y: frameObj.y + offset,
            status: 'idle',
            error: undefined,
            generatingTotal: undefined,
            generatingDone: undefined,
          };

          try {
            sessionStorage.setItem('outpaint_studio_copied_snapshot', JSON.stringify(newFrame));
          } catch (_) {}

          onSnapshotFramesChange([...snapshotFrames, newFrame]);
          onSelectedSnapshotIdChange?.(newId);
          return;
        }
      } catch (err) {
        console.error('Failed to paste content:', err);
      }
    };

    window.addEventListener('copy', onCopy);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('paste', onPaste);
    };
  }, []);

  stateRef.current = {
    layers,
    selectedLayerId,
    viewport,
    onLayersChange,
    onSelectedLayerIdChange,
    addFilesAt,
    snapshotFrames,
    onSnapshotFramesChange,
    selectedSnapshotId,
    onSelectedSnapshotIdChange,
  };

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    const worldX = (localX - viewport.panX) / viewport.zoom;
    const worldY = (localY - viewport.panY) / viewport.zoom;

    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewport.zoom * factor));

    setViewport({
      panX: localX - worldX * newZoom,
      panY: localY - worldY * newZoom,
      zoom: newZoom,
    });
  }, [viewport, setViewport]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const placeSnapshotAt = useCallback((clientX, clientY) => {
    if (!onSnapshotFramesChange) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const { x, y } = screenToWorld(rect, viewport, clientX, clientY);
    const { imageSize, aspectRatio, model } = generationDefaults;

    const newFrame = {
      id: 'snap_' + Date.now(),
      ...createSnapshotFrame(x, y, imageSize, aspectRatio, model),
      prompt: '',
      status: 'idle',
    };

    onSnapshotFramesChange([...snapshotFrames, newFrame]);
    onSelectedSnapshotIdChange?.(newFrame.id);
    onSelectedExportFrameIdChange?.(null);
    setLayerSelection([]);
  }, [
    viewport,
    snapshotFrames,
    generationDefaults,
    onSnapshotFramesChange,
    onSelectedSnapshotIdChange,
    onSelectedExportFrameIdChange,
    setLayerSelection,
  ]);

  const placeSnapshotAtCenter = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    placeSnapshotAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, [placeSnapshotAt]);

  const placeExportFrameAt = useCallback((clientX, clientY) => {
    if (!onExportFramesChange) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const center = screenToWorld(rect, viewport, clientX, clientY);
    const frame = {
      id: `export_${Date.now()}`,
      x: Math.round(center.x - 256),
      y: Math.round(center.y - 256),
      width: 512,
      height: 512,
    };
    onExportFramesChange([...exportFrames, frame]);
    onSelectedExportFrameIdChange?.(frame.id);
    onSelectedSnapshotIdChange?.(null);
    setLayerSelection([]);
  }, [exportFrames, onExportFramesChange, onSelectedExportFrameIdChange, setLayerSelection, onSelectedSnapshotIdChange, viewport]);

  const placeExportFrameAtCenter = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    placeExportFrameAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, [placeExportFrameAt]);

  const saveExportFrame = useCallback(async (frame, format = 'png') => {
    const width = Math.max(1, Math.round(frame.width));
    const height = Math.max(1, Math.round(frame.height));
    const extension = format === 'jpg' ? 'jpg' : 'png';
    const mimeType = extension === 'jpg' ? 'image/jpeg' : 'image/png';
    setSavingExportFrameId(frame.id);
    try {
      const composed = await composeSnapshotBackground(
        frame,
        layers,
        width,
        height,
        { type: gridType, size: gridSize, angle: gridAngle },
        false,
        drawingsRef.current,
        tilePaintsRef.current,
        { size: gridSize, angle: gridAngle },
        { mimeType, quality: 0.92 },
      );
      const binary = window.atob(composed.data);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: composed.mimeType }));
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `outpaint_${width}x${height}.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (error) {
      console.error('Export image failed:', error);
    } finally {
      setSavingExportFrameId(null);
    }
  }, [gridAngle, gridSize, gridType, layers]);

  const pointFromPointerEvent = useCallback((event) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: (event.clientX - rect.left - viewport.panX) / viewport.zoom,
      y: (event.clientY - rect.top - viewport.panY) / viewport.zoom,
    };
  }, [viewport]);

  const paintTileAtPoint = useCallback((point) => {
    if (gridType !== 'isometric' || !onTilePaintsChange) return;
    const cell = getIsometricCellAtPoint(point, gridSize, gridAngle);
    const brushCells = getTileBrushCells(cell, tileBrushSize);
    const footprintKey = brushCells.map((brushCell) => `${brushCell.u}:${brushCell.v}`).join('|');
    if (activeTilePointerRef.current?.lastKey === footprintKey) return;
    if (activeTilePointerRef.current) activeTilePointerRef.current.lastKey = footprintKey;

    const targetKeys = new Set(brushCells.map((brushCell) => `${brushCell.u}:${brushCell.v}`));

    const current = tilePaintsRef.current;
    if (tileColor === null) {
      const next = current.filter((tile) => !targetKeys.has(`${tile.u}:${tile.v}`));
      if (next.length === current.length) return;
      tilePaintsRef.current = next;
      onTilePaintsChange(next);
      return;
    }
    const nextByKey = new Map(current.map((tile) => [`${tile.u}:${tile.v}`, tile]));
    let changed = false;
    targetKeys.forEach((key) => {
      const [u, v] = key.split(':').map(Number);
      if (nextByKey.get(key)?.color === tileColor) return;
      nextByKey.set(key, { u, v, color: tileColor });
      changed = true;
    });
    if (!changed) return;
    const next = [...nextByKey.values()];
    tilePaintsRef.current = next;
    onTilePaintsChange(next);
  }, [gridAngle, gridSize, gridType, onTilePaintsChange, tileBrushSize, tileColor]);

  const handleDrawPointerDown = useCallback((event) => {
    if (!['draw', 'erase', 'tile'].includes(activeTool) || event.button !== 0 || event.altKey) return;
    const point = pointFromPointerEvent(event);
    if (!point) return;

    if (activeTool === 'tile') {
      if (gridType !== 'isometric' || !onTilePaintsChange) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      onToolActionStart?.();
      onHistoryTransactionStart?.('tile');
      setLayerSelection([]);
      onSelectedSnapshotIdChange?.(null);
      onSelectedExportFrameIdChange?.(null);
      activeTilePointerRef.current = { pointerId: event.pointerId, lastKey: null, lastPoint: point };
      paintTileAtPoint(point);
      return;
    }
    if (!onDrawingsChange) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onToolActionStart?.();
    onHistoryTransactionStart?.('draw');
    setLayerSelection([]);
    onSelectedSnapshotIdChange?.(null);
    onSelectedExportFrameIdChange?.(null);

    const stroke = {
      id: `stroke_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      mode: activeTool === 'erase' ? 'erase' : 'draw',
      color: activeTool === 'erase' ? undefined : brushColor,
      width: activeTool === 'erase' ? eraserSize : brushSize,
      points: [point],
      pointerId: event.pointerId,
    };
    activeStrokePathElsRef.current.clear();
    activeStrokeRef.current = stroke;
    setActiveStroke(stroke);
  }, [
    activeTool,
    brushColor,
    brushSize,
    eraserSize,
    onDrawingsChange,
    onToolActionStart,
    onHistoryTransactionStart,
    setLayerSelection,
    onSelectedSnapshotIdChange,
    onSelectedExportFrameIdChange,
    gridType,
    onTilePaintsChange,
    paintTileAtPoint,
    pointFromPointerEvent,
  ]);

  const handleDrawPointerMove = useCallback((event) => {
    const tilePointer = activeTilePointerRef.current;
    if (tilePointer?.pointerId === event.pointerId) {
      const point = pointFromPointerEvent(event);
      if (!point) return;
      event.preventDefault();
      event.stopPropagation();
      const previousPoint = tilePointer.lastPoint || point;
      const distance = Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y);
      const steps = Math.max(1, Math.ceil(distance / Math.max(2, gridSize / 3)));
      for (let step = 1; step <= steps; step += 1) {
        const progress = step / steps;
        paintTileAtPoint({
          x: previousPoint.x + (point.x - previousPoint.x) * progress,
          y: previousPoint.y + (point.y - previousPoint.y) * progress,
        });
      }
      tilePointer.lastPoint = point;
      return;
    }
    const stroke = activeStrokeRef.current;
    if (!stroke || stroke.pointerId !== event.pointerId) return;
    const point = pointFromPointerEvent(event);
    if (!point) return;
    const last = stroke.points[stroke.points.length - 1];
    const minDistance = 1.5 / viewport.zoom;
    if (Math.hypot(point.x - last.x, point.y - last.y) < minDistance) return;

    event.preventDefault();
    event.stopPropagation();
    stroke.points.push(point);
    if (drawingFrameRef.current === null) {
      drawingFrameRef.current = requestAnimationFrame(() => {
        drawingFrameRef.current = null;
        const currentStroke = activeStrokeRef.current;
        if (!currentStroke) return;
        const path = strokePath(currentStroke.points);
        activeStrokePathElsRef.current.forEach((node) => {
          if (node.isConnected) node.setAttribute('d', path);
          else activeStrokePathElsRef.current.delete(node);
        });
      });
    }
  }, [gridSize, paintTileAtPoint, pointFromPointerEvent, viewport.zoom]);

  const updateBrushCursor = useCallback((event) => {
    const cursorNode = brushCursorRef.current;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!cursorNode || !rect || !['draw', 'erase'].includes(activeTool) || isPanning) return;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    cursorNode.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
    cursorNode.style.opacity = '1';
  }, [activeTool, isPanning]);

  const updateTileCursor = useCallback((event) => {
    if (activeTool !== 'tile' || gridType !== 'isometric' || isPanning) {
      setTileHoverCell(null);
      return;
    }
    const point = pointFromPointerEvent(event);
    if (!point) return;
    const cell = getIsometricCellAtPoint(point, gridSize, gridAngle);
    setTileHoverCell((current) => (
      current?.u === cell.u && current?.v === cell.v ? current : cell
    ));
  }, [activeTool, gridAngle, gridSize, gridType, isPanning, pointFromPointerEvent]);

  const hideToolCursors = useCallback(() => {
    if (brushCursorRef.current) brushCursorRef.current.style.opacity = '0';
    setTileHoverCell(null);
  }, []);

  const handleCanvasPointerMove = useCallback((event) => {
    updateBrushCursor(event);
    updateTileCursor(event);
    handleDrawPointerMove(event);
  }, [handleDrawPointerMove, updateBrushCursor, updateTileCursor]);

  const finishDrawing = useCallback((event) => {
    const tilePointer = activeTilePointerRef.current;
    if (tilePointer?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      activeTilePointerRef.current = null;
      onHistoryTransactionEnd?.('tile');
      return;
    }
    const stroke = activeStrokeRef.current;
    if (!stroke || stroke.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.releasePointerCapture?.(event.pointerId);

    const { pointerId, ...completedStroke } = stroke;
    if (drawingFrameRef.current !== null) {
      cancelAnimationFrame(drawingFrameRef.current);
      drawingFrameRef.current = null;
    }
    activeStrokeRef.current = null;
    activeStrokePathElsRef.current.clear();
    setActiveStroke(null);
    onDrawingsChange?.([...drawingsRef.current, completedStroke]);
    onHistoryTransactionEnd?.('draw');
  }, [onDrawingsChange, onHistoryTransactionEnd]);

  const handleBackgroundPointerDown = useCallback((e) => {
    if (e.button !== 0 && e.button !== 1) return;
    const panMode = e.button === 1 || e.altKey;
    if (panMode) {
      e.preventDefault();
      startPan(e);
      return;
    }
    setLayerSelection([]);
    onSelectedSnapshotIdChange?.(null);
    onSelectedExportFrameIdChange?.(null);
    if (activeTool === 'select') {
      const point = pointFromPointerEvent(e);
      if (!point) return;
      e.preventDefault();
      setSelectedDrawingIds([]);
      setDrawingSelectionRect({ x: point.x, y: point.y, width: 0, height: 0 });
      interactionRef.current = {
        kind: 'drawing-selection',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startWorldX: point.x,
        startWorldY: point.y,
      };
      setInteracting(true);
      return;
    }
    setSelectedDrawingIds([]);
    startPan(e);
  }, [
    activeTool,
    setLayerSelection,
    onSelectedSnapshotIdChange,
    onSelectedExportFrameIdChange,
    pointFromPointerEvent,
    startPan,
  ]);

  const handleDrawingPointerDown = useCallback((event, drawingId) => {
    if (activeTool !== 'select' || event.button !== 0 || event.altKey) return;
    const drawing = drawingsRef.current.find((item) => item.id === drawingId);
    if (!drawing) return;
    event.preventDefault();
    event.stopPropagation();
    onHistoryTransactionStart?.('pointer');
    const movingIds = selectedDrawingIds.includes(drawingId)
      ? selectedDrawingIds
      : [drawingId];
    const movingIdSet = new Set(movingIds);
    const startPointsById = Object.fromEntries(
      drawingsRef.current
        .filter((item) => movingIdSet.has(item.id))
        .map((item) => [
          item.id,
          (item.points || []).map((point) => ({ ...point })),
        ]),
    );
    setSelectedDrawingIds(movingIds);
    setLayerSelection([]);
    onSelectedSnapshotIdChange?.(null);
    onSelectedExportFrameIdChange?.(null);
    interactionRef.current = {
      kind: 'drawing',
      drawingIds: movingIds,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPointsById,
    };
    setInteracting(true);
  }, [activeTool, onHistoryTransactionStart, setLayerSelection, onSelectedSnapshotIdChange, onSelectedExportFrameIdChange, selectedDrawingIds]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const { x, y } = screenToWorld(rect, viewport, e.clientX, e.clientY);
    if (e.dataTransfer?.getData(STUDIO_SNAPSHOT_DRAG_TYPE)) {
      placeSnapshotAt(e.clientX, e.clientY);
      return;
    }
    if (e.dataTransfer?.getData(STUDIO_EXPORT_DRAG_TYPE)) {
      placeExportFrameAt(e.clientX, e.clientY);
      return;
    }
    if (e.dataTransfer?.files?.length) {
      addFilesAt(e.dataTransfer.files, x, y);
    }
  }, [viewport, addFilesAt, placeSnapshotAt, placeExportFrameAt]);

  const handleFileInput = useCallback((e) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const { x, y } = screenToWorld(rect, viewport, rect.left + cx, rect.top + cy);
    if (e.target.files?.length) {
      addFilesAt(e.target.files, x, y);
      e.target.value = '';
    }
  }, [viewport, addFilesAt]);

  const selectedLayerIdSet = useMemo(() => new Set(selectedLayerIds), [selectedLayerIds]);
  const selectedLayers = useMemo(() => layers.filter((layer) => (
    selectedLayerIdSet.has(layer.id)
  )), [layers, selectedLayerIdSet]);
  const selectedLayerGroupBounds = useMemo(() => (
    selectedLayers.length > 1 ? layerGroupBounds(selectedLayers) : null
  ), [selectedLayers]);
  const sortedLayers = useMemo(() => [...layers].sort((a, b) => {
    if (selectedLayerIdSet.has(a.id) && !selectedLayerIdSet.has(b.id)) return 1;
    if (selectedLayerIdSet.has(b.id) && !selectedLayerIdSet.has(a.id)) return -1;
    return 0;
  }), [layers, selectedLayerIdSet]);

  const cursor = isPanning
    ? 'grabbing'
    : (['draw', 'erase'].includes(activeTool) ? 'none' : activeTool === 'tile' ? 'crosshair' : 'default');
  const brushCursorSize = Math.max(
    1,
    (activeTool === 'erase' ? eraserSize : brushSize) * viewport.zoom,
  );

  const handleSnapshotImageSize = useCallback((frameId, imageSize) => {
    if (!onSnapshotFramesChange) return;
    const next = snapshotFrames.map((f) => {
      if (f.id === frameId) {
        return applySnapshotSettings(f, imageSize, f.aspectRatio, f.model);
      }
      return f;
    });
    onSnapshotFramesChange(next);
  }, [snapshotFrames, onSnapshotFramesChange]);

  const handleSnapshotAspectRatio = useCallback((frameId, aspectRatio) => {
    if (!onSnapshotFramesChange) return;
    const next = snapshotFrames.map((f) => {
      if (f.id === frameId) {
        return applySnapshotSettings(f, f.imageSize, aspectRatio, f.model);
      }
      return f;
    });
    onSnapshotFramesChange(next);
  }, [snapshotFrames, onSnapshotFramesChange]);

  const handleSnapshotModel = useCallback((frameId, model) => {
    if (!onSnapshotFramesChange) return;
    const next = snapshotFrames.map((f) => {
      if (f.id === frameId) {
        const imageSize = coerceImageSizeForModel(f.imageSize, model);
        return applySnapshotSettings(f, imageSize, f.aspectRatio, model);
      }
      return f;
    });
    onSnapshotFramesChange(next);
  }, [snapshotFrames, onSnapshotFramesChange]);

  const handleSnapshotPromptChange = useCallback((frameId, prompt) => {
    if (!onSnapshotFramesChange) return;
    const next = snapshotFrames.map((f) => {
      if (f.id === frameId) {
        return { ...f, prompt };
      }
      return f;
    });
    onSnapshotFramesChange(next);
  }, [snapshotFrames, onSnapshotFramesChange]);

  const handleSnapshotResetScale = useCallback((frameId) => {
    if (!onSnapshotFramesChange) return;
    const next = snapshotFrames.map((f) => (
      f.id === frameId ? resetSnapshotToDefaultSize(f) : f
    ));
    onSnapshotFramesChange(next);
  }, [snapshotFrames, onSnapshotFramesChange]);

  const handleSnapshotDelete = useCallback((frameId) => {
    if (!onSnapshotFramesChange) return;
    onSnapshotFramesChange(snapshotFrames.filter((frame) => frame.id !== frameId));
    if (selectedSnapshotId === frameId) onSelectedSnapshotIdChange?.(null);
  }, [snapshotFrames, onSnapshotFramesChange, selectedSnapshotId, onSelectedSnapshotIdChange]);

  useImperativeHandle(ref, () => ({
    openFilePicker: () => fileInputRef.current?.click(),
    placeSnapshotAtCenter,
    placeExportFrameAtCenter,
  }), [placeExportFrameAtCenter, placeSnapshotAtCenter]);

  useEffect(() => {
    const canvas = gridCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return undefined;

    const repaint = () => {
      paintGridCanvas(
        canvas,
        viewport,
        gridSize,
        gridType,
        gridAngle,
      );
    };

    repaint();
    const ro = new ResizeObserver(repaint);
    ro.observe(container);
    return () => ro.disconnect();
  }, [viewport, gridSize, gridType, gridAngle]);

  const visibleDrawingActions = activeStroke ? [...drawings, activeStroke] : drawings;
  const visibleDrawingBounds = drawingBounds(visibleDrawingActions);
  const tileBrushPreviewCells = activeTool === 'tile' && tileHoverCell && !isPanning
    ? getTileBrushCells(tileHoverCell, tileBrushSize)
    : [];

  return (
    <div
      ref={containerRef}
      className={['draw', 'erase'].includes(activeTool) && !isPanning ? 'infinite-canvas draw-mode' : 'infinite-canvas'}
      data-image-paste-target
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      onPointerDown={handleBackgroundPointerDown}
      onPointerDownCapture={handleDrawPointerDown}
      onPointerEnter={handleCanvasPointerMove}
      onPointerLeave={hideToolCursors}
      onPointerMoveCapture={handleCanvasPointerMove}
      onPointerUpCapture={finishDrawing}
      onPointerCancelCapture={finishDrawing}
      style={{
        position: 'relative',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        backgroundColor: '#f2f2f7',
        cursor,
        touchAction: 'none',
        userSelect: 'none',
      }}
    >
      <div
        ref={brushCursorRef}
        aria-hidden="true"
        className={`brush-cursor-preview${activeTool === 'erase' ? ' eraser' : ''}`}
        style={{
          display: ['draw', 'erase'].includes(activeTool) && !isPanning ? 'block' : 'none',
          width: brushCursorSize,
          height: brushCursorSize,
          '--brush-cursor-color': brushColor,
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileInput}
        style={{ display: 'none' }}
      />

      <canvas
        ref={gridCanvasRef}
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: isGridOverlayActive ? 2 : 0,
        }}
      />

      {drawingSelectionRect && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: viewport.panX + drawingSelectionRect.x * zoom,
            top: viewport.panY + drawingSelectionRect.y * zoom,
            width: drawingSelectionRect.width * zoom,
            height: drawingSelectionRect.height * zoom,
            zIndex: 30,
            boxSizing: 'border-box',
            border: '1px solid #007aff',
            background: 'rgba(0, 122, 255, 0.12)',
            pointerEvents: 'none',
          }}
        />
      )}

      <svg
        aria-hidden="true"
        width="100%"
        height="100%"
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'visible',
          pointerEvents: 'none',
          zIndex: 3,
        }}
      >
        {snapshotFrames.filter((frame) => frame.id === selectedSnapshotId).flatMap((frame) => (
          (frame.referenceImages || []).map((reference) => {
            if (reference.kind !== 'layer') return null;
            const layer = layers.find((item) => item.id === reference.layerId);
            const sourceRect = referenceAnchors[`${frame.id}:${reference.id}`];
            if (!layer || !sourceRect) return null;
            const endX = viewport.panX + (layer.x + layer.width / 2) * viewport.zoom;
            const endY = viewport.panY + (layer.y + layer.height / 2) * viewport.zoom;
            return (
              <g key={`${frame.id}_${reference.id}`}>
                <path
                  d={referenceCurvePath(sourceRect, endX, endY)}
                  fill="none"
                  stroke="rgba(0,122,255,0.78)"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </g>
            );
          })
        ))}
        {linkDrag && (
          <path
            d={referenceCurvePath(linkDrag.sourceRect, linkDrag.currentX, linkDrag.currentY)}
            fill="none"
            stroke="#007aff"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="6 5"
          />
        )}
      </svg>

      {snapshotFrames.filter((frame) => frame.id === selectedSnapshotId).flatMap((frame) => (
        (frame.referenceImages || []).map((reference) => {
          if (reference.kind !== 'layer') return null;
          const layer = layers.find((item) => item.id === reference.layerId);
          if (!layer) return null;
          const x = viewport.panX + (layer.x + layer.width / 2) * viewport.zoom;
          const y = viewport.panY + (layer.y + layer.height / 2) * viewport.zoom;
          return (
            <button
              key={`pin_${frame.id}_${reference.id}`}
              type="button"
              aria-label="Delete link"
              className="studio-tooltip"
              data-tooltip="Delete link"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                removeSnapshotReference(frame.id, reference.id);
              }}
              style={{
                position: 'absolute',
                left: x,
                top: y,
                zIndex: 4,
                width: 16,
                height: 16,
                display: 'grid',
                placeItems: 'center',
                padding: 0,
                border: '2px solid #007aff',
                borderRadius: '50%',
                background: '#fff',
                color: '#007aff',
                fontSize: 11,
                fontWeight: 700,
                lineHeight: 1,
                cursor: 'pointer',
                transform: 'translate(-50%, -50%)',
              }}
            >
              ×
            </button>
          );
        })
      ))}

      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          zIndex: 1,
          transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
          transformOrigin: '0 0',
        }}
      >
        <svg
          aria-hidden="true"
          width="1"
          height="1"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            zIndex: 0,
            overflow: 'visible',
            pointerEvents: activeTool === 'select' ? 'auto' : 'none',
          }}
        >
          {tilePaints.map((tile) => (
            <polygon
              key={`${tile.u}:${tile.v}`}
              points={getIsometricCellPolygon(tile, gridSize, gridAngle)
                .map((point) => `${point.x},${point.y}`)
                .join(' ')}
              fill={tile.color}
            />
          ))}
          <defs>
            {visibleDrawingActions.map((stroke, strokeIndex) => {
              if (stroke.mode === 'erase') return null;
              const laterErasers = visibleDrawingActions
                .slice(strokeIndex + 1)
                .filter((action) => action.mode === 'erase');
              if (!laterErasers.length) return null;
              const maskId = `${drawingMaskPrefixRef.current}_${stroke.id}`;
              return (
                <mask
                  key={maskId}
                  id={maskId}
                  maskUnits="userSpaceOnUse"
                  x={visibleDrawingBounds.x}
                  y={visibleDrawingBounds.y}
                  width={visibleDrawingBounds.width}
                  height={visibleDrawingBounds.height}
                >
                  <rect
                    x={visibleDrawingBounds.x}
                    y={visibleDrawingBounds.y}
                    width={visibleDrawingBounds.width}
                    height={visibleDrawingBounds.height}
                    fill="#fff"
                  />
                  {laterErasers.map((eraser) => (
                    <path
                      key={eraser.id}
                      ref={eraser.id === activeStroke?.id ? (node) => {
                        if (node) activeStrokePathElsRef.current.add(node);
                      } : undefined}
                      d={strokePath(eraser.points)}
                      fill="none"
                      stroke="#000"
                      strokeWidth={eraser.width}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                </mask>
              );
            })}
          </defs>
          {visibleDrawingActions.map((stroke, strokeIndex) => {
            if (stroke.mode === 'erase') return null;
            const hasLaterEraser = visibleDrawingActions
              .slice(strokeIndex + 1)
              .some((action) => action.mode === 'erase');
            const maskId = `${drawingMaskPrefixRef.current}_${stroke.id}`;
            const isSelected = selectedDrawingIds.includes(stroke.id);
            return (
              <g key={stroke.id} mask={hasLaterEraser ? `url(#${maskId})` : undefined}>
                {isSelected && (
                  <path
                    d={strokePath(stroke.points)}
                    fill="none"
                    stroke="#007aff"
                    strokeWidth={stroke.width + screenPx(5, zoom)}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pointerEvents="none"
                  />
                )}
                <path
                  ref={stroke.id === activeStroke?.id ? (node) => {
                    if (node) activeStrokePathElsRef.current.add(node);
                  } : undefined}
                  d={strokePath(stroke.points)}
                  fill="none"
                  stroke={stroke.color}
                  strokeWidth={stroke.width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pointerEvents="none"
                />
                {activeTool === 'select' && (
                  <path
                    d={strokePath(stroke.points)}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={Math.max(stroke.width, screenPx(14, zoom))}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pointerEvents="stroke"
                    onPointerDown={(event) => handleDrawingPointerDown(event, stroke.id)}
                    style={{
                      cursor: interacting
                        && interactionRef.current?.kind === 'drawing'
                        && interactionRef.current?.drawingIds?.includes(stroke.id)
                        ? 'grabbing'
                        : 'grab',
                    }}
                  />
                )}
              </g>
            );
          })}
        </svg>

        {sortedLayers.map((layer) => {
          const isSelected = selectedLayerIdSet.has(layer.id);
          const isSingleSelection = isSelected && selectedLayerIds.length === 1;
          const showNewPulse = layer.isNewResult && !isSelected;
          const variantLoading = variantLoad?.layerId === layer.id && variantLoad.url === layer.url;
          const seamOverlap = isLayerCropped(layer)
            ? 0
            : screenPx(LAYER_SEAM_OVERLAP_PX, zoom);
          return (
            <div
              key={layer.id}
              onPointerDown={(e) => {
                if (activeTool === 'select') {
                  startLayerInteraction(e, layer.id, 'move');
                  return;
                }
                if (activeTool === 'crop' && e.button === 0) {
                  e.preventDefault();
                  e.stopPropagation();
                  onSelectedSnapshotIdChange?.(null);
                  setLayerSelection([layer.id]);
                }
              }}
              style={{
                position: 'absolute',
                left: layer.x,
                top: layer.y,
                width: layer.width,
                height: layer.height,
                zIndex: isSelected ? 15 : 5,
                cursor: layer.locked ? 'not-allowed' : interacting ? 'grabbing' : 'grab',
                touchAction: 'none',
                boxShadow: isSelected
                  ? `0 ${screenPx(2, zoom)}px ${screenPx(12, zoom)}px rgba(0,0,0,0.15)`
                  : 'none',
                outline: linkDrag?.hoverLayerId === layer.id
                  ? `${screenPx(3, zoom)}px solid #007aff`
                  : isSelected
                    ? `${screenPx(1, zoom)}px solid #007aff`
                    : 'none',
                outlineOffset: linkDrag?.hoverLayerId === layer.id
                  ? screenPx(3, zoom)
                  : isSelected ? screenPx(1, zoom) : 0,
              }}
            >
              {showNewPulse && (
                <NewLayerPulseOutline width={layer.width} height={layer.height} zoom={zoom} />
              )}
              {isSelected && activeTool === 'crop' && (
                <CropSourcePreview layer={layer} zoom={zoom} />
              )}
              <div
                style={{
                  position: 'absolute',
                  left: -seamOverlap,
                  top: -seamOverlap,
                  width: layer.width + seamOverlap * 2,
                  height: layer.height + seamOverlap * 2,
                  overflow: 'hidden',
                  zIndex: 1,
                }}
              >
                <StableLayerImage layer={layer} onReady={finishVariantLoad} />
              </div>
              {isSingleSelection && !layer.locked && activeTool === 'select' && RESIZE_HANDLES.map((h) => (
                <div
                  key={h}
                  onPointerDown={(e) => startLayerInteraction(e, layer.id, `resize-${h}`)}
                  style={handleStyle(h, layer.width, layer.height, zoom)}
                />
              ))}
              {isSelected && activeTool === 'crop' && CROP_HANDLES.map((h) => (
                <div
                  key={h}
                  onPointerDown={(e) => startLayerInteraction(e, layer.id, `crop-${h}`)}
                  style={{
                    ...handleStyle(h, layer.width, layer.height, zoom),
                    backgroundColor: '#007aff',
                    borderColor: '#fff',
                  }}
                />
              ))}
              {isSingleSelection && (
                <LayerSelectionBar
                  layer={layer}
                  gridSize={gridSize}
                  zoom={zoom}
                  cropActive={activeTool === 'crop'}
                  onToggleCrop={() => onToolChange?.(activeTool === 'crop' ? 'select' : 'crop')}
                  onResetScale={() => resetLayerToNaturalSize(layer)}
                  onResetCrop={() => {
                    const crop = normalizeLayerCrop(layer);
                    const fullWidth = layer.width / crop.width;
                    const fullHeight = layer.height / crop.height;
                    updateLayer(layer.id, {
                      x: layer.x - crop.x * fullWidth,
                      y: layer.y - crop.y * fullHeight,
                      width: fullWidth,
                      height: fullHeight,
                      crop: undefined,
                    });
                  }}
                  onDownload={async () => {
                    try {
                      await downloadLayerImage(layer);
                    } catch (err) {
                      console.error('Download failed:', err);
                    }
                  }}
                  onRemove={() => removeLayer(layer.id)}
                  onPrevVariant={() => cycleLayerVariantBy(layer.id, -1)}
                  onNextVariant={() => cycleLayerVariantBy(layer.id, 1)}
                  onRegenerate={() => onLayerRegenerate?.(layer.id)}
                  onToggleLocked={() => setLayersLocked([layer.id], !layer.locked)}
                  variantLoading={variantLoading}
                />
              )}
            </div>
          );
        })}

        {selectedLayerGroupBounds && (
          <div
            style={{
              position: 'absolute',
              left: selectedLayerGroupBounds.x,
              top: selectedLayerGroupBounds.y,
              width: selectedLayerGroupBounds.width,
              height: selectedLayerGroupBounds.height,
              zIndex: 20,
              boxSizing: 'border-box',
              border: `${screenPx(1, zoom)}px dashed #007aff`,
              pointerEvents: 'none',
            }}
          >
            <MultiLayerSelectionBar
              layers={selectedLayers}
              frameWidth={selectedLayerGroupBounds.width}
              gridSize={gridSize}
              zoom={zoom}
              onResetScale={() => resetLayersToNaturalSize(selectedLayers)}
              onToggleLocked={() => {
                const allLocked = selectedLayers.every((layer) => layer.locked);
                setLayersLocked(selectedLayerIds, !allLocked);
              }}
              onRemove={() => removeLayers(selectedLayerIds)}
            />
          </div>
        )}

        {snapshotFrames &&
          snapshotFrames.map((frame) => {
            const isSelected = frame.id === selectedSnapshotId;
            const generationMode = isSnapshotGenerationMode(
              frame,
              layers,
              drawings,
              tilePaints,
              gridSize,
              gridAngle,
            );
            const isInteractingWithThis =
              interacting &&
              interactionRef.current?.kind === 'snapshot' &&
              interactionRef.current?.frameId === frame.id;
            return (
              <SnapshotFrame
                key={frame.id}
                frame={frame}
                generationMode={generationMode}
                zoom={zoom}
                selected={isSelected}
                accentColor={accentColor}
                onPointerDown={(e, mode) => startSnapshotInteraction(e, frame.id, mode)}
                onImageSizeChange={(sz) => handleSnapshotImageSize(frame.id, sz)}
                onAspectRatioChange={(ar) => handleSnapshotAspectRatio(frame.id, ar)}
                onModelChange={(md) => handleSnapshotModel(frame.id, md)}
                onPromptChange={(pr) => handleSnapshotPromptChange(frame.id, pr)}
                onPromptFocus={() => onHistoryTransactionStart?.('prompt')}
                onPromptBlur={() => onHistoryTransactionEnd?.('prompt')}
                onGenerate={() => onSnapshotGenerate?.(frame.id, 1)}
                onGenerateX4={() => onSnapshotGenerate?.(frame.id, 4)}
                onCancelGeneration={() => onSnapshotCancelGeneration?.(frame.id)}
                onResetScale={() => handleSnapshotResetScale(frame.id)}
                onDelete={() => handleSnapshotDelete(frame.id)}
                globalContext={globalContext}
                layers={layers}
                onAddReferenceCard={() => addSnapshotReferenceCard(frame.id)}
                onAddReferenceFile={(referenceId, file) => setSnapshotReferenceFile(frame.id, referenceId, file)}
                onRemoveReference={(referenceId) => removeSnapshotReference(frame.id, referenceId)}
                onStartReferenceLink={(event, referenceId) => startReferenceLink(event, frame.id, referenceId)}
                onOpenGlobalContext={onOpenGlobalContext}
                referenceAnchorRef={(referenceId, node) => registerReferenceAnchor(frame.id, referenceId, node)}
                isInteracting={isInteractingWithThis}
              />
            );
          })}

        {exportFrames.map((frame) => (
          <ExportFrame
            key={frame.id}
            frame={frame}
            zoom={zoom}
            selected={frame.id === selectedExportFrameId}
            saving={savingExportFrameId === frame.id}
            onPointerDown={(event, mode) => startExportFrameInteraction(event, frame.id, mode)}
            onSave={(format) => saveExportFrame(frame, format)}
            onDelete={() => {
              onExportFramesChange?.(exportFrames.filter((item) => item.id !== frame.id));
              if (selectedExportFrameId === frame.id) onSelectedExportFrameIdChange?.(null);
            }}
          />
        ))}

        {tileBrushPreviewCells.length > 0 && (
          <svg
            aria-hidden="true"
            width="1"
            height="1"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              zIndex: 40,
              overflow: 'visible',
              pointerEvents: 'none',
            }}
          >
            {tileBrushPreviewCells.map((cell) => (
              <polygon
                key={`${cell.u}:${cell.v}`}
                points={getIsometricCellPolygon(cell, gridSize, gridAngle)
                  .map((point) => `${point.x},${point.y}`)
                  .join(' ')}
                fill={tileColor || '#ff3b30'}
                fillOpacity={tileColor ? 0.34 : 0.12}
                stroke={tileColor || '#ff3b30'}
                strokeWidth={screenPx(2, zoom)}
                strokeDasharray={tileColor ? undefined : `${screenPx(5, zoom)} ${screenPx(3, zoom)}`}
              />
            ))}
          </svg>
        )}
      </div>

      {/* Hint for an empty canvas */}
      {layers.length === 0 && drawings.length === 0 && tilePaints.length === 0 && snapshotFrames.length === 0 && exportFrames.length === 0 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div className="empty-canvas-state">
            Drop images from your computer onto the canvas
            <br />
            Add a snapshot frame by clicking or dragging its icon from the left toolbar
            <br />
            <span>Scroll to zoom; drag the background to pan</span>
          </div>
        </div>
      )}
    </div>
  );
});

export default InfiniteCanvas;

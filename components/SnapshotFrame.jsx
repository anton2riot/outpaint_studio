import React, { useLayoutEffect, useRef, useState } from 'react';
import {
  ASPECT_RATIO_OPTIONS,
  formatResolutionLabel,
  getImageSizeOptionsForModel,
  getSnapshotScalePercent,
} from '../lib/generationSettings';
import { NANO_BANANA_MODEL_OPTIONS } from '../lib/nanoBananaModelConfig';
import { screenPx } from '../lib/infiniteCanvasUtils';
import ScreenSpacePanel, {
  STUDIO_PANEL_CHROME,
  STUDIO_SELECT_STYLE,
  STUDIO_FIELD_STYLE,
} from './ScreenSpacePanel';
import GenerationReferences from './GenerationReferences';

const HANDLE_SIZE = 8;
const CORNER_HANDLES = ['nw', 'ne', 'se', 'sw'];
const EDGE_HANDLES = ['n', 'e', 's', 'w'];
const SCALE_HIGHLIGHT_COLOR = '#ff9500';

function handleCursor(handle) {
  const map = {
    nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize',
    se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize',
  };
  return map[handle] || 'default';
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
    zIndex: 30,
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
 * @param {Object} props
 * @param {{ id: string, x: number, y: number, width: number, height: number, imageSize: string, aspectRatio: string, model?: string, prompt?: string, status?: string, error?: string }} props.frame
 * @param {boolean} props.selected
 * @param {boolean} [props.generationMode]
 * @param {string} props.accentColor
 * @param {(e: React.PointerEvent, mode: string) => void} props.onPointerDown
 * @param {(imageSize: string) => void} props.onImageSizeChange
 * @param {(aspectRatio: string) => void} props.onAspectRatioChange
 * @param {(model: string) => void} props.onModelChange
 * @param {(prompt: string) => void} props.onPromptChange
 * @param {() => void} [props.onPromptFocus]
 * @param {() => void} [props.onPromptBlur]
 * @param {() => void} props.onGenerate
 * @param {() => void} props.onGenerateX4
 * @param {() => void} props.onCancelGeneration
 * @param {() => void} props.onResetScale
 * @param {() => void} props.onDelete
 * @param {boolean} props.isInteracting
 * @param {number} [props.zoom]
 */
export default function SnapshotFrame({
  frame,
  generationMode = false,
  selected,
  accentColor,
  onPointerDown,
  onImageSizeChange,
  onAspectRatioChange,
  onModelChange,
  onPromptChange,
  onPromptFocus,
  onPromptBlur,
  onGenerate,
  onGenerateX4,
  onCancelGeneration,
  onResetScale,
  onDelete,
  globalContext,
  layers,
  onAddReferenceFile,
  onAddReferenceCard,
  onRemoveReference,
  onStartReferenceLink,
  onOpenGlobalContext,
  referenceAnchorRef,
  isInteracting = false,
  zoom = 1,
}) {
  const [isHovered, setIsHovered] = useState(false);
  const promptRef = useRef(null);
  const resolution = formatResolutionLabel(frame.imageSize, frame.aspectRatio, frame.model);
  const scalePercent = getSnapshotScalePercent(frame);
  const isNaturalScale = scalePercent === 100;

  const status = frame.status || 'idle';
  const isGenerating = status === 'generating';
  const generatingTotal = frame.generatingTotal || 0;
  const generatingDone = frame.generatingDone || 0;
  const generateLabel = isGenerating && generatingTotal > 1
    ? `${generatingDone}/${generatingTotal}`
    : (isGenerating ? '...' : null);
  const hasGenerationContext = Boolean(
    globalContext?.imageId
    || globalContext?.prompt?.trim()
    || frame.referenceImages?.length,
  );
  const showAsSelected = selected;
  const showControls = isHovered || isInteracting || showAsSelected;

  useLayoutEffect(() => {
    const textarea = promptRef.current;
    if (!textarea) return;

    if (!frame.prompt) {
      textarea.style.height = '38px';
      return;
    }
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(38, textarea.scrollHeight + 2)}px`;
  }, [frame.prompt, frame.width, zoom]);

  const borderColor = isGenerating
    ? accentColor
    : (showAsSelected ? accentColor : '#007aff');

  const spx = (n) => screenPx(n, zoom);
  const borderStroke = spx(1);
  const borderInset = spx(0.5);
  const dashStep = spx(20);

  const topPanelStyle = {
    ...STUDIO_PANEL_CHROME,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '7px 10px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.06), 0 12px 28px rgba(0,0,0,0.1)',
    flexWrap: 'nowrap',
    whiteSpace: 'nowrap',
  };

  const bottomPanelStyle = {
    ...STUDIO_PANEL_CHROME,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: '8px 10px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.06), 0 12px 28px rgba(0,0,0,0.1)',
  };

  const boxShadow = isGenerating
    ? `0 0 0 ${spx(1)}px rgba(255,255,255,0.9), 0 0 ${spx(36)}px ${accentColor}, 0 ${spx(10)}px ${spx(42)}px rgba(0,0,0,0.42), inset 0 0 ${spx(18)}px ${accentColor}`
    : (showAsSelected
      ? `0 0 0 ${spx(1)}px rgba(255,255,255,0.9), 0 0 ${spx(30)}px ${accentColor}a6, 0 ${spx(10)}px ${spx(42)}px rgba(0,0,0,0.42)`
      : `0 0 0 ${spx(1)}px rgba(255,255,255,0.8), 0 0 ${spx(15)}px rgba(0,122,255,0.55), 0 ${spx(6)}px ${spx(26)}px rgba(0,0,0,0.28)`);

  return (
    <div
      onPointerDown={(e) => onPointerDown(e, 'move')}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        position: 'absolute',
        left: frame.x,
        top: frame.y,
        width: frame.width,
        height: frame.height,
        zIndex: selected ? 201 : 200,
        backgroundColor: 'transparent',
        boxShadow,
        cursor: showAsSelected ? 'grab' : 'pointer',
        touchAction: 'none',
        overflow: 'visible',
        transition: 'box-shadow 0.15s',
      }}
    >
      <style>{`
        @keyframes snapshot-dash-flow {
          to {
            stroke-dashoffset: ${dashStep};
          }
        }
      `}</style>

      {/* 1 экранный px снаружи области генерации (внутренний край stroke = граница frame) */}
      <svg
        aria-hidden
        width={frame.width}
        height={frame.height}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          overflow: 'visible',
          pointerEvents: 'none',
          zIndex: 1,
          filter: isGenerating ? `drop-shadow(0 0 ${spx(6)}px ${accentColor})` : undefined,
        }}
      >
        <rect
          x={-borderInset}
          y={-borderInset}
          width={frame.width + borderStroke}
          height={frame.height + borderStroke}
          fill="none"
          stroke={borderColor}
          strokeWidth={borderStroke}
          shapeRendering="crispEdges"
          strokeDasharray={isGenerating ? `${spx(8)} ${spx(4)}` : undefined}
          style={isGenerating ? { animation: 'snapshot-dash-flow 0.8s linear infinite' } : undefined}
        />
      </svg>

      <ScreenSpacePanel
        zoom={zoom}
        attach="above"
        frameWidth={frame.width}
        minWidth={600}
        visible={showControls}
        onPointerDown={(e) => e.stopPropagation()}
        panelStyle={topPanelStyle}
      >
        <span className="studio-tooltip" data-tooltip="Модель" style={{ display: 'inline-flex', flexShrink: 0 }}>
          <select
            value={frame.model || 'nb2'}
            onChange={(e) => onModelChange(e.target.value)}
            disabled={isGenerating}
            style={{ ...STUDIO_SELECT_STYLE, width: 190, flexShrink: 0 }}
          >
            {NANO_BANANA_MODEL_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </span>
        <span className="studio-tooltip" data-tooltip="Разрешение" style={{ display: 'inline-flex', flexShrink: 0 }}>
          <select
            value={frame.imageSize}
            onChange={(e) => onImageSizeChange(e.target.value)}
            disabled={isGenerating}
            style={{ ...STUDIO_SELECT_STYLE, width: 76, flexShrink: 0 }}
          >
            {getImageSizeOptionsForModel(frame.model || 'nb2').map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </span>
        <span className="studio-tooltip" data-tooltip="Соотношение сторон" style={{ display: 'inline-flex', flexShrink: 0 }}>
          <select
            value={frame.aspectRatio}
            onChange={(e) => onAspectRatioChange(e.target.value)}
            disabled={isGenerating}
            style={{ ...STUDIO_SELECT_STYLE, width: 86, flexShrink: 0 }}
          >
            {ASPECT_RATIO_OPTIONS.map((ar) => (
              <option key={ar} value={ar}>{ar}</option>
            ))}
          </select>
        </span>
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#8e8e93',
          marginLeft: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexShrink: 0,
        }}
        >
          <span>{resolution}</span>
          <span style={{ color: '#c7c7cc' }}>·</span>
          {isNaturalScale ? (
            <span>{scalePercent}%</span>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onResetScale();
              }}
              disabled={isGenerating}
              style={{
                border: 'none',
                padding: 0,
                background: 'transparent',
                color: SCALE_HIGHLIGHT_COLOR,
                font: 'inherit',
                cursor: isGenerating ? 'not-allowed' : 'pointer',
                opacity: isGenerating ? 0.5 : 1,
              }}
              className="studio-tooltip"
              data-tooltip="Установить масштаб 100%"
            >
              {scalePercent}%
            </button>
          )}
          {isGenerating && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCancelGeneration?.();
              }}
              style={{
                border: 'none',
                backgroundColor: '#f2f2f7',
                color: '#8e8e93',
                fontSize: 10,
                fontWeight: 600,
                height: 22,
                padding: '0 8px',
                borderRadius: 999,
                cursor: 'pointer',
                lineHeight: 1,
                flexShrink: 0,
              }}
              className="studio-tooltip"
              data-tooltip="Отменить генерацию"
            >
              Отмена
            </button>
          )}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete?.();
          }}
          style={{
            width: 28,
            height: 28,
            padding: 0,
            border: 'none',
            borderRadius: 8,
            backgroundColor: '#f2f2f7',
            color: '#ff3b30',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
          className="studio-tooltip"
          data-tooltip="Удалить фрейм"
          aria-label="Удалить фрейм"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m5 5v6m4-6v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </ScreenSpacePanel>

      <ScreenSpacePanel
        zoom={zoom}
        attach="below"
        frameWidth={frame.width}
        screenWidth={480}
        visible={showControls}
        onPointerDown={(e) => e.stopPropagation()}
        panelStyle={bottomPanelStyle}
      >
        <div style={{ display: 'flex', gap: 6, width: '100%', alignItems: 'stretch' }}>
          <textarea
            ref={promptRef}
            rows={1}
            value={frame.prompt || ''}
            onChange={(e) => onPromptChange(e.target.value)}
            onFocus={onPromptFocus}
            onBlur={onPromptBlur}
            disabled={isGenerating}
            placeholder={generationMode
              ? 'Укажите особенности генерации'
              : 'Укажите особенности генерации (опционально)'}
            style={{
              ...STUDIO_FIELD_STYLE,
              flex: 1,
              minHeight: 38,
              padding: '10px',
              resize: 'none',
              overflowY: 'hidden',
            }}
          />
          <button
            type="button"
            onClick={() => {
              if (!isGenerating) onGenerateX4?.();
            }}
            disabled={isGenerating}
            style={{
              width: 42,
              height: 38,
              borderRadius: 12,
              border: 'none',
              backgroundColor: '#f2f2f7',
              color: '#000',
              fontSize: 11,
              fontWeight: 700,
              cursor: isGenerating ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              boxSizing: 'border-box',
            }}
            className="studio-tooltip"
            data-tooltip="4 параллельных варианта"
          >
            x4
          </button>
          <button
            type="button"
            onClick={() => {
              if (!isGenerating) onGenerate();
            }}
            disabled={isGenerating}
            style={{
              width: generationMode ? 120 : 96,
              height: 38,
              borderRadius: 999,
              border: 'none',
              backgroundColor: isGenerating ? '#e5e5ea' : '#1c1c1e',
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              cursor: isGenerating ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 0.15s',
              flexShrink: 0,
              boxSizing: 'border-box',
            }}
          >
            {generateLabel || (generationMode ? 'Сгенерировать' : 'Дорисовать')}
          </button>
          {!hasGenerationContext && (
            <button
              type="button"
              onClick={onAddReferenceCard}
              disabled={isGenerating}
              aria-label="Добавить контекст"
              className="studio-tooltip"
              data-tooltip="Добавить изображение"
              style={{
                width: 38,
                height: 38,
                flexShrink: 0,
                display: 'grid',
                placeItems: 'center',
                padding: 0,
                border: '1px dashed #d1d1d6',
                borderRadius: 12,
                background: 'transparent',
                color: '#8e8e93',
                fontSize: 20,
                lineHeight: 1,
                cursor: isGenerating ? 'not-allowed' : 'pointer',
              }}
            >
              +
            </button>
          )}
        </div>
        {frame.error && (
          <div style={{ fontSize: 11, color: '#ff3b30', marginTop: 2 }}>
            {frame.error}
          </div>
        )}
        {hasGenerationContext && (
          <GenerationReferences
            globalContext={globalContext}
            references={frame.referenceImages || []}
            layers={layers}
            disabled={isGenerating}
            onAddCard={onAddReferenceCard}
            onSetFile={onAddReferenceFile}
            onRemove={onRemoveReference}
            onStartLink={onStartReferenceLink}
            onOpenGlobalContext={onOpenGlobalContext}
            anchorRef={referenceAnchorRef}
          />
        )}
      </ScreenSpacePanel>

      {showAsSelected && [...CORNER_HANDLES, ...EDGE_HANDLES].map((h) => {
        const baseStyle = handleStyle(h, frame.width, frame.height, zoom);
        return (
          <div
            key={h}
            onPointerDown={(e) => onPointerDown(e, `resize-${h}`)}
            style={{
              ...baseStyle,
              opacity: showControls ? 1 : 0,
              pointerEvents: showControls ? 'auto' : 'none',
              transition: 'opacity 0.2s ease-in-out',
            }}
          />
        );
      })}
    </div>
  );
}

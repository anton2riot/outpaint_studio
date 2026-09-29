import React, { useState } from 'react';
import { screenPx } from '../lib/infiniteCanvasUtils';
import ScreenSpacePanel, { STUDIO_PANEL_CHROME } from './ScreenSpacePanel';

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function handleCursor(handle) {
  if (handle === 'n' || handle === 's') return 'ns-resize';
  if (handle === 'e' || handle === 'w') return 'ew-resize';
  if (handle === 'ne' || handle === 'sw') return 'nesw-resize';
  return 'nwse-resize';
}

function handleStyle(handle, width, height, zoom) {
  const size = screenPx(8, zoom);
  const offset = -size / 2;
  const style = {
    position: 'absolute',
    width: size,
    height: size,
    border: `${screenPx(1, zoom)}px solid #34c759`,
    borderRadius: screenPx(2, zoom),
    background: '#fff',
    boxSizing: 'border-box',
    cursor: handleCursor(handle),
    zIndex: 3,
  };
  if (handle.includes('w')) style.left = offset;
  else if (handle.includes('e')) style.left = width + offset;
  else style.left = width / 2 + offset;
  if (handle.includes('n')) style.top = offset;
  else if (handle.includes('s')) style.top = height + offset;
  else style.top = height / 2 + offset;
  return style;
}

export default function ExportFrame({
  frame,
  selected,
  zoom = 1,
  saving = false,
  onPointerDown,
  onSave,
  onDelete,
}) {
  const [hovered, setHovered] = useState(false);
  const showControls = selected || hovered;
  const width = Math.max(1, Math.round(frame.width));
  const height = Math.max(1, Math.round(frame.height));
  const accentColor = '#34c759';
  const borderStroke = screenPx(1, zoom);
  const borderInset = screenPx(0.5, zoom);
  const boxShadow = selected
    ? `0 0 0 ${screenPx(1, zoom)}px rgba(255,255,255,0.9), 0 0 ${screenPx(30, zoom)}px rgba(52,199,89,0.7), 0 ${screenPx(10, zoom)}px ${screenPx(42, zoom)}px rgba(0,0,0,0.42)`
    : `0 0 0 ${screenPx(1, zoom)}px rgba(255,255,255,0.8), 0 0 ${screenPx(15, zoom)}px rgba(52,199,89,0.55), 0 ${screenPx(6, zoom)}px ${screenPx(26, zoom)}px rgba(0,0,0,0.28)`;

  return (
    <div
      onPointerDown={(event) => onPointerDown(event, 'move')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'absolute',
        left: frame.x,
        top: frame.y,
        width: frame.width,
        height: frame.height,
        zIndex: selected ? 221 : 220,
        background: 'transparent',
        boxShadow,
        cursor: selected ? 'grab' : 'pointer',
        touchAction: 'none',
      }}
    >
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
        }}
      >
        <rect
          x={-borderInset}
          y={-borderInset}
          width={frame.width + borderStroke}
          height={frame.height + borderStroke}
          fill="none"
          stroke={accentColor}
          strokeWidth={borderStroke}
          shapeRendering="crispEdges"
        />
      </svg>

      <ScreenSpacePanel
        zoom={zoom}
        attach="above"
        frameWidth={frame.width}
        minWidth={330}
        visible={showControls}
        onPointerDown={(event) => event.stopPropagation()}
        panelStyle={{
          ...STUDIO_PANEL_CHROME,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 10px',
          whiteSpace: 'nowrap',
        }}
      >
        <strong style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
          {width} × {height} px
        </strong>
        <button
          type="button"
          disabled={saving}
          onClick={(event) => {
            event.stopPropagation();
            onSave?.('png');
          }}
          style={{
            height: 28,
            marginLeft: 'auto',
            padding: '0 12px',
            border: 'none',
            borderRadius: 999,
            background: saving ? '#e5e5ea' : '#1c1c1e',
            color: '#fff',
            fontSize: 12,
            fontWeight: 600,
            cursor: saving ? 'wait' : 'pointer',
          }}
        >
          PNG
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={(event) => {
            event.stopPropagation();
            onSave?.('jpg');
          }}
          style={{
            height: 28,
            padding: '0 12px',
            border: 'none',
            borderRadius: 999,
            background: '#f2f2f7',
            color: '#1c1c1e',
            fontSize: 12,
            fontWeight: 600,
            cursor: saving ? 'wait' : 'pointer',
            opacity: saving ? 0.55 : 1,
          }}
        >
          JPG
        </button>
        <button
          type="button"
          aria-label="Delete export frame"
          data-tooltip="Delete frame"
          className="studio-tooltip"
          onClick={(event) => {
            event.stopPropagation();
            onDelete?.();
          }}
          style={{
            width: 28,
            height: 28,
            padding: 0,
            border: 'none',
            borderRadius: 8,
            background: '#f2f2f7',
            color: '#ff3b30',
            cursor: 'pointer',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M3 6h18M8 6V4h8v2m3 0-1 16H6L5 6m5 5v6m4-6v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </ScreenSpacePanel>

      {selected && HANDLES.map((handle) => (
        <div
          key={handle}
          onPointerDown={(event) => onPointerDown(event, `resize-${handle}`)}
          style={handleStyle(handle, frame.width, frame.height, zoom)}
        />
      ))}
    </div>
  );
}

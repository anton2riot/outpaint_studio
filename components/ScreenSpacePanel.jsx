import React from 'react';

/**
 * Panel with a fixed screen-pixel size inside the canvas scale(zoom).
 * The outer shell is positioned in world units; the inner shell uses counter-scale(1/zoom).
 *
 * @param {Object} props
 * @param {number} props.zoom
 * @param {'above'|'below'} [props.attach]
 * @param {number} props.frameWidth — parent width in world units
 * @param {number} [props.minWidth] — minimum panel width in screen px
 * @param {number} [props.screenWidth] — fixed panel width in screen px
 * @param {boolean} [props.stretch] — stretch panel to minWidth (bottom panels)
 * @param {number} [props.gap] — gap from parent in screen px
 * @param {boolean} [props.visible]
 * @param {(e: React.PointerEvent) => void} [props.onPointerDown]
 * @param {React.CSSProperties} [props.panelStyle]
 */
export default function ScreenSpacePanel({
  zoom,
  attach = 'below',
  frameWidth,
  minWidth = 0,
  screenWidth,
  stretch = false,
  gap = 8,
  visible = true,
  onPointerDown,
  panelStyle,
  children,
}) {
  const z = zoom > 0 ? zoom : 1;
  const shellGap = gap / z;
  const panelMinW = screenWidth ?? Math.max(frameWidth * z, minWidth);

  return (
    <div
      onPointerDown={onPointerDown}
      style={{
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)',
        ...(attach === 'above'
          ? { bottom: '100%', marginBottom: shellGap }
          : { top: '100%', marginTop: shellGap }),
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
        transition: 'opacity 0.2s ease-in-out',
        zIndex: 10,
      }}
    >
      <div
        style={{
          transform: `scale(${1 / z})`,
          transformOrigin: attach === 'above' ? 'bottom center' : 'top center',
          minWidth: panelMinW,
          width: screenWidth ?? (stretch ? panelMinW : 'max-content'),
          boxSizing: 'border-box',
          ...panelStyle,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** Shared floating-panel styles in the PassportHelper visual language. */
export const STUDIO_PANEL_CHROME = {
  borderRadius: 16,
  border: '1px solid rgba(229,229,234,0.9)',
  background: 'rgba(255,255,255,0.96)',
  color: '#000',
  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, "Segoe UI", sans-serif',
  backdropFilter: 'blur(18px) saturate(160%)',
};

export const STUDIO_SELECT_STYLE = {
  fontSize: 11,
  lineHeight: '16px',
  height: 28,
  padding: '4px 9px',
  borderRadius: 8,
  border: '1px solid transparent',
  backgroundColor: '#f2f2f7',
  color: '#000',
  cursor: 'pointer',
  outline: 'none',
  boxSizing: 'border-box',
};

export const STUDIO_FIELD_STYLE = {
  fontSize: 12,
  lineHeight: '16px',
  padding: '8px 10px',
  borderRadius: 10,
  border: '1px solid transparent',
  backgroundColor: '#f2f2f7',
  color: '#000',
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};

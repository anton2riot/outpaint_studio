import React, { useEffect, useState } from 'react';

export const STUDIO_SNAPSHOT_DRAG_TYPE = 'text/studio-snapshot';
export const STUDIO_EXPORT_DRAG_TYPE = 'text/studio-export';

const BRUSH_COLORS = [
  '#ffcc00', '#ff9500', '#ff3b30', '#ffffff',
  '#ff2d55', '#af52de', '#5856d6', '#8e8e93',
  '#34c759', '#00a86b', '#007aff', '#1c1c1e',
  '#64d2ff', '#5e5ce6', '#bf5af2', '#8e5a2b',
];

const SELECT_TOOL = {
  id: 'select',
  label: 'Выбор',
  icon: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 3l14 7-6 2-2 6-6-15z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
    </svg>
  ),
};

const UPLOAD_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M12 3v12m0-12 4 4m-4-4L8 7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
  </svg>
);

const SNAPSHOT_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
    <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.75" />
    <path d="M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75" />
  </svg>
);

const EXPORT_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 11l5 5 5-5M12 4v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ERASER_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="m7.5 18.5-3-3a2.1 2.1 0 0 1 0-3L13 4a2.1 2.1 0 0 1 3 0l4 4a2.1 2.1 0 0 1 0 3l-7.5 7.5h-5Z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
    <path d="m10 7 7 7M7.5 18.5H20" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
  </svg>
);

const TILE_PAINT_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="m12 4-8 4 8 4 8-4-8-4Zm-8 8 8 4 8-4M4 16l8 4 8-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * @param {Object} props
 * @param {string} [props.accentColor]
 * @param {() => void} [props.onUpload]
 * @param {() => void} [props.onSnapshot]
 * @param {() => void} [props.onExport]
 * @param {boolean} [props.uploadDisabled]
 * @param {'select'|'crop'|'draw'|'erase'|'tile'} [props.activeTool]
 * @param {(tool: 'select'|'crop'|'draw'|'erase'|'tile') => void} [props.onToolChange]
 * @param {string} [props.brushColor]
 * @param {number} [props.brushSize]
 * @param {(color: string) => void} [props.onBrushColorChange]
 * @param {(size: number) => void} [props.onBrushSizeChange]
 * @param {number} [props.eraserSize]
 * @param {(size: number) => void} [props.onEraserSizeChange]
 * @param {string|null} [props.tileColor]
 * @param {(color: string|null) => void} [props.onTileColorChange]
 * @param {number} [props.tileBrushSize]
 * @param {(size: number) => void} [props.onTileBrushSizeChange]
 * @param {boolean} [props.tileToolDisabled]
 * @param {number} [props.settingsDismissVersion]
 */
export default function StudioToolbar({
  accentColor = '#007AFF',
  onUpload,
  onSnapshot,
  onExport,
  uploadDisabled = false,
  activeTool = 'select',
  onToolChange,
  brushColor = '#1c1c1e',
  brushSize = 8,
  onBrushColorChange,
  onBrushSizeChange,
  eraserSize = 28,
  onEraserSizeChange,
  tileColor = '#ffcc00',
  onTileColorChange,
  tileBrushSize = 1,
  onTileBrushSizeChange,
  tileToolDisabled = false,
  settingsDismissVersion = 0,
}) {
  const [settingsTool, setSettingsTool] = useState(null);
  const settingsOpen = settingsTool === activeTool && ['draw', 'erase', 'tile'].includes(activeTool);
  const activeSize = activeTool === 'erase' ? eraserSize : brushSize;
  const minSize = activeTool === 'erase' ? 4 : 1;
  const maxSize = activeTool === 'erase' ? 128 : 64;
  const brushPreviewSize = Math.max(3, Math.min(28, brushSize));

  useEffect(() => {
    if (settingsTool && settingsTool !== activeTool) setSettingsTool(null);
  }, [activeTool, settingsTool]);

  useEffect(() => {
    setSettingsTool(null);
  }, [settingsDismissVersion]);

  const selectTool = (tool) => {
    if (activeTool === tool && ['draw', 'erase', 'tile'].includes(tool)) {
      setSettingsTool((current) => (current === tool ? null : tool));
      return;
    }
    setSettingsTool(null);
    onToolChange?.(tool);
  };

  return (
    <aside
      className="tool-rail"
      style={{ '--tool-accent': accentColor }}
    >
      <button
        type="button"
        data-tooltip="Загрузить изображение"
        aria-label="Загрузить изображение"
        className="tool-button studio-tooltip"
        onClick={onUpload}
        disabled={uploadDisabled}
      >
        {UPLOAD_ICON}
      </button>

      <div className="tool-separator" />

      <button
        type="button"
        data-tooltip={SELECT_TOOL.label}
        aria-pressed={activeTool === 'select'}
        className={`tool-button studio-tooltip${activeTool === 'select' ? ' active' : ''}`}
        onClick={() => selectTool('select')}
      >
        {SELECT_TOOL.icon}
      </button>

      <button
        type="button"
        data-tooltip="Кисть"
        aria-label={`Кисть, ${brushSize} px, ${brushColor}`}
        aria-pressed={activeTool === 'draw'}
        className={`tool-button studio-tooltip${activeTool === 'draw' ? ' active' : ''}`}
        onClick={() => selectTool('draw')}
      >
        <span
          aria-hidden
          style={{
            width: brushPreviewSize,
            height: brushPreviewSize,
            flex: '0 0 auto',
            borderRadius: '50%',
            background: brushColor,
            boxShadow: '0 0 0 1px rgba(60,60,67,0.38)',
          }}
        />
      </button>

      <button
        type="button"
        data-tooltip="Ластик"
        aria-label="Ластик"
        aria-pressed={activeTool === 'erase'}
        className={`tool-button studio-tooltip${activeTool === 'erase' ? ' active' : ''}`}
        onClick={() => selectTool('erase')}
      >
        {ERASER_ICON}
      </button>

      <button
        type="button"
        data-tooltip={tileToolDisabled ? 'Доступно для изометрической сетки' : 'Раскрашивание ячеек'}
        aria-label="Раскрашивание ячеек"
        aria-pressed={activeTool === 'tile'}
        className={`tool-button studio-tooltip${activeTool === 'tile' ? ' active' : ''}`}
        onClick={() => selectTool('tile')}
        disabled={tileToolDisabled}
      >
        {TILE_PAINT_ICON}
      </button>

      {settingsOpen && (
        <div
          className="brush-popover"
          role="group"
          aria-label={activeTool === 'erase' ? 'Настройки ластика' : activeTool === 'tile' ? 'Цвет ячеек' : 'Настройки кисти'}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {activeTool !== 'tile' && <>
            <div className="brush-size-row">
              <span>{activeTool === 'erase' ? 'Размер ластика' : 'Толщина'}</span>
              <strong>{activeSize} px</strong>
            </div>
            <input
              type="range"
              min={minSize}
              max={maxSize}
              step="1"
              value={activeSize}
              aria-label={activeTool === 'erase' ? 'Размер ластика' : 'Толщина кисти'}
              className="brush-size-slider"
              onChange={(event) => {
                const nextSize = Number(event.target.value);
                if (activeTool === 'erase') onEraserSizeChange?.(nextSize);
                else onBrushSizeChange?.(nextSize);
              }}
              style={{ '--brush-slider-progress': `${((activeSize - minSize) / (maxSize - minSize)) * 100}%` }}
            />
          </>}
          {activeTool === 'draw' && <div className="brush-palette">
            {BRUSH_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={`brush-swatch${brushColor.toLowerCase() === color ? ' selected' : ''}`}
                style={{ '--swatch-color': color }}
                aria-label={`Цвет ${color}`}
                aria-pressed={brushColor.toLowerCase() === color}
                onClick={() => onBrushColorChange?.(color)}
              >
                {brushColor.toLowerCase() === color && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            ))}
            <label className="brush-custom-color" aria-label="Другой цвет">
              <span aria-hidden>+</span>
              <input
                type="color"
                value={brushColor}
                onChange={(event) => onBrushColorChange?.(event.target.value)}
              />
            </label>
          </div>}
          {activeTool === 'tile' && <>
            <div className="brush-size-row">
              <span>Размер кисти</span>
              <strong>{tileBrushSize}×{tileBrushSize}</strong>
            </div>
            <input
              type="range"
              min="1"
              max="10"
              step="1"
              value={tileBrushSize}
              aria-label="Размер кисти в ячейках"
              className="brush-size-slider"
              onChange={(event) => onTileBrushSizeChange?.(Number(event.target.value))}
              style={{ '--brush-slider-progress': `${((tileBrushSize - 1) / 9) * 100}%` }}
            />
            <div className="tile-palette-title">Цвет ячейки</div>
            <div className="brush-palette">
              <button
                type="button"
                className={`brush-swatch tile-no-color${tileColor === null ? ' selected' : ''}`}
                aria-label="Отсутствие цвета — удалить покраску"
                aria-pressed={tileColor === null}
                onClick={() => onTileColorChange?.(null)}
              >
                <span aria-hidden />
              </button>
              {BRUSH_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`brush-swatch${tileColor?.toLowerCase() === color ? ' selected' : ''}`}
                  style={{ '--swatch-color': color }}
                  aria-label={`Цвет ячейки ${color}`}
                  aria-pressed={tileColor?.toLowerCase() === color}
                  onClick={() => onTileColorChange?.(color)}
                >
                  {tileColor?.toLowerCase() === color && (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </>}
        </div>
      )}

      <button
        type="button"
        draggable
        data-tooltip="Снимок — нажмите или перетащите на холст"
        aria-label="Добавить рамку снимка в центр холста"
        onClick={onSnapshot}
        onDragStart={(e) => {
          e.dataTransfer.setData(STUDIO_SNAPSHOT_DRAG_TYPE, '1');
          e.dataTransfer.effectAllowed = 'copy';
        }}
        className="tool-button studio-tooltip"
      >
        {SNAPSHOT_ICON}
      </button>

      <button
        type="button"
        draggable
        data-tooltip="Сохранение PNG — нажмите или перетащите на холст"
        aria-label="Добавить рамку сохранения PNG в центр холста"
        onClick={onExport}
        onDragStart={(e) => {
          e.dataTransfer.setData(STUDIO_EXPORT_DRAG_TYPE, '1');
          e.dataTransfer.effectAllowed = 'copy';
        }}
        className="tool-button studio-tooltip"
      >
        {EXPORT_ICON}
      </button>
    </aside>
  );
}

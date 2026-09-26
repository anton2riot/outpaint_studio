import React, { useEffect, useRef, useState } from 'react';

import { paintGridCanvas } from '../lib/infiniteCanvasUtils';
import { useHoveredImagePaste } from '../lib/useHoveredImagePaste';

const GRID_TYPE_OPTIONS = [
  { value: 'dots', label: 'Точки' },
  { value: 'isometric', label: 'Изометрия' },
];

export default function CanvasSettingsDialog({
  gridType,
  onGridTypeChange,
  gridAngle,
  onGridAngleChange,
  drawGridInReference,
  onDrawGridInReferenceChange,
  nativeInpaint,
  onNativeInpaintChange,
  gridSize,
  onGridSizeChange,
  snapToGrid,
  onSnapToGridChange,
  snapToElements,
  onSnapToElementsChange,
  onClose,
}) {
  const [isGridTypeOpen, setIsGridTypeOpen] = useState(false);
  const [reference, setReference] = useState(null);
  const [isReferenceDragging, setIsReferenceDragging] = useState(false);
  const gridTypeSelectRef = useRef(null);
  const gridTypeTriggerRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const referencePasteTargetRef = useRef(null);
  const referenceInputRef = useRef(null);
  const referenceUrlRef = useRef(null);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!isGridTypeOpen) return undefined;

    const handlePointerDown = (event) => {
      if (!gridTypeSelectRef.current?.contains(event.target)) setIsGridTypeOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isGridTypeOpen]);

  useEffect(() => {
    if (!isGridTypeOpen) return;
    gridTypeSelectRef.current?.querySelector('[role="option"][aria-selected="true"]')?.focus();
  }, [isGridTypeOpen]);

  useEffect(() => {
    if (gridType !== 'isometric') return undefined;
    const canvas = previewCanvasRef.current;
    if (!canvas) return undefined;

    const repaint = () => {
      const rect = canvas.getBoundingClientRect();
      paintGridCanvas(
        canvas,
        { panX: rect.width / 2, panY: rect.height / 2, zoom: 1 },
        gridSize,
        'isometric',
        gridAngle,
        { strokeStyle: '#1684ff', lineWidth: 1.25 },
      );
    };

    repaint();
    const resizeObserver = new ResizeObserver(repaint);
    resizeObserver.observe(canvas);
    return () => resizeObserver.disconnect();
  }, [gridType, gridAngle, gridSize, reference]);

  useEffect(() => () => {
    if (referenceUrlRef.current) URL.revokeObjectURL(referenceUrlRef.current);
  }, []);

  const selectedGridType = GRID_TYPE_OPTIONS.find((option) => option.value === gridType) || GRID_TYPE_OPTIONS[0];

  const handleGridTypeKeyDown = (event) => {
    if (event.key === 'Escape' && isGridTypeOpen) {
      event.preventDefault();
      event.stopPropagation();
      setIsGridTypeOpen(false);
      gridTypeTriggerRef.current?.focus();
      return;
    }

    if (!isGridTypeOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setIsGridTypeOpen(true);
      return;
    }

    if (!isGridTypeOpen || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

    event.preventDefault();
    const options = [...gridTypeSelectRef.current.querySelectorAll('[role="option"]')];
    const currentIndex = options.indexOf(document.activeElement);
    let nextIndex = event.key === 'Home' ? 0 : options.length - 1;
    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % options.length;
    if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + options.length) % options.length;
    options[nextIndex]?.focus();
  };

  const selectGridType = (value) => {
    onGridTypeChange(value);
    setIsGridTypeOpen(false);
    gridTypeTriggerRef.current?.focus();
  };

  const updateGridSize = (value) => {
    if (value === '') {
      onGridSizeChange('');
      return;
    }
    const parsed = parseInt(value, 10);
    if (!Number.isNaN(parsed)) onGridSizeChange(parsed);
  };

  const normalizeGridSize = () => {
    const parsed = parseInt(gridSize, 10);
    if (Number.isNaN(parsed) || parsed < 5) onGridSizeChange(20);
    else onGridSizeChange(Math.min(parsed, 500));
  };

  const updateGridAngle = (value) => {
    if (value === '') return;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      const clamped = Math.min(35, Math.max(22, parsed));
      onGridAngleChange(Math.round(clamped * 2) / 2);
    }
  };

  const useReferenceFile = (file) => {
    if (!file?.type?.startsWith('image/')) return;
    if (referenceUrlRef.current) URL.revokeObjectURL(referenceUrlRef.current);
    const url = URL.createObjectURL(file);
    referenceUrlRef.current = url;
    setReference({ url, name: file.name });
  };

  const clearReference = (event) => {
    event?.stopPropagation();
    if (referenceUrlRef.current) URL.revokeObjectURL(referenceUrlRef.current);
    referenceUrlRef.current = null;
    setReference(null);
    if (referenceInputRef.current) referenceInputRef.current.value = '';
  };

  useHoveredImagePaste(referencePasteTargetRef, ([file]) => useReferenceFile(file));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Настройки холста"
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog-panel settings-dialog">
        <div className="dialog-header">
          <div className="dialog-title">Настройки</div>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="btn btn-icon"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2.5 2.5l9 9m0-9l-9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></button>
        </div>

        <div className="settings-row">
          <div>
            <div className="settings-label">Тип сетки</div>
          </div>
          <div
            ref={gridTypeSelectRef}
            className="settings-select"
            onKeyDown={handleGridTypeKeyDown}
          >
            <button
              ref={gridTypeTriggerRef}
              type="button"
              className="settings-select-trigger"
              aria-label="Тип сетки"
              aria-haspopup="listbox"
              aria-expanded={isGridTypeOpen}
              aria-controls="grid-type-options"
              onClick={() => setIsGridTypeOpen((isOpen) => !isOpen)}
            >
              <span>{selectedGridType.label}</span>
              <span className="settings-select-chevron" aria-hidden="true" />
            </button>
            {isGridTypeOpen && (
              <div id="grid-type-options" className="settings-select-menu" role="listbox" aria-label="Тип сетки">
                {GRID_TYPE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className="settings-select-option"
                    role="option"
                    aria-selected={option.value === gridType}
                    onClick={() => selectGridType(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="settings-row">
          <div>
            <div className="settings-label">{gridType === 'isometric' ? 'Размер ячейки' : 'Размер сетки'}</div>
          </div>
          <label className="settings-number">
            <input
              type="number"
              min="5"
              max="500"
              value={gridSize}
              onChange={(event) => updateGridSize(event.target.value)}
              onBlur={normalizeGridSize}
              className="compact-input"
            />
            <span>px</span>
          </label>
        </div>

        {gridType === 'isometric' && (
          <>
            <div className="settings-row settings-angle-row">
              <div>
                <div className="settings-label">Угол сетки</div>
              </div>
              <div className="settings-angle-control">
                <input
                  type="range"
                  min="22"
                  max="35"
                  step="0.5"
                  value={gridAngle}
                  onChange={(event) => updateGridAngle(event.target.value)}
                  aria-label="Угол изометрической сетки"
                />
                <label className="settings-number settings-angle-number">
                  <input
                    type="number"
                    min="22"
                    max="35"
                    step="0.5"
                    value={gridAngle}
                    onChange={(event) => updateGridAngle(event.target.value)}
                    onBlur={() => updateGridAngle(gridAngle || 30)}
                    className="compact-input"
                  />
                  <span>°</span>
                </label>
              </div>
            </div>

            <div className="settings-preview-section">
              <div className="settings-preview-title">Референс с сеткой</div>
              <div className="settings-reference-wrap">
                <div
                  ref={referencePasteTargetRef}
                  data-image-paste-target
                  className={`settings-reference-card${isReferenceDragging ? ' is-dragging' : ''}${reference ? ' has-image' : ''}`}
                  role="button"
                  tabIndex="0"
                  aria-label={reference ? `Заменить референс ${reference.name}` : 'Добавить референс'}
                  onClick={() => referenceInputRef.current?.click()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') referenceInputRef.current?.click();
                  }}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setIsReferenceDragging(true);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) setIsReferenceDragging(false);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setIsReferenceDragging(false);
                    useReferenceFile(event.dataTransfer.files?.[0]);
                  }}
                >
                  {reference ? (
                    <>
                      <img src={reference.url} alt={reference.name} />
                      <canvas
                        ref={previewCanvasRef}
                        className="settings-reference-grid"
                        aria-label="Предпросмотр изометрической сетки поверх референса"
                      />
                    </>
                  ) : (
                    <div className="settings-reference-empty">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4a2 2 0 002 2h10a2 2 0 002-2v-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span>Перетащите изображение</span>
                      <small>или нажмите / вставьте Ctrl+V</small>
                    </div>
                  )}
                </div>
                {reference && (
                  <button
                    type="button"
                    className="settings-reference-remove"
                    onClick={clearReference}
                    aria-label="Убрать референс"
                  >
                    ×
                  </button>
                )}
              </div>
              <input
                ref={referenceInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => useReferenceFile(event.target.files?.[0])}
              />
              <div className="settings-preview-note">Референс используется только для сравнения и не сохраняется.</div>
            </div>

            <label className="settings-row settings-toggle">
              <div>
                <div className="settings-label">Врисовывать сетку в референс</div>
              </div>
              <input
                type="checkbox"
                checked={drawGridInReference}
                onChange={(event) => onDrawGridInReferenceChange(event.target.checked)}
              />
            </label>
          </>
        )}

        {gridType === 'dots' && (
          <label className="settings-row settings-toggle">
            <div>
              <div className="settings-label">Магнитить к сетке</div>
            </div>
            <input
              type="checkbox"
              checked={snapToGrid}
              onChange={(event) => onSnapToGridChange(event.target.checked)}
            />
          </label>
        )}

        <label className="settings-row settings-toggle">
          <div>
            <div className="settings-label">Нативный инпейнт</div>
            <div className="settings-description">Маска областей передаётся отдельно. Работает с моделями ChatGPT.</div>
          </div>
          <input
            type="checkbox"
            checked={nativeInpaint}
            onChange={(event) => onNativeInpaintChange(event.target.checked)}
          />
        </label>

        <label className="settings-row settings-toggle">
          <div>
            <div className="settings-label">Магнитить к объектам</div>
          </div>
          <input
            type="checkbox"
            checked={snapToElements}
            onChange={(event) => onSnapToElementsChange(event.target.checked)}
          />
        </label>
      </div>
    </div>
  );
}

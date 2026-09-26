import React, { useRef, useState } from 'react';
import { studioImageUrl } from '../lib/outpaintStudioGenerate';
import { useHoveredImagePaste } from '../lib/useHoveredImagePaste';

const cardStyle = {
  position: 'relative',
  width: 132,
  height: 82,
  flex: '0 0 132px',
  display: 'flex',
  flexDirection: 'column',
  padding: 5,
  border: '1px solid #e5e5ea',
  borderRadius: 11,
  background: '#f2f2f7',
  boxSizing: 'border-box',
  outline: 'none',
};

const smallButtonStyle = {
  width: 24,
  height: 24,
  display: 'grid',
  placeItems: 'center',
  padding: 0,
  border: 0,
  borderRadius: 7,
  background: 'rgba(255,255,255,0.92)',
  color: '#3c3c43',
  cursor: 'pointer',
  boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
};

function ImageArea({ src, linked, children, anchorRef, onStartLink, disabled }) {
  const linkable = Boolean(onStartLink);

  return (
    <div
      ref={anchorRef}
      onPointerDown={(event) => {
        if (!linkable || disabled || event.target.closest('button, input')) return;
        onStartLink?.(event);
      }}
      style={{
        position: 'relative',
        height: 70,
        flex: '0 0 70px',
        overflow: 'visible',
        borderRadius: 8,
        background: '#e5e5ea',
        cursor: linkable && !disabled ? 'crosshair' : undefined,
        touchAction: linkable ? 'none' : undefined,
      }}
    >
      {src && <img src={src} alt="" draggable={false} style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover', borderRadius: 8 }} />}
      {linked && (
        <span style={{ position: 'absolute', left: 5, top: 5, width: 15, height: 15, display: 'grid', placeItems: 'center', border: '1px solid #fff', borderRadius: '50%', background: '#007aff', color: '#fff' }}>
          <svg width="8" height="8" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M4.5 7.5 7.5 4.5M4 3.5l1-1a2.1 2.1 0 0 1 3 3l-.8.8M8 8.5l-1 1a2.1 2.1 0 0 1-3-3l.8-.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
      )}
      {children}
    </div>
  );
}

function UploadIcon() {
  return <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 11V3m0 0L5 6m3-3 3 3M3 10v2.5h10V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function ReferenceCard({
  reference, src, linked, disabled, busy, hasError, inputRefs,
  onSetFile, onRemove, onStartLink, anchorRef,
}) {
  const pasteTargetRef = useRef(null);
  useHoveredImagePaste(
    pasteTargetRef,
    ([file]) => onSetFile(reference.id, file),
    disabled,
    { allowFocused: true },
  );

  return (
    <div
      ref={pasteTargetRef}
      data-image-paste-target
      tabIndex={0}
      style={{ ...cardStyle, borderColor: hasError ? '#ff3b30' : '#e5e5ea' }}
    >
      <ImageArea
        src={src}
        linked={linked}
        disabled={disabled}
        anchorRef={(node) => anchorRef?.(reference.id, node)}
        onStartLink={(event) => onStartLink?.(event, reference.id)}
      >
        <div style={{ position: 'absolute', right: 5, bottom: 5, display: 'flex', gap: 4 }}>
          <input
            ref={(node) => {
              if (node) inputRefs.current.set(reference.id, node);
              else inputRefs.current.delete(reference.id);
            }}
            type="file"
            accept="image/*"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) onSetFile(reference.id, file);
            }}
            style={{ display: 'none' }}
          />
          <button type="button" disabled={disabled || busy} onClick={() => inputRefs.current.get(reference.id)?.click()} aria-label="Загрузить изображение" className="studio-tooltip" data-tooltip="Загрузить файл или вставить Ctrl+V" style={smallButtonStyle}>
            {busy ? '…' : <UploadIcon />}
          </button>
        </div>
      </ImageArea>
      <button type="button" onClick={() => onRemove?.(reference.id)} aria-label="Удалить карточку" className="studio-tooltip" data-tooltip="Удалить" style={{ position: 'absolute', right: -5, top: -5, width: 17, height: 17, display: 'grid', placeItems: 'center', padding: 0, border: '1px solid #e5e5ea', borderRadius: '50%', background: '#fff', color: '#8e8e93', fontSize: 12, lineHeight: 1, cursor: 'pointer' }}>×</button>
    </div>
  );
}

export default function GenerationReferences({
  globalContext = {}, references = [], layers = [], disabled = false,
  onAddCard, onSetFile, onRemove, onStartLink,
  onOpenGlobalContext, anchorRef,
}) {
  const inputRefs = useRef(new Map());
  const [busyId, setBusyId] = useState(null);
  const [errorId, setErrorId] = useState(null);
  const hasGlobalContext = Boolean(globalContext.imageId || globalContext.prompt?.trim());

  const setFile = async (referenceId, file) => {
    if (!file?.type?.startsWith('image/')) return;
    setBusyId(referenceId);
    setErrorId(null);
    try {
      await onSetFile?.(referenceId, file);
    } catch (_) {
      setErrorId(referenceId);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 6, borderTop: '1px solid #e5e5ea', paddingTop: 6 }}>
      {hasGlobalContext && (
        <button
          type="button"
          onClick={onOpenGlobalContext}
          className="studio-tooltip"
          data-tooltip={globalContext.prompt || 'Общий контекст'}
          style={{ ...cardStyle, cursor: 'pointer', textAlign: 'left' }}
        >
          <ImageArea src={globalContext.imageId ? studioImageUrl(globalContext.imageId) : null} />
        </button>
      )}

      {references.map((reference) => {
        const layer = reference.kind === 'layer' ? layers.find((item) => item.id === reference.layerId) : null;
        const src = reference.kind === 'layer' ? layer?.url : (reference.imageId ? studioImageUrl(reference.imageId) : null);
        return (
          <ReferenceCard
            key={reference.id}
            reference={reference}
            src={src}
            linked={reference.kind === 'layer'}
            disabled={disabled}
            busy={busyId === reference.id}
            hasError={errorId === reference.id}
            inputRefs={inputRefs}
            onSetFile={setFile}
            onRemove={onRemove}
            onStartLink={onStartLink}
            anchorRef={anchorRef}
          />
        );
      })}

      <button type="button" onClick={onAddCard} disabled={disabled} aria-label="Добавить контекст" className="studio-tooltip" data-tooltip="Добавить изображение" style={{ ...cardStyle, width: 38, flexBasis: 38, display: 'grid', placeItems: 'center', borderStyle: 'dashed', background: 'transparent', color: '#8e8e93', fontSize: 20, cursor: 'pointer' }}>+</button>
    </div>
  );
}

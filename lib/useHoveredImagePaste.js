import { useEffect, useRef } from 'react';

import { getClipboardImageFiles } from './clipboardImages';

/**
 * Routes clipboard images to the innermost upload target under the pointer.
 * Focus is not required: hover over the area and press Ctrl+V.
 */
export function useHoveredImagePaste(targetRef, onPaste, disabled = false, { allowFocused = false } = {}) {
  const onPasteRef = useRef(onPaste);
  onPasteRef.current = onPaste;

  useEffect(() => {
    if (disabled) return undefined;

    const handlePaste = (event) => {
      const target = targetRef.current;
      const activeElement = document.activeElement;
      const isTargeted = target?.matches(':hover')
        || (allowFocused && target?.contains(activeElement));
      if (!isTargeted) return;

      const nestedHoveredTarget = Array.from(
        target.querySelectorAll('[data-image-paste-target]'),
      ).some((node) => node.matches(':hover') || node.contains(activeElement));
      if (nestedHoveredTarget) return;

      const files = getClipboardImageFiles(event.clipboardData);
      if (!files.length) return;

      event.preventDefault();
      onPasteRef.current?.(files, event);
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [allowFocused, disabled, targetRef]);
}

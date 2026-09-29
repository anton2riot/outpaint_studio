/**
 * Snap layer edges to the canvas and each other (outpainting mode).
 */

const DEFAULT_THRESHOLD = 8;

function snapScalar(value, targets, threshold, snapToGrid = false, gridSize = 20) {
  let best = value;
  let bestDist = threshold + 1;
  for (const t of targets) {
    const d = Math.abs(value - t);
    if (d <= threshold && d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  if (snapToGrid && gridSize > 0) {
    const gridLine = Math.round(value / gridSize) * gridSize;
    const d = Math.abs(value - gridLine);
    if (d <= threshold && d < bestDist) {
      bestDist = d;
      best = gridLine;
    }
  }
  return best;
}

/**
 * @param {number} canvasW
 * @param {number} canvasH
 * @param {Array<{ id: string, x: number, y: number, width: number, height: number }>} layers
 * @param {string|null} excludeId
 */
export function collectSnapTargets(canvasW, canvasH, layers, excludeId = null) {
  const xTargets = [0, canvasW];
  const yTargets = [0, canvasH];
  for (const layer of layers) {
    if (layer.id === excludeId) continue;
    xTargets.push(layer.x, layer.x + layer.width);
    yTargets.push(layer.y, layer.y + layer.height);
  }
  return { xTargets, yTargets };
}

/** Snap targets from other layers and tool boundaries (snapshots) on the infinite canvas. */
export function collectInfiniteSnapTargets(layers, excludeId = null, snapshotFrames = null, excludeSnapshotId = null, enabled = true) {
  const xTargets = [];
  const yTargets = [];
  if (!enabled) {
    return { xTargets, yTargets };
  }
  for (const layer of layers) {
    if (layer.id === excludeId) continue;
    xTargets.push(layer.x, layer.x + layer.width);
    yTargets.push(layer.y, layer.y + layer.height);
  }
  if (snapshotFrames) {
    const frames = Array.isArray(snapshotFrames) ? snapshotFrames : [snapshotFrames];
    for (const frame of frames) {
      if (frame && frame.id !== excludeSnapshotId) {
        xTargets.push(frame.x, frame.x + frame.width);
        yTargets.push(frame.y, frame.y + frame.height);
      }
    }
  }
  return { xTargets, yTargets };
}

/**
 * @param {{ x: number, y: number, width: number, height: number }} rect
 */
export function snapMoveRect(rect, snapCtx, threshold = DEFAULT_THRESHOLD, snapToGrid = false, gridSize = 20) {
  const { xTargets, yTargets } = snapCtx;
  let { x, y, width, height } = rect;

  const snappedLeft = snapScalar(x, xTargets, threshold, snapToGrid, gridSize);
  if (snappedLeft !== x) x = snappedLeft;

  const snappedRight = snapScalar(x + width, xTargets, threshold, snapToGrid, gridSize);
  if (snappedRight !== x + width) x = snappedRight - width;

  const snappedTop = snapScalar(y, yTargets, threshold, snapToGrid, gridSize);
  if (snappedTop !== y) y = snappedTop;

  const snappedBottom = snapScalar(y + height, yTargets, threshold, snapToGrid, gridSize);
  if (snappedBottom !== y + height) y = snappedBottom - height;

  return { x: Math.round(x), y: Math.round(y), width, height };
}

/**
 * @param {'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w'} handle
 */
export function snapResizeRect(rect, handle, snapCtx, threshold = DEFAULT_THRESHOLD, snapToGrid = false, gridSize = 20) {
  const { xTargets, yTargets } = snapCtx;
  let { x, y, width, height } = rect;
  const minSize = 16;

  const applyWest = () => {
    const right = x + width;
    let left = x;
    const snappedLeft = snapScalar(left, xTargets, threshold, snapToGrid, gridSize);
    if (snappedLeft !== left) left = snappedLeft;
    width = right - left;
    if (width < minSize) {
      width = minSize;
      left = right - minSize;
    }
    x = left;
  };

  const applyEast = () => {
    let right = x + width;
    const snappedRight = snapScalar(right, xTargets, threshold, snapToGrid, gridSize);
    if (snappedRight !== right) right = snappedRight;
    width = right - x;
    if (width < minSize) width = minSize;
  };

  const applyNorth = () => {
    const bottom = y + height;
    let top = y;
    const snappedTop = snapScalar(top, yTargets, threshold, snapToGrid, gridSize);
    if (snappedTop !== top) top = snappedTop;
    height = bottom - top;
    if (height < minSize) {
      height = minSize;
      top = bottom - minSize;
    }
    y = top;
  };

  const applySouth = () => {
    let bottom = y + height;
    const snappedBottom = snapScalar(bottom, yTargets, threshold, snapToGrid, gridSize);
    if (snappedBottom !== bottom) bottom = snappedBottom;
    height = bottom - y;
    if (height < minSize) height = minSize;
  };

  if (handle.includes('w')) applyWest();
  if (handle.includes('e')) applyEast();
  if (handle.includes('n')) applyNorth();
  if (handle.includes('s')) applySouth();

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

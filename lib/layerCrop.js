const MIN_CROP_FRACTION = 0.0001;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeLayerCrop(layerOrCrop) {
  const hasCropProperty = layerOrCrop
    && Object.prototype.hasOwnProperty.call(layerOrCrop, 'crop');
  const isLayer = layerOrCrop && (
    'id' in layerOrCrop
    || 'url' in layerOrCrop
    || 'naturalWidth' in layerOrCrop
    || 'naturalHeight' in layerOrCrop
  );
  const raw = hasCropProperty
    ? (layerOrCrop.crop || {})
    : (isLayer ? {} : (layerOrCrop || {}));
  const x = clamp(Number(raw.x) || 0, 0, 1 - MIN_CROP_FRACTION);
  const y = clamp(Number(raw.y) || 0, 0, 1 - MIN_CROP_FRACTION);
  const width = clamp(
    Number(raw.width) || 1,
    MIN_CROP_FRACTION,
    1 - x,
  );
  const height = clamp(
    Number(raw.height) || 1,
    MIN_CROP_FRACTION,
    1 - y,
  );
  return { x, y, width, height };
}

export function isLayerCropped(layer) {
  const crop = normalizeLayerCrop(layer);
  return crop.x > 0
    || crop.y > 0
    || crop.width < 1
    || crop.height < 1;
}

export function getLayerImageStyle(layer) {
  const crop = normalizeLayerCrop(layer);
  return {
    position: 'absolute',
    width: `${100 / crop.width}%`,
    height: `${100 / crop.height}%`,
    left: `${(-crop.x / crop.width) * 100}%`,
    top: `${(-crop.y / crop.height) * 100}%`,
  };
}

export function drawCroppedLayerImage(ctx, image, layer, dx, dy, dw, dh) {
  const crop = normalizeLayerCrop(layer);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  ctx.drawImage(
    image,
    crop.x * sourceWidth,
    crop.y * sourceHeight,
    crop.width * sourceWidth,
    crop.height * sourceHeight,
    dx,
    dy,
    dw,
    dh,
  );
}

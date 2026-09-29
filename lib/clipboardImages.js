/**
 * Returns images from the system clipboard.
 * Check `files` first to support pasting files from File Explorer.
 *
 * @param {DataTransfer|null|undefined} clipboardData
 * @returns {File[]}
 */
export function getClipboardImageFiles(clipboardData) {
  if (!clipboardData) return [];

  const files = Array.from(clipboardData.files || [])
    .filter((file) => file?.type?.startsWith('image/'));
  if (files.length) return files;

  return Array.from(clipboardData.items || [])
    .filter((item) => item?.type?.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter(Boolean);
}

import crypto from 'crypto';
import { calculateGenerationCost } from './generationPricing';

const JOURNAL_KEY_BASE = 'outpaint-studio/generation-log';

const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function journalId() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${timestamp}_${crypto.randomBytes(3).toString('hex')}`;
}

function safeErrorMessage(error) {
  const message = error?.message || String(error || 'Unknown error');
  return message.slice(0, 2000);
}

function requestSettings(params) {
  const {
    modelName,
    imageSize,
    aspectRatio,
    imageQuality,
    useNanoBananaPro,
    thinkingLevel,
    mediaResolution,
    showThoughts,
    nativeInpaint,
    generationMode,
  } = params;
  return {
    modelName: modelName || null,
    imageSize: imageSize || null,
    aspectRatio: aspectRatio || null,
    imageQuality: imageQuality || null,
    useNanoBananaPro: useNanoBananaPro ?? null,
    thinkingLevel: thinkingLevel || null,
    mediaResolution: mediaResolution || null,
    showThoughts: showThoughts ?? null,
    nativeInpaint: nativeInpaint === true,
    generationMode: generationMode === true,
  };
}

async function writeMetadata(storage, entry) {
  await storage.writeFile(
    `${JOURNAL_KEY_BASE}/${entry.id}/request.json`,
    JSON.stringify(entry, null, 2),
    'utf8',
  );
}

/**
 * Сохраняет точную копию входов до отправки провайдеру.
 * API-ключ намеренно не принимается и никогда не попадает в журнал.
 */
export async function startGenerationJournal(storage, kind, params) {
  const id = journalId();
  const createdAt = new Date().toISOString();
  const images = (params.images || []).filter((image) => image?.data);
  const imageRecords = [];

  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    const mimeType = image.mimeType || 'image/png';
    const extension = MIME_EXT[mimeType] || 'bin';
    const file = `input-${index + 1}.${extension}`;
    const buffer = Buffer.from(image.data, 'base64');
    await storage.writeFile(`${JOURNAL_KEY_BASE}/${id}/${file}`, buffer);
    imageRecords.push({
      index: index + 1,
      role: params.generationMode && index === 0
        ? 'global-reference'
        : (index === 0 ? 'snapshot' : (index === 1 ? 'global-reference' : 'reference')),
      file,
      mimeType,
      bytes: buffer.length,
    });
  }

  if (params.mask?.data) {
    const mimeType = params.mask.mimeType || 'image/png';
    const extension = MIME_EXT[mimeType] || 'bin';
    const file = `mask.${extension}`;
    const buffer = Buffer.from(params.mask.data, 'base64');
    await storage.writeFile(`${JOURNAL_KEY_BASE}/${id}/${file}`, buffer);
    imageRecords.push({
      role: 'native-inpaint-mask',
      file,
      mimeType,
      bytes: buffer.length,
    });
  }

  await storage.writeFile(
    `${JOURNAL_KEY_BASE}/${id}/prompt.txt`,
    params.prompt || '',
    'utf8',
  );

  const entry = {
    version: 1,
    id,
    createdAt,
    status: 'sending',
    kind,
    prompt: params.prompt || '',
    settings: requestSettings(params),
    images: imageRecords,
  };
  await writeMetadata(storage, entry);
  return entry;
}

export async function finishGenerationJournal(storage, entry, { error = null, usage = null } = {}) {
  const finished = {
    ...entry,
    status: error ? 'error' : 'completed',
    finishedAt: new Date().toISOString(),
    ...(!error && usage ? { usage } : {}),
    ...(error ? { error: safeErrorMessage(error) } : {}),
  };
  const cost = calculateGenerationCost(finished, usage);
  if (cost) finished.cost = cost;
  await writeMetadata(storage, finished);
}

export async function listGenerationJournalEntries(storage) {
  let directories;
  try {
    directories = await storage.readDir(JOURNAL_KEY_BASE, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const entries = await Promise.all(directories
    .filter((item) => item.isDirectory())
    .map(async (item) => {
      try {
        const raw = await storage.readFile(
          `${JOURNAL_KEY_BASE}/${item.name}/request.json`,
          'utf8',
        );
        const entry = JSON.parse(raw);
        return {
          ...entry,
          cost: entry.cost || calculateGenerationCost(entry, entry.usage || null),
        };
      } catch (error) {
        console.error('generation journal read:', item.name, error);
        return null;
      }
    }));

  return entries
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function readGenerationJournalImage(storage, id, file) {
  if (!/^[\w-]+$/.test(id) || !/^[\w.-]+$/.test(file)) return null;
  const raw = await storage.readFile(`${JOURNAL_KEY_BASE}/${id}/request.json`, 'utf8');
  const entry = JSON.parse(raw);
  if (!(entry.images || []).some((image) => image.file === file && image.mimeType?.startsWith('image/'))) {
    return null;
  }
  const image = entry.images.find((item) => item.file === file);
  return {
    buffer: await storage.readFile(`${JOURNAL_KEY_BASE}/${id}/${file}`),
    mimeType: image.mimeType,
  };
}

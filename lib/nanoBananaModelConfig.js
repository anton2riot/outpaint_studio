/** Реестр моделей генерации (настройка nanoBananaModel). */

export const NANO_BANANA_API_MODELS = {
  regular: 'gemini-2.5-flash-image',
  pro: 'gemini-3-pro-image-preview',
  nb2: 'gemini-3.1-flash-image-preview',
  'gpt-image-2': 'gpt-image-2',
  'gpt-image-2.5-sunburst': 'gpt-image-2.5-sunburst',
  'gpt-image-2.5-flare': 'gpt-image-2.5-flare',
};

/** Порядок переключения хоткеем Ctrl+Space */
export const NANO_BANANA_MODEL_CYCLE = [
  'regular', 'nb2', 'pro', 'gpt-image-2',
  'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare',
];

export const NANO_BANANA_MODEL_OPTIONS = [
  { id: 'regular', label: 'NanoBanana', provider: 'gemini' },
  { id: 'nb2', label: 'NanoBanana 2', provider: 'gemini', suffix: '2' },
  { id: 'pro', label: 'NanoBanana Pro', provider: 'gemini', suffix: 'pro' },
  { id: 'gpt-image-2', label: 'ChatGPT 2', provider: 'openai' },
  { id: 'gpt-image-2.5-sunburst', label: 'ChatGPT Sunburst', provider: 'openai', suffix: 'Snb' },
  { id: 'gpt-image-2.5-flare', label: 'ChatGPT Flare', provider: 'openai', suffix: 'Flr' },
];

/** Модели GPT Image доступны через Image API, а не Gemini API. */
export function isOpenAIImageModel(modelId) {
  return modelId === 'gpt-image-2'
    || modelId === 'gpt-image-2.5-sunburst'
    || modelId === 'gpt-image-2.5-flare';
}

export function getNanoBananaModelOption(modelId) {
  return NANO_BANANA_MODEL_OPTIONS.find((o) => o.id === modelId)
    || NANO_BANANA_MODEL_OPTIONS.find((o) => o.id === 'nb2');
}

export function getNextNanoBananaModel(currentId) {
  const idx = NANO_BANANA_MODEL_CYCLE.indexOf(currentId);
  const nextIdx = idx >= 0 ? (idx + 1) % NANO_BANANA_MODEL_CYCLE.length : 0;
  return NANO_BANANA_MODEL_CYCLE[nextIdx];
}

export function resolveNanoBananaModelId(settings) {
  if (!settings) return null;
  if (settings.nanoBananaModel !== undefined) return settings.nanoBananaModel;
  if (settings.useNanoBananaPro !== undefined) {
    return settings.useNanoBananaPro ? 'nb2' : 'regular';
  }
  return null;
}

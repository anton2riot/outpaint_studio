const STORAGE_KEY = 'outpaint-studio:user-api-keys:v1';

const PROVIDER_BY_JOB_KIND = {
  gemini: 'gemini',
  'openai-image': 'openai',
};

export function loadUserApiKeys() {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      ...(typeof parsed.gemini === 'string' && parsed.gemini ? { gemini: parsed.gemini } : {}),
      ...(typeof parsed.openai === 'string' && parsed.openai ? { openai: parsed.openai } : {}),
    };
  } catch {
    return {};
  }
}

export function updateUserApiKeys(updates) {
  const next = loadUserApiKeys();
  for (const [provider, value] of Object.entries(updates)) {
    if (value === null) delete next[provider];
    else if (typeof value === 'string' && value.trim()) next[provider] = value.trim();
  }

  if (Object.keys(next).length > 0) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } else {
    window.localStorage.removeItem(STORAGE_KEY);
  }
  return next;
}

export function getUserApiKeyForJob(kind) {
  const provider = PROVIDER_BY_JOB_KIND[kind];
  return provider ? loadUserApiKeys()[provider] || null : null;
}

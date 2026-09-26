const MILLION = 1_000_000;

const PRICING_VERSION = '2026-09-20';

const GEMINI_RATES = {
  'gemini-3.1-flash-image-preview': { input: 0.5, textOutput: 3, imageOutput: 60 },
  'gemini-3.1-flash-image': { input: 0.5, textOutput: 3, imageOutput: 60 },
  'gemini-3-pro-image-preview': { input: 2, textOutput: 12, imageOutput: 120 },
  'gemini-3-pro-image': { input: 2, textOutput: 12, imageOutput: 120 },
  'gemini-2.5-flash-image': { input: 0.3, textOutput: 2.5, imageOutput: 30 },
};

const OPENAI_RATES = {
  'gpt-image-2': { textInput: 5, imageInput: 8, imageOutput: 30 },
  'gpt-image-2.5-sunburst': { textInput: 5, imageInput: 8, imageOutput: 30 },
  'gpt-image-2.5-flare': { textInput: 5, imageInput: 8, imageOutput: 30 },
};

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function modalityTokens(details, modality) {
  return (details || []).reduce((sum, item) => (
    String(item?.modality || '').toUpperCase() === modality
      ? sum + finite(item?.tokenCount)
      : sum
  ), 0);
}

function roundCost(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function result(amount, estimated, breakdown) {
  return {
    amountUsd: roundCost(amount),
    currency: 'USD',
    estimated,
    pricingVersion: PRICING_VERSION,
    breakdown,
  };
}

function priceGemini(entry, usage) {
  const model = entry.settings?.modelName || 'gemini-3.1-flash-image-preview';
  const rates = GEMINI_RATES[model];
  if (!rates) return null;

  if (usage) {
    const inputTokens = finite(usage.promptTokenCount);
    const detailedImageTokens = modalityTokens(usage.candidatesTokensDetails, 'IMAGE');
    const detailedTextTokens = modalityTokens(usage.candidatesTokensDetails, 'TEXT');
    const totalCandidateTokens = finite(usage.candidatesTokenCount);
    const outputImageTokens = detailedImageTokens || Math.max(0, totalCandidateTokens - detailedTextTokens);
    const outputTextTokens = detailedTextTokens;
    const thinkingTokens = finite(usage.thoughtsTokenCount);
    const amount = (inputTokens * rates.input
      + outputImageTokens * rates.imageOutput
      + (outputTextTokens + thinkingTokens) * rates.textOutput) / MILLION;
    return result(amount, false, {
      inputTokens,
      outputImageTokens,
      outputTextTokens,
      thinkingTokens,
    });
  }

  const tier = entry.settings?.imageSize || '1K';
  const outputTokensByTier = model.includes('3-pro')
    ? { '0.5K': 1120, '1K': 1120, '2K': 1120, '4K': 2000 }
    : model.includes('3.1-flash')
      ? { '0.5K': 747, '1K': 1120, '2K': 1680, '4K': 2520 }
      : { '0.5K': 1290, '1K': 1290, '2K': 1290, '4K': 1290 };
  const outputImageTokens = outputTokensByTier[tier] ?? outputTokensByTier['1K'];
  const imageCount = (entry.images || []).filter((image) => image.role !== 'native-inpaint-mask').length;
  const inputImageTokensPerImage = model.includes('3-pro')
    ? 560
    : model.includes('3.1-flash') ? 1120 : 560;
  const approximateTextTokens = Math.ceil((entry.prompt || '').length / 4);
  const approximateInputTokens = approximateTextTokens + imageCount * inputImageTokensPerImage;
  const inputCost = approximateInputTokens * rates.input / MILLION;
  const outputCost = outputImageTokens * rates.imageOutput / MILLION;
  return result(inputCost + outputCost, true, {
    approximateInputTokens,
    approximateTextTokens,
    inputImageTokensPerImage,
    outputImageTokens,
    outputTier: tier,
  });
}

function priceOpenAI(entry, usage) {
  const model = entry.settings?.modelName || 'gpt-image-2';
  const rates = OPENAI_RATES[model];
  if (!rates || !usage) return null;
  const details = usage.input_tokens_details || {};
  const textInputTokens = finite(details.text_tokens);
  const imageInputTokens = finite(details.image_tokens);
  const outputImageTokens = finite(usage.output_tokens);
  const amount = (textInputTokens * rates.textInput
    + imageInputTokens * rates.imageInput
    + outputImageTokens * rates.imageOutput) / MILLION;
  return result(amount, false, { textInputTokens, imageInputTokens, outputImageTokens });
}

export function calculateGenerationCost(entry, usage = null) {
  if (entry.status && entry.status !== 'completed') return null;
  if (entry.kind === 'gemini') return priceGemini(entry, usage);
  if (entry.kind === 'openai-image') return priceOpenAI(entry, usage);
  return null;
}

import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { STANDARD_SIZES_GPT_IMAGE_2 } from '../../lib/imageResize';
import {
  finishGenerationJournal,
  startGenerationJournal,
} from '../../lib/generationJournal';
import { requireUser } from '../../lib/requestAuth';
import { storageForUser } from '../../lib/storage';

export const config = {
  api: { bodyParser: { sizeLimit: '50mb' } },
};

function imageFromGemini(response) {
  const parts = response.candidates?.[0]?.content?.parts || [];
  return parts.find((part) => part.inlineData?.data)?.inlineData || null;
}

function openAiSize(imageSize, aspectRatio) {
  const size = STANDARD_SIZES_GPT_IMAGE_2.find((item) => (
    item.imageSize === imageSize && item.aspectRatio === aspectRatio
  ));
  if (!size) throw new Error(`Unsupported GPT size: ${imageSize} ${aspectRatio}`);
  return `${size.width}x${size.height}`;
}

function pngDimensions(buffer) {
  const signature = '89504e470d0a1a0a';
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== signature) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function validateOpenAiMask(maskBuffer, firstImageBuffer, maskMimeType, requestedSize) {
  if (maskMimeType !== 'image/png') throw new Error('The GPT mask must be a PNG');
  if (maskBuffer.length >= 4 * 1024 * 1024) throw new Error('The GPT mask must be smaller than 4 MB');
  const maskSize = pngDimensions(maskBuffer);
  const imageSize = pngDimensions(firstImageBuffer);
  if (!maskSize || !imageSize) throw new Error('The GPT mask and first image must be PNGs');
  if (maskSize.width !== imageSize.width || maskSize.height !== imageSize.height) {
    throw new Error(
      `Mask size ${maskSize.width}×${maskSize.height} does not match `
      + `the first image ${imageSize.width}×${imageSize.height}`,
    );
  }
  const [requestedWidth, requestedHeight] = requestedSize.split('x').map(Number);
  if (imageSize.width !== requestedWidth || imageSize.height !== requestedHeight) {
    throw new Error(
      `Inpaint input size ${imageSize.width}×${imageSize.height} does not match `
      + `the requested GPT size ${requestedWidth}×${requestedHeight}`,
    );
  }
}

function openAiImageDataUrl(image) {
  return `data:${image.mimeType || 'image/png'};base64,${image.data}`;
}

async function editWithOpenAI(request, images, mask, apiKey) {
  const response = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...request,
      images: images.map((image) => ({ image_url: openAiImageDataUrl(image) })),
      ...(mask?.data ? { mask: { image_url: openAiImageDataUrl(mask) } } : {}),
      background: 'opaque',
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(result?.error?.message || `OpenAI error: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return result;
}

async function generateWithGemini(params, apiKey) {
  const ai = new GoogleGenAI({ apiKey });
  const { prompt, images = [], modelName, useNanoBananaPro, imageSize, aspectRatio } = params;
  const request = {
    model: modelName || 'gemini-3.1-flash-image-preview',
    contents: [
      ...images.filter((image) => image?.data).map((image) => ({
        inlineData: { mimeType: image.mimeType || 'image/png', data: image.data },
      })),
      { text: prompt || '' },
    ],
    config: { responseModalities: ['IMAGE'] },
  };
  if (useNanoBananaPro) {
    request.config.thinking_level = 'low';
    request.config.media_resolution = 'media_resolution_high';
    request.config.imageConfig = {
      aspectRatio: aspectRatio || '1:1',
      imageSize: imageSize === '0.5K' ? '512' : (imageSize || '2K'),
    };
  }
  const response = await ai.models.generateContent(request);
  const image = imageFromGemini(response);
  if (!image) throw new Error('Gemini did not return an image');
  return {
    mimeType: image.mimeType || 'image/png',
    data: Buffer.from(image.data, 'base64'),
    usage: response.usageMetadata || null,
  };
}

async function generateWithOpenAI(params, apiKey) {
  const { prompt, images = [], mask, modelName, imageSize, aspectRatio } = params;
  const client = new OpenAI({ apiKey });
  const requestedSize = openAiSize(imageSize, aspectRatio);
  const validImages = images.filter((image) => image?.data);
  const imageBuffers = validImages.map((image) => Buffer.from(image.data, 'base64'));
  if (mask?.data) {
    if (imageBuffers.length === 0) throw new Error('A GPT mask cannot be sent without an image');
    const maskBuffer = Buffer.from(mask.data, 'base64');
    const maskMimeType = mask.mimeType || 'image/png';
    validateOpenAiMask(maskBuffer, imageBuffers[0], maskMimeType, requestedSize);
  }
  const request = {
    model: modelName || 'gpt-image-2',
    prompt: prompt || '',
    size: requestedSize,
    quality: 'auto',
    output_format: 'png',
    moderation: 'low',
  };
  const result = validImages.length > 0
    ? await editWithOpenAI(request, validImages, mask, apiKey)
    : await client.images.generate(request);
  const data = result.data?.[0]?.b64_json;
  if (!data) throw new Error('OpenAI did not return an image');
  return {
    mimeType: 'image/png',
    data: Buffer.from(data, 'base64'),
    usage: result.usage || null,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireUser(req, res);
  if (!user) return;
  const storage = storageForUser(user);
  let journalEntry = null;
  try {
    const { kind, params, apiKey } = req.body || {};
    if (!params?.prompt || !Array.isArray(params.images)) {
      return res.status(400).json({ error: 'Invalid generation request' });
    }
    if (
      typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 2000 || /[\r\n\0]/.test(apiKey)
    ) {
      return res.status(400).json({ error: 'Enter a valid personal API key in Settings' });
    }
    if (kind !== 'openai-image' && kind !== 'gemini') {
      return res.status(400).json({ error: 'Unsupported model' });
    }
    journalEntry = await startGenerationJournal(storage, kind, params);
    const result = kind === 'openai-image'
      ? await generateWithOpenAI(params, apiKey)
      : await generateWithGemini(params, apiKey);
    try {
      await finishGenerationJournal(storage, journalEntry, { usage: result.usage });
    } catch (journalError) {
      console.error('generation journal finish:', journalError);
    }
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(result.data);
  } catch (error) {
    if (journalEntry) {
      try {
        await finishGenerationJournal(storage, journalEntry, { error });
      } catch (journalError) {
        console.error('generation journal error finish:', journalError);
      }
    }
    console.error('outpaint generation:', error);
    return res.status(error.status || 500).json({ error: error.message || 'Generation failed' });
  }
}

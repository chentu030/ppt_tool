import { getValidBearerToken } from './auth';

// Both paths use aiplatform.googleapis.com (Vertex AI billing) — never generativelanguage.googleapis.com
// Bearer token → v1 regional endpoint (GCP project credits)
// API key     → v1beta1 Express Mode (still Vertex AI, still GCP billing)
const getBaseUrl = (hasBearerToken: boolean) => {
  if (hasBearerToken) {
    const project = localStorage.getItem('gcpProjectId') || '';
    const region  = localStorage.getItem('vertexRegion')  || 'us-central1';
    return `https://aiplatform.googleapis.com/v1/projects/${project}/locations/${region}/publishers/google/models`;
  }
  return 'https://aiplatform.googleapis.com/v1beta1/publishers/google/models';
};


// Text-only polish via Gemini (no image output)
export const polishTextWithAI = async (
  text: string,
  direction: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<string> => {
  const modelName = 'gemini-3-flash-preview';
  const instruction = direction
    ? `請根據以下方向潤色文字：「${direction}」。直接回傳修飾後的文字，不要加任何說明或格式標記。`
    : '請潤色以下投影片文字，使其更流暢、專業、清晰。直接回傳修飾後的文字，不要加任何說明或格式標記。';

  const requestBody = {
    contents: [{ role: 'user', parts: [{ text: `${instruction}\n\n原始文字：\n${text}` }] }]
  };

  const bearerToken = await getValidBearerToken();
  const url = bearerToken
    ? `${getBaseUrl(true)}/${modelName}:generateContent`
    : `${getBaseUrl(false)}/${modelName}:generateContent?key=${apiKey}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`;

  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(requestBody), signal });
  if (!response.ok) {
    const errorText = await response.text();
    console.error('Polish API failed:', errorText);
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  const textPart = data?.candidates?.[0]?.content?.parts?.find((p: any) => p.text);
  if (textPart) return textPart.text.trim();
  throw new Error('AI did not return text.');
};

// Generate a short conversation title (≤10 chars) using Gemini 2.5 Flash
export const generateChatTitle = async (firstMessage: string, apiKey: string): Promise<string> => {
  const modelName = 'gemini-2.5-flash-preview-05-20';
  const requestBody = {
    contents: [{ role: 'user', parts: [{ text: `請用10個字以內為以下對話開頭取一個簡短標題，直接回覆標題文字，不要加標點符號或其他說明：\n\n${firstMessage.slice(0, 300)}` }] }],
  };
  try {
    const bearerToken = await getValidBearerToken();
    const url = bearerToken
      ? `${getBaseUrl(true)}/${modelName}:generateContent`
      : `${getBaseUrl(false)}/${modelName}:generateContent?key=${apiKey}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`;
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(requestBody) });
    if (!resp.ok) return firstMessage.slice(0, 10);
    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    return text.slice(0, 15) || firstMessage.slice(0, 10);
  } catch { return firstMessage.slice(0, 10); }
};

// Multi-turn chat via Gemini (text + optional images/files, can return text + images)
export interface ChatMessage {
  role: 'user' | 'model';
  parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
}
export interface ChatResponse {
  text: string;
  images: string[]; // data URIs
}
export const chatWithGemini = async (
  history: ChatMessage[],
  apiKey: string,
  options?: { generateImage?: boolean; referenceImage?: string | null; aspectRatio?: string; resolution?: string },
  signal?: AbortSignal
): Promise<ChatResponse> => {
  const wantImage = options?.generateImage ?? false;
  const modelName = wantImage ? 'gemini-3.1-flash-image-preview' : 'gemini-3-flash-preview';

  // Optionally append reference style image to the last user message
  if (options?.referenceImage && history.length > 0) {
    const last = history[history.length - 1];
    if (last.role === 'user') {
      const cleanRef = options.referenceImage.includes(',')
        ? options.referenceImage.split(',')[1]
        : options.referenceImage;
      last.parts = [
        ...last.parts,
        { text: 'Reference Style:' },
        { inlineData: { mimeType: 'image/jpeg', data: cleanRef } },
      ];
    }
  }

  const requestBody: any = { contents: history };
  if (wantImage) {
    requestBody.generationConfig = {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio: options?.aspectRatio || '16:9', imageSize: options?.resolution || '2K' },
    };
  }

  const bearerToken = await getValidBearerToken();
  const url = bearerToken
    ? `${getBaseUrl(true)}/${modelName}:generateContent`
    : `${getBaseUrl(false)}/${modelName}:generateContent?key=${apiKey}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`;

  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(requestBody), signal });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Error ${response.status}: ${errorText.slice(0, 200)}`);
  }
  const data = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((p: any) => p.text).map((p: any) => p.text).join('');
  const images = parts
    .filter((p: any) => p?.inlineData?.data)
    .map((p: any) => `data:${p.inlineData.mimeType || 'image/png'};base64,${p.inlineData.data}`);
  return { text, images };
};

// Standard generation via Gemini generateContent endpoint (no mask)
export const generateImageDesign = async (
  baseImage: string | null,
  referenceImage: string | null,
  maskImage: string | null,
  prompt: string,
  apiKey: string,
  modelName: string = 'gemini-3.1-flash-image-preview',
  aspectRatio: string = '16:9',
  resolution: string = '2K',
  signal?: AbortSignal
): Promise<string> => {
  console.log(`Calling API with model: ${modelName}, ratio: ${aspectRatio}, res: ${resolution}, mask: ${!!maskImage}`);

  const cleanBase = baseImage ? (baseImage.split(',')[1] || baseImage) : null;
  const cleanRef = referenceImage ? (referenceImage.split(',')[1] || referenceImage) : null;
  const cleanMask = maskImage ? (maskImage.split(',')[1] || maskImage) : null;

  // No mask — use Gemini generateContent
  // Text-only slides (no baseImage): just send text prompt + reference style image
  const parts: any[] = [];

  if (cleanMask && cleanBase) {
    // Mask-guided local edit: send base image + mask, instruct Gemini to only edit white areas
    parts.push({ text: `You are an image editor. Here is the original image followed by a mask image. The mask has WHITE pixels marking the region to modify and BLACK pixels marking everything to keep unchanged. Task: ${prompt || 'Edit the masked area.'}. Keep every part of the image outside the white mask region pixel-perfect identical to the original. Only change the white-masked area as instructed.` });
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: cleanBase } });
    parts.push({ text: 'Mask (white = edit here, black = keep unchanged):' });
    parts.push({ inlineData: { mimeType: 'image/png', data: cleanMask } });
  } else {
    parts.push({ text: prompt || 'Design a slide based on the provided content.' });
    if (cleanBase) {
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: cleanBase } });
    }
    if (cleanRef) {
      parts.push({ text: 'Reference Style:' });
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: cleanRef } });
    }
  }

  const requestBody = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: {
        aspectRatio,
        imageSize: resolution
      }
    }
  };

  const MAX_RETRIES = 3;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      // 429 → long backoff (15s, 30s, 60s); 5xx → short backoff (2s, 4s, 8s)
      const is429 = lastError?.message?.includes('429');
      const delayMs = is429 ? 15000 * attempt : 2000 * attempt;
      console.warn(`[Retry ${attempt}/${MAX_RETRIES}] Waiting ${delayMs / 1000}s before retry...`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  try {
    const bearerToken = await getValidBearerToken();
    const url = bearerToken
      ? `${getBaseUrl(true)}/${modelName}:generateContent`
      : `${getBaseUrl(false)}/${modelName}:generateContent?key=${apiKey}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('API call failed:', errorText);
      const retryable = response.status === 429 || response.status === 500 || response.status === 503;
      if (retryable && attempt < MAX_RETRIES) {
        lastError = new Error(`API Error: ${response.status}`);
        continue;
      }
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('API Success Response:', data);

    const parts2 = data?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts2.find((p: any) => p?.inlineData?.data);
    if (imagePart) {
      const mime = imagePart.inlineData.mimeType || 'image/jpeg';
      return `data:${mime};base64,${imagePart.inlineData.data}`;
    }

    console.warn("API didn't return an image part. Returning original.");
    return baseImage ?? '';

  } catch (error: any) {
    if (attempt < MAX_RETRIES && (error?.message?.includes('500') || error?.message?.includes('503'))) {
      lastError = error;
      continue;
    }
    console.error('Error calling AI API:', error);
    throw error;
  }
  } // end for loop
  throw lastError ?? new Error('API failed after retries');
};

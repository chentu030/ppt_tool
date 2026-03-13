import { getValidBearerToken } from './auth';

const IMAGEN_INPAINT_MODEL = 'imagen-4.0-generate-001';
// Build the correct Vertex AI base URL depending on auth mode:
// - Bearer token → https://aiplatform.googleapis.com/v1/projects/{PROJECT}/locations/{REGION}/publishers/google/models
// - Express Mode (API key) → https://aiplatform.googleapis.com/v1beta1/publishers/google/models
const getBaseUrl = () => {
  const bearerToken = localStorage.getItem('vertexBearerToken') || '';
  if (bearerToken) {
    const project = localStorage.getItem('gcpProjectId') || '';
    const region  = localStorage.getItem('vertexRegion')  || 'global';
    if (!project) console.warn('[Vertex] Bearer token set but GCP Project ID is empty — requests may fail');
    return `https://aiplatform.googleapis.com/v1/projects/${project}/locations/${region}/publishers/google/models`;
  }
  return 'https://aiplatform.googleapis.com/v1beta1/publishers/google/models';
};

// Inpainting via Imagen 4 generateImages endpoint (mask present)
const imagenInpaint = async (
  cleanBase: string,
  cleanMask: string,
  prompt: string,
  apiKey: string,
  aspectRatio: string
): Promise<string> => {
  const requestBody = {
    prompt,
    referenceImages: [
      {
        referenceType: 'REFERENCE_TYPE_RAW',
        referenceId: 1,
        referenceImage: { bytesBase64Encoded: cleanBase }
      },
      {
        referenceType: 'REFERENCE_TYPE_MASK',
        referenceId: 2,
        referenceImage: { bytesBase64Encoded: cleanMask },
        maskImageConfig: { maskMode: 'MASK_MODE_WHITE' }
      }
    ],
    editConfig: { editMode: 'INPAINTING_INSERT' },
    generationConfig: { numberOfImages: 1, aspectRatio }
  };

  const bearerToken = await getValidBearerToken();
  const inpaintUrl = bearerToken
    ? `${getBaseUrl()}/${IMAGEN_INPAINT_MODEL}:generateImages`
    : `${getBaseUrl()}/${IMAGEN_INPAINT_MODEL}:generateImages?key=${apiKey}`;
  const inpaintHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearerToken) inpaintHeaders['Authorization'] = `Bearer ${bearerToken}`;

  const response = await fetch(inpaintUrl, {
    method: 'POST',
    headers: inpaintHeaders,
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Imagen inpaint API call failed:', errorText);
    throw new Error(`Imagen API Error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  console.log('Imagen inpaint response:', data);

  const b64 = data?.images?.[0]?.bytesBase64Encoded;
  if (b64) return `data:image/png;base64,${b64}`;
  throw new Error('Imagen API did not return an image.');
};

// Standard generation via Gemini generateContent endpoint (no mask)
export const generateImageDesign = async (
  baseImage: string,
  referenceImage: string | null,
  maskImage: string | null,
  prompt: string,
  apiKey: string,
  modelName: string = 'gemini-3-pro-image-preview',
  aspectRatio: string = '16:9',
  resolution: string = '2K'
): Promise<string> => {
  console.log(`Calling API with model: ${modelName}, ratio: ${aspectRatio}, res: ${resolution}, mask: ${!!maskImage}`);

  const cleanBase = baseImage.split(',')[1] || baseImage;
  const cleanRef = referenceImage ? (referenceImage.split(',')[1] || referenceImage) : null;
  const cleanMask = maskImage ? (maskImage.split(',')[1] || maskImage) : null;

  // When mask is present use Imagen 4 inpainting
  if (cleanMask) {
    return imagenInpaint(cleanBase, cleanMask, prompt || 'Edit the masked area.', apiKey, aspectRatio);
  }

  // No mask — use Gemini generateContent
  const parts: any[] = [
    { text: prompt || 'Redesign this slide with a clean, modern minimalist style.' },
    { inlineData: { mimeType: 'image/jpeg', data: cleanBase } }
  ];

  if (cleanRef) {
    parts.push({ text: 'Reference Style:' });
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: cleanRef } });
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
      ? `${getBaseUrl()}/${modelName}:generateContent`
      : `${getBaseUrl()}/${modelName}:generateContent?key=${apiKey}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
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
    return baseImage;

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

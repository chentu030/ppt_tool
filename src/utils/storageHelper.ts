/**
 * Compress a base64 image using HTML5 Canvas.
 * Returns a smaller base64 data URL (JPEG format).
 */
export function compressImage(base64Input: string, maxWidth = 800, quality = 0.6): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      if (w > maxWidth) {
        h = Math.round((h * maxWidth) / w);
        w = maxWidth;
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas context unavailable')); return; }
      
      ctx.drawImage(img, 0, 0, w, h);
      const compressed = canvas.toDataURL('image/jpeg', quality);
      resolve(compressed);
    };
    img.onerror = () => reject(new Error('Image load failed'));

    if (base64Input.startsWith('data:')) {
      img.src = base64Input;
    } else {
      img.src = `data:image/png;base64,${base64Input}`;
    }
  });
}

/**
 * Compress aggressively until the result is under Firestore's ~900KB safe limit.
 * Tries progressively smaller dimensions and lower quality.
 */
export async function compressForFirestore(base64Input: string): Promise<string> {
  const LIMIT = 900 * 1024; // 900KB in base64 chars (~675KB binary)
  const steps = [
    { maxWidth: 1200, quality: 0.7 },
    { maxWidth: 900,  quality: 0.65 },
    { maxWidth: 700,  quality: 0.6 },
    { maxWidth: 500,  quality: 0.55 },
    { maxWidth: 400,  quality: 0.5 },
  ];
  for (const { maxWidth, quality } of steps) {
    const result = await compressImage(base64Input, maxWidth, quality);
    if (result.length < LIMIT) return result;
  }
  // Last resort: smallest possible
  return compressImage(base64Input, 300, 0.45);
}

/**
 * "Upload" an image — actually compresses it and returns a data URL directly.
 * Firebase Storage has CORS issues, so we bypass it entirely and store
 * compressed images inline in Firestore.
 */
export const uploadImageToStorage = async (
  _projectId: string,
  _slideId: string,
  _field: string,
  base64DataUrl: string
): Promise<string> => {
  try {
    const compressed = await compressImage(base64DataUrl, 800, 0.65);
    console.log(`[Image] Compressed to ${(compressed.length / 1024).toFixed(0)}KB`);
    return compressed;
  } catch (err) {
    console.warn('[Image] Compression failed, using original:', err);
    return base64DataUrl.startsWith('data:') 
      ? base64DataUrl 
      : `data:image/png;base64,${base64DataUrl}`;
  }
};

/**
 * Upload original (full-quality) image to Firebase Storage and return the download URL.
 * Used for PPTX export quality.
 */
export const uploadHQToStorage = async (
  projectId: string,
  slideId: string,
  field: string,
  base64DataUrl: string
): Promise<string | null> => {
  try {
    const { getStorage, ref, uploadString, getDownloadURL } = await import('firebase/storage');
    const storage = getStorage();
    const path = `projects/${projectId}/${slideId}/${field}_hq.jpg`;
    const storageRef = ref(storage, path);

    const dataUrl = base64DataUrl.startsWith('data:')
      ? base64DataUrl
      : `data:image/jpeg;base64,${base64DataUrl}`;

    await uploadString(storageRef, dataUrl, 'data_url');
    const url = await getDownloadURL(storageRef);
    return url;
  } catch (err) {
    console.warn('[HQ Upload] Failed, skipping HQ:', err);
    return null;
  }
};

/**
 * Upload a full-quality image to Google Drive via a deployed Apps Script web app.
 * Returns the public Drive URL, or null if the upload fails / no URL configured.
 */
export const uploadToDrive = async (
  base64DataUrl: string,
  filename: string,
  appScriptUrl: string
): Promise<string | null> => {
  if (!appScriptUrl) return null;
  try {
    const base64 = base64DataUrl.startsWith('data:')
      ? base64DataUrl.split(',')[1]
      : base64DataUrl;
    const body = JSON.stringify({ imageData: base64, filename });
    // Use text/plain to avoid CORS preflight (Apps Script handles it as e.postData.contents)
    const res = await fetch(appScriptUrl, { method: 'POST', body });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Drive upload failed');
    return json.url as string;
  } catch (err) {
    console.warn('[Drive] Upload failed:', err);
    return null;
  }
};

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

/**
 * Fetch an image URL and convert it to a base64 data URL.
 * For Firebase Storage URLs, uses the Firebase SDK (getBlob) to bypass CORS.
 */
export const fetchImageAsBase64 = async (url: string): Promise<string> => {
  if (url.startsWith('data:')) return url;

  // Google Drive URL — fetch via Apps Script proxy (bypasses CORS)
  if (url.includes('drive.google.com')) {
    const scriptUrl = localStorage.getItem('driveScriptUrl') || import.meta.env.VITE_DRIVE_SCRIPT_URL || '';
    const match = url.match(/[?&]id=([^&]+)/);
    if (scriptUrl && match) {
      try {
        const fileId = match[1];
        const res = await fetch(`${scriptUrl}?fileId=${encodeURIComponent(fileId)}`);
        const json = await res.json();
        if (json.ok && json.data) {
          return `data:${json.mimeType || 'image/jpeg'};base64,${json.data}`;
        }
      } catch (err) {
        console.warn('[fetchImageAsBase64] Drive proxy fetch failed:', err);
      }
    }
    // Fallback: try direct fetch (may hit CORS but worth trying)
  }

  if (url.includes('firebasestorage.googleapis.com')) {
    try {
      const { getStorage, ref, getBlob } = await import('firebase/storage');
      const storage = getStorage();
      const pathMatch = url.match(/\/o\/(.+?)\?/);
      if (pathMatch) {
        const storagePath = decodeURIComponent(pathMatch[1]);
        const storageRef = ref(storage, storagePath);
        const blob = await getBlob(storageRef);
        return blobToBase64(blob);
      }
    } catch (err) {
      console.warn('[fetchImageAsBase64] Firebase SDK fetch failed, trying raw fetch:', err);
    }
  }

  const response = await fetch(url);
  const blob = await response.blob();
  return blobToBase64(blob);
};

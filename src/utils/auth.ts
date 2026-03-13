/**
 * Auto-refreshing Bearer Token for Vertex AI regional endpoints.
 * After the user consents once (via the "刷新 Token" button in Settings),
 * subsequent refreshes are fully silent — no popup, no CLI needed.
 */

const EXPIRY_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before actual expiry

let refreshPromise: Promise<string> | null = null;

function isTokenValid(): boolean {
  const expiry = parseInt(localStorage.getItem('vertexTokenExpiry') || '0');
  return expiry > Date.now() + EXPIRY_BUFFER_MS;
}

function silentRefresh(clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const google = (window as any).google;
    if (!google?.accounts?.oauth2) {
      reject(new Error('Google Identity Services not loaded'));
      return;
    }
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      prompt: '', // silent — no popup if user already consented
      callback: (resp: any) => {
        if (resp.error) { reject(new Error(resp.error)); return; }
        const token: string = resp.access_token;
        const expiry = Date.now() + (resp.expires_in || 3600) * 1000;
        localStorage.setItem('vertexBearerToken', token);
        localStorage.setItem('vertexTokenExpiry', String(expiry));
        resolve(token);
      },
    });
    client.requestAccessToken();
  });
}

/**
 * Returns a valid Bearer token, auto-refreshing silently if expired.
 * Falls back to the stored token if no Client ID is configured.
 */
export async function getValidBearerToken(): Promise<string> {
  const clientId = localStorage.getItem('googleClientId') || '';
  const storedToken = localStorage.getItem('vertexBearerToken') || '';

  // No Bearer token mode — using API Key instead
  if (!storedToken && !clientId) return '';

  // Token still valid
  if (isTokenValid()) return storedToken;

  // No client ID to refresh — return stale token and warn
  if (!clientId) {
    console.warn('[Auth] Bearer token expired and no Client ID set for auto-refresh');
    return storedToken;
  }

  // Deduplicate concurrent refresh calls
  if (!refreshPromise) {
    refreshPromise = silentRefresh(clientId).finally(() => { refreshPromise = null; });
  }
  try {
    return await refreshPromise;
  } catch (err) {
    console.warn('[Auth] Silent refresh failed, using stale token:', err);
    return storedToken;
  }
}

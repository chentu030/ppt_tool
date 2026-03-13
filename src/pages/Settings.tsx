import React, { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';

export const Settings: React.FC = () => {
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light');
  const [apiKey, setApiKey] = useState(localStorage.getItem('vertexApiKey') || localStorage.getItem('geminiApiKey') || import.meta.env.VITE_VERTEX_API_KEY || '');
  const [model, setModel] = useState(localStorage.getItem('vertexModel') || localStorage.getItem('geminiModel') || 'gemini-3-pro-image-preview');
  const [backendUrl, setBackendUrl] = useState(localStorage.getItem('backendUrl') || import.meta.env.VITE_BACKEND_URL || '');
  const [driveScriptUrl, setDriveScriptUrl] = useState(localStorage.getItem('driveScriptUrl') || import.meta.env.VITE_DRIVE_SCRIPT_URL || '');
  const [vertexRegion, setVertexRegion] = useState(localStorage.getItem('vertexRegion') || 'global');
  const [gcpProjectId, setGcpProjectId] = useState(localStorage.getItem('gcpProjectId') || import.meta.env.VITE_GCP_PROJECT_ID || '');
  const [bearerToken, setBearerToken] = useState(localStorage.getItem('vertexBearerToken') || '');
  const [googleClientId, setGoogleClientId] = useState(localStorage.getItem('googleClientId') || import.meta.env.VITE_GOOGLE_CLIENT_ID || '');
  const [tokenExpiry, setTokenExpiry] = useState<number>(parseInt(localStorage.getItem('vertexTokenExpiry') || '0'));

  const VERTEX_REGIONS = [
    { label: 'global — 建議优先（最多 quota）', value: 'global' },
    { label: 'us-central1 (Iowa)', value: 'us-central1' },
    { label: 'us-east4 (N. Virginia)', value: 'us-east4' },
    { label: 'us-east1 (S. Carolina)', value: 'us-east1' },
    { label: 'us-west1 (Oregon)', value: 'us-west1' },
    { label: 'us-west4 (Las Vegas)', value: 'us-west4' },
    { label: 'europe-west1 (Belgium)', value: 'europe-west1' },
    { label: 'europe-west2 (London)', value: 'europe-west2' },
    { label: 'europe-west4 (Netherlands)', value: 'europe-west4' },
    { label: 'asia-east1 (Taiwan)', value: 'asia-east1' },
    { label: 'asia-northeast1 (Tokyo)', value: 'asia-northeast1' },
    { label: 'asia-northeast3 (Seoul)', value: 'asia-northeast3' },
    { label: 'asia-southeast1 (Singapore)', value: 'asia-southeast1' },
    { label: 'australia-southeast1 (Sydney)', value: 'australia-southeast1' },
  ];

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const handleSaveConfigs = () => {
    localStorage.setItem('theme', theme);
    localStorage.setItem('vertexApiKey', apiKey);
    localStorage.setItem('vertexModel', model);
    localStorage.setItem('backendUrl', backendUrl);
    localStorage.setItem('driveScriptUrl', driveScriptUrl);
    localStorage.setItem('vertexRegion', vertexRegion);
    localStorage.setItem('gcpProjectId', gcpProjectId);
    localStorage.setItem('vertexBearerToken', bearerToken);
    localStorage.setItem('googleClientId', googleClientId);
    alert('Settings saved successfully!');
  };

  const handleThemeChange = (newTheme: string) => {
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', width: '100%' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Settings</h1>
        <p>Manage your account and tool preferences</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        <Card>
          <h3 style={{ marginBottom: '1.5rem' }}>Appearance</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div 
              onClick={() => handleThemeChange('light')}
              style={{ 
                padding: '1.5rem', borderRadius: 'var(--radius-md)', 
                cursor: 'pointer', textAlign: 'center', fontWeight: 500,
                border: theme === 'light' ? '2px solid var(--accent-color)' : '1px solid var(--border-color)',
                backgroundColor: '#ffffff', color: '#09090b'
              }}
            >
              Light Mode
            </div>
            <div 
              onClick={() => handleThemeChange('dark')}
              style={{ 
                padding: '1.5rem', borderRadius: 'var(--radius-md)', 
                cursor: 'pointer', textAlign: 'center', fontWeight: 500,
                border: theme === 'dark' ? '2px solid var(--accent-color)' : '1px solid var(--border-color)',
                backgroundColor: '#09090b', color: '#fafafa'
              }}
            >
              Dark Mode
            </div>
          </div>
        </Card>

        <Card>
          <h3 style={{ marginBottom: '1.5rem' }}>API Configuration</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <Input 
              label="Vertex AI API Key" 
              type="password" 
              placeholder="AQ.Ab8RN6K..." 
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <Input 
              label="Vertex AI Model Name" 
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            <Input 
              label="Cloud Run Backend URL (PPT Parser)" 
              value={backendUrl}
              onChange={(e) => setBackendUrl(e.target.value)}
            />
            <Input
              label="GCP Project ID"
              placeholder="my-project-12345"
              value={gcpProjectId}
              onChange={(e) => setGcpProjectId(e.target.value)}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>Vertex AI Region</label>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>
                Express Mode (API Key) 期間地區無效。選地區需搭配 Bearer Token + GCP Project ID。
              </p>
              <select
                value={vertexRegion}
                onChange={e => setVertexRegion(e.target.value)}
                style={{
                  padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)', background: 'var(--card-bg)',
                  color: 'var(--text-primary)', fontSize: '0.875rem', cursor: 'pointer'
                }}
              >
                {VERTEX_REGIONS.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            <Input
              label="Google OAuth2 Client ID（自動刷新 Token 用）"
              placeholder="123456789-xxx.apps.googleusercontent.com"
              value={googleClientId}
              onChange={(e) => setGoogleClientId(e.target.value)}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>Bearer Token（地區端點用）</label>
              <p style={{ fontSize: '0.75rem', color: tokenExpiry && tokenExpiry > Date.now() ? 'var(--success-color, #16a34a)' : 'var(--text-secondary)', margin: 0 }}>
                {tokenExpiry && tokenExpiry > Date.now()
                  ? `✓ 有效，剩餘 ${Math.round((tokenExpiry - Date.now()) / 60000)} 分鐘`
                  : '未設定或已過期'}
              </p>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="password"
                  placeholder="ya29.a0AfB_by... （或點右側按鈕自動取得）"
                  value={bearerToken}
                  onChange={(e) => setBearerToken(e.target.value)}
                  style={{
                    flex: 1, padding: '0.5rem 0.75rem',
                    borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)',
                    background: 'var(--card-bg)', color: 'var(--text-primary)', fontSize: '0.875rem'
                  }}
                />
                <Button
                  onClick={() => {
                    const clientId = googleClientId || localStorage.getItem('googleClientId') || '';
                    if (!clientId) return alert('請先填入 Google OAuth2 Client ID');
                    const google = (window as any).google;
                    if (!google?.accounts?.oauth2) return alert('Google Identity Services 尚未載入，請重新整理頁面');
                    const client = google.accounts.oauth2.initTokenClient({
                      client_id: clientId,
                      scope: 'https://www.googleapis.com/auth/cloud-platform',
                      callback: (resp: any) => {
                        if (resp.error) return alert('OAuth 錯誤：' + resp.error);
                        const token = resp.access_token;
                        const expiry = Date.now() + (resp.expires_in || 3600) * 1000;
                        setBearerToken(token);
                        setTokenExpiry(expiry);
                        localStorage.setItem('vertexBearerToken', token);
                        localStorage.setItem('vertexTokenExpiry', String(expiry));
                        alert('✓ Token 已刷新，有效 1 小時');
                      }
                    });
                    client.requestAccessToken();
                  }}
                >
                  刷新 Token
                </Button>
              </div>
            </div>
            <Input 
              label="Google Drive Backup (Apps Script URL)"
              placeholder="https://script.google.com/macros/s/.../exec"
              value={driveScriptUrl}
              onChange={(e) => setDriveScriptUrl(e.target.value)}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button onClick={handleSaveConfigs}>Save Configuration</Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

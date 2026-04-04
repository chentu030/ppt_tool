import React, { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';

export const Settings: React.FC = () => {
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light');
  const [apiKey, setApiKey] = useState(localStorage.getItem('vertexApiKey') || localStorage.getItem('geminiApiKey') || import.meta.env.VITE_VERTEX_API_KEY || '');
  const [model, setModel] = useState(localStorage.getItem('vertexModel') || localStorage.getItem('geminiModel') || 'gemini-3.1-flash-image-preview');

  const GEMINI_MODELS = [
    { label: 'gemini-3.1-flash-image-preview（預設，快速）', value: 'gemini-3.1-flash-image-preview' },
    { label: 'gemini-3-pro-image-preview（高品質）', value: 'gemini-3-pro-image-preview' },
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
    localStorage.setItem('geminiApiKey', apiKey);
    localStorage.setItem('vertexModel', model);
    localStorage.setItem('geminiModel', model);
    alert('設定已儲存！');
  };

  const handleThemeChange = (newTheme: string) => {
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', width: '100%' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>設定</h1>
        <p>管理你的帳號與工具偏好</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        <Card>
          <h3 style={{ marginBottom: '1.5rem' }}>外觀</h3>
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
              淺色模式
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
              深色模式
            </div>
          </div>
        </Card>

        <Card>
          <h3 style={{ marginBottom: '1.5rem' }}>API 設定</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <Input
              label="Gemini API Key"
              type="password"
              placeholder="AIza..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>Gemini 模型</label>
              <select
                value={model}
                onChange={e => setModel(e.target.value)}
                style={{
                  padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)', background: 'var(--card-bg)',
                  color: 'var(--text-primary)', fontSize: '0.875rem', cursor: 'pointer'
                }}
              >
                {GEMINI_MODELS.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button onClick={handleSaveConfigs}>儲存設定</Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

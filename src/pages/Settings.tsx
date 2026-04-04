import React, { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { showAlert } from '../utils/dialog';

const USD_TO_TWD = 32;
const tw = (usd: number) => `NT$${(usd * USD_TO_TWD).toFixed(1)}`;

const PRICING_INFO = [
  {
    model: 'Gemini 3.1 Flash Image',
    rows: [
      { label: '每張圖 1K', usd: 0.067 },
      { label: '每張圖 2K', usd: 0.101 },
      { label: '每張圖 4K', usd: 0.151 },
    ],
  },
  {
    model: 'Gemini 3 Pro Image',
    rows: [
      { label: '每張圖 1K / 2K', usd: 0.134 },
      { label: '每張圖 4K', usd: 0.24 },
    ],
  },
];

export const Settings: React.FC = () => {
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light');
  const [apiKey, setApiKey] = useState(localStorage.getItem('geminiApiKey') || '');
  const [model, setModel] = useState(localStorage.getItem('vertexModel') || localStorage.getItem('geminiModel') || 'gemini-3.1-flash-image-preview');
  const [showPricingModal, setShowPricingModal] = useState(false);

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

  const doSave = async (saveKey: boolean) => {
    localStorage.setItem('theme', theme);
    if (saveKey) {
      localStorage.setItem('geminiApiKey', apiKey);
    } else {
      localStorage.removeItem('geminiApiKey');
    }
    localStorage.setItem('vertexModel', model);
    localStorage.setItem('geminiModel', model);
    setShowPricingModal(false);
    await showAlert(saveKey ? '設定已儲存！將使用您自己的 Gemini API Key。' : '設定已儲存！將使用預設 Vertex API（您的 API Key 未啟用）。', '設定已儲存');
  };

  const handleSaveConfigs = () => {
    localStorage.setItem('theme', theme);
    localStorage.setItem('vertexModel', model);
    localStorage.setItem('geminiModel', model);
    if (apiKey.trim()) {
      setShowPricingModal(true);
    } else {
      localStorage.removeItem('geminiApiKey');
      showAlert('設定已儲存！將使用預設 Vertex API。', '設定已儲存');
    }
  };

  const handleThemeChange = (newTheme: string) => {
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
  };

  const tdStyle: React.CSSProperties = { padding: '0.4rem 0.75rem', borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem' };
  const thStyle: React.CSSProperties = { ...tdStyle, fontWeight: 700, textAlign: 'left', background: 'var(--bg-secondary)' };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', width: '100%' }}>
      {/* Pricing Confirmation Modal */}
      {showPricingModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', boxShadow: '0 16px 48px rgba(0,0,0,0.3)', padding: '1.75rem', width: '520px', maxWidth: '100%', maxHeight: '85vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>⚠️ 使用自己的 Gemini API Key 前請確認費用</h3>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              使用您自己的 API Key 將由 <strong>Google 直接向您計費</strong>。以下為最新官方定價（匯率約 1 USD ≈ {USD_TO_TWD} TWD）：
            </p>
            {PRICING_INFO.map(info => (
              <div key={info.model}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.4rem' }}>{info.model}</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid var(--border-color)', borderRadius: '6px', overflow: 'hidden' }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>規格</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>美元 (USD)</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>台幣 (TWD)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {info.rows.map(row => (
                      <tr key={row.label}>
                        <td style={tdStyle}>{row.label}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>${row.usd.toFixed(3)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{tw(row.usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              若不確定，建議取消並繼續使用<strong>預設 Vertex API</strong>（由平台提供，不需額外付費）。
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
              <Button onClick={() => doSave(false)}>取消，使用預設 Vertex API</Button>
              <Button onClick={() => doSave(true)}>確認，使用我自己的 API Key</Button>
            </div>
          </div>
        </div>
      )}

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
            <div>
              <Input
                label="Gemini API Key（選填，留空則使用平台預設）"
                type="password"
                placeholder="AIza... （留空 = 使用預設 Vertex API）"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              {apiKey.trim() && (
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: '#d97706' }}>
                  ⚠️ 已填入自訂 API Key，儲存後將向您的 Google 帳號計費。
                </p>
              )}
            </div>
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

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
  const [channel, setChannel] = useState<'platform' | 'gemini' | 'vertex'>(
    (localStorage.getItem('apiChannel') as 'platform' | 'gemini' | 'vertex') || 'platform'
  );
  const [geminiApiKey, setGeminiApiKey] = useState(localStorage.getItem('geminiApiKey') || '');
  const [vertexApiKey, setVertexApiKey] = useState(localStorage.getItem('vertexApiKey') || '');
  const [model, setModel] = useState(localStorage.getItem('vertexModel') || localStorage.getItem('geminiModel') || 'gemini-3.1-flash-image-preview');
  const [showPricingModal, setShowPricingModal] = useState(false);

  const GEMINI_MODELS = [
    { label: 'gemini-3.1-flash-image-preview（預設，快速）', value: 'gemini-3.1-flash-image-preview' },
    { label: 'gemini-3-pro-image-preview（高品質）', value: 'gemini-3-pro-image-preview' },
  ];

  const CHANNEL_OPTIONS: { value: 'platform' | 'gemini' | 'vertex'; label: string; desc: string }[] = [
    { value: 'platform', label: '平台預設（Vertex）', desc: '使用平台提供的 Vertex API，不需額外設定' },
    { value: 'gemini',   label: '自訂 Gemini API', desc: '使用自己的 Gemini API Key（從 AI Studio 取得，走 generativelanguage 通道）' },
    { value: 'vertex',   label: '自訂 Vertex AI', desc: '使用自己的 Vertex AI API Key（走 aiplatform Express Mode 通道）' },
  ];

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const doSave = async (confirmKey: boolean) => {
    localStorage.setItem('theme', theme);
    localStorage.setItem('apiChannel', channel);
    localStorage.setItem('vertexModel', model);
    localStorage.setItem('geminiModel', model);
    if (confirmKey) {
      if (channel === 'gemini') localStorage.setItem('geminiApiKey', geminiApiKey);
      if (channel === 'vertex') localStorage.setItem('vertexApiKey', vertexApiKey);
    } else {
      // User cancelled — revert to platform
      setChannel('platform');
      localStorage.setItem('apiChannel', 'platform');
    }
    setShowPricingModal(false);
    const msgs: Record<string, string> = {
      platform: '設定已儲存！將使用平台預設 API。',
      gemini: '設定已儲存！將使用您自己的 Gemini API Key。',
      vertex: '設定已儲存！將使用您自己的 Vertex AI API Key。',
    };
    await showAlert(confirmKey ? msgs[channel] : msgs['platform'], '設定已儲存');
  };

  const handleSaveConfigs = () => {
    localStorage.setItem('theme', theme);
    localStorage.setItem('vertexModel', model);
    localStorage.setItem('geminiModel', model);
    if (channel === 'gemini' && !geminiApiKey.trim()) {
      showAlert('請輸入 Gemini API Key，或切換回「平台預設」。', '缺少 API Key');
      return;
    }
    if (channel === 'vertex' && !vertexApiKey.trim()) {
      showAlert('請輸入 Vertex AI API Key，或切換回「平台預設」。', '缺少 API Key');
      return;
    }
    const hasCustomKey = channel === 'gemini' || channel === 'vertex';
    if (hasCustomKey) {
      setShowPricingModal(true);
    } else {
      localStorage.setItem('apiChannel', 'platform');
      localStorage.removeItem('geminiApiKey');
      localStorage.removeItem('vertexApiKey');
      showAlert('設定已儲存！將使用平台預設 Vertex API。', '設定已儲存');
    }
  };

  const handleThemeChange = (newTheme: string) => {
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
  };

  const tdStyle: React.CSSProperties = { padding: '0.4rem 0.75rem', borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem' };
  const thStyle: React.CSSProperties = { ...tdStyle, fontWeight: 700, textAlign: 'left', background: 'var(--bg-secondary)' };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', width: '100%', padding: '1rem 0' }}>
      {/* Pricing Confirmation Modal */}
      {showPricingModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-float)', padding: '2rem', width: '560px', maxWidth: '100%', maxHeight: '85vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>⚠️ 使用自己的 API Key 前請確認費用</h3>
            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              使用您自己的 API Key 將由 <strong>Google 直接向您計費</strong>。
              {channel === 'gemini' && ' 通道：Gemini API（generativelanguage.googleapis.com）'}
              {channel === 'vertex' && ' 通道：Vertex AI Express Mode（aiplatform.googleapis.com）'}
              。以下為最新官方定價（匯率約 1 USD ≈ {USD_TO_TWD} TWD）：
            </p>
            {PRICING_INFO.map(info => (
              <div key={info.model}>
                <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.5rem', color: 'var(--accent-color)' }}>{info.model}</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid var(--border-color)', borderRadius: '0.5rem', overflow: 'hidden' }}>
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
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)', background: 'var(--bg-secondary)', padding: '0.75rem', borderRadius: '0.5rem' }}>
              若不確定，建議取消並繼續使用<strong>平台預設</strong>（不需額外付費）。
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <Button variant="secondary" onClick={() => doSave(false)} style={{ borderRadius: '0.5rem', fontWeight: 600 }}>取消，使用平台預設</Button>
              <Button onClick={() => doSave(true)} style={{ borderRadius: '0.5rem', fontWeight: 600 }}>確認，使用我自己的 API Key</Button>
            </div>
          </div>
        </div>
      )}

      <div style={{ marginBottom: '2.5rem' }}>
        <h1 style={{ fontSize: '1.8rem', fontWeight: 800, marginBottom: '0.5rem', letterSpacing: '-0.02em' }}>設定</h1>
        <p style={{ fontSize: '0.95rem', color: 'var(--text-secondary)' }}>管理你的帳號與工具偏好</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <Card style={{ borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border-color)' }}>
          <h3 style={{ marginBottom: '1.5rem', fontSize: '1.1rem', fontWeight: 700 }}>外觀</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div
              onClick={() => handleThemeChange('light')}
              style={{
                padding: '1.5rem', borderRadius: 'var(--radius-md)',
                cursor: 'pointer', textAlign: 'center', fontWeight: 600, fontSize: '0.95rem',
                border: theme === 'light' ? '2px solid var(--accent-color)' : '1px solid var(--border-color)',
                backgroundColor: '#ffffff', color: '#1e1e2d',
                boxShadow: theme === 'light' ? '0 4px 12px rgba(99, 102, 241, 0.15)' : 'none',
                transition: 'all 0.2s ease'
              }}
            >
              淺色模式
            </div>
            <div
              onClick={() => handleThemeChange('dark')}
              style={{
                padding: '1.5rem', borderRadius: 'var(--radius-md)',
                cursor: 'pointer', textAlign: 'center', fontWeight: 600, fontSize: '0.95rem',
                border: theme === 'dark' ? '2px solid var(--accent-color)' : '1px solid var(--border-color)',
                backgroundColor: '#09090b', color: '#fafafa',
                boxShadow: theme === 'dark' ? '0 4px 12px rgba(99, 102, 241, 0.15)' : 'none',
                transition: 'all 0.2s ease'
              }}
            >
              深色模式
            </div>
          </div>
        </Card>

        <Card style={{ borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border-color)' }}>
          <h3 style={{ marginBottom: '1.5rem', fontSize: '1.1rem', fontWeight: 700 }}>API 設定</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

            {/* Channel selector */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>API 通道</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                {CHANNEL_OPTIONS.map(opt => (
                  <div
                    key={opt.value}
                    onClick={() => setChannel(opt.value)}
                    style={{
                      padding: '1rem', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                      border: channel === opt.value ? '2px solid var(--accent-color)' : '1px solid var(--border-color)',
                      backgroundColor: channel === opt.value ? 'var(--accent-light)' : 'var(--bg-secondary)',
                      transition: 'all 0.2s ease',
                      boxShadow: channel === opt.value ? '0 4px 12px rgba(99, 102, 241, 0.12)' : 'none'
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.3rem', color: channel === opt.value ? 'var(--accent-color)' : 'var(--text-primary)' }}>{opt.label}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{opt.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Gemini API Key */}
            {channel === 'gemini' && (
              <div>
                <Input
                  label="Gemini API Key"
                  type="password"
                  placeholder="AIza..."
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  style={{ borderRadius: '0.5rem', background: 'var(--bg-secondary)' }}
                />
                <p style={{ margin: '0.5rem 0 0', fontSize: '0.8rem', color: '#d97706', fontWeight: 500 }}>
                  ⚠️ 使用自訂 API Key 將由 Google 直接向您計費（走 generativelanguage.googleapis.com）。
                </p>
              </div>
            )}

            {/* Vertex AI API Key */}
            {channel === 'vertex' && (
              <div>
                <Input
                  label="Vertex AI API Key"
                  type="password"
                  placeholder="AIza..."
                  value={vertexApiKey}
                  onChange={(e) => setVertexApiKey(e.target.value)}
                  style={{ borderRadius: '0.5rem', background: 'var(--bg-secondary)' }}
                />
                <p style={{ margin: '0.5rem 0 0', fontSize: '0.8rem', color: '#d97706', fontWeight: 500 }}>
                  ⚠️ 使用自訂 API Key 將由 Google 直接向您計費（走 aiplatform.googleapis.com Express Mode）。
                </p>
              </div>
            )}

            {/* Platform default hint */}
            {channel === 'platform' && (
              <div style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '0.5rem', border: '1px solid var(--border-color)' }}>
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  使用平台提供的 Vertex API，不需要輸入任何 Key。
                </p>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Gemini 模型</label>
              <select
                value={model}
                onChange={e => setModel(e.target.value)}
                style={{
                  padding: '0.6rem 0.8rem', borderRadius: '0.5rem',
                  border: '1px solid var(--border-color)', background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)', fontSize: '0.9rem', cursor: 'pointer', outline: 'none'
                }}
              >
                {GEMINI_MODELS.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
              <Button onClick={handleSaveConfigs} style={{ borderRadius: '0.5rem', fontWeight: 600, boxShadow: '0 4px 12px rgba(99, 102, 241, 0.25)', padding: '0.6rem 1.5rem' }}>儲存設定</Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

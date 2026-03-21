import React, { useRef, useState } from 'react';
import { X, Upload, Sparkles, Loader } from 'lucide-react';

export interface TemplateSettings {
  fontFamily?: string;
  mainColor?: string;
  highlightColor?: string;
  specialMark?: string;
  extraPrompt?: string;
}

const TEMPLATE_SETTINGS: Record<number, TemplateSettings> = {
  1:  { fontFamily: '襯線體',    mainColor: '黑色',      highlightColor: '黑底白字' },
  2:  { fontFamily: 'Noto Sans', mainColor: '黑色',      highlightColor: '黑字加底線', extraPrompt: '真實照片風景圖去背加文字，圖可以有山、植物、樹、森林、葉子、花朵、種子、動植物等等' },
  3:  { fontFamily: 'Noto Sans', mainColor: '黑色',      highlightColor: '黑底白字',   extraPrompt: '3d物體用真實的植物或相關物品(跟該投影片相關，元素不要太多，不要太複雜太花俏)(例如只要一個樹枝或葉子或花或果實或種子，任何植物都可以，碳匯、esg元素也可以，用有顏色的，不要全純黑)，小插圖用純黑色線條，不准出現任何香蕉(或有香蕉的元素)' },
  4:  { fontFamily: '襯線體',    mainColor: '黑色',      highlightColor: '金黃色' },
  5:  { fontFamily: '等寬長字',  mainColor: '白色',      highlightColor: '黃色' },
  6:  { fontFamily: 'Noto Sans', mainColor: '黑色',      highlightColor: '紫色' },
  7:  { fontFamily: 'Noto Sans', mainColor: '黑色或白色',highlightColor: '黃色' },
  8:  { fontFamily: '草寫體',    mainColor: '灰色',      highlightColor: '白色' },
  9:  { fontFamily: 'Noto Sans', mainColor: '白色',      highlightColor: '白底黑字' },
  10: { fontFamily: '襯線體',    mainColor: '深黑綠色',  highlightColor: '深黑綠色加底線' },
  11: { fontFamily: 'Noto Sans', mainColor: '深黑藍色',  highlightColor: '白字藍底' },
  13: { fontFamily: '襯線體',    mainColor: '黑色',      highlightColor: '淺棕色' },
};

const TOTAL = 36;
const ANALYSIS_MODEL = 'gemini-3-flash-preview';

export interface ApplyParams {
  imageUrl: string;
  settings: TemplateSettings | null;
  resolvedExtraPrompt: string | null;
}

interface Props {
  currentExtraPrompt: string;
  onClose: () => void;
  onApply: (params: ApplyParams) => void;
}

type ConflictChoice = 'replace' | 'merge' | 'keep';

const TemplateGalleryModal: React.FC<Props> = ({ currentExtraPrompt, onClose, onApply }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Conflict resolution for templates WITH preset extraPrompt
  const [conflictPending, setConflictPending] = useState<{ imageUrl: string; settings: TemplateSettings } | null>(null);
  // Gemini prompt for all templates and user-uploaded images
  const [geminiPending, setGeminiPending] = useState<{ imageUrl: string; existingSettings: TemplateSettings | null } | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // --- helpers ---

  const finalizeApply = (imageUrl: string, settings: TemplateSettings | null, extraPrompt: string | null) => {
    onApply({ imageUrl, settings, resolvedExtraPrompt: extraPrompt });
  };

  const checkConflictAndApply = (imageUrl: string, settings: TemplateSettings) => {
    if (settings.extraPrompt && currentExtraPrompt.trim()) {
      setConflictPending({ imageUrl, settings });
    } else {
      finalizeApply(imageUrl, settings, settings.extraPrompt ?? null);
    }
  };

  // Entry point when a template is clicked — always offer Gemini to fill in missing fields
  const handleTemplateClick = (imageUrl: string, settings: TemplateSettings | null) => {
    setAnalyzeError(null);
    setGeminiPending({ imageUrl, existingSettings: settings });
  };

  // User uploaded their own image
  const handleUploadOwn = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setAnalyzeError(null);
      setGeminiPending({ imageUrl: dataUrl, existingSettings: null });
    };
    reader.readAsDataURL(file);
  };

  // Skip Gemini — apply with preset settings only (or nothing for user uploads)
  const skipGemini = () => {
    if (!geminiPending) return;
    const { imageUrl, existingSettings } = geminiPending;
    if (existingSettings !== null) {
      checkConflictAndApply(imageUrl, existingSettings);
    } else {
      finalizeApply(imageUrl, null, null);
    }
  };

  // Call Gemini 2.5 Flash to analyse the image and suggest settings
  const runGeminiAnalysis = async () => {
    if (!geminiPending) return;
    const apiKey = localStorage.getItem('vertexApiKey') || localStorage.getItem('geminiApiKey') || '';
    if (!apiKey) {
      setAnalyzeError('找不到 API Key（請先在設定中填入 Gemini API Key）');
      return;
    }
    setIsAnalyzing(true);
    setAnalyzeError(null);
    try {
      // Convert URL to base64 if needed
      let base64: string;
      let mimeType = 'image/jpeg';
      const { imageUrl, existingSettings } = geminiPending;
      if (imageUrl.startsWith('data:')) {
        const [header, data] = imageUrl.split(',');
        base64 = data;
        mimeType = header.match(/data:([^;]+)/)?.[1] ?? 'image/jpeg';
      } else {
        const resp = await fetch(imageUrl);
        const blob = await resp.blob();
        mimeType = blob.type || 'image/jpeg';
        base64 = await new Promise<string>((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res((fr.result as string).split(',')[1]);
          fr.onerror = rej;
          fr.readAsDataURL(blob);
        });
      }

      const prompt = `請仔細分析這張投影片或設計風格圖的視覺風格，然後以 JSON 格式回傳建議的投影片設計設定。
只回傳 JSON，不要有任何其他文字。格式如下：
{
  "fontFamily": "字體風格（如：Noto Sans、襯線體、等寬長字、草寫體）",
  "mainColor": "主要文字顏色（如：黑色、白色、深藍色、灰色）",
  "highlightColor": "重點標示方式（如：金黃色、黑底白字、黑字加底線、紫色、白字藍底）",
  "specialMark": "特殊標記說明，若無則填「無」",
  "extraPrompt": "描述這個設計風格的視覺特點，給 AI 生成投影片圖片使用（中文，50~150字）"
}`;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${ANALYSIS_MODEL}:generateContent?key=${apiKey}`;
      const body = {
        contents: [{ parts: [{ inlineData: { mimeType, data: base64 } }, { text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      };
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini API 錯誤 ${res.status}: ${errText.slice(0, 200)}`);
      }
      const json = await res.json();
      const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
      const geminiSettings: TemplateSettings = JSON.parse(raw.replace(/```json|```/g, '').trim());
      // Preset settings override Gemini's output for fields already defined
      const merged: TemplateSettings = existingSettings
        ? { ...geminiSettings, ...existingSettings }
        : geminiSettings;
      setGeminiPending(null);
      setIsAnalyzing(false);
      checkConflictAndApply(imageUrl, merged);
    } catch (err: any) {
      setIsAnalyzing(false);
      setAnalyzeError(String(err?.message ?? err));
    }
  };

  // Conflict resolution
  const resolveConflict = (choice: ConflictChoice) => {
    if (!conflictPending) return;
    const newPrompt = conflictPending.settings?.extraPrompt ?? '';
    let resolved: string;
    if (choice === 'replace') resolved = newPrompt;
    else if (choice === 'merge') resolved = currentExtraPrompt.trim() + '\n' + newPrompt;
    else resolved = currentExtraPrompt;
    finalizeApply(conflictPending.imageUrl, conflictPending.settings, resolved);
  };

  // --- styles ---
  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 2000,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
  };
  const modal: React.CSSProperties = {
    background: 'var(--bg-primary)', borderRadius: '1.1rem', width: '100%', maxWidth: '860px',
    maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    boxShadow: '0 16px 50px rgba(0,0,0,0.35)',
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
          <span style={{ fontWeight: 700, fontSize: '1rem' }}>選擇風格範本</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.9rem', fontSize: '0.82rem', fontWeight: 600, borderRadius: '0.55rem', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', cursor: 'pointer', color: 'var(--text-primary)' }}>
              <Upload size={14} /> 上傳自己的圖片
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleUploadOwn} />
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '0.25rem' }}><X size={18} /></button>
          </div>
        </div>

        {/* Gemini analysis prompt */}
        {geminiPending && (
          <div style={{ padding: '1rem 1.25rem', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
              {/* Preview */}
              <img src={geminiPending.imageUrl} alt="preview" style={{ width: '90px', height: '60px', objectFit: 'cover', borderRadius: '0.4rem', border: '1px solid var(--border-color)', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <p style={{ margin: '0 0 0.4rem', fontWeight: 700, fontSize: '0.9rem' }}>
                  <Sparkles size={14} style={{ verticalAlign: 'middle', marginRight: '0.3rem', color: 'var(--accent-color)' }} />
                  要用 Gemini 2.0 Flash 分析圖片並自動填入設定嗎？
                </p>
                <p style={{ margin: '0 0 0.75rem', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {geminiPending?.existingSettings
                    ? 'Gemini 會補齊未設定的欄位（已有的預設設定會保留）。'
                    : 'Gemini 會根據圖片風格建議字體、顏色、重點標示方式及額外提示詞。'}
                  {currentExtraPrompt.trim() && <><br />（已有額外提示詞，套用後會詢問是否合併）</>}
                </p>
                {analyzeError && (
                  <p style={{ margin: '0 0 0.6rem', fontSize: '0.78rem', color: '#e53e3e', background: 'rgba(229,62,62,0.08)', borderRadius: '0.35rem', padding: '0.35rem 0.6rem' }}>
                    ⚠ {analyzeError}
                  </p>
                )}
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <button
                    onClick={runGeminiAnalysis}
                    disabled={isAnalyzing}
                    style={conflictBtnStyle('var(--accent-color)', '#fff', isAnalyzing)}>
                    {isAnalyzing
                      ? <><Loader size={13} style={{ animation: 'spin 1s linear infinite', marginRight: '0.3rem', verticalAlign: 'middle' }} />分析中...</>
                      : <><Sparkles size={13} style={{ marginRight: '0.3rem', verticalAlign: 'middle' }} />是，自動分析</>}
                  </button>
                  <button onClick={skipGemini} disabled={isAnalyzing} style={conflictBtnStyle('var(--bg-primary)', 'var(--text-secondary)', isAnalyzing)}>
                    不用，直接套用圖片
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Conflict dialog (extraPrompt clash) */}
        {conflictPending && (
          <div style={{ padding: '0.9rem 1.25rem', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
            <p style={{ margin: '0 0 0.6rem', fontSize: '0.88rem', fontWeight: 600 }}>你已有額外提示詞，要怎麼處理？</p>
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              <strong>新提示詞：</strong>{conflictPending.settings?.extraPrompt}
            </p>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              <button onClick={() => resolveConflict('replace')} style={conflictBtnStyle('var(--accent-color)', '#fff')}>取代（使用新提示詞）</button>
              <button onClick={() => resolveConflict('merge')}   style={conflictBtnStyle('var(--bg-primary)', 'var(--text-primary)')}>合併（原本 + 新）</button>
              <button onClick={() => resolveConflict('keep')}    style={conflictBtnStyle('var(--bg-primary)', 'var(--text-secondary)')}>保留原本</button>
            </div>
          </div>
        )}

        {/* Masonry grid */}
        <div style={{ overflowY: 'auto', padding: '1rem 1.25rem', columnCount: 3, columnGap: '0.75rem' }}>
          {Array.from({ length: TOTAL }, (_, i) => i + 1).map(n => {
            const settings = TEMPLATE_SETTINGS[n] ?? null;
            const imgUrl = `/templates/${n}.jpg`;
            return (
              <button
                key={n}
                onClick={() => handleTemplateClick(imgUrl, settings)}
                style={{ padding: 0, border: '2px solid var(--border-color)', borderRadius: '0.6rem', cursor: 'pointer', background: 'none', overflow: 'hidden', display: 'inline-flex', flexDirection: 'column', textAlign: 'left', transition: 'border-color 0.15s', width: '100%', marginBottom: '0.75rem', breakInside: 'avoid' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent-color)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-color)')}>
                <img src={imgUrl} alt={`範本 ${n}`} style={{ width: '100%', height: 'auto', display: 'block' }} />
                <div style={{ padding: '0.35rem 0.5rem', fontSize: '0.7rem', color: 'var(--text-secondary)', background: 'var(--bg-secondary)', width: '100%', boxSizing: 'border-box' }}>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{n}</span>
                  {settings ? (
                    <span style={{ marginLeft: '0.3rem' }}>{settings.fontFamily} · {settings.highlightColor}</span>
                  ) : (
                    <span style={{ marginLeft: '0.3rem', color: 'var(--accent-color)', fontStyle: 'italic' }}>
                      <Sparkles size={10} style={{ verticalAlign: 'middle', marginRight: '0.2rem' }} />僅圖片
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const conflictBtnStyle = (bg: string, color: string, disabled = false): React.CSSProperties => ({
  padding: '0.4rem 0.85rem', fontSize: '0.8rem', fontWeight: 600, borderRadius: '0.45rem',
  border: '1px solid var(--border-color)', background: bg, color, cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.6 : 1, display: 'inline-flex', alignItems: 'center',
});

export default TemplateGalleryModal;

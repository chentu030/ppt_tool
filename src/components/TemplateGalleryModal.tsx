import React, { useRef, useState } from 'react';
import { X, Upload } from 'lucide-react';

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
  const [pending, setPending] = useState<{ imageUrl: string; settings: TemplateSettings | null } | null>(null);

  const tryApply = (imageUrl: string, settings: TemplateSettings | null) => {
    const hasNewPrompt = !!(settings?.extraPrompt);
    const hasOldPrompt = !!currentExtraPrompt.trim();
    if (hasNewPrompt && hasOldPrompt) {
      setPending({ imageUrl, settings });
    } else {
      onApply({ imageUrl, settings, resolvedExtraPrompt: settings?.extraPrompt ?? null });
    }
  };

  const resolveConflict = (choice: ConflictChoice) => {
    if (!pending) return;
    const newPrompt = pending.settings?.extraPrompt ?? '';
    let resolved: string;
    if (choice === 'replace') resolved = newPrompt;
    else if (choice === 'merge') resolved = currentExtraPrompt.trim() + '\n' + newPrompt;
    else resolved = currentExtraPrompt;
    onApply({ imageUrl: pending.imageUrl, settings: pending.settings, resolvedExtraPrompt: resolved });
  };

  const handleUploadOwn = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      onApply({ imageUrl: dataUrl, settings: null, resolvedExtraPrompt: null });
    };
    reader.readAsDataURL(file);
  };

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

        {/* Conflict dialog */}
        {pending && (
          <div style={{ padding: '0.9rem 1.25rem', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
            <p style={{ margin: '0 0 0.6rem', fontSize: '0.88rem', fontWeight: 600 }}>你已有額外提示詞，要怎麼處理？</p>
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              <strong>範本提示詞：</strong>{pending.settings?.extraPrompt}
            </p>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              <button onClick={() => resolveConflict('replace')} style={conflictBtnStyle('var(--accent-color)', '#fff')}>取代（使用範本提示詞）</button>
              <button onClick={() => resolveConflict('merge')}   style={conflictBtnStyle('var(--bg-primary)', 'var(--text-primary)')}>合併（原本 + 範本）</button>
              <button onClick={() => resolveConflict('keep')}    style={conflictBtnStyle('var(--bg-primary)', 'var(--text-secondary)')}>保留原本</button>
            </div>
          </div>
        )}

        {/* Grid */}
        <div style={{ overflowY: 'auto', padding: '1rem 1.25rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem' }}>
          {Array.from({ length: TOTAL }, (_, i) => i + 1).map(n => {
            const settings = TEMPLATE_SETTINGS[n] ?? null;
            const imgUrl = `/templates/${n}.jpg`;
            return (
              <button
                key={n}
                onClick={() => tryApply(imgUrl, settings)}
                style={{ padding: 0, border: '2px solid var(--border-color)', borderRadius: '0.6rem', cursor: 'pointer', background: 'none', overflow: 'hidden', display: 'flex', flexDirection: 'column', textAlign: 'left', transition: 'border-color 0.15s', position: 'relative' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent-color)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-color)')}>
                <img src={imgUrl} alt={`範本 ${n}`} style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }} />
                <div style={{ padding: '0.4rem 0.5rem', fontSize: '0.72rem', color: 'var(--text-secondary)', background: 'var(--bg-secondary)', width: '100%', boxSizing: 'border-box' }}>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>範本 {n}</span>
                  {settings ? (
                    <span style={{ marginLeft: '0.4rem' }}>{settings.fontFamily} · {settings.highlightColor}</span>
                  ) : (
                    <span style={{ marginLeft: '0.4rem', fontStyle: 'italic' }}>僅圖片</span>
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

const conflictBtnStyle = (bg: string, color: string): React.CSSProperties => ({
  padding: '0.4rem 0.85rem', fontSize: '0.8rem', fontWeight: 600, borderRadius: '0.45rem',
  border: '1px solid var(--border-color)', background: bg, color, cursor: 'pointer',
});

export default TemplateGalleryModal;

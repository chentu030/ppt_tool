import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Paperclip, Image as ImageIcon, X, Loader, Download, Sparkles } from 'lucide-react';
import { chatWithGemini } from '../utils/gemini';
import type { ChatMessage as GeminiChatMessage } from '../utils/gemini';
import TemplateGalleryModal from '../components/TemplateGalleryModal';
import type { ApplyParams } from '../components/TemplateGalleryModal';

interface Attachment { name: string; mimeType: string; dataUrl: string; }
interface ChatMsg {
  id: string; role: 'user' | 'assistant'; text: string;
  images: string[]; attachments: Attachment[]; timestamp: number;
}

export const AIChatPage: React.FC = () => {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [generateImage, setGenerateImage] = useState(false);
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [referenceLabel, setReferenceLabel] = useState('');
  const [showTemplateGallery, setShowTemplateGallery] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const apiKey = localStorage.getItem('geminiApiKey') || '';

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + 'px';
    }
  }, [input]);

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(file); });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files) return;
    const arr: Attachment[] = [];
    for (const f of Array.from(files)) {
      if (f.size > 20 * 1024 * 1024) { alert(`${f.name} 超過 20MB`); continue; }
      arr.push({ name: f.name, mimeType: f.type || 'application/octet-stream', dataUrl: await fileToDataUrl(f) });
    }
    setAttachments(prev => [...prev, ...arr]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleTemplateApply = ({ imageUrl, resolvedExtraPrompt, settings }: ApplyParams) => {
    setShowTemplateGallery(false);
    setReferenceImage(imageUrl);
    setReferenceLabel([settings?.fontFamily, settings?.highlightColor].filter(Boolean).join(' · ') || '已選擇');
    if (resolvedExtraPrompt) setInput(prev => prev || `風格提示：${resolvedExtraPrompt}`);
  };

  const buildHistory = useCallback((msgs: ChatMsg[], userParts: GeminiChatMessage['parts']): GeminiChatMessage[] => {
    const h: GeminiChatMessage[] = [
      { role: 'user', parts: [{ text: '你是專業設計助手，可以整理文件、生成圖卡、回答問題。用繁體中文回答。' }] },
      { role: 'model', parts: [{ text: '好的，我是你的設計助手！請問需要什麼幫助？' }] },
    ];
    for (const m of msgs) {
      if (m.role === 'user') {
        const p: GeminiChatMessage['parts'] = [];
        if (m.text) p.push({ text: m.text });
        for (const a of m.attachments) {
          const b64 = a.dataUrl.includes(',') ? a.dataUrl.split(',')[1] : a.dataUrl;
          p.push({ inlineData: { mimeType: a.mimeType, data: b64 } });
        }
        if (p.length) h.push({ role: 'user', parts: p });
      } else {
        if (m.text) h.push({ role: 'model', parts: [{ text: m.text }] });
      }
    }
    h.push({ role: 'user', parts: userParts });
    return h;
  }, []);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed && attachments.length === 0) return;
    const userMsg: ChatMsg = { id: Date.now().toString(), role: 'user', text: trimmed, images: [], attachments: [...attachments], timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInput(''); setAttachments([]);
    setIsLoading(true);
    const ctrl = new AbortController(); abortRef.current = ctrl;
    try {
      const parts: GeminiChatMessage['parts'] = [];
      if (trimmed) parts.push({ text: trimmed });
      for (const a of userMsg.attachments) {
        const b64 = a.dataUrl.includes(',') ? a.dataUrl.split(',')[1] : a.dataUrl;
        parts.push({ inlineData: { mimeType: a.mimeType, data: b64 } });
      }
      const history = buildHistory(messages, parts);
      const resp = await chatWithGemini(history, apiKey, {
        generateImage, referenceImage, aspectRatio,
      }, ctrl.signal);
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'assistant', text: resp.text, images: resp.images, attachments: [], timestamp: Date.now() }]);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'assistant', text: `❌ 錯誤：${err.message || '未知錯誤'}`, images: [], attachments: [], timestamp: Date.now() }]);
    } finally { setIsLoading(false); abortRef.current = null; }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const downloadImage = (dataUrl: string, idx: number) => {
    const a = document.createElement('a'); a.href = dataUrl; a.download = `ai-card-${idx + 1}.png`; a.click();
  };

  // ── Styles ─────────────────────────────────────────────────────────────
  const bubbleBase: React.CSSProperties = { maxWidth: '80%', padding: '0.75rem 1rem', borderRadius: '1rem', fontSize: '0.88rem', lineHeight: 1.6, wordBreak: 'break-word' };
  const userBubble: React.CSSProperties = { ...bubbleBase, background: 'var(--accent-color)', color: '#fff', borderBottomRightRadius: '0.3rem', marginLeft: 'auto' };
  const aiBubble: React.CSSProperties = { ...bubbleBase, background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderBottomLeftRadius: '0.3rem' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 3rem)', maxWidth: '900px', margin: '0 auto', width: '100%' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 0', borderBottom: '1px solid var(--border-color)', flexShrink: 0, gap: '0.5rem', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Sparkles size={20} color="var(--accent-color)" /> AI 對話設計
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {/* Reference image */}
          {referenceImage ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.3rem 0.6rem', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', fontSize: '0.75rem' }}>
              <img src={referenceImage} alt="ref" style={{ width: '28px', height: '16px', objectFit: 'cover', borderRadius: '3px' }} />
              <span>{referenceLabel || '風格'}</span>
              <button onClick={() => { setReferenceImage(null); setReferenceLabel(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px', color: 'var(--text-secondary)' }}><X size={12} /></button>
            </div>
          ) : null}
          <button onClick={() => setShowTemplateGallery(true)}
            style={{ padding: '0.35rem 0.7rem', fontSize: '0.78rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', cursor: 'pointer', background: 'var(--bg-primary)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <ImageIcon size={13} /> 模板庫
          </button>
          {/* Aspect ratio */}
          <select value={aspectRatio} onChange={e => setAspectRatio(e.target.value)}
            style={{ padding: '0.35rem 0.5rem', fontSize: '0.75rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--bg-primary)', color: 'var(--text-primary)', cursor: 'pointer' }}>
            <option value="16:9">16:9</option><option value="1:1">1:1</option><option value="9:16">9:16</option><option value="4:3">4:3</option>
          </select>
          {/* Generate image toggle */}
          <button onClick={() => setGenerateImage(!generateImage)}
            style={{ padding: '0.35rem 0.7rem', fontSize: '0.78rem', border: `1px solid ${generateImage ? 'var(--accent-color)' : 'var(--border-color)'}`, borderRadius: '0.5rem', cursor: 'pointer', background: generateImage ? 'var(--accent-color)' : 'var(--bg-primary)', color: generateImage ? '#fff' : 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.3rem', fontWeight: generateImage ? 700 : 400 }}>
            <ImageIcon size={13} /> {generateImage ? '圖片模式' : '文字模式'}
          </button>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 0', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {messages.length === 0 && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', color: 'var(--text-secondary)' }}>
            <Sparkles size={48} style={{ opacity: 0.3 }} />
            <p style={{ fontSize: '1rem', fontWeight: 600 }}>開始與 AI 對話</p>
            <div style={{ fontSize: '0.82rem', textAlign: 'center', maxWidth: '400px', lineHeight: 1.7 }}>
              上傳文件讓 AI 整理分析<br />
              描述需求生成精美圖卡<br />
              選擇模板風格套用設計<br />
              切換「圖片模式」生成圖片
            </div>
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            {/* Attachments */}
            {msg.attachments.length > 0 && (
              <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: '0.3rem', maxWidth: '80%', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                {msg.attachments.map((a, i) => (
                  a.mimeType.startsWith('image/') ? (
                    <img key={i} src={a.dataUrl} alt={a.name} onClick={() => setLightbox(a.dataUrl)}
                      style={{ maxHeight: '120px', maxWidth: '200px', borderRadius: '0.5rem', cursor: 'zoom-in', border: '1px solid var(--border-color)' }} />
                  ) : (
                    <div key={i} style={{ padding: '0.4rem 0.6rem', background: 'var(--bg-tertiary)', borderRadius: '0.4rem', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <Paperclip size={11} />{a.name}
                    </div>
                  )
                ))}
              </div>
            )}
            {/* Text bubble */}
            {msg.text && <div style={msg.role === 'user' ? userBubble : aiBubble}><pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 'inherit' }}>{msg.text}</pre></div>}
            {/* AI images */}
            {msg.images.length > 0 && (
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: msg.text ? '0.4rem' : 0, maxWidth: '80%' }}>
                {msg.images.map((img, i) => (
                  <div key={i} style={{ position: 'relative', borderRadius: '0.6rem', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                    <img src={img} alt={`card ${i + 1}`} onClick={() => setLightbox(img)}
                      style={{ maxHeight: '300px', maxWidth: '100%', display: 'block', cursor: 'zoom-in' }} />
                    <button onClick={() => downloadImage(img, i)}
                      style={{ position: 'absolute', bottom: '6px', right: '6px', background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: '50%', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                      <Download size={14} color="#fff" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <span style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', marginTop: '0.15rem', paddingInline: '0.2rem' }}>
              {new Date(msg.timestamp).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        ))}
        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} />
            {generateImage ? 'AI 生成圖片中…' : 'AI 思考中…'}
            <button onClick={() => abortRef.current?.abort()} style={{ marginLeft: '0.5rem', padding: '0.2rem 0.5rem', fontSize: '0.72rem', border: '1px solid var(--border-color)', borderRadius: '0.3rem', cursor: 'pointer', background: 'none', color: 'var(--text-secondary)' }}>取消</button>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Attachment preview */}
      {attachments.length > 0 && (
        <div style={{ display: 'flex', gap: '0.4rem', padding: '0.4rem 0', flexWrap: 'wrap', borderTop: '1px solid var(--border-color)' }}>
          {attachments.map((a, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.3rem 0.5rem', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '0.4rem', fontSize: '0.72rem' }}>
              {a.mimeType.startsWith('image/') ? <img src={a.dataUrl} alt="" style={{ width: '24px', height: '24px', objectFit: 'cover', borderRadius: '3px' }} /> : <Paperclip size={11} />}
              <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
              <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px', color: 'var(--text-secondary)' }}><X size={11} /></button>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem', padding: '0.75rem 0', borderTop: '1px solid var(--border-color)', flexShrink: 0 }}>
        <button onClick={() => fileInputRef.current?.click()} title="上傳檔案"
          style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: '0.5rem', padding: '0.55rem', cursor: 'pointer', color: 'var(--text-secondary)', flexShrink: 0 }}>
          <Paperclip size={18} />
        </button>
        <input ref={fileInputRef} type="file" multiple accept="*/*" style={{ display: 'none' }} onChange={handleFileUpload} />
        <textarea ref={textareaRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
          placeholder={generateImage ? '描述你想要的圖卡…' : '輸入訊息…'}
          rows={1}
          style={{ flex: 1, padding: '0.6rem 0.85rem', border: '1px solid var(--border-color)', borderRadius: '0.75rem', fontSize: '0.88rem', resize: 'none', outline: 'none', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'inherit', lineHeight: 1.5 }} />
        <button onClick={handleSend} disabled={isLoading || (!input.trim() && attachments.length === 0)}
          style={{ background: 'var(--accent-color)', border: 'none', borderRadius: '0.5rem', padding: '0.55rem 0.75rem', cursor: 'pointer', color: '#fff', flexShrink: 0, opacity: (isLoading || (!input.trim() && attachments.length === 0)) ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <Send size={18} />
        </button>
      </div>

      {/* Template Gallery */}
      {showTemplateGallery && (
        <TemplateGalleryModal currentExtraPrompt="" onClose={() => setShowTemplateGallery(false)} onApply={handleTemplateApply} />
      )}

      {/* Lightbox */}
      {lightbox && (
        <div onClick={() => setLightbox(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 10200, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <img src={lightbox} alt="展開" onClick={e => e.stopPropagation()}
            style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: '8px', cursor: 'default' }} />
          <button onClick={() => setLightbox(null)}
            style={{ position: 'absolute', top: '20px', right: '20px', background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <X size={20} color="#fff" />
          </button>
        </div>
      )}
    </div>
  );
};

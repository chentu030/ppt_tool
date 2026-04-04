import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Paperclip, Image as ImageIcon, X, Loader, Download, Sparkles, Plus, Trash2, ChevronUp, ChevronDown, MessageSquare, FileText, Images } from 'lucide-react';
import { chatWithGemini, generateChatTitle } from '../utils/gemini';
import type { ChatMessage as GeminiChatMessage } from '../utils/gemini';
import TemplateGalleryModal from '../components/TemplateGalleryModal';
import type { ApplyParams } from '../components/TemplateGalleryModal';

// ── Types ──────────────────────────────────────────────────────────────────────
interface Attachment { name: string; mimeType: string; dataUrl: string; }
interface ChatMsg {
  id: string; role: 'user' | 'assistant'; text: string;
  images: string[]; attachments: Attachment[]; timestamp: number;
}
interface Conversation { id: string; title: string; messages: ChatMsg[]; createdAt: number; updatedAt: number; }

// ── Persistence helpers ────────────────────────────────────────────────────────
const LS_KEY = 'ai_chat_conversations';
const loadConversations = (): Conversation[] => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; } };
const saveConversations = (c: Conversation[]) => {
  // strip heavy dataUrl from attachments & images before saving
  const lite = c.map(conv => ({
    ...conv,
    messages: conv.messages.map(m => ({
      ...m,
      attachments: m.attachments.map(a => ({ ...a, dataUrl: a.mimeType.startsWith('image/') ? a.dataUrl.slice(0, 200) : '' })),
      images: m.images.map(img => img.slice(0, 200)),
    })),
  }));
  try { localStorage.setItem(LS_KEY, JSON.stringify(lite)); } catch { /* quota */ }
};
const deriveTitle = (msgs: ChatMsg[]): string => {
  const first = msgs.find(m => m.role === 'user' && m.text);
  return first ? first.text.slice(0, 30) + (first.text.length > 30 ? '…' : '') : '新對話';
};

// ── Component ──────────────────────────────────────────────────────────────────
export const AIChatPage: React.FC = () => {
  const [conversations, setConversations] = useState<Conversation[]>(loadConversations);
  const [activeId, setActiveId] = useState<string | null>(null);
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
  const [rightTab, setRightTab] = useState<'files' | 'images'>('images');
  // Collected images from all messages (for right panel gallery with reorder)
  const [galleryImages, setGalleryImages] = useState<string[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const apiKey = localStorage.getItem('vertexApiKey') || localStorage.getItem('geminiApiKey') || '';

  // Collect all images & files from messages
  const allFiles = messages.flatMap(m => m.attachments);
  const allImages = messages.flatMap(m => m.images);

  // Sync gallery whenever allImages changes
  useEffect(() => { setGalleryImages(allImages); }, [allImages.length]);

  // Auto-scroll
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + 'px';
    }
  }, [input]);

  // Save conversation whenever messages change
  useEffect(() => {
    if (messages.length === 0) return;
    setConversations(prev => {
      let updated: Conversation[];
      if (activeId && prev.find(c => c.id === activeId)) {
        updated = prev.map(c => c.id === activeId ? { ...c, messages, title: deriveTitle(messages), updatedAt: Date.now() } : c);
      } else {
        const newId = activeId || Date.now().toString();
        if (!activeId) setActiveId(newId);
        updated = [{ id: newId, title: deriveTitle(messages), messages, createdAt: Date.now(), updatedAt: Date.now() }, ...prev];
      }
      saveConversations(updated);
      return updated;
    });
  }, [messages]);

  // Load a conversation
  const loadConversation = (conv: Conversation) => {
    setActiveId(conv.id);
    setMessages(conv.messages);
    setInput(''); setAttachments([]);
  };

  // New conversation
  const newConversation = () => {
    setActiveId(null); setMessages([]); setInput(''); setAttachments([]);
  };

  // Delete conversation
  const deleteConversation = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConversations(prev => {
      const updated = prev.filter(c => c.id !== id);
      saveConversations(updated);
      return updated;
    });
    if (activeId === id) newConversation();
  };

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
    const isNewConversation = messages.length === 0;
    // For new conversations, pre-set activeId so the save-effect uses this ID
    const convId = activeId || Date.now().toString();
    if (!activeId) setActiveId(convId);
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
      const resp = await chatWithGemini(history, apiKey, { generateImage, referenceImage, aspectRatio }, ctrl.signal);
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'assistant', text: resp.text, images: resp.images, attachments: [], timestamp: Date.now() }]);
      // Generate AI title for new conversations (first user message)
      if (isNewConversation && trimmed) {
        generateChatTitle(trimmed, apiKey).then(title => {
          setConversations(prev => {
            const updated = prev.map(c => c.id === convId ? { ...c, title } : c);
            saveConversations(updated);
            return updated;
          });
        });
      }
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

  // Gallery reorder
  const moveImage = (from: number, dir: -1 | 1) => {
    const to = from + dir;
    if (to < 0 || to >= galleryImages.length) return;
    setGalleryImages(prev => { const arr = [...prev]; [arr[from], arr[to]] = [arr[to], arr[from]]; return arr; });
  };

  const downloadAllImages = () => {
    galleryImages.forEach((img, i) => downloadImage(img, i));
  };

  // ── Styles ─────────────────────────────────────────────────────────────
  const bubbleBase: React.CSSProperties = { maxWidth: '85%', padding: '0.7rem 1rem', borderRadius: '1rem', fontSize: '0.85rem', lineHeight: 1.6, wordBreak: 'break-word' };
  const userBubble: React.CSSProperties = { ...bubbleBase, background: 'var(--accent-color)', color: '#fff', borderBottomRightRadius: '0.3rem', marginLeft: 'auto' };
  const aiBubble: React.CSSProperties = { ...bubbleBase, background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderBottomLeftRadius: '0.3rem' };
  const panelHeader: React.CSSProperties = { padding: '0.6rem 0.75rem', fontWeight: 700, fontSize: '0.8rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 };

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 3rem)', margin: '-1.5rem', overflow: 'hidden' }}>

      {/* ── Left Sidebar: History ── */}
      <div style={{ width: '220px', minWidth: '220px', borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
        <div style={{ ...panelHeader, justifyContent: 'space-between' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><MessageSquare size={14} /> 歷史對話</span>
          <button onClick={newConversation} title="新對話"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--accent-color)' }}>
            <Plus size={16} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0.3rem' }}>
          {conversations.length === 0 && <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textAlign: 'center', padding: '1rem 0.5rem' }}>尚無歷史紀錄</p>}
          {conversations.map(conv => (
            <div key={conv.id} onClick={() => loadConversation(conv)}
              style={{
                padding: '0.5rem 0.6rem', borderRadius: '0.4rem', cursor: 'pointer', marginBottom: '2px',
                background: conv.id === activeId ? 'var(--accent-color)' : 'transparent',
                color: conv.id === activeId ? '#fff' : 'var(--text-primary)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.3rem',
              }}>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <div style={{ fontSize: '0.76rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conv.title}</div>
                <div style={{ fontSize: '0.62rem', opacity: 0.7, marginTop: '1px' }}>
                  {new Date(conv.updatedAt).toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' })} · {conv.messages.length} 則
                </div>
              </div>
              <button onClick={e => deleteConversation(conv.id, e)} title="刪除"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: conv.id === activeId ? 'rgba(255,255,255,0.7)' : 'var(--text-secondary)', flexShrink: 0 }}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Center: Chat ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Header toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0.85rem', borderBottom: '1px solid var(--border-color)', flexShrink: 0, gap: '0.4rem', flexWrap: 'wrap', background: 'var(--bg-primary)' }}>
          <h2 style={{ margin: 0, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap' }}>
            <Sparkles size={18} color="var(--accent-color)" /> AI 對話設計
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            {referenceImage && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.25rem 0.5rem', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '0.4rem', fontSize: '0.7rem' }}>
                <img src={referenceImage} alt="ref" style={{ width: '24px', height: '14px', objectFit: 'cover', borderRadius: '2px' }} />
                <span>{referenceLabel || '風格'}</span>
                <button onClick={() => { setReferenceImage(null); setReferenceLabel(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-secondary)' }}><X size={11} /></button>
              </div>
            )}
            <button onClick={() => setShowTemplateGallery(true)}
              style={{ padding: '0.3rem 0.6rem', fontSize: '0.72rem', border: '1px solid var(--border-color)', borderRadius: '0.4rem', cursor: 'pointer', background: 'var(--bg-secondary)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <ImageIcon size={12} /> 模板庫
            </button>
            <select value={aspectRatio} onChange={e => setAspectRatio(e.target.value)}
              style={{ padding: '0.3rem 0.4rem', fontSize: '0.7rem', border: '1px solid var(--border-color)', borderRadius: '0.4rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer' }}>
              <option value="16:9">16:9</option><option value="1:1">1:1</option><option value="9:16">9:16</option><option value="4:3">4:3</option>
            </select>
            <button onClick={() => setGenerateImage(!generateImage)}
              style={{ padding: '0.3rem 0.6rem', fontSize: '0.72rem', border: `1px solid ${generateImage ? 'var(--accent-color)' : 'var(--border-color)'}`, borderRadius: '0.4rem', cursor: 'pointer', background: generateImage ? 'var(--accent-color)' : 'var(--bg-secondary)', color: generateImage ? '#fff' : 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.25rem', fontWeight: generateImage ? 700 : 400 }}>
              <ImageIcon size={12} /> {generateImage ? '圖片模式' : '文字模式'}
            </button>
          </div>
        </div>

        {/* Messages area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {messages.length === 0 && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', color: 'var(--text-secondary)' }}>
              <Sparkles size={44} style={{ opacity: 0.25 }} />
              <p style={{ fontSize: '0.95rem', fontWeight: 600, margin: 0 }}>開始與 AI 對話</p>
              <div style={{ fontSize: '0.78rem', textAlign: 'center', lineHeight: 1.7 }}>
                上傳文件讓 AI 整理分析<br />描述需求生成精美圖卡<br />選擇模板風格套用設計
              </div>
            </div>
          )}
          {messages.map(msg => (
            <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
              {msg.attachments.length > 0 && (
                <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginBottom: '0.25rem', maxWidth: '85%', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  {msg.attachments.map((a, i) => (
                    a.mimeType.startsWith('image/') ? (
                      <img key={i} src={a.dataUrl} alt={a.name} onClick={() => setLightbox(a.dataUrl)}
                        style={{ maxHeight: '100px', maxWidth: '160px', borderRadius: '0.4rem', cursor: 'zoom-in', border: '1px solid var(--border-color)' }} />
                    ) : (
                      <div key={i} style={{ padding: '0.3rem 0.5rem', background: 'var(--bg-tertiary)', borderRadius: '0.35rem', fontSize: '0.68rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <Paperclip size={10} />{a.name}
                      </div>
                    )
                  ))}
                </div>
              )}
              {msg.text && <div style={msg.role === 'user' ? userBubble : aiBubble}><pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 'inherit' }}>{msg.text}</pre></div>}
              {msg.images.length > 0 && (
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: msg.text ? '0.35rem' : 0, maxWidth: '85%' }}>
                  {msg.images.map((img, i) => (
                    <div key={i} style={{ position: 'relative', borderRadius: '0.5rem', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                      <img src={img} alt={`card ${i + 1}`} onClick={() => setLightbox(img)}
                        style={{ maxHeight: '260px', maxWidth: '100%', display: 'block', cursor: 'zoom-in' }} />
                      <button onClick={() => downloadImage(img, i)}
                        style={{ position: 'absolute', bottom: '4px', right: '4px', background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: '50%', width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                        <Download size={12} color="#fff" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <span style={{ fontSize: '0.58rem', color: 'var(--text-secondary)', marginTop: '0.1rem', paddingInline: '0.15rem' }}>
                {new Date(msg.timestamp).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
          {isLoading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
              <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />
              {generateImage ? 'AI 生成圖片中…' : 'AI 思考中…'}
              <button onClick={() => abortRef.current?.abort()} style={{ marginLeft: '0.3rem', padding: '0.15rem 0.4rem', fontSize: '0.68rem', border: '1px solid var(--border-color)', borderRadius: '0.25rem', cursor: 'pointer', background: 'none', color: 'var(--text-secondary)' }}>取消</button>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Pending attachments */}
        {attachments.length > 0 && (
          <div style={{ display: 'flex', gap: '0.3rem', padding: '0.35rem 0.85rem', flexWrap: 'wrap', borderTop: '1px solid var(--border-color)' }}>
            {attachments.map((a, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.2rem 0.4rem', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '0.35rem', fontSize: '0.68rem' }}>
                {a.mimeType.startsWith('image/') ? <img src={a.dataUrl} alt="" style={{ width: '20px', height: '20px', objectFit: 'cover', borderRadius: '2px' }} /> : <Paperclip size={10} />}
                <span style={{ maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-secondary)' }}><X size={10} /></button>
              </div>
            ))}
          </div>
        )}

        {/* Input area */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.4rem', padding: '0.6rem 0.85rem', borderTop: '1px solid var(--border-color)', flexShrink: 0, background: 'var(--bg-primary)' }}>
          <button onClick={() => fileInputRef.current?.click()} title="上傳檔案"
            style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: '0.4rem', padding: '0.45rem', cursor: 'pointer', color: 'var(--text-secondary)', flexShrink: 0 }}>
            <Paperclip size={16} />
          </button>
          <input ref={fileInputRef} type="file" multiple accept="*/*" style={{ display: 'none' }} onChange={handleFileUpload} />
          <textarea ref={textareaRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
            placeholder={generateImage ? '描述你想要的圖卡…' : '輸入訊息…'} rows={1}
            style={{ flex: 1, padding: '0.5rem 0.75rem', border: '1px solid var(--border-color)', borderRadius: '0.6rem', fontSize: '0.85rem', resize: 'none', outline: 'none', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontFamily: 'inherit', lineHeight: 1.5 }} />
          <button onClick={handleSend} disabled={isLoading || (!input.trim() && attachments.length === 0)}
            style={{ background: 'var(--accent-color)', border: 'none', borderRadius: '0.4rem', padding: '0.45rem 0.65rem', cursor: 'pointer', color: '#fff', flexShrink: 0, opacity: (isLoading || (!input.trim() && attachments.length === 0)) ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <Send size={16} />
          </button>
        </div>
      </div>

      {/* ── Right Panel: Files & Images ── */}
      <div style={{ width: '280px', minWidth: '280px', borderLeft: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
        {/* Tab switcher */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
          <button onClick={() => setRightTab('images')}
            style={{ flex: 1, padding: '0.55rem', fontSize: '0.72rem', fontWeight: rightTab === 'images' ? 700 : 400, border: 'none', borderBottom: rightTab === 'images' ? '2px solid var(--accent-color)' : '2px solid transparent', cursor: 'pointer', background: 'none', color: rightTab === 'images' ? 'var(--accent-color)' : 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}>
            <Images size={13} /> 生成圖片 ({allImages.length})
          </button>
          <button onClick={() => setRightTab('files')}
            style={{ flex: 1, padding: '0.55rem', fontSize: '0.72rem', fontWeight: rightTab === 'files' ? 700 : 400, border: 'none', borderBottom: rightTab === 'files' ? '2px solid var(--accent-color)' : '2px solid transparent', cursor: 'pointer', background: 'none', color: rightTab === 'files' ? 'var(--accent-color)' : 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}>
            <FileText size={13} /> 檔案 ({allFiles.length})
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
          {rightTab === 'images' ? (
            galleryImages.length === 0 ? (
              <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem 0.5rem' }}>使用「圖片模式」生成圖片後<br />會顯示在這裡</p>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.4rem' }}>
                  <button onClick={downloadAllImages}
                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.65rem', border: '1px solid var(--border-color)', borderRadius: '0.3rem', cursor: 'pointer', background: 'none', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                    <Download size={10} /> 全部下載
                  </button>
                </div>
                {galleryImages.map((img, i) => (
                  <div key={i} style={{ marginBottom: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', overflow: 'hidden', position: 'relative' }}>
                    <img src={img} alt={`圖片 ${i + 1}`} onClick={() => setLightbox(img)}
                      style={{ width: '100%', height: 'auto', display: 'block', cursor: 'zoom-in' }} />
                    <div style={{ position: 'absolute', top: '4px', right: '4px', display: 'flex', gap: '2px' }}>
                      <span style={{ background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '0.6rem', padding: '1px 5px', borderRadius: '3px' }}>#{i + 1}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '0.3rem', padding: '0.3rem', background: 'var(--bg-secondary)' }}>
                      <button onClick={() => moveImage(i, -1)} disabled={i === 0}
                        style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: '0.25rem', padding: '2px 6px', cursor: i === 0 ? 'default' : 'pointer', opacity: i === 0 ? 0.3 : 1, color: 'var(--text-secondary)' }}>
                        <ChevronUp size={12} />
                      </button>
                      <button onClick={() => moveImage(i, 1)} disabled={i === galleryImages.length - 1}
                        style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: '0.25rem', padding: '2px 6px', cursor: i === galleryImages.length - 1 ? 'default' : 'pointer', opacity: i === galleryImages.length - 1 ? 0.3 : 1, color: 'var(--text-secondary)' }}>
                        <ChevronDown size={12} />
                      </button>
                      <button onClick={() => downloadImage(img, i)}
                        style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: '0.25rem', padding: '2px 6px', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                        <Download size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )
          ) : (
            allFiles.length === 0 ? (
              <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem 0.5rem' }}>上傳的檔案會顯示在這裡</p>
            ) : (
              allFiles.map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.45rem 0.5rem', marginBottom: '0.2rem', background: 'var(--bg-secondary)', borderRadius: '0.35rem', fontSize: '0.72rem' }}>
                  {f.mimeType.startsWith('image/') ? (
                    <img src={f.dataUrl} alt="" onClick={() => setLightbox(f.dataUrl)} style={{ width: '32px', height: '32px', objectFit: 'cover', borderRadius: '3px', cursor: 'zoom-in', flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-tertiary)', borderRadius: '3px', flexShrink: 0 }}>
                      <FileText size={14} color="var(--text-secondary)" />
                    </div>
                  )}
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{f.name}</div>
                    <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)' }}>{f.mimeType.split('/')[1]?.toUpperCase() || 'FILE'}</div>
                  </div>
                </div>
              ))
            )
          )}
        </div>
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

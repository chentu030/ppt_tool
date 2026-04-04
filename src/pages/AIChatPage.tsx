import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Paperclip, Image as ImageIcon, X, Loader, Download, Sparkles, Plus, Trash2, ChevronUp, ChevronDown, MessageSquare, FileText, Images, Play, Square } from 'lucide-react';
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

// ── Persistence ────────────────────────────────────────────────────────────────
const LS_KEY = 'ai_chat_conversations';
const loadConversations = (): Conversation[] => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; } };
const saveConversations = (c: Conversation[]) => {
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

// ── Markdown renderer ──────────────────────────────────────────────────────────
const Markdown: React.FC<{ text: string }> = ({ text }) => {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Code block
    if (line.trimStart().startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) { codeLines.push(lines[i]); i++; }
      i++; // skip closing ```
      elements.push(<pre key={elements.length} style={{ background: 'var(--bg-tertiary)', padding: '0.6rem 0.8rem', borderRadius: '0.4rem', overflow: 'auto', fontSize: '0.78rem', margin: '0.3rem 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}><code>{codeLines.join('\n')}</code></pre>);
      continue;
    }
    // Heading
    const hMatch = line.match(/^(#{1,4})\s+(.*)$/);
    if (hMatch) {
      const level = hMatch[1].length;
      const sizes = ['1.1rem', '1rem', '0.92rem', '0.88rem'];
      elements.push(<div key={elements.length} style={{ fontWeight: 700, fontSize: sizes[level - 1], margin: '0.4rem 0 0.15rem' }}>{renderInline(hMatch[2])}</div>);
      i++; continue;
    }
    // Horizontal rule
    if (/^---+$/.test(line.trim())) { elements.push(<hr key={elements.length} style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '0.4rem 0' }} />); i++; continue; }
    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(<li key={items.length} style={{ marginBottom: '0.15rem' }}>{renderInline(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>);
        i++;
      }
      elements.push(<ul key={elements.length} style={{ margin: '0.2rem 0', paddingLeft: '1.2rem' }}>{items}</ul>);
      continue;
    }
    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(<li key={items.length} style={{ marginBottom: '0.15rem' }}>{renderInline(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>);
        i++;
      }
      elements.push(<ol key={elements.length} style={{ margin: '0.2rem 0', paddingLeft: '1.2rem' }}>{items}</ol>);
      continue;
    }
    // Empty line
    if (line.trim() === '') { i++; continue; }
    // Normal paragraph
    elements.push(<p key={elements.length} style={{ margin: '0.15rem 0' }}>{renderInline(line)}</p>);
    i++;
  }
  return <div style={{ fontSize: '0.84rem', lineHeight: 1.7, wordBreak: 'break-word' }}>{elements}</div>;
};
function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*)|(`([^`]+?)`)|(\*(.+?)\*)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push(text.slice(lastIdx, match.index));
    if (match[2]) parts.push(<strong key={key++}>{match[2]}</strong>);
    else if (match[4]) parts.push(<code key={key++} style={{ background: 'var(--bg-tertiary)', padding: '0.1rem 0.3rem', borderRadius: '3px', fontSize: '0.8em' }}>{match[4]}</code>);
    else if (match[6]) parts.push(<em key={key++}>{match[6]}</em>);
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

// ── Component ──────────────────────────────────────────────────────────────────
export const AIChatPage: React.FC = () => {
  const [conversations, setConversations] = useState<Conversation[]>(loadConversations);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [referenceLabel, setReferenceLabel] = useState('');
  const [stylePrompt, setStylePrompt] = useState('');
  const [showTemplateGallery, setShowTemplateGallery] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [rightTab, setRightTab] = useState<'generate' | 'files'>('generate');
  const [galleryImages, setGalleryImages] = useState<string[]>([]);
  // Image generation state
  const [imageCount, setImageCount] = useState(3);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const genAbortRef = useRef(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const apiKey = localStorage.getItem('vertexApiKey') || localStorage.getItem('geminiApiKey') || '';

  const allFiles = messages.flatMap(m => m.attachments);

  // Auto-scroll & auto-resize
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + 'px';
    }
  }, [input]);

  // Save conversation
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

  const loadConversation = (conv: Conversation) => { setActiveId(conv.id); setMessages(conv.messages); setInput(''); setAttachments([]); setGalleryImages([]); };
  const newConversation = () => { setActiveId(null); setMessages([]); setInput(''); setAttachments([]); setGalleryImages([]); };
  const deleteConversation = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConversations(prev => { const u = prev.filter(c => c.id !== id); saveConversations(u); return u; });
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

  const urlToBase64 = async (url: string): Promise<string> => {
    try { const r = await fetch(url); const b = await r.blob(); return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.onerror = rej; fr.readAsDataURL(b); }); }
    catch { return url; }
  };

  const handleTemplateApply = async ({ imageUrl, resolvedExtraPrompt, settings }: ApplyParams) => {
    setShowTemplateGallery(false);
    setReferenceLabel([settings?.fontFamily, settings?.highlightColor].filter(Boolean).join(' · ') || '已選擇');
    if (resolvedExtraPrompt) setStylePrompt(resolvedExtraPrompt);
    if (imageUrl && !imageUrl.startsWith('data:')) { setReferenceImage(await urlToBase64(imageUrl)); } else { setReferenceImage(imageUrl); }
  };

  const buildHistory = useCallback((msgs: ChatMsg[], userParts: GeminiChatMessage['parts'], extraStylePrompt?: string): GeminiChatMessage[] => {
    let sys = '你是專業設計助手，可以整理文件、規劃圖卡內容、回答問題。用繁體中文回答。不要自己生成圖片，圖片生成由系統另外處理。';
    if (extraStylePrompt) sys += `\n\n風格設定：${extraStylePrompt}`;
    const h: GeminiChatMessage[] = [
      { role: 'user', parts: [{ text: sys }] },
      { role: 'model', parts: [{ text: '好的！我會幫你規劃圖卡內容。請告訴我需求，確認後再由你啟動生成。' }] },
    ];
    for (const m of msgs) {
      if (m.role === 'user') {
        const p: GeminiChatMessage['parts'] = [];
        if (m.text) p.push({ text: m.text });
        for (const a of m.attachments) { const b64 = a.dataUrl.includes(',') ? a.dataUrl.split(',')[1] : a.dataUrl; p.push({ inlineData: { mimeType: a.mimeType, data: b64 } }); }
        if (p.length) h.push({ role: 'user', parts: p });
      } else { if (m.text) h.push({ role: 'model', parts: [{ text: m.text }] }); }
    }
    h.push({ role: 'user', parts: userParts });
    return h;
  }, []);

  // ── Chat send (always text mode) ──
  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed && attachments.length === 0) return;
    const isNew = messages.length === 0;
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
      for (const a of userMsg.attachments) { const b64 = a.dataUrl.includes(',') ? a.dataUrl.split(',')[1] : a.dataUrl; parts.push({ inlineData: { mimeType: a.mimeType, data: b64 } }); }
      const history = buildHistory(messages, parts, stylePrompt || undefined);
      const resp = await chatWithGemini(history, apiKey, { generateImage: false }, ctrl.signal);
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'assistant', text: resp.text, images: [], attachments: [], timestamp: Date.now() }]);
      if (isNew && trimmed) {
        generateChatTitle(trimmed, apiKey).then(title => {
          setConversations(prev => { const u = prev.map(c => c.id === convId ? { ...c, title } : c); saveConversations(u); return u; });
        });
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'assistant', text: `❌ 錯誤：${err.message || '未知錯誤'}`, images: [], attachments: [], timestamp: Date.now() }]);
    } finally { setIsLoading(false); abortRef.current = null; }
  };

  // ── Image generation (separate from chat) ──
  const handleGenerateImages = async () => {
    if (messages.length === 0) { alert('請先跟 AI 討論要生成的內容'); return; }
    setIsGenerating(true); setGenProgress({ current: 0, total: imageCount }); genAbortRef.current = false;
    setRightTab('generate');

    // Ask AI to create a concise image prompt based on conversation
    const promptReqHistory: GeminiChatMessage[] = [
      ...buildHistory(messages, [{ text: `根據我們的對話內容，請幫我寫一段詳細的英文圖片生成 prompt，用於生成圖卡/投影片。只回覆 prompt 本身，不要加任何說明或前綴。${stylePrompt ? `風格：${stylePrompt}` : ''}` }], stylePrompt || undefined),
    ];
    let imagePrompt = '';
    try {
      const promptResp = await chatWithGemini(promptReqHistory, apiKey, { generateImage: false });
      imagePrompt = promptResp.text.trim();
    } catch {
      imagePrompt = messages.filter(m => m.role === 'assistant' && m.text).slice(-1)[0]?.text || 'Create a beautiful presentation slide';
    }

    for (let idx = 0; idx < imageCount; idx++) {
      if (genAbortRef.current) break;
      setGenProgress({ current: idx + 1, total: imageCount });
      try {
        const slidePrompt = imageCount > 1 ? `${imagePrompt}\n\nThis is slide ${idx + 1} of ${imageCount}. Make each slide have different content focus.` : imagePrompt;
        const imgHistory: GeminiChatMessage[] = [{ role: 'user', parts: [{ text: slidePrompt }] }];
        // Attach reference image if available
        const resp = await chatWithGemini(imgHistory, apiKey, {
          generateImage: true, referenceImage, aspectRatio,
        });
        if (resp.images.length > 0) {
          setGalleryImages(prev => [...prev, ...resp.images]);
        }
      } catch (err: any) {
        console.error(`Image ${idx + 1} failed:`, err);
        // Continue generating remaining images
      }
    }
    setIsGenerating(false);
  };

  const stopGenerating = () => { genAbortRef.current = true; };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const downloadImage = (dataUrl: string, idx: number) => {
    const a = document.createElement('a'); a.href = dataUrl; a.download = `ai-card-${idx + 1}.png`; a.click();
  };
  const moveImage = (from: number, dir: -1 | 1) => {
    const to = from + dir;
    if (to < 0 || to >= galleryImages.length) return;
    setGalleryImages(prev => { const arr = [...prev]; [arr[from], arr[to]] = [arr[to], arr[from]]; return arr; });
  };
  const downloadAllImages = () => { galleryImages.forEach((img, i) => downloadImage(img, i)); };
  const removeImage = (idx: number) => { setGalleryImages(prev => prev.filter((_, i) => i !== idx)); };

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
          <button onClick={newConversation} title="新對話" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--accent-color)' }}><Plus size={16} /></button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0.3rem' }}>
          {conversations.length === 0 && <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textAlign: 'center', padding: '1rem 0.5rem' }}>尚無歷史紀錄</p>}
          {conversations.map(conv => (
            <div key={conv.id} onClick={() => loadConversation(conv)}
              style={{ padding: '0.5rem 0.6rem', borderRadius: '0.4rem', cursor: 'pointer', marginBottom: '2px', background: conv.id === activeId ? 'var(--accent-color)' : 'transparent', color: conv.id === activeId ? '#fff' : 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.3rem' }}>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <div style={{ fontSize: '0.76rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conv.title}</div>
                <div style={{ fontSize: '0.62rem', opacity: 0.7, marginTop: '1px' }}>{new Date(conv.updatedAt).toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' })} · {conv.messages.length} 則</div>
              </div>
              <button onClick={e => deleteConversation(conv.id, e)} title="刪除" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: conv.id === activeId ? 'rgba(255,255,255,0.7)' : 'var(--text-secondary)', flexShrink: 0 }}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Center: Chat ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0.85rem', borderBottom: '1px solid var(--border-color)', flexShrink: 0, gap: '0.4rem', flexWrap: 'wrap', background: 'var(--bg-primary)' }}>
          <h2 style={{ margin: 0, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap' }}>
            <Sparkles size={18} color="var(--accent-color)" /> AI 對話設計
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            {referenceImage && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.25rem 0.5rem', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '0.4rem', fontSize: '0.7rem' }}>
                <img src={referenceImage} alt="ref" style={{ width: '24px', height: '14px', objectFit: 'cover', borderRadius: '2px' }} />
                <span>{referenceLabel || '風格'}</span>
                <button onClick={() => { setReferenceImage(null); setReferenceLabel(''); setStylePrompt(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-secondary)' }}><X size={11} /></button>
              </div>
            )}
            <button onClick={() => setShowTemplateGallery(true)} style={{ padding: '0.3rem 0.6rem', fontSize: '0.72rem', border: '1px solid var(--border-color)', borderRadius: '0.4rem', cursor: 'pointer', background: 'var(--bg-secondary)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <ImageIcon size={12} /> 模板庫
            </button>
            <select value={aspectRatio} onChange={e => setAspectRatio(e.target.value)} style={{ padding: '0.3rem 0.4rem', fontSize: '0.7rem', border: '1px solid var(--border-color)', borderRadius: '0.4rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer' }}>
              <option value="16:9">16:9</option><option value="1:1">1:1</option><option value="9:16">9:16</option><option value="4:3">4:3</option>
            </select>
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {messages.length === 0 && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', color: 'var(--text-secondary)' }}>
              <Sparkles size={44} style={{ opacity: 0.25 }} />
              <p style={{ fontSize: '0.95rem', fontWeight: 600, margin: 0 }}>開始與 AI 對話</p>
              <div style={{ fontSize: '0.78rem', textAlign: 'center', lineHeight: 1.7 }}>
                1. 上傳文件或描述需求<br />2. 與 AI 討論確認內容<br />3. 右側面板設定張數並生成圖卡
              </div>
            </div>
          )}
          {messages.map(msg => (
            <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
              {msg.attachments.length > 0 && (
                <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginBottom: '0.25rem', maxWidth: '85%', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  {msg.attachments.map((a, i) => (
                    a.mimeType.startsWith('image/') ? (
                      <img key={i} src={a.dataUrl} alt={a.name} onClick={() => setLightbox(a.dataUrl)} style={{ maxHeight: '100px', maxWidth: '160px', borderRadius: '0.4rem', cursor: 'zoom-in', border: '1px solid var(--border-color)' }} />
                    ) : (
                      <div key={i} style={{ padding: '0.3rem 0.5rem', background: 'var(--bg-tertiary)', borderRadius: '0.35rem', fontSize: '0.68rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Paperclip size={10} />{a.name}</div>
                    )
                  ))}
                </div>
              )}
              {msg.text && (
                <div style={msg.role === 'user' ? userBubble : aiBubble}>
                  {msg.role === 'assistant' ? <Markdown text={msg.text} /> : <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 'inherit' }}>{msg.text}</pre>}
                </div>
              )}
              <span style={{ fontSize: '0.58rem', color: 'var(--text-secondary)', marginTop: '0.1rem', paddingInline: '0.15rem' }}>
                {new Date(msg.timestamp).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
          {isLoading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
              <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> AI 思考中…
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

        {/* Input */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.4rem', padding: '0.6rem 0.85rem', borderTop: '1px solid var(--border-color)', flexShrink: 0, background: 'var(--bg-primary)' }}>
          <button onClick={() => fileInputRef.current?.click()} title="上傳檔案" style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: '0.4rem', padding: '0.45rem', cursor: 'pointer', color: 'var(--text-secondary)', flexShrink: 0 }}><Paperclip size={16} /></button>
          <input ref={fileInputRef} type="file" multiple accept="*/*" style={{ display: 'none' }} onChange={handleFileUpload} />
          <textarea ref={textareaRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} placeholder="輸入訊息，與 AI 討論圖卡內容…" rows={1}
            style={{ flex: 1, padding: '0.5rem 0.75rem', border: '1px solid var(--border-color)', borderRadius: '0.6rem', fontSize: '0.85rem', resize: 'none', outline: 'none', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontFamily: 'inherit', lineHeight: 1.5 }} />
          <button onClick={handleSend} disabled={isLoading || (!input.trim() && attachments.length === 0)}
            style={{ background: 'var(--accent-color)', border: 'none', borderRadius: '0.4rem', padding: '0.45rem 0.65rem', cursor: 'pointer', color: '#fff', flexShrink: 0, opacity: (isLoading || (!input.trim() && attachments.length === 0)) ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <Send size={16} />
          </button>
        </div>
      </div>

      {/* ── Right Panel ── */}
      <div style={{ width: '300px', minWidth: '300px', borderLeft: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
          <button onClick={() => setRightTab('generate')}
            style={{ flex: 1, padding: '0.55rem', fontSize: '0.72rem', fontWeight: rightTab === 'generate' ? 700 : 400, border: 'none', borderBottom: rightTab === 'generate' ? '2px solid var(--accent-color)' : '2px solid transparent', cursor: 'pointer', background: 'none', color: rightTab === 'generate' ? 'var(--accent-color)' : 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}>
            <Images size={13} /> 生成圖片
          </button>
          <button onClick={() => setRightTab('files')}
            style={{ flex: 1, padding: '0.55rem', fontSize: '0.72rem', fontWeight: rightTab === 'files' ? 700 : 400, border: 'none', borderBottom: rightTab === 'files' ? '2px solid var(--accent-color)' : '2px solid transparent', cursor: 'pointer', background: 'none', color: rightTab === 'files' ? 'var(--accent-color)' : 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}>
            <FileText size={13} /> 檔案 ({allFiles.length})
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
          {rightTab === 'generate' ? (
            <>
              {/* Generate controls */}
              <div style={{ padding: '0.5rem', background: 'var(--bg-secondary)', borderRadius: '0.5rem', marginBottom: '0.5rem' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.4rem' }}>生成設定</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.4rem' }}>
                  <span style={{ fontSize: '0.7rem', whiteSpace: 'nowrap' }}>張數：</span>
                  <input type="number" min={1} max={20} value={imageCount} onChange={e => setImageCount(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                    style={{ width: '50px', padding: '0.25rem 0.4rem', fontSize: '0.75rem', border: '1px solid var(--border-color)', borderRadius: '0.3rem', background: 'var(--bg-primary)', color: 'var(--text-primary)', textAlign: 'center' }} />
                  <span style={{ fontSize: '0.7rem', whiteSpace: 'nowrap' }}>比例：</span>
                  <select value={aspectRatio} onChange={e => setAspectRatio(e.target.value)} style={{ padding: '0.25rem', fontSize: '0.7rem', border: '1px solid var(--border-color)', borderRadius: '0.3rem', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                    <option value="16:9">16:9</option><option value="1:1">1:1</option><option value="9:16">9:16</option><option value="4:3">4:3</option>
                  </select>
                </div>
                {isGenerating ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem' }}>
                      <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} />
                      生成中 {genProgress.current}/{genProgress.total}
                    </div>
                    <div style={{ height: '4px', background: 'var(--border-color)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', background: 'var(--accent-color)', width: `${(genProgress.current / genProgress.total) * 100}%`, transition: 'width 0.3s' }} />
                    </div>
                    <button onClick={stopGenerating} style={{ padding: '0.35rem', fontSize: '0.7rem', border: '1px solid #e74c3c', borderRadius: '0.3rem', cursor: 'pointer', background: 'none', color: '#e74c3c', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}>
                      <Square size={11} /> 停止生成
                    </button>
                  </div>
                ) : (
                  <button onClick={handleGenerateImages} disabled={messages.length === 0}
                    style={{ width: '100%', padding: '0.45rem', fontSize: '0.78rem', fontWeight: 700, border: 'none', borderRadius: '0.4rem', cursor: messages.length === 0 ? 'default' : 'pointer', background: messages.length === 0 ? 'var(--border-color)' : 'var(--accent-color)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}>
                    <Play size={14} /> 開始生成 {imageCount} 張圖片
                  </button>
                )}
                {messages.length === 0 && <p style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', margin: '0.3rem 0 0', textAlign: 'center' }}>先跟 AI 討論內容後再生成</p>}
              </div>

              {/* Gallery */}
              {galleryImages.length > 0 && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 600 }}>已生成 {galleryImages.length} 張</span>
                    <button onClick={downloadAllImages} style={{ padding: '0.2rem 0.4rem', fontSize: '0.62rem', border: '1px solid var(--border-color)', borderRadius: '0.25rem', cursor: 'pointer', background: 'none', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.15rem' }}><Download size={10} /> 全部下載</button>
                  </div>
                  {galleryImages.map((img, i) => (
                    <div key={i} style={{ marginBottom: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', overflow: 'hidden', position: 'relative' }}>
                      <img src={img} alt={`圖片 ${i + 1}`} onClick={() => setLightbox(img)} style={{ width: '100%', height: 'auto', display: 'block', cursor: 'zoom-in' }} />
                      <div style={{ position: 'absolute', top: '4px', right: '4px', display: 'flex', gap: '2px' }}>
                        <span style={{ background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '0.6rem', padding: '1px 5px', borderRadius: '3px' }}>#{i + 1}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'center', gap: '0.25rem', padding: '0.25rem', background: 'var(--bg-secondary)' }}>
                        <button onClick={() => moveImage(i, -1)} disabled={i === 0} style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: '0.2rem', padding: '2px 5px', cursor: i === 0 ? 'default' : 'pointer', opacity: i === 0 ? 0.3 : 1, color: 'var(--text-secondary)' }}><ChevronUp size={11} /></button>
                        <button onClick={() => moveImage(i, 1)} disabled={i === galleryImages.length - 1} style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: '0.2rem', padding: '2px 5px', cursor: i === galleryImages.length - 1 ? 'default' : 'pointer', opacity: i === galleryImages.length - 1 ? 0.3 : 1, color: 'var(--text-secondary)' }}><ChevronDown size={11} /></button>
                        <button onClick={() => downloadImage(img, i)} style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: '0.2rem', padding: '2px 5px', cursor: 'pointer', color: 'var(--text-secondary)' }}><Download size={11} /></button>
                        <button onClick={() => removeImage(i)} style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: '0.2rem', padding: '2px 5px', cursor: 'pointer', color: '#e74c3c' }}><Trash2 size={11} /></button>
                      </div>
                    </div>
                  ))}
                </>
              )}
              {galleryImages.length === 0 && !isGenerating && messages.length > 0 && (
                <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textAlign: 'center', padding: '1rem 0.5rem' }}>確認好內容後<br />點擊上方「開始生成」</p>
              )}
            </>
          ) : (
            allFiles.length === 0 ? (
              <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem 0.5rem' }}>上傳的檔案會顯示在這裡</p>
            ) : (
              allFiles.map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.45rem 0.5rem', marginBottom: '0.2rem', background: 'var(--bg-secondary)', borderRadius: '0.35rem', fontSize: '0.72rem' }}>
                  {f.mimeType.startsWith('image/') ? (
                    <img src={f.dataUrl} alt="" onClick={() => setLightbox(f.dataUrl)} style={{ width: '32px', height: '32px', objectFit: 'cover', borderRadius: '3px', cursor: 'zoom-in', flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-tertiary)', borderRadius: '3px', flexShrink: 0 }}><FileText size={14} color="var(--text-secondary)" /></div>
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

      {showTemplateGallery && <TemplateGalleryModal currentExtraPrompt="" onClose={() => setShowTemplateGallery(false)} onApply={handleTemplateApply} />}

      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: 'fixed', inset: 0, zIndex: 10200, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <img src={lightbox} alt="展開" onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: '8px', cursor: 'default' }} />
          <button onClick={() => setLightbox(null)} style={{ position: 'absolute', top: '20px', right: '20px', background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><X size={20} color="#fff" /></button>
        </div>
      )}
    </div>
  );
};

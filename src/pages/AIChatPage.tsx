import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Paperclip, Image as ImageIcon, X, Loader, Download, Sparkles, Plus, Trash2, ChevronUp, ChevronDown, MessageSquare, FileText, Images, Play, Square, Edit3, FileDown } from 'lucide-react';
import { chatWithGemini, generateChatTitle } from '../utils/gemini';
import type { ChatMessage as GeminiChatMessage } from '../utils/gemini';
import TemplateGalleryModal from '../components/TemplateGalleryModal';
import type { ApplyParams } from '../components/TemplateGalleryModal';
import pptxgen from 'pptxgenjs';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

// ── Types ──────────────────────────────────────────────────────────────────────
interface Attachment { name: string; mimeType: string; dataUrl: string; }
interface ChatMsg {
  id: string; role: 'user' | 'assistant'; text: string;
  images: string[]; attachments: Attachment[]; timestamp: number;
}
interface Conversation { id: string; title: string; messages: ChatMsg[]; createdAt: number; updatedAt: number; }
interface SlidePlan {
  id: string; pageNum: number; title: string; content: string;
  templateImage?: string; templateLabel?: string; templatePrompt?: string;
  generatedImage?: string;
}

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

// ── Markdown renderer (react-markdown + GFM tables + KaTeX) ─────────────────
const mdComponents: Record<string, React.FC<any>> = {
  h1: ({ children }) => <h1 style={{ fontSize: '1.15rem', fontWeight: 700, margin: '0.6rem 0 0.2rem', color: 'var(--text-primary)' }}>{children}</h1>,
  h2: ({ children }) => <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '0.5rem 0 0.15rem', color: 'var(--text-primary)' }}>{children}</h2>,
  h3: ({ children }) => <h3 style={{ fontSize: '0.9rem', fontWeight: 600, margin: '0.4rem 0 0.1rem', color: 'var(--text-primary)' }}>{children}</h3>,
  h4: ({ children }) => <h4 style={{ fontSize: '0.85rem', fontWeight: 600, margin: '0.35rem 0 0.1rem', color: 'var(--text-secondary)' }}>{children}</h4>,
  p: ({ children }) => <p style={{ margin: '0.2rem 0', lineHeight: 1.65 }}>{children}</p>,
  ul: ({ children }) => <ul style={{ margin: '0.2rem 0', paddingLeft: '1.3rem' }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: '0.2rem 0', paddingLeft: '1.3rem' }}>{children}</ol>,
  li: ({ children }) => <li style={{ marginBottom: '0.1rem' }}>{children}</li>,
  strong: ({ children }) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '0.4rem 0' }} />,
  code: ({ inline, children, className }: any) => inline
    ? <code style={{ background: 'var(--bg-tertiary)', padding: '0.1rem 0.3rem', borderRadius: '3px', fontSize: '0.8em' }}>{children}</code>
    : <pre style={{ background: 'var(--bg-tertiary)', padding: '0.6rem 0.8rem', borderRadius: '0.4rem', overflow: 'auto', fontSize: '0.78rem', margin: '0.3rem 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}><code className={className}>{children}</code></pre>,
  table: ({ children }) => <div style={{ overflowX: 'auto', margin: '0.3rem 0' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>{children}</table></div>,
  thead: ({ children }) => <thead style={{ background: 'var(--bg-tertiary)' }}>{children}</thead>,
  th: ({ children }) => <th style={{ padding: '0.35rem 0.5rem', borderBottom: '2px solid var(--border-color)', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>{children}</th>,
  td: ({ children }) => <td style={{ padding: '0.3rem 0.5rem', borderBottom: '1px solid var(--border-color)' }}>{children}</td>,
  blockquote: ({ children }) => <blockquote style={{ margin: '0.3rem 0', paddingLeft: '0.8rem', borderLeft: '3px solid var(--accent-color)', color: 'var(--text-secondary)' }}>{children}</blockquote>,
  a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-color)', textDecoration: 'underline' }}>{children}</a>,
};
const Markdown: React.FC<{ text: string }> = React.memo(({ text }) => (
  <div style={{ fontSize: '0.84rem', lineHeight: 1.7, wordBreak: 'break-word' }}>
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={mdComponents}>
      {text}
    </ReactMarkdown>
  </div>
));

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
  const [templateTargetSlide, setTemplateTargetSlide] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [rightTab, setRightTab] = useState<'images' | 'files'>('images');
  const [galleryImages, setGalleryImages] = useState<string[]>([]);
  // Slide plan state
  const [slidePlans, setSlidePlans] = useState<SlidePlan[]>([]);
  const [isPlanLoading, setIsPlanLoading] = useState(false);
  const [planPageCount, setPlanPageCount] = useState(5);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const genAbortRef = useRef(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showAddPages, setShowAddPages] = useState(false);
  const [addPagesCount, setAddPagesCount] = useState(1);

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

  const loadConversation = (conv: Conversation) => { setActiveId(conv.id); setMessages(conv.messages); setInput(''); setAttachments([]); setGalleryImages([]); setSlidePlans([]); };
  const newConversation = () => { setActiveId(null); setMessages([]); setInput(''); setAttachments([]); setGalleryImages([]); setSlidePlans([]); };
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
        for (const a of m.attachments) {
          // Skip truncated/invalid attachments (saved conversations truncate to ~200 chars)
          if (a.dataUrl.length < 500) continue;
          const b64 = a.dataUrl.includes(',') ? a.dataUrl.split(',')[1] : a.dataUrl;
          p.push({ inlineData: { mimeType: a.mimeType, data: b64 } });
        }
        if (p.length) h.push({ role: 'user', parts: p });
      } else { if (m.text) h.push({ role: 'model', parts: [{ text: m.text }] }); }
    }
    h.push({ role: 'user', parts: userParts });
    return h;
  }, []);

  // Text-only history (no attachments) for plan generation to avoid re-sending large files
  const buildTextHistory = useCallback((msgs: ChatMsg[], userParts: GeminiChatMessage['parts'], extraStylePrompt?: string): GeminiChatMessage[] => {
    let sys = '你是專業設計助手，根據之前的對話內容來規劃簡報。用繁體中文回答。';
    if (extraStylePrompt) sys += `\n\n風格設定：${extraStylePrompt}`;
    const h: GeminiChatMessage[] = [
      { role: 'user', parts: [{ text: sys }] },
      { role: 'model', parts: [{ text: '好的，我會根據對話內容來規劃。' }] },
    ];
    for (const m of msgs) {
      if (m.role === 'user') {
        const parts: GeminiChatMessage['parts'] = [];
        if (m.text) parts.push({ text: m.text });
        if (m.attachments.length > 0 && !m.text) parts.push({ text: `[已上傳 ${m.attachments.length} 個檔案]` });
        if (parts.length) h.push({ role: 'user', parts });
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

  // ── Generate slide plan via AI ──
  const handleGeneratePlan = async (pageCount: number) => {
    if (messages.length === 0) { alert('請先跟 AI 討論要生成的內容'); return; }
    setIsPlanLoading(true);
    try {
      const req = `根據我們的對話內容，請規劃 ${pageCount} 頁簡報，每頁包含標題和內容文字。回覆純 JSON 陣列格式，不要加任何說明：[{"title":"標題","content":"內容文字"}]。內容要具體、簡潔，適合放在投影片上。`;
      const history = buildTextHistory(messages, [{ text: req }], stylePrompt || undefined);
      const resp = await chatWithGemini(history, apiKey, { generateImage: false });
      // Parse JSON from response
      const jsonMatch = resp.text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as { title: string; content: string }[];
        const plans: SlidePlan[] = parsed.map((s, i) => ({
          id: `slide-${Date.now()}-${i}`, pageNum: i + 1, title: s.title, content: s.content,
        }));
        setSlidePlans(plans);
        setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'assistant', text: `✅ 已規劃 ${plans.length} 頁投影片內容。請在下方模塊中檢視、編輯文字，選擇模板後按「開始生成圖片」。`, images: [], attachments: [], timestamp: Date.now() }]);
      } else {
        setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'assistant', text: `⚠️ 無法解析投影片規劃，請再試一次。\n\n原始回覆：\n${resp.text}`, images: [], attachments: [], timestamp: Date.now() }]);
      }
    } catch (err: any) {
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'assistant', text: `❌ 規劃失敗：${err.message}`, images: [], attachments: [], timestamp: Date.now() }]);
    } finally { setIsPlanLoading(false); }
  };

  const updateSlidePlan = (id: string, field: 'title' | 'content', value: string) => {
    setSlidePlans(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const handleTemplateApplyForSlide = ({ imageUrl, resolvedExtraPrompt, settings }: ApplyParams) => {
    setShowTemplateGallery(false);
    if (!templateTargetSlide) { handleTemplateApply({ imageUrl, resolvedExtraPrompt, settings } as ApplyParams); return; }
    const label = [settings?.fontFamily, settings?.highlightColor].filter(Boolean).join(' · ') || '已選擇';
    setSlidePlans(prev => prev.map(s => s.id === templateTargetSlide ? { ...s, templateImage: imageUrl, templateLabel: label, templatePrompt: resolvedExtraPrompt || '' } : s));
    setTemplateTargetSlide(null);
  };

  // ── Generate images from plan ──
  const handleGenerateFromPlan = async () => {
    if (slidePlans.length === 0) return;
    setIsGenerating(true); genAbortRef.current = false;
    setGenProgress({ current: 0, total: slidePlans.length });
    setRightTab('images');

    for (let idx = 0; idx < slidePlans.length; idx++) {
      if (genAbortRef.current) break;
      setGenProgress({ current: idx + 1, total: slidePlans.length });
      const slide = slidePlans[idx];
      try {
        const slideStylePrompt = slide.templatePrompt || stylePrompt || '';
        const promptText = `Create a professional presentation slide image.\nTitle: ${slide.title}\nContent: ${slide.content}\n${slideStylePrompt ? `Style: ${slideStylePrompt}` : ''}\nThis is slide ${slide.pageNum} of ${slidePlans.length}.`;
        const imgHistory: GeminiChatMessage[] = [{ role: 'user', parts: [{ text: promptText }] }];
        const refImg = slide.templateImage || referenceImage;
        // Convert URL ref to base64 if needed
        let resolvedRef = refImg;
        if (refImg && !refImg.startsWith('data:')) { resolvedRef = await urlToBase64(refImg); }
        const resp = await chatWithGemini(imgHistory, apiKey, { generateImage: true, referenceImage: resolvedRef, aspectRatio });
        if (resp.images.length > 0) {
          const img = resp.images[0];
          setSlidePlans(prev => prev.map(s => s.id === slide.id ? { ...s, generatedImage: img } : s));
          setGalleryImages(prev => [...prev, img]);
        }
      } catch (err: any) { console.error(`Slide ${idx + 1} failed:`, err); }
    }
    setIsGenerating(false);
  };

  const stopGenerating = () => { genAbortRef.current = true; };

  // ── PPTX Export ──
  const handleExportPptx = async () => {
    const images = galleryImages.filter(Boolean);
    if (images.length === 0) { alert('沒有可匯出的圖片'); return; }
    setIsExporting(true);
    try {
      const pres = new pptxgen();
      // Detect dimensions from first image
      const dims = await new Promise<{ w: number; h: number }>(res => {
        const img = new Image(); img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight }); img.onerror = () => res({ w: 16, h: 9 }); img.src = images[0];
      });
      const layoutW = 10; const layoutH = parseFloat((layoutW / (dims.w / dims.h)).toFixed(4));
      pres.defineLayout({ name: 'AUTO', width: layoutW, height: layoutH }); pres.layout = 'AUTO';
      for (const img of images) { pres.addSlide().addImage({ data: img, x: 0, y: 0, w: layoutW, h: layoutH }); }
      await pres.writeFile({ fileName: `AI_Slides_${Date.now()}.pptx` });
    } catch (err: any) { alert(`匯出失敗：${err.message}`); }
    finally { setIsExporting(false); }
  };

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
    <div style={{ display: 'flex', height: '100vh', margin: '-1.5rem', overflow: 'hidden' }}>

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
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--bg-secondary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 1rem', borderBottom: '1px solid var(--border-color)', flexShrink: 0, background: 'var(--bg-primary)' }}>
          <h2 style={{ margin: 0, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap' }}>
            <Sparkles size={18} color="var(--accent-color)" /> AI 協作
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            {referenceImage && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.25rem 0.5rem', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '0.4rem', fontSize: '0.7rem' }}>
                <img src={referenceImage} alt="ref" style={{ width: '24px', height: '14px', objectFit: 'cover', borderRadius: '2px' }} />
                <span>{referenceLabel || '風格'}</span>
                <button onClick={() => { setReferenceImage(null); setReferenceLabel(''); setStylePrompt(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-secondary)' }}><X size={11} /></button>
              </div>
            )}
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
          {messages.length === 0 && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', color: 'var(--text-secondary)' }}>
              <Sparkles size={44} style={{ opacity: 0.25 }} />
              <p style={{ fontSize: '0.95rem', fontWeight: 600, margin: 0 }}>開始與 AI 對話</p>
              <div style={{ fontSize: '0.78rem', textAlign: 'center', lineHeight: 1.7 }}>
                1. 上傳文件或描述需求<br />2. 與 AI 討論確認內容<br />3. 點「📋 規劃投影片」產生內容規劃<br />4. 編輯文字、選模板後按「開始生成」
              </div>
            </div>
          )}
          {messages.map(msg => (
            <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
              {msg.attachments.length > 0 && (
                <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginBottom: '0.25rem', maxWidth: '85%', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  {msg.attachments.map((a, i) => (
                    a.mimeType.startsWith('image/') ? (
                      <img key={i} src={a.dataUrl} alt={a.name} onClick={() => setLightbox(a.dataUrl)} style={{ maxHeight: '100px', maxWidth: '160px', borderRadius: '0.4rem', cursor: 'zoom-in', border: '1px solid var(--border-color)', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }} />
                    ) : (
                      <div key={i} style={{ padding: '0.3rem 0.5rem', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '0.35rem', fontSize: '0.68rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Paperclip size={10} />{a.name}</div>
                    )
                  ))}
                </div>
              )}
              {msg.text && (
                <div style={{ ...(msg.role === 'user' ? userBubble : aiBubble), boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
                  {msg.role === 'assistant' ? <Markdown text={msg.text} /> : <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 'inherit' }}>{msg.text}</pre>}
                </div>
              )}
              <span style={{ fontSize: '0.58rem', color: 'var(--text-secondary)', marginTop: '0.15rem', paddingInline: '0.2rem' }}>
                {new Date(msg.timestamp).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
          {isLoading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.8rem', padding: '0.5rem' }}>
              <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> AI 思考中…
              <button onClick={() => abortRef.current?.abort()} style={{ marginLeft: '0.3rem', padding: '0.15rem 0.4rem', fontSize: '0.68rem', border: '1px solid var(--border-color)', borderRadius: '0.25rem', cursor: 'pointer', background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>取消</button>
            </div>
          )}
          {isPlanLoading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.8rem', padding: '0.5rem' }}>
              <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> AI 正在規劃投影片內容…
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* ── Slide Plan Module (outside scroll area, always visible) ── */}
        {slidePlans.length > 0 && (
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', maxHeight: '50vh', borderTop: '1px solid var(--border-color)', background: 'var(--bg-primary)', boxShadow: '0 -4px 12px rgba(0,0,0,0.02)' }}>
            {/* Header */}
            <div style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, background: 'var(--bg-primary)', borderBottom: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent-color)' }} />
                <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>投影片規劃</span>
                <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', background: 'var(--bg-secondary)', padding: '0.05rem 0.4rem', borderRadius: '0.6rem', border: '1px solid var(--border-color)' }}>{slidePlans.length} 頁</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', position: 'relative' }}>
                <button onClick={() => { setTemplateTargetSlide(null); setShowTemplateGallery(true); }} style={{ padding: '0.2rem 0.5rem', fontSize: '0.68rem', border: '1px solid var(--border-color)', borderRadius: '0.25rem', cursor: 'pointer', background: 'var(--bg-secondary)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <ImageIcon size={11} /> 模板庫
                </button>
                <div style={{ width: '1px', height: '12px', background: 'var(--border-color)', margin: '0 0.1rem' }} />
                <button onClick={() => setShowAddPages(!showAddPages)}
                  style={{ padding: '0.2rem 0.5rem', fontSize: '0.68rem', border: '1px solid var(--border-color)', borderRadius: '0.25rem', cursor: 'pointer', background: 'var(--bg-secondary)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.15rem' }}><Plus size={11} /> 新增</button>
                {showAddPages && (
                  <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '4px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '0.4rem', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', padding: '0.5rem', zIndex: 10, display: 'flex', alignItems: 'center', gap: '0.3rem', whiteSpace: 'nowrap' }}>
                    <span style={{ fontSize: '0.7rem' }}>新增</span>
                    <input type="number" min={1} max={20} value={addPagesCount} onChange={e => setAddPagesCount(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                      style={{ width: '36px', padding: '0.2rem', fontSize: '0.72rem', border: '1px solid var(--border-color)', borderRadius: '0.2rem', textAlign: 'center', background: 'var(--bg-secondary)', color: 'var(--text-primary)', outline: 'none' }} />
                    <span style={{ fontSize: '0.7rem' }}>頁</span>
                    <button onClick={() => { setSlidePlans(prev => [...prev, ...Array.from({ length: addPagesCount }, (_, i) => ({ id: `slide-${Date.now()}-${prev.length + i}`, pageNum: prev.length + i + 1, title: '', content: '' }))]); setShowAddPages(false); }}
                      style={{ padding: '0.2rem 0.4rem', fontSize: '0.68rem', border: 'none', borderRadius: '0.2rem', cursor: 'pointer', background: 'var(--accent-color)', color: '#fff' }}>確定</button>
                  </div>
                )}
                <select value={aspectRatio} onChange={e => setAspectRatio(e.target.value)} style={{ padding: '0.2rem 0.3rem', fontSize: '0.65rem', borderRadius: '0.25rem', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)', cursor: 'pointer' }}>
                  <option value="16:9">16:9</option><option value="1:1">1:1</option><option value="9:16">9:16</option><option value="4:3">4:3</option>
                </select>
                <button onClick={() => setSlidePlans([])} title="清除全部" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px', color: 'var(--text-secondary)', opacity: 0.6 }}><X size={13} /></button>
              </div>
            </div>
            {/* Slide cards */}
            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '0.6rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'var(--bg-secondary)' }}>
              {slidePlans.map((slide) => (
                <div key={slide.id} style={{ border: '1px solid var(--border-color)', borderRadius: '0.6rem', background: 'var(--bg-primary)', overflow: 'hidden', transition: 'all 0.2s ease', boxShadow: '0 2px 8px rgba(0,0,0,0.02)', ...(slide.generatedImage ? { borderColor: '#27ae60', boxShadow: '0 0 0 1px rgba(39, 174, 96, 0.2)' } : {}) }}>
                  <div style={{ display: 'flex', alignItems: 'stretch' }}>
                    {/* Page number strip */}
                    <div style={{ width: '32px', background: slide.generatedImage ? '#27ae60' : 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, borderRight: '1px solid var(--border-color)' }}>
                      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: slide.generatedImage ? '#fff' : 'var(--text-secondary)' }}>{slide.pageNum}</span>
                    </div>
                    {/* Content area */}
                    <div style={{ flex: 1, padding: '0.6rem 0.8rem', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                      <input value={slide.title} onChange={e => updateSlidePlan(slide.id, 'title', e.target.value)} placeholder="投影片標題" disabled={isGenerating}
                        style={{ width: '100%', padding: '0.2rem 0.4rem', fontSize: '0.85rem', fontWeight: 600, border: '1px solid transparent', borderRadius: '0.3rem', background: 'transparent', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.2s', ...(isGenerating ? {} : { ':focus': { borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' } } as any) }} />
                      <textarea value={slide.content} onChange={e => updateSlidePlan(slide.id, 'content', e.target.value)} placeholder="內容描述…" disabled={isGenerating} rows={2}
                        style={{ width: '100%', padding: '0.3rem 0.4rem', fontSize: '0.78rem', border: '1px solid transparent', borderRadius: '0.3rem', background: 'transparent', color: 'var(--text-primary)', outline: 'none', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box', minHeight: '3rem', transition: 'all 0.2s', ...(isGenerating ? {} : { ':focus': { borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' } } as any) }} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.2rem', paddingLeft: '0.4rem' }}>
                        <button onClick={() => { setTemplateTargetSlide(slide.id); setShowTemplateGallery(true); }}
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.65rem', border: '1px solid var(--border-color)', borderRadius: '0.3rem', cursor: 'pointer', background: slide.templateImage ? 'var(--accent-color)' : 'var(--bg-secondary)', color: slide.templateImage ? '#fff' : 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.2rem', transition: 'all 0.2s' }}>
                          <ImageIcon size={10} /> {slide.templateLabel || '選擇模板'}
                        </button>
                        {slide.templateImage && <img src={slide.templateImage} alt="" style={{ height: '20px', borderRadius: '3px', border: '1px solid var(--border-color)', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }} />}
                        {slide.generatedImage && <span style={{ fontSize: '0.68rem', color: '#27ae60', display: 'flex', alignItems: 'center', gap: '0.15rem', fontWeight: 600 }}>✓ 已生成</span>}
                        <button onClick={() => setSlidePlans(prev => { const arr = prev.filter(s => s.id !== slide.id); return arr.map((s, i) => ({ ...s, pageNum: i + 1 })); })} title="刪除" disabled={isGenerating}
                          style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--text-secondary)', opacity: isGenerating ? 0.2 : 0.6, borderRadius: '0.3rem', transition: 'all 0.2s', ...(isGenerating ? {} : { ':hover': { background: 'var(--bg-secondary)', color: '#e74c3c', opacity: 1 } } as any) }}><Trash2 size={12} /></button>
                      </div>
                    </div>
                    {/* Thumbnail */}
                    {slide.generatedImage && (
                      <div style={{ padding: '0.6rem', paddingLeft: 0, display: 'flex', alignItems: 'center' }}>
                        <img src={slide.generatedImage} alt="" onClick={() => setLightbox(slide.generatedImage!)} style={{ width: '80px', height: 'auto', aspectRatio: aspectRatio.replace(':', '/'), objectFit: 'cover', borderRadius: '0.4rem', cursor: 'zoom-in', border: '1px solid var(--border-color)', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }} />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {/* Footer: generate button / progress */}
            <div style={{ padding: '0.6rem 1rem', borderTop: '1px solid var(--border-color)', background: 'var(--bg-primary)', flexShrink: 0 }}>
              {isGenerating ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Loader size={11} style={{ animation: 'spin 1s linear infinite' }} /> 正在生成第 {genProgress.current} 張…</span>
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>{genProgress.current}/{genProgress.total}</span>
                    </div>
                    <div style={{ height: '3px', background: 'var(--border-color)', borderRadius: '2px', overflow: 'hidden' }}><div style={{ height: '100%', background: 'var(--accent-color)', borderRadius: '2px', width: `${(genProgress.current / genProgress.total) * 100}%`, transition: 'width 0.3s' }} /></div>
                  </div>
                  <button onClick={stopGenerating} style={{ padding: '0.25rem 0.55rem', fontSize: '0.68rem', border: '1px solid var(--border-color)', borderRadius: '0.25rem', cursor: 'pointer', background: 'var(--bg-primary)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.15rem', whiteSpace: 'nowrap' }}><Square size={10} /> 停止</button>
                </div>
              ) : (
                <button onClick={handleGenerateFromPlan}
                  style={{ width: '100%', padding: '0.5rem', fontSize: '0.8rem', fontWeight: 600, border: 'none', borderRadius: '0.4rem', cursor: 'pointer', background: 'var(--accent-color)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem', letterSpacing: '0.02em' }}>
                  <Play size={14} /> 開始生成 {slidePlans.length} 張圖片
                </button>
              )}
            </div>
          </div>
        )}

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

        {/* Plan generation controls */}
        {messages.length > 0 && slidePlans.length === 0 && !isPlanLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.85rem', borderTop: '1px solid var(--border-color)', background: 'var(--bg-secondary)', flexShrink: 0 }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>確認好內容後：</span>
            <span style={{ fontSize: '0.7rem', whiteSpace: 'nowrap' }}>頁數</span>
            <input type="number" min={1} max={30} value={planPageCount} onChange={e => setPlanPageCount(Math.max(1, Math.min(30, parseInt(e.target.value) || 1)))}
              style={{ width: '42px', padding: '0.2rem 0.3rem', fontSize: '0.72rem', border: '1px solid var(--border-color)', borderRadius: '0.25rem', textAlign: 'center', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
            <button onClick={() => handleGeneratePlan(planPageCount)} disabled={isLoading}
              style={{ padding: '0.3rem 0.65rem', fontSize: '0.72rem', fontWeight: 600, border: 'none', borderRadius: '0.35rem', cursor: 'pointer', background: 'var(--accent-color)', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.25rem', whiteSpace: 'nowrap', opacity: isLoading ? 0.5 : 1 }}>
              <Edit3 size={12} /> 規劃投影片
            </button>
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

      {/* ── Right Panel: Gallery ── */}
      <div style={{ width: '300px', minWidth: '300px', borderLeft: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
          <button onClick={() => setRightTab('images')}
            style={{ flex: 1, padding: '0.55rem', fontSize: '0.72rem', fontWeight: rightTab === 'images' ? 700 : 400, border: 'none', borderBottom: rightTab === 'images' ? '2px solid var(--accent-color)' : '2px solid transparent', cursor: 'pointer', background: 'none', color: rightTab === 'images' ? 'var(--accent-color)' : 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}>
            <Images size={13} /> 生成圖片 ({galleryImages.length})
          </button>
          <button onClick={() => setRightTab('files')}
            style={{ flex: 1, padding: '0.55rem', fontSize: '0.72rem', fontWeight: rightTab === 'files' ? 700 : 400, border: 'none', borderBottom: rightTab === 'files' ? '2px solid var(--accent-color)' : '2px solid transparent', cursor: 'pointer', background: 'none', color: rightTab === 'files' ? 'var(--accent-color)' : 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}>
            <FileText size={13} /> 檔案 ({allFiles.length})
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
          {rightTab === 'images' ? (
            galleryImages.length === 0 ? (
              <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem 0.5rem' }}>使用投影片規劃模塊生成圖片後<br />會顯示在這裡</p>
            ) : (
              <>
                {/* Action buttons */}
                <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.4rem' }}>
                  <button onClick={downloadAllImages} style={{ flex: 1, padding: '0.3rem', fontSize: '0.65rem', border: '1px solid var(--border-color)', borderRadius: '0.3rem', cursor: 'pointer', background: 'none', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.2rem' }}><Download size={10} /> 下載圖片</button>
                  <button onClick={handleExportPptx} disabled={isExporting} style={{ flex: 1, padding: '0.3rem', fontSize: '0.65rem', border: '1px solid var(--accent-color)', borderRadius: '0.3rem', cursor: 'pointer', background: 'var(--accent-color)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.2rem', opacity: isExporting ? 0.6 : 1 }}><FileDown size={10} /> {isExporting ? '匯出中…' : '匯出 PPTX'}</button>
                </div>
                {isGenerating && (
                  <div style={{ marginBottom: '0.4rem', padding: '0.35rem 0.5rem', background: 'var(--bg-secondary)', borderRadius: '0.4rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.7rem', marginBottom: '0.2rem' }}>
                      <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> 生成中 {genProgress.current}/{genProgress.total}
                    </div>
                    <div style={{ height: '3px', background: 'var(--border-color)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', background: 'var(--accent-color)', width: `${(genProgress.current / genProgress.total) * 100}%`, transition: 'width 0.3s' }} />
                    </div>
                  </div>
                )}
                {galleryImages.map((img, i) => (
                  <div key={i} style={{ marginBottom: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', overflow: 'hidden', position: 'relative' }}>
                    <img src={img} alt={`圖片 ${i + 1}`} onClick={() => setLightbox(img)} style={{ width: '100%', height: 'auto', display: 'block', cursor: 'zoom-in' }} />
                    <div style={{ position: 'absolute', top: '4px', right: '4px' }}>
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

      {showTemplateGallery && <TemplateGalleryModal currentExtraPrompt="" onClose={() => { setShowTemplateGallery(false); setTemplateTargetSlide(null); }} onApply={templateTargetSlide ? handleTemplateApplyForSlide : handleTemplateApply} />}

      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: 'fixed', inset: 0, zIndex: 10200, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <img src={lightbox} alt="展開" onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: '8px', cursor: 'default' }} />
          <button onClick={() => setLightbox(null)} style={{ position: 'absolute', top: '20px', right: '20px', background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><X size={20} color="#fff" /></button>
        </div>
      )}
    </div>
  );
};

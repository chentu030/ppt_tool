import React, { useState, useRef, useEffect, useCallback } from 'react';
import { showAlert, showConfirm } from '../utils/dialog';
import { Send, Paperclip, Image as ImageIcon, X, Loader, Download, Sparkles, Plus, Trash2, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, MessageSquare, FileText, Images, Play, Square, Edit3, FileDown, EyeOff, Eye, Check, Settings } from 'lucide-react';
import { chatWithGemini, generateChatTitle, transformSlideText } from '../utils/gemini';
import type { ChatMessage as GeminiChatMessage } from '../utils/gemini';
import type { TransformOp } from '../utils/gemini';
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
interface SlideOperation {
  action: 'update' | 'delete' | 'add';
  pageNum: number;
  title?: string;
  content?: string;
}

// ── Persistence ────────────────────────────────────────────────────────────────
const LS_KEY = 'ai_chat_conversations';
const slidesKey = (id: string | null) => id ? `ai_slide_plans_${id}` : null;
const loadSlidePlans = (id: string | null): SlidePlan[] => { const k = slidesKey(id); if (!k) return []; try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
const saveSlidePlans = (plans: SlidePlan[], id: string | null) => {
  const k = slidesKey(id); if (!k) return;
  try { localStorage.setItem(k, JSON.stringify(plans)); }
  catch {
    // Quota exceeded — retry without generatedImage (largest field)
    try { localStorage.setItem(k, JSON.stringify(plans.map(p => ({ ...p, generatedImage: undefined })))); }
    catch { /* still too big, give up */ }
  }
};
const deleteSlidePlans = (id: string) => { try { localStorage.removeItem(`ai_slide_plans_${id}`); } catch { /* ignore */ } };
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
  const [fontFamily, setFontFamily] = useState('');
  const [mainColor, setMainColor] = useState('');
  const [highlightColor, setHighlightColor] = useState('');
  const [specialMark, setSpecialMark] = useState('');
  const [bgColor, setBgColor] = useState('');
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
  const [showStyleSettings, setShowStyleSettings] = useState(false);
  const [addPagesCount, setAddPagesCount] = useState(1);
  const [activeSlideId, setActiveSlideId] = useState<string | null>(null);
  const [isContentProcessing, setIsContentProcessing] = useState(false);
  const [showToneMenu, setShowToneMenu] = useState(false);
  const [pendingSlideUpdate, setPendingSlideUpdate] = useState<{ msgId: string; ops: SlideOperation[] } | null>(null);
  const [slidePlanVisible, setSlidePlanVisible] = useState(false);
  const [slidePlanHeight, setSlidePlanHeight] = useState(45);
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(220);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(300);
  const dragHandleRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const leftResizeRef = useRef<{ startX: number; startW: number } | null>(null);
  const rightResizeRef = useRef<{ startX: number; startW: number } | null>(null);
  // 429 auto-retry state
  const [retryModal429, setRetryModal429] = useState<{ successCount: number; toRetryIds: string[] } | null>(null);
  const [retryIntervalSec, setRetryIntervalSec] = useState(30);
  const [retryStopCond, setRetryStopCond] = useState<'success' | 'retries' | 'time'>('success');
  const [retryMaxTimes, setRetryMaxTimes] = useState(3);
  const [retryUntilTime, setRetryUntilTime] = useState(() => { const d = new Date(); d.setHours(d.getHours() + 1); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; });
  const [autoRetryStatus, setAutoRetryStatus] = useState<{ countdown: number; doneCount: number } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const autoRetryConfigRef = useRef<{ toRetryIds: string[]; intervalSec: number; stopCond: 'success' | 'retries' | 'time'; maxTimes: number; untilTime: string; doneCount: number } | null>(null);
  const autoRetryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoRetryIsWaiting = useRef(false);
  const retryModal429Ref = useRef<{ successCount: number; toRetryIds: string[] } | null>(null);
  const handleGenerateRef = useRef<(retryIds?: string[]) => void>(() => {});
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
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

  // Persist slide plans under current conversation ID
  // Use ref for activeId to avoid saving stale plans when conversation switches
  useEffect(() => {
    saveSlidePlans(slidePlans, activeIdRef.current);
    if (slidePlans.length > 0) setSlidePlanVisible(true);
  }, [slidePlans]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load slide plans when active conversation changes
  useEffect(() => {
    const plans = loadSlidePlans(activeId);
    setSlidePlans(plans);
    setSlidePlanVisible(plans.length > 0);
    setActiveSlideId(plans[0]?.id || null);
  }, [activeId]);

  // Drag-to-resize slide plan panel
  const onDragHandleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const containerH = (e.currentTarget.closest('[data-chat-center]') as HTMLElement)?.offsetHeight ?? window.innerHeight;
    dragHandleRef.current = { startY: e.clientY, startHeight: slidePlanHeight };
    const onMove = (me: MouseEvent) => {
      if (!dragHandleRef.current) return;
      const delta = dragHandleRef.current.startY - me.clientY;
      const deltaVh = (delta / containerH) * 100;
      setSlidePlanHeight(_ => Math.min(85, Math.max(20, dragHandleRef.current!.startHeight + deltaVh)));
    };
    const onUp = () => { dragHandleRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [slidePlanHeight]);

  // Drag-to-resize left sidebar width
  const onLeftResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    leftResizeRef.current = { startX: e.clientX, startW: leftSidebarWidth };
    const onMove = (me: MouseEvent) => {
      if (!leftResizeRef.current) return;
      setLeftSidebarWidth(Math.min(400, Math.max(140, leftResizeRef.current.startW + me.clientX - leftResizeRef.current.startX)));
    };
    const onUp = () => { leftResizeRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [leftSidebarWidth]);

  // Drag-to-resize right sidebar width
  const onRightResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    rightResizeRef.current = { startX: e.clientX, startW: rightSidebarWidth };
    const onMove = (me: MouseEvent) => {
      if (!rightResizeRef.current) return;
      setRightSidebarWidth(Math.min(500, Math.max(180, rightResizeRef.current.startW - (me.clientX - rightResizeRef.current.startX))));
    };
    const onUp = () => { rightResizeRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [rightSidebarWidth]);

  // Reorder slides
  const moveSlide = (id: string, dir: -1 | 1) => {
    setSlidePlans(prev => {
      const idx = prev.findIndex(s => s.id === id);
      const to = idx + dir;
      if (to < 0 || to >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[to]] = [arr[to], arr[idx]];
      return arr.map((s, i) => ({ ...s, pageNum: i + 1 }));
    });
  };

  // Apply or reject pending AI slide updates
  const applyPendingUpdate = () => {
    if (!pendingSlideUpdate) return;
    setSlidePlans(prev => {
      let result = [...prev];
      for (const op of pendingSlideUpdate.ops) {
        if (op.action === 'delete') {
          result = result.filter(s => s.pageNum !== op.pageNum);
        } else if (op.action === 'update') {
          const idx = result.findIndex(s => s.pageNum === op.pageNum);
          if (idx >= 0) {
            if (op.title !== undefined) result[idx] = { ...result[idx], title: op.title };
            if (op.content !== undefined) result[idx] = { ...result[idx], content: op.content };
          }
        } else if (op.action === 'add') {
          result.push({ id: `slide-${Date.now()}-${op.pageNum}`, pageNum: op.pageNum, title: op.title || '', content: op.content || '' });
        }
      }
      return result.sort((a, b) => a.pageNum - b.pageNum).map((s, i) => ({ ...s, pageNum: i + 1 }));
    });
    // Append confirmation note to the AI message
    setMessages(prev => prev.map(m => m.id === pendingSlideUpdate.msgId ? { ...m, text: m.text + '\n\n✅ 變更已套用。' } : m));
    setPendingSlideUpdate(null);
  };
  const rejectPendingUpdate = () => {
    if (!pendingSlideUpdate) return;
    setMessages(prev => prev.map(m => m.id === pendingSlideUpdate.msgId ? { ...m, text: m.text + '\n\n❌ 使用者已取消此變更。' } : m));
    setPendingSlideUpdate(null);
  };

  // Keep ref in sync for callbacks
  retryModal429Ref.current = retryModal429;

  // Post-generate: check if auto-retry was waiting
  useEffect(() => {
    if (!autoRetryIsWaiting.current) return;
    if (isGenerating) return;
    autoRetryIsWaiting.current = false;
    const config = autoRetryConfigRef.current;
    if (!config) return;
    const newDone = config.doneCount + 1;
    config.doneCount = newDone;
    const another429 = retryModal429Ref.current;
    if (!another429) {
      autoRetryConfigRef.current = null;
      if (autoRetryTimerRef.current) clearInterval(autoRetryTimerRef.current);
      autoRetryTimerRef.current = null;
      setAutoRetryStatus(null);
      return;
    }
    if (config.stopCond === 'retries' && newDone >= config.maxTimes) {
      autoRetryConfigRef.current = null;
      if (autoRetryTimerRef.current) clearInterval(autoRetryTimerRef.current);
      autoRetryTimerRef.current = null;
      setAutoRetryStatus(null);
      return;
    }
    if (config.stopCond === 'time' && config.untilTime) {
      const now = new Date();
      const [h, m] = config.untilTime.split(':').map(Number);
      if (now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m)) {
        autoRetryConfigRef.current = null;
        if (autoRetryTimerRef.current) clearInterval(autoRetryTimerRef.current);
        autoRetryTimerRef.current = null;
        setAutoRetryStatus(null);
        return;
      }
    }
    config.toRetryIds = another429.toRetryIds;
    setRetryModal429(null);
    let cd = config.intervalSec;
    setAutoRetryStatus({ countdown: cd, doneCount: newDone });
    if (autoRetryTimerRef.current) clearInterval(autoRetryTimerRef.current);
    autoRetryTimerRef.current = setInterval(() => {
      cd--;
      if (cd <= 0) {
        clearInterval(autoRetryTimerRef.current!); autoRetryTimerRef.current = null;
        const cfg = autoRetryConfigRef.current;
        if (!cfg) return;
        setAutoRetryStatus(prev => prev ? { ...prev, countdown: -1 } : null);
        autoRetryIsWaiting.current = true;
        setTimeout(() => handleGenerateRef.current(cfg.toRetryIds), 50);
      } else {
        setAutoRetryStatus(prev => prev ? { ...prev, countdown: cd } : null);
      }
    }, 1000);
  }, [isGenerating]);

  const loadConversation = (conv: Conversation) => {
    setActiveId(conv.id);
    setMessages(conv.messages);
    setInput(''); setAttachments([]); setGalleryImages([]);
    // slides are loaded by the activeId useEffect
  };
  const newConversation = () => { setActiveId(null); setMessages([]); setInput(''); setAttachments([]); setGalleryImages([]); setSlidePlans([]); };
  const deleteConversation = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteSlidePlans(id);
    setConversations(prev => { const u = prev.filter(c => c.id !== id); saveConversations(u); return u; });
    if (activeId === id) newConversation();
  };

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(file); });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files) return;
    const arr: Attachment[] = [];
    for (const f of Array.from(files)) {
      if (f.size > 20 * 1024 * 1024) { showAlert(`${f.name} 超過 20MB，請選擇較小的檔案。`, '檔案過大'); continue; }
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
    if (settings) {
      if (settings.fontFamily) setFontFamily(settings.fontFamily);
      if (settings.mainColor) setMainColor(settings.mainColor);
      if (settings.highlightColor) setHighlightColor(settings.highlightColor);
      if (settings.specialMark !== undefined) setSpecialMark(settings.specialMark);
      if (settings.backgroundColor) setBgColor(settings.backgroundColor);
    }
    setReferenceLabel([settings?.fontFamily, settings?.highlightColor].filter(Boolean).join(' · ') || '已選擇');
    if (resolvedExtraPrompt !== null) setStylePrompt(resolvedExtraPrompt);
    if (imageUrl && !imageUrl.startsWith('data:')) { setReferenceImage(await urlToBase64(imageUrl)); } else { setReferenceImage(imageUrl); }
  };

  const buildHistory = useCallback((msgs: ChatMsg[], userParts: GeminiChatMessage['parts'], extraStylePrompt?: string, currentSlides?: SlidePlan[]): GeminiChatMessage[] => {
    let sys = '你是專業設計助手，可以整理文件、規劃圖卡內容、回答問題。用繁體中文回答。不要自己生成圖片，圖片生成由系統另外處理。';
    if (extraStylePrompt) sys += `\n\n風格設定：${extraStylePrompt}`;
    if (currentSlides && currentSlides.length > 0) {
      const slidesJson = JSON.stringify(currentSlides.map(s => ({ pageNum: s.pageNum, title: s.title, content: s.content })));
      sys += `\n\n當前投影片規劃（共 ${currentSlides.length} 頁）：\n${slidesJson}\n\n如果使用者要求修改、刪除或擴充投影片，請在回覆末尾附上以下 JSON 格式（使用者會看到預覽並決定是否套用）：\n[SLIDE_UPDATE]\n[{"action":"update","pageNum":1,"title":"新標題","content":"新內容"},{"action":"delete","pageNum":3},{"action":"add","pageNum":${currentSlides.length + 1},"title":"新頁標題","content":"新頁內容"}]\n[/SLIDE_UPDATE]\n\naction 說明：\n- "update"：修改指定頁的標題或內容（只需提供要改的欄位）\n- "delete"：刪除指定頁\n- "add"：新增頁面，pageNum 從 ${currentSlides.length + 1} 開始遞增\n\n注意：先描述你的修改計畫，再附上 [SLIDE_UPDATE] 區塊。使用者會在介面上預覽變更後決定是否套用。`;
    }
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
      const history = buildHistory(messages, parts, stylePrompt || undefined, slidePlans.length > 0 ? slidePlans : undefined);
      const resp = await chatWithGemini(history, apiKey, { generateImage: false }, ctrl.signal);
      // Detect [SLIDE_UPDATE] block in response — store as pending (user must approve)
      const updateMatch = resp.text.match(/\[SLIDE_UPDATE\]([\s\S]*?)\[\/SLIDE_UPDATE\]/);
      let displayText = resp.text;
      const aiMsgId = (Date.now() + 1).toString();
      if (updateMatch) {
        try {
          let rawOps = JSON.parse(updateMatch[1].trim()) as any[];
          // Normalise: legacy format (no action) → 'update' or 'add'
          const existingNums = new Set(slidePlans.map(s => s.pageNum));
          const ops: SlideOperation[] = rawOps.map(o => ({
            action: o.action || (existingNums.has(o.pageNum) ? 'update' : 'add'),
            pageNum: o.pageNum,
            ...(o.title !== undefined ? { title: o.title } : {}),
            ...(o.content !== undefined ? { content: o.content } : {}),
          }));
          displayText = resp.text.replace(/\[SLIDE_UPDATE\][\s\S]*?\[\/SLIDE_UPDATE\]/g, '').trim();
          setPendingSlideUpdate({ msgId: aiMsgId, ops });
        } catch { /* ignore parse error */ }
      }
      setMessages(prev => [...prev, { id: aiMsgId, role: 'assistant', text: displayText, images: [], attachments: [], timestamp: Date.now() }]);
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
    if (messages.length === 0) { showAlert('請先跟 AI 討論要生成的內容。', '提示'); return; }
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
        setActiveSlideId(plans[0]?.id || null);
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

  const handleContentTransform = async (slideId: string, operation: TransformOp) => {
    const slide = slidePlans.find(s => s.id === slideId);
    if (!slide || !slide.content.trim()) return;
    setIsContentProcessing(true);
    setShowToneMenu(false);
    try {
      // Build conversation context from text messages (exclude binary attachments to save tokens)
      const ctxParts: string[] = [];
      for (const m of messages) {
        if (m.text) ctxParts.push(`[${m.role === 'user' ? '使用者' : 'AI'}]: ${m.text}`);
        for (const a of m.attachments) {
          // Only include text-based attachments (skip images)
          if (a.mimeType.startsWith('text/') || a.mimeType.includes('word') || a.mimeType.includes('document')) {
            ctxParts.push(`[附件 ${a.name}]: (二進位檔，內容已在對話中討論)`);
          }
        }
      }
      const conversationContext = ctxParts.join('\n').slice(0, 8000);
      const result = await transformSlideText(slide.content, slide.title, operation, apiKey, undefined, conversationContext || undefined);
      if (result) updateSlidePlan(slideId, 'content', result);
    } catch (err: any) {
      showAlert('處理失敗：' + (err?.message || '未知錯誤'), '錯誤');
    } finally {
      setIsContentProcessing(false);
    }
  };

  const handleTemplateApplyForSlide = ({ imageUrl, resolvedExtraPrompt, settings }: ApplyParams) => {
    setShowTemplateGallery(false);
    if (!templateTargetSlide) { handleTemplateApply({ imageUrl, resolvedExtraPrompt, settings } as ApplyParams); return; }
    const label = [settings?.fontFamily, settings?.highlightColor].filter(Boolean).join(' · ') || '已選擇';
    setSlidePlans(prev => prev.map(s => s.id === templateTargetSlide ? { ...s, templateImage: imageUrl, templateLabel: label, templatePrompt: resolvedExtraPrompt || '' } : s));
    setTemplateTargetSlide(null);
  };

  // ── Generate images from plan ──
  const handleGenerateFromPlan = async (retryIds?: string[]) => {
    // Use snapshot of current slidePlans at call time to avoid stale closure
    const currentPlans = retryIds
      ? (slidePlans.length > 0 ? slidePlans : [])
      : slidePlans;
    if (currentPlans.length === 0) return;
    const slideIds = retryIds ?? currentPlans.map(s => s.id);
    if (slideIds.length === 0) return;

    setIsGenerating(true); genAbortRef.current = false;
    setRetryModal429(null);
    setGenProgress({ current: 0, total: slideIds.length });
    setRightTab('images');

    const RETRY_INTERVAL = 5_000;
    const INTER_DELAY = 2_000;
    const results: (string | null)[] = [];
    let completedCount = 0;

    try {
      for (let i = 0; i < slideIds.length; i++) {
        if (genAbortRef.current) break;
        const slideId = slideIds[i];
        // Get latest slide data (ref may be stale, read from DOM state via functional updater workaround)
        const slide = currentPlans.find(s => s.id === slideId);
        if (!slide) { completedCount++; setGenProgress({ current: completedCount, total: slideIds.length }); results.push(null); continue; }
        try {
          const slideStylePrompt = slide.templatePrompt || stylePrompt || '';
          const advParts = [fontFamily && `Font: ${fontFamily}`, mainColor && `Main color: ${mainColor}`, highlightColor && `Highlight: ${highlightColor}`, bgColor && `Background: ${bgColor}`, specialMark && `Special: ${specialMark}`].filter(Boolean).join(', ');
          const promptText = `Create a professional presentation slide image.\nTitle: ${slide.title}\nContent: ${slide.content}\n${advParts ? `Design settings: ${advParts}\n` : ''}${slideStylePrompt ? `Style: ${slideStylePrompt}\n` : ''}This is slide ${slide.pageNum} of ${currentPlans.length}.`;
          const imgHistory: GeminiChatMessage[] = [{ role: 'user', parts: [{ text: promptText }] }];
          const refImg = slide.templateImage || referenceImage;
          let resolvedRef = refImg;
          if (refImg && !refImg.startsWith('data:')) { resolvedRef = await urlToBase64(refImg); }

          // Inner retry loop: retry every 5s for up to 60s on 429
          let generatedImg = '';
          const RETRY_DEADLINE = Date.now() + 60_000;
          let lastErr: unknown;
          while (true) {
            if (genAbortRef.current) break;
            try {
              const resp = await chatWithGemini(imgHistory, apiKey, { generateImage: true, referenceImage: resolvedRef, aspectRatio });
              if (resp.images.length > 0) { generatedImg = resp.images[0]; }
              break;
            } catch (e: unknown) {
              lastErr = e;
              const is429 = String((e as { message?: string })?.message ?? e).includes('429');
              if (!is429 || Date.now() >= RETRY_DEADLINE) throw lastErr;
              console.warn('[429] 5 秒後自動重試...');
              await new Promise<void>(r => setTimeout(r, RETRY_INTERVAL));
            }
          }
          if (generatedImg) {
            setSlidePlans(prev => prev.map(s => s.id === slideId ? { ...s, generatedImage: generatedImg } : s));
            setGalleryImages(prev => { const withoutOld = prev.filter((_, gi) => gi !== currentPlans.findIndex(sp => sp.id === slideId)); return [...withoutOld, generatedImg]; });
            results.push(generatedImg);
          } else {
            results.push(null);
          }
          completedCount++; setGenProgress({ current: completedCount, total: slideIds.length });
          if (i < slideIds.length - 1) await new Promise(r => setTimeout(r, INTER_DELAY));
        } catch (err: any) {
          const msg = String(err?.message ?? err);
          const is429 = msg.includes('429');
          console.error(`Slide ${slide.pageNum} failed:`, msg);
          completedCount++; setGenProgress({ current: completedCount, total: slideIds.length });
          results.push(null);
          if (is429) throw new Error('QUOTA_EXHAUSTED:' + msg);
        }
      }
    } catch (loopErr: any) {
      if (!String(loopErr).includes('QUOTA_EXHAUSTED')) {
        console.error('Generation error:', loopErr);
      } else {
        const successCount = results.filter(Boolean).length;
        const toRetryIds = slideIds.filter((_, i) => !results[i]);
        setRetryModal429({ successCount, toRetryIds });
      }
    }

    setIsGenerating(false);
  };

  // Wire ref so auto-retry timer can call latest version
  handleGenerateRef.current = (retryIds?: string[]) => {
    // Read latest slidePlans via closure — need to use a setter trick
    setSlidePlans(prev => {
      setTimeout(() => handleGenerateFromPlanWithPlans(prev, retryIds), 0);
      return prev;
    });
  };

  // Version that accepts explicit plans snapshot for auto-retry
  const handleGenerateFromPlanWithPlans = async (plans: SlidePlan[], retryIds?: string[]) => {
    const slideIds = retryIds ?? plans.map(s => s.id);
    if (slideIds.length === 0) return;

    setIsGenerating(true); genAbortRef.current = false;
    setRetryModal429(null);
    setGenProgress({ current: 0, total: slideIds.length });
    setRightTab('images');

    const RETRY_INTERVAL = 5_000;
    const INTER_DELAY = 2_000;
    const results: (string | null)[] = [];
    let completedCount = 0;

    try {
      for (let i = 0; i < slideIds.length; i++) {
        if (genAbortRef.current) break;
        const slideId = slideIds[i];
        const slide = plans.find(s => s.id === slideId);
        if (!slide) { completedCount++; setGenProgress({ current: completedCount, total: slideIds.length }); results.push(null); continue; }
        try {
          const slideStylePrompt = slide.templatePrompt || stylePrompt || '';
          const advParts = [fontFamily && `Font: ${fontFamily}`, mainColor && `Main color: ${mainColor}`, highlightColor && `Highlight: ${highlightColor}`, bgColor && `Background: ${bgColor}`, specialMark && `Special: ${specialMark}`].filter(Boolean).join(', ');
          const promptText = `Create a professional presentation slide image.\nTitle: ${slide.title}\nContent: ${slide.content}\n${advParts ? `Design settings: ${advParts}\n` : ''}${slideStylePrompt ? `Style: ${slideStylePrompt}\n` : ''}This is slide ${slide.pageNum} of ${plans.length}.`;
          const imgHistory: GeminiChatMessage[] = [{ role: 'user', parts: [{ text: promptText }] }];
          const refImg = slide.templateImage || referenceImage;
          let resolvedRef = refImg;
          if (refImg && !refImg.startsWith('data:')) { resolvedRef = await urlToBase64(refImg); }

          let generatedImg = '';
          const RETRY_DEADLINE = Date.now() + 60_000;
          let lastErr: unknown;
          while (true) {
            if (genAbortRef.current) break;
            try {
              const resp = await chatWithGemini(imgHistory, apiKey, { generateImage: true, referenceImage: resolvedRef, aspectRatio });
              if (resp.images.length > 0) { generatedImg = resp.images[0]; }
              break;
            } catch (e: unknown) {
              lastErr = e;
              const is429 = String((e as { message?: string })?.message ?? e).includes('429');
              if (!is429 || Date.now() >= RETRY_DEADLINE) throw lastErr;
              console.warn('[429] 5 秒後自動重試...');
              await new Promise<void>(r => setTimeout(r, RETRY_INTERVAL));
            }
          }
          if (generatedImg) {
            setSlidePlans(prev => prev.map(s => s.id === slideId ? { ...s, generatedImage: generatedImg } : s));
            setGalleryImages(prev => [...prev, generatedImg]);
            results.push(generatedImg);
          } else {
            results.push(null);
          }
          completedCount++; setGenProgress({ current: completedCount, total: slideIds.length });
          if (i < slideIds.length - 1) await new Promise(r => setTimeout(r, INTER_DELAY));
        } catch (err: any) {
          const msg = String(err?.message ?? err);
          const is429 = msg.includes('429');
          console.error(`Slide ${slide.pageNum} failed:`, msg);
          completedCount++; setGenProgress({ current: completedCount, total: slideIds.length });
          results.push(null);
          if (is429) throw new Error('QUOTA_EXHAUSTED:' + msg);
        }
      }
    } catch (loopErr: any) {
      if (!String(loopErr).includes('QUOTA_EXHAUSTED')) {
        console.error('Generation error:', loopErr);
      } else {
        const successCount = results.filter(Boolean).length;
        const toRetryIds = slideIds.filter((_, i) => !results[i]);
        setRetryModal429({ successCount, toRetryIds });
      }
    }

    setIsGenerating(false);
  };

  const stopGenerating = () => { genAbortRef.current = true; };

  const startAutoRetry = () => {
    if (!retryModal429) return;
    const intervalSec = Math.max(5, retryIntervalSec);
    const cfg = { toRetryIds: [...retryModal429.toRetryIds], intervalSec, stopCond: retryStopCond, maxTimes: retryMaxTimes, untilTime: retryUntilTime, doneCount: 0 };
    autoRetryConfigRef.current = cfg;
    setRetryModal429(null);
    let cd = intervalSec;
    setAutoRetryStatus({ countdown: cd, doneCount: 0 });
    if (autoRetryTimerRef.current) clearInterval(autoRetryTimerRef.current);
    autoRetryTimerRef.current = setInterval(() => {
      cd--;
      if (cd <= 0) {
        clearInterval(autoRetryTimerRef.current!); autoRetryTimerRef.current = null;
        const c = autoRetryConfigRef.current;
        if (!c) return;
        setAutoRetryStatus(prev => prev ? { ...prev, countdown: -1 } : null);
        autoRetryIsWaiting.current = true;
        setTimeout(() => handleGenerateRef.current(c.toRetryIds), 50);
      } else {
        setAutoRetryStatus(prev => prev ? { ...prev, countdown: cd } : null);
      }
    }, 1000);
  };

  // ── PPTX Export ──
  const handleExportPptx = async () => {
    const images = galleryImages.filter(Boolean);
    if (images.length === 0) { showAlert('沒有可匯出的圖片。', '提示'); return; }
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
    } catch (err: any) { showAlert(`匯出失敗：${err.message}`, '錯誤'); }
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
      <div style={{ width: leftSidebarOpen ? `${leftSidebarWidth}px` : '36px', minWidth: leftSidebarOpen ? `${leftSidebarWidth}px` : '36px', borderRight: 'none', display: 'flex', flexDirection: 'row', background: 'var(--bg-primary)', position: 'relative', flexShrink: 0 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden', borderRight: '1px solid var(--border-color)' }}>
        <div style={{ ...panelHeader, justifyContent: 'space-between', minWidth: 0 }}>
          {leftSidebarOpen && <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', whiteSpace: 'nowrap', overflow: 'hidden' }}><MessageSquare size={14} /> 歷史對話</span>}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', marginLeft: leftSidebarOpen ? 'auto' : 0 }}>
            {leftSidebarOpen && <button onClick={newConversation} title="新對話" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--accent-color)' }}><Plus size={15} /></button>}
            <button onClick={() => setLeftSidebarOpen(o => !o)} title={leftSidebarOpen ? '收起' : '展開歷史'} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--text-secondary)' }}>
              {leftSidebarOpen ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
            </button>
          </div>
        </div>
        {leftSidebarOpen && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '0.3rem', minHeight: 0 }}>
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
        )}
        </div>
        {/* Left sidebar drag-resize handle */}
        {leftSidebarOpen && (
          <div onMouseDown={onLeftResizeMouseDown} style={{ width: '5px', cursor: 'ew-resize', background: 'transparent', flexShrink: 0, zIndex: 10, position: 'absolute', right: 0, top: 0, bottom: 0 }} />
        )}
      </div>

      {/* ── Center: Chat ── */}
      <div data-chat-center="1" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--bg-secondary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 1rem', borderBottom: '1px solid var(--border-color)', flexShrink: 0, background: 'var(--bg-primary)' }}>
          <h2 style={{ margin: 0, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap' }}>
            <Sparkles size={18} color="var(--accent-color)" /> AI 協作
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            {slidePlans.length > 0 && (
              <button onClick={() => setSlidePlanVisible(v => !v)}
                title={slidePlanVisible ? '隱藏投影片規劃' : '顯示投影片規劃'}
                style={{ padding: '0.25rem 0.55rem', fontSize: '0.72rem', border: '1px solid var(--border-color)', borderRadius: '0.4rem', cursor: 'pointer', background: slidePlanVisible ? 'var(--bg-tertiary)' : 'var(--accent-color)', color: slidePlanVisible ? 'var(--text-secondary)' : '#fff', display: 'flex', alignItems: 'center', gap: '0.25rem', transition: 'all 0.2s' }}>
                {slidePlanVisible ? <EyeOff size={12} /> : <Eye size={12} />} 投影片規劃 ({slidePlans.length})
              </button>
            )}
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
              {/* Pending slide update approval card */}
              {pendingSlideUpdate && pendingSlideUpdate.msgId === msg.id && (
                <div style={{ maxWidth: '85%', marginTop: '0.4rem', padding: '0.7rem 0.9rem', background: 'var(--bg-primary)', border: '2px solid var(--accent-color)', borderRadius: '0.6rem', fontSize: '0.78rem', boxShadow: '0 2px 12px rgba(52, 152, 219, 0.15)' }}>
                  <div style={{ fontWeight: 700, marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--accent-color)' }}>
                    <Edit3 size={13} /> AI 建議以下投影片變更：
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '0.6rem' }}>
                    {pendingSlideUpdate.ops.map((op, i) => (
                      <div key={i} style={{ padding: '0.3rem 0.5rem', background: op.action === 'delete' ? 'rgba(231,76,60,0.08)' : op.action === 'add' ? 'rgba(39,174,96,0.08)' : 'rgba(52,152,219,0.08)', borderRadius: '0.3rem', fontSize: '0.72rem', display: 'flex', alignItems: 'flex-start', gap: '0.3rem' }}>
                        <span style={{ fontWeight: 700, color: op.action === 'delete' ? '#e74c3c' : op.action === 'add' ? '#27ae60' : 'var(--accent-color)', flexShrink: 0, minWidth: '2.5rem' }}>
                          {op.action === 'delete' ? '🗑 刪除' : op.action === 'add' ? '➕ 新增' : '✏️ 修改'}
                        </span>
                        <span style={{ color: 'var(--text-primary)' }}>
                          第 {op.pageNum} 頁
                          {op.action !== 'delete' && op.title && <> — <strong>{op.title}</strong></>}
                          {op.action !== 'delete' && op.content && <div style={{ marginTop: '0.15rem', fontSize: '0.68rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', maxHeight: '3rem', overflow: 'hidden' }}>{op.content.slice(0, 120)}{op.content.length > 120 ? '…' : ''}</div>}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button onClick={applyPendingUpdate} style={{ flex: 1, padding: '0.4rem', fontSize: '0.75rem', fontWeight: 600, border: 'none', borderRadius: '0.35rem', cursor: 'pointer', background: 'var(--accent-color)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}>
                      <Check size={13} /> 套用變更
                    </button>
                    <button onClick={rejectPendingUpdate} style={{ flex: 1, padding: '0.4rem', fontSize: '0.75rem', fontWeight: 600, border: '1px solid var(--border-color)', borderRadius: '0.35rem', cursor: 'pointer', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}>
                      <X size={13} /> 取消
                    </button>
                  </div>
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

        {/* ── Slide Plan Module (Split View) ── */}
        {slidePlans.length > 0 && slidePlanVisible && (
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', height: `${slidePlanHeight}vh`, minHeight: '240px', borderTop: '1px solid var(--border-color)', background: 'var(--bg-primary)', boxShadow: '0 -4px 12px rgba(0,0,0,0.02)' }}>
            {/* Drag handle */}
            <div onMouseDown={onDragHandleMouseDown} style={{ height: '6px', cursor: 'ns-resize', background: 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none' }}>
              <div style={{ width: '32px', height: '3px', borderRadius: '2px', background: 'var(--border-color)' }} />
            </div>
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
                <button onClick={() => setShowStyleSettings(v => !v)} title="風格設定" style={{ padding: '0.2rem 0.5rem', fontSize: '0.68rem', border: '1px solid var(--border-color)', borderRadius: '0.25rem', cursor: 'pointer', background: showStyleSettings ? 'var(--accent-color)' : 'var(--bg-secondary)', color: showStyleSettings ? '#fff' : 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.25rem', transition: 'all 0.2s' }}>
                  <Settings size={11} /> 設定
                </button>
                {showStyleSettings && (
                  <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '4px', width: '320px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', boxShadow: '0 8px 24px rgba(0,0,0,0.18)', padding: '0.75rem', zIndex: 20, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--text-primary)' }}>風格設定</span>
                      <button onClick={() => setShowStyleSettings(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--text-secondary)' }}><X size={13} /></button>
                    </div>
                    {referenceImage && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem', background: 'var(--bg-secondary)', borderRadius: '0.35rem', border: '1px solid var(--border-color)' }}>
                        <img src={referenceImage} alt="ref" style={{ width: '48px', height: '30px', objectFit: 'cover', borderRadius: '3px', border: '1px solid var(--border-color)' }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-primary)' }}>{referenceLabel || '風格參考圖'}</div>
                          <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)' }}>來自模板庫</div>
                        </div>
                        <button onClick={() => { setReferenceImage(null); setReferenceLabel(''); }} title="移除參考圖" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: '#e74c3c' }}><Trash2 size={11} /></button>
                      </div>
                    )}
                    {/* Advanced settings grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
                      {[
                        { label: '字體', value: fontFamily, set: setFontFamily, ph: 'Noto Sans TC' },
                        { label: '主色', value: mainColor, set: setMainColor, ph: '#333333' },
                        { label: '強調色/方式', value: highlightColor, set: setHighlightColor, ph: '藍色底線' },
                        { label: '背景色', value: bgColor, set: setBgColor, ph: '白色' },
                      ].map(f => (
                        <div key={f.label} style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                          <label style={{ fontSize: '0.62rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{f.label}</label>
                          <input value={f.value} onChange={e => f.set(e.target.value)} placeholder={f.ph}
                            style={{ width: '100%', padding: '0.3rem 0.4rem', fontSize: '0.72rem', border: '1px solid var(--border-color)', borderRadius: '0.25rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }} />
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                      <label style={{ fontSize: '0.62rem', fontWeight: 600, color: 'var(--text-secondary)' }}>特殊標記</label>
                      <input value={specialMark} onChange={e => setSpecialMark(e.target.value)} placeholder="例如：校徽浮水印、LOGO…"
                        style={{ width: '100%', padding: '0.3rem 0.4rem', fontSize: '0.72rem', border: '1px solid var(--border-color)', borderRadius: '0.25rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <label style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)' }}>額外提示詞</label>
                      <textarea value={stylePrompt} onChange={e => setStylePrompt(e.target.value)} placeholder="例如：不要太花俏，背景簡潔，文字清晰可讀…" rows={3}
                        style={{ width: '100%', padding: '0.5rem', fontSize: '0.75rem', border: '1px solid var(--border-color)', borderRadius: '0.3rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', outline: 'none', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box' }} />
                      <span style={{ fontSize: '0.6rem', color: 'var(--text-secondary)' }}>此提示詞會附加到每張投影片的圖片生成指令中</span>
                    </div>
                    {(stylePrompt || fontFamily || mainColor || highlightColor || bgColor || specialMark) && (
                      <button onClick={() => { setStylePrompt(''); setFontFamily(''); setMainColor(''); setHighlightColor(''); setBgColor(''); setSpecialMark(''); }} style={{ padding: '0.3rem', fontSize: '0.68rem', border: '1px solid var(--border-color)', borderRadius: '0.25rem', cursor: 'pointer', background: 'var(--bg-secondary)', color: '#e74c3c', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.2rem' }}>
                        <Trash2 size={10} /> 清除所有設定
                      </button>
                    )}
                  </div>
                )}
                <div style={{ width: '1px', height: '12px', background: 'var(--border-color)', margin: '0 0.1rem' }} />
                <button onClick={() => setShowAddPages(!showAddPages)}
                  style={{ padding: '0.2rem 0.5rem', fontSize: '0.68rem', border: '1px solid var(--border-color)', borderRadius: '0.25rem', cursor: 'pointer', background: 'var(--bg-secondary)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.15rem' }}><Plus size={11} /> 新增</button>
                {showAddPages && (
                  <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '4px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '0.4rem', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', padding: '0.5rem', zIndex: 10, display: 'flex', alignItems: 'center', gap: '0.3rem', whiteSpace: 'nowrap' }}>
                    <span style={{ fontSize: '0.7rem' }}>新增</span>
                    <input type="number" min={1} max={20} value={addPagesCount} onChange={e => setAddPagesCount(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                      style={{ width: '36px', padding: '0.2rem', fontSize: '0.72rem', border: '1px solid var(--border-color)', borderRadius: '0.2rem', textAlign: 'center', background: 'var(--bg-secondary)', color: 'var(--text-primary)', outline: 'none' }} />
                    <span style={{ fontSize: '0.7rem' }}>頁</span>
                    <button onClick={() => { 
                      const newSlides = Array.from({ length: addPagesCount }, (_, i) => ({ id: `slide-${Date.now()}-${slidePlans.length + i}`, pageNum: slidePlans.length + i + 1, title: '新投影片', content: '' }));
                      setSlidePlans(prev => [...prev, ...newSlides]); 
                      if (!activeSlideId) setActiveSlideId(newSlides[0].id);
                      setShowAddPages(false); 
                    }} style={{ padding: '0.2rem 0.4rem', fontSize: '0.68rem', border: 'none', borderRadius: '0.2rem', cursor: 'pointer', background: 'var(--accent-color)', color: '#fff' }}>確定</button>
                  </div>
                )}
                <select value={aspectRatio} onChange={e => setAspectRatio(e.target.value)} style={{ padding: '0.2rem 0.3rem', fontSize: '0.65rem', borderRadius: '0.25rem', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)', cursor: 'pointer' }}>
                  <option value="16:9">16:9</option><option value="1:1">1:1</option><option value="9:16">9:16</option><option value="4:3">4:3</option>
                </select>
                <button onClick={() => setSlidePlanVisible(false)} title="隱藏規劃框" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px', color: 'var(--text-secondary)', opacity: 0.6 }}><X size={13} /></button>
                <button onClick={async () => { if (await showConfirm('確定清除所有投影片規劃？', '清除確認', '清除', '取消')) { setSlidePlans([]); setActiveSlideId(null); } }} title="清除全部" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px', color: '#e74c3c', opacity: 0.6 }}><Trash2 size={12} /></button>
              </div>
            </div>

            {/* Split View Content */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: 'var(--bg-secondary)' }}>
              
              {/* Left Panel: Slide List */}
              <div style={{ width: '220px', borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)', flexShrink: 0 }}>
                <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
                  {slidePlans.map((slide, idx) => (
                    <div key={slide.id} onClick={() => setActiveSlideId(slide.id)}
                      style={{ padding: '0.35rem 0.4rem', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer', borderRadius: '0.4rem', marginBottom: '0.2rem', background: activeSlideId === slide.id ? 'var(--bg-secondary)' : 'transparent', border: activeSlideId === slide.id ? '1px solid var(--border-color)' : '1px solid transparent', transition: 'all 0.15s' }}>
                      <div style={{ width: '18px', height: '18px', borderRadius: '3px', background: slide.generatedImage ? '#27ae60' : (slide.templateImage ? 'var(--accent-color)' : 'var(--bg-tertiary)'), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.58rem', fontWeight: 700, flexShrink: 0 }}>
                        {slide.pageNum}
                      </div>
                      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 600, color: activeSlideId === slide.id ? 'var(--text-primary)' : 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {slide.title || '無標題'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', opacity: activeSlideId === slide.id ? 1 : 0, transition: 'opacity 0.15s' }}>
                        <button onClick={e => { e.stopPropagation(); moveSlide(slide.id, -1); }} disabled={idx === 0 || isGenerating} title="上移" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px', color: 'var(--text-secondary)', lineHeight: 1, opacity: idx === 0 ? 0.2 : 1 }}><ChevronUp size={9} /></button>
                        <button onClick={e => { e.stopPropagation(); moveSlide(slide.id, 1); }} disabled={idx === slidePlans.length - 1 || isGenerating} title="下移" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px', color: 'var(--text-secondary)', lineHeight: 1, opacity: idx === slidePlans.length - 1 ? 0.2 : 1 }}><ChevronDown size={9} /></button>
                      </div>
                      <button onClick={(e) => { 
                          e.stopPropagation(); 
                          setSlidePlans(prev => { 
                            const arr = prev.filter(s => s.id !== slide.id).map((s, i) => ({ ...s, pageNum: i + 1 }));
                            if (activeSlideId === slide.id) setActiveSlideId(arr[0]?.id || null);
                            return arr;
                          }); 
                        }} 
                        title="刪除" disabled={isGenerating} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--text-secondary)', opacity: isGenerating ? 0.2 : (activeSlideId === slide.id ? 0.5 : 0), transition: 'opacity 0.2s' }}>
                        <Trash2 size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Panel: Active Slide Editor & Preview */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.5rem', display: 'flex', flexDirection: 'column' }}>
                {activeSlideId ? (() => {
                  const slide = slidePlans.find(s => s.id === activeSlideId);
                  if (!slide) return null;
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', maxWidth: '800px', margin: '0 auto', width: '100%' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-color)', background: 'rgba(52, 152, 219, 0.1)', padding: '0.2rem 0.5rem', borderRadius: '0.3rem', alignSelf: 'flex-start' }}>第 {slide.pageNum} 頁</span>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>標題</label>
                        <input value={slide.title} onChange={e => updateSlidePlan(slide.id, 'title', e.target.value)} placeholder="點此輸入投影片標題" disabled={isGenerating}
                          style={{ width: '100%', padding: '0.6rem 0.8rem', fontSize: '1.1rem', fontWeight: 700, border: '1px solid var(--border-color)', borderRadius: '0.4rem', background: 'var(--bg-primary)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.2s', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.02)', ...(isGenerating ? {} : { ':focus': { borderColor: 'var(--accent-color)' } } as any) }} />
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.3rem' }}>
                          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>內容文字</label>
                          <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            {/* Expand */}
                            <button onClick={() => handleContentTransform(slide.id, 'expand')} disabled={isGenerating || isContentProcessing || !slide.content.trim()} title="擴展文字內容"
                              style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', padding: '0.2rem 0.5rem', fontSize: '0.68rem', fontWeight: 600, border: '1px solid var(--border-color)', borderRadius: '0.25rem', cursor: (isGenerating || isContentProcessing || !slide.content.trim()) ? 'not-allowed' : 'pointer', background: 'var(--bg-secondary)', color: 'var(--text-primary)', opacity: (isGenerating || isContentProcessing) ? 0.4 : 1 }}>
                              {isContentProcessing ? <Loader size={9} style={{ animation: 'spin 1s linear infinite' }} /> : '↕'} 增長
                            </button>
                            {/* Shorten */}
                            <button onClick={() => handleContentTransform(slide.id, 'shorten')} disabled={isGenerating || isContentProcessing || !slide.content.trim()} title="精簡文字內容"
                              style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', padding: '0.2rem 0.5rem', fontSize: '0.68rem', fontWeight: 600, border: '1px solid var(--border-color)', borderRadius: '0.25rem', cursor: (isGenerating || isContentProcessing || !slide.content.trim()) ? 'not-allowed' : 'pointer', background: 'var(--bg-secondary)', color: 'var(--text-primary)', opacity: (isGenerating || isContentProcessing) ? 0.4 : 1 }}>
                              縮短
                            </button>
                            {/* Tone dropdown */}
                            <div style={{ position: 'relative' }}>
                              <button onClick={() => setShowToneMenu(v => !v)} disabled={isGenerating || isContentProcessing || !slide.content.trim()} title="語氣調整"
                                style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', padding: '0.2rem 0.5rem', fontSize: '0.68rem', fontWeight: 600, border: '1px solid var(--border-color)', borderRadius: '0.25rem', cursor: (isGenerating || isContentProcessing || !slide.content.trim()) ? 'not-allowed' : 'pointer', background: 'var(--bg-secondary)', color: 'var(--text-primary)', opacity: (isGenerating || isContentProcessing) ? 0.4 : 1 }}>
                                語氣 ▾
                              </button>
                              {showToneMenu && (
                                <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '0.2rem', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '0.35rem', boxShadow: '0 4px 16px rgba(0,0,0,0.15)', zIndex: 200, minWidth: '110px', overflow: 'hidden' }}>
                                  {([['tone-formal', '正式商業'], ['tone-casual', '輕鬆平易'], ['tone-academic', '學術研究']] as [TransformOp, string][]).map(([op, label]) => (
                                    <button key={op} onClick={() => handleContentTransform(slide.id, op)}
                                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.4rem 0.7rem', fontSize: '0.75rem', border: 'none', cursor: 'pointer', background: 'none', color: 'var(--text-primary)' }}
                                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                                      {label}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                            {/* Grounding */}
                            <button onClick={() => handleContentTransform(slide.id, 'grounding')} disabled={isGenerating || isContentProcessing || !slide.content.trim()} title="上網搜尋並擴充內容"
                              style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', padding: '0.2rem 0.5rem', fontSize: '0.68rem', fontWeight: 600, border: '1px solid var(--accent-color)', borderRadius: '0.25rem', cursor: (isGenerating || isContentProcessing || !slide.content.trim()) ? 'not-allowed' : 'pointer', background: 'rgba(52,152,219,0.08)', color: 'var(--accent-color)', opacity: (isGenerating || isContentProcessing) ? 0.4 : 1 }}>
                              🌐 聯網擴充
                            </button>
                          </div>
                        </div>
                        {isContentProcessing && (
                          <div style={{ fontSize: '0.7rem', color: 'var(--accent-color)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                            <Loader size={10} style={{ animation: 'spin 1s linear infinite' }} /> AI 處理中…
                          </div>
                        )}
                        <textarea value={slide.content} onChange={e => updateSlidePlan(slide.id, 'content', e.target.value)} placeholder="在這裡編輯投影片的主要內容…" disabled={isGenerating || isContentProcessing}
                          style={{ width: '100%', padding: '0.6rem 0.8rem', fontSize: '0.9rem', border: '1px solid var(--border-color)', borderRadius: '0.4rem', background: isContentProcessing ? 'var(--bg-secondary)' : 'var(--bg-primary)', color: 'var(--text-primary)', outline: 'none', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6, boxSizing: 'border-box', minHeight: '120px', transition: 'border-color 0.2s', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.02)' }} />
                      </div>

                      {slide.generatedImage && (
                        <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#27ae60', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>✓ 生成結果預覽</label>
                            <div style={{ display: 'flex', gap: '0.3rem' }}>
                              <button onClick={() => { setSlidePlans(prev => prev.map(s => s.id === slide.id ? { ...s, generatedImage: undefined } : s)); }} disabled={isGenerating} title="清除此頁圖片，之後可用底部按鈕批次重新生成"
                                style={{ padding: '0.2rem 0.5rem', fontSize: '0.65rem', border: '1px solid var(--border-color)', borderRadius: '0.25rem', cursor: isGenerating ? 'not-allowed' : 'pointer', background: 'var(--bg-secondary)', color: '#e74c3c', display: 'flex', alignItems: 'center', gap: '0.2rem', opacity: isGenerating ? 0.4 : 1 }}>
                                <X size={9} /> 清除
                              </button>
                              <button onClick={() => handleGenerateFromPlan([slide.id])} disabled={isGenerating}
                                style={{ padding: '0.2rem 0.5rem', fontSize: '0.65rem', border: '1px solid var(--border-color)', borderRadius: '0.25rem', cursor: isGenerating ? 'not-allowed' : 'pointer', background: 'var(--bg-secondary)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.2rem', opacity: isGenerating ? 0.4 : 1 }}>
                                <Play size={9} /> 重新生成
                              </button>
                            </div>
                          </div>
                          <img src={slide.generatedImage} alt="" onClick={() => setLightbox(slide.generatedImage!)} style={{ width: '100%', maxWidth: '400px', height: 'auto', aspectRatio: aspectRatio.replace(':', '/'), objectFit: 'cover', borderRadius: '0.5rem', cursor: 'zoom-in', border: '1px solid var(--border-color)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                        </div>
                      )}
                    </div>
                  );
                })() : (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', opacity: 0.5 }}>
                    <Edit3 size={32} style={{ marginBottom: '0.5rem' }} />
                    <span style={{ fontSize: '0.85rem' }}>請在左側選擇投影片以進行編輯</span>
                  </div>
                )}
              </div>
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                  {!(slidePlans.some(s => s.templateImage) || !!referenceImage) && (
                    <p style={{ margin: 0, fontSize: '0.68rem', color: '#e67e22', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}>
                      ⚠️ 請先選擇樣式模板（點右上角「模板庫」或各頁「選擇樣板」）
                    </p>
                  )}
                  {(() => {
                    const hasTemplate = slidePlans.some(s => s.templateImage) || !!referenceImage;
                    const pending = slidePlans.filter(s => !s.generatedImage);
                    const allDone = pending.length === 0 && slidePlans.length > 0;
                    return (
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <button onClick={() => handleGenerateFromPlan(allDone ? undefined : pending.map(s => s.id))} disabled={!hasTemplate}
                          style={{ flex: 1, padding: '0.6rem', fontSize: '0.85rem', fontWeight: 600, border: 'none', borderRadius: '0.4rem', cursor: hasTemplate ? 'pointer' : 'not-allowed', background: hasTemplate ? 'var(--accent-color)' : 'var(--bg-tertiary)', color: hasTemplate ? '#fff' : 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem', letterSpacing: '0.02em', boxShadow: hasTemplate ? '0 2px 8px rgba(52, 152, 219, 0.3)' : 'none', transition: 'all 0.2s' }}>
                          <Play size={14} /> {allDone ? `重新生成全部 ${slidePlans.length} 張` : `繼續生成 ${pending.length} 張圖片`}
                        </button>
                        {!allDone && slidePlans.some(s => s.generatedImage) && (
                          <button onClick={() => handleGenerateFromPlan()} disabled={!hasTemplate} title="重新生成全部"
                            style={{ padding: '0.6rem 0.8rem', fontSize: '0.75rem', fontWeight: 600, border: '1px solid var(--border-color)', borderRadius: '0.4rem', cursor: hasTemplate ? 'pointer' : 'not-allowed', background: 'var(--bg-secondary)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.2rem', whiteSpace: 'nowrap', opacity: hasTemplate ? 1 : 0.4 }}>
                            全部 {slidePlans.length} 張
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </div>
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
      <div style={{ width: rightSidebarOpen ? `${rightSidebarWidth}px` : '36px', minWidth: rightSidebarOpen ? `${rightSidebarWidth}px` : '36px', borderLeft: 'none', display: 'flex', flexDirection: 'row', background: 'var(--bg-primary)', position: 'relative', flexShrink: 0 }}>
        {/* Right sidebar drag-resize handle */}
        {rightSidebarOpen && (
          <div onMouseDown={onRightResizeMouseDown} style={{ width: '5px', cursor: 'ew-resize', background: 'transparent', flexShrink: 0, zIndex: 10, position: 'absolute', left: 0, top: 0, bottom: 0 }} />
        )}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden', borderLeft: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', flexShrink: 0, minWidth: 0 }}>
          <button onClick={() => setRightSidebarOpen(o => !o)} title={rightSidebarOpen ? '收起' : '展開畫廊'}
            style={{ padding: '0.55rem 0.5rem', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-secondary)', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
            {rightSidebarOpen ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          </button>
          {rightSidebarOpen && <>
          <button onClick={() => setRightTab('images')}
            style={{ flex: 1, padding: '0.55rem', fontSize: '0.72rem', fontWeight: rightTab === 'images' ? 700 : 400, border: 'none', borderBottom: rightTab === 'images' ? '2px solid var(--accent-color)' : '2px solid transparent', cursor: 'pointer', background: 'none', color: rightTab === 'images' ? 'var(--accent-color)' : 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem', whiteSpace: 'nowrap' }}>
            <Images size={13} /> 生成圖片 ({galleryImages.length})
          </button>
          <button onClick={() => setRightTab('files')}
            style={{ flex: 1, padding: '0.55rem', fontSize: '0.72rem', fontWeight: rightTab === 'files' ? 700 : 400, border: 'none', borderBottom: rightTab === 'files' ? '2px solid var(--accent-color)' : '2px solid transparent', cursor: 'pointer', background: 'none', color: rightTab === 'files' ? 'var(--accent-color)' : 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem', whiteSpace: 'nowrap' }}>
            <FileText size={13} /> 檔案 ({allFiles.length})
          </button>
          </>}
        </div>

        {rightSidebarOpen && <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
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
        </div>}
        </div>
      </div>

      {showTemplateGallery && <TemplateGalleryModal currentExtraPrompt={stylePrompt} onClose={() => { setShowTemplateGallery(false); setTemplateTargetSlide(null); }} onApply={templateTargetSlide ? handleTemplateApplyForSlide : handleTemplateApply} />}

      {/* Auto-retry countdown banner */}
      {autoRetryStatus && (
        <div style={{ position: 'fixed', bottom: '1.5rem', left: '50%', transform: 'translateX(-50%)', zIndex: 9999, background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '0.6rem', boxShadow: '0 8px 24px rgba(0,0,0,0.15)', padding: '0.7rem 1.2rem', display: 'flex', alignItems: 'center', gap: '0.8rem', fontSize: '0.85rem', minWidth: '320px' }}>
          {autoRetryStatus.countdown > 0 ? (
            <><Loader size={15} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
            <span style={{ flex: 1 }}>自動重試第 <strong>{autoRetryStatus.doneCount + 1}</strong> 次，<strong>{autoRetryStatus.countdown}</strong> 秒後開始…</span></>
          ) : (
            <><Loader size={15} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
            <span style={{ flex: 1 }}>自動重試第 <strong>{autoRetryStatus.doneCount + 1}</strong> 次，正在生成…</span></>
          )}
          <button onClick={() => { autoRetryConfigRef.current = null; if (autoRetryTimerRef.current) clearInterval(autoRetryTimerRef.current); autoRetryTimerRef.current = null; setAutoRetryStatus(null); genAbortRef.current = true; }} style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: '0.3rem', cursor: 'pointer', padding: '0.2rem 0.5rem', fontSize: '0.72rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>取消</button>
        </div>
      )}

      {/* 429 Error Modal */}
      {retryModal429 && !autoRetryStatus && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 10100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
          onClick={() => setRetryModal429(null)}>
          <div style={{ backgroundColor: 'var(--bg-primary)', borderRadius: '0.75rem', boxShadow: '0 16px 48px rgba(0,0,0,0.3)', padding: '1.75rem', width: '440px', maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
              <span style={{ fontSize: '1.4rem', lineHeight: 1, flexShrink: 0 }}>⚠️</span>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#ef4444' }}>429 錯誤：API 使用量過高</h3>
              </div>
              <button onClick={() => setRetryModal429(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '2px', flexShrink: 0 }}><X size={18} /></button>
            </div>
            <div style={{ paddingLeft: '2rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                重試 3 次後仍失敗，因目前 Gemini API 用量過高，請等待 5–10 分鐘再嘗試。
              </p>
              <div style={{ background: 'var(--bg-secondary)', borderRadius: '0.5rem', padding: '0.5rem 0.75rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                成功：{retryModal429.successCount} 張　／　待重試：{retryModal429.toRetryIds.length} 張
              </div>
            </div>
            <div style={{ paddingLeft: '2rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>自動重試設定</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
                <span style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>每</span>
                <input type="number" min={5} max={3600} value={retryIntervalSec}
                  onChange={e => setRetryIntervalSec(Math.max(5, Math.min(3600, Number(e.target.value) || 30)))}
                  style={{ width: '64px', textAlign: 'center', border: '1px solid var(--border-color)', borderRadius: '0.3rem', padding: '0.3rem', fontSize: '0.875rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', outline: 'none' }} />
                <span style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>秒自動重試一次</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.875rem' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>停止條件：</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input type="radio" name="chatRetryStop" checked={retryStopCond === 'success'} onChange={() => setRetryStopCond('success')} />
                  <span>成功為止</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input type="radio" name="chatRetryStop" checked={retryStopCond === 'retries'} onChange={() => setRetryStopCond('retries')} />
                  <span>最多重試</span>
                  <input type="number" min={1} max={20} value={retryMaxTimes}
                    onChange={e => setRetryMaxTimes(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                    onClick={() => setRetryStopCond('retries')}
                    style={{ width: '48px', textAlign: 'center', border: '1px solid var(--border-color)', borderRadius: '0.3rem', padding: '0.2rem', fontSize: '0.875rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', outline: 'none' }} />
                  <span>次</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input type="radio" name="chatRetryStop" checked={retryStopCond === 'time'} onChange={() => setRetryStopCond('time')} />
                  <span>直到</span>
                  <input type="time" value={retryUntilTime}
                    onChange={e => setRetryUntilTime(e.target.value)}
                    onClick={() => setRetryStopCond('time')}
                    style={{ border: '1px solid var(--border-color)', borderRadius: '0.3rem', padding: '0.2rem 0.4rem', fontSize: '0.875rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', outline: 'none' }} />
                </label>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setRetryModal429(null)}
                style={{ padding: '0.5rem 1rem', borderRadius: '0.4rem', border: '1px solid var(--border-color)', background: 'none', cursor: 'pointer', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                確定
              </button>
              <button onClick={startAutoRetry}
                style={{ padding: '0.5rem 1.25rem', borderRadius: '0.4rem', border: 'none', backgroundColor: 'var(--accent-color)', color: '#fff', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                ▶ 開始自動重試
              </button>
            </div>
          </div>
        </div>
      )}

      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: 'fixed', inset: 0, zIndex: 10200, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <img src={lightbox} alt="展開" onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: '8px', cursor: 'default' }} />
          <button onClick={() => setLightbox(null)} style={{ position: 'absolute', top: '20px', right: '20px', background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><X size={20} color="#fff" /></button>
        </div>
      )}
    </div>
  );
};

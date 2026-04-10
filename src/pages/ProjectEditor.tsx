import React, { useState, useRef } from 'react';
import { showAlert } from '../utils/dialog';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { ArrowLeft, Download, Image as ImageIcon, Plus, Trash2, X, Circle, Sparkles, CheckSquare, Eye, RotateCcw, ChevronLeft, ChevronRight, FileText, Share2, ImagePlus, Upload, Send, Paperclip, Loader, MessageSquare, Clock } from 'lucide-react';
import TemplateGalleryModal from '../components/TemplateGalleryModal';
import type { ApplyParams } from '../components/TemplateGalleryModal';
import pptxgen from 'pptxgenjs';
import JSZip from 'jszip';
import { collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, writeBatch, query, orderBy, getDoc } from 'firebase/firestore';
import { db, auth, storage } from '../firebase';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { onAuthStateChanged } from 'firebase/auth';
import { uploadImageToStorage, uploadHQToStorage, fetchImageAsBase64, compressImage, compressForFirestore, uploadToDrive } from '../utils/storageHelper';
import { getApiKey, chatWithGemini, generateChatTitle } from '../utils/gemini';
import type { ChatMessage as GeminiChatMessage } from '../utils/gemini';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

interface Slide {
  id: string;
  originalImage: string | null;
  generatedImage: string | null;
  originalImageHQ: string | null;
  generatedImageHQ: string | null;
  maskImage: string | null;
  prompt: string;
  status: 'empty' | 'draft' | 'generating' | 'done';
  order?: number;
  imageHistory?: string[];
  imageHistoryPos?: number;
  generatedImageDriveUrl?: string | null;
}

// ── AI Chat Persistence ─────────────────────────────────────────────────────
interface AIChatMsg { id: string; role: 'user' | 'assistant'; text: string; images: string[]; attachments: { name: string; mimeType: string; dataUrl: string }[]; taggedSlides: number[]; timestamp: number; }
interface AIChatConv { id: string; title: string; projectId: string; messages: AIChatMsg[]; createdAt: number; updatedAt: number; }
const AI_CHAT_LS_KEY = 'editor_ai_chat_conversations';
const loadAiConversations = (): AIChatConv[] => { try { return JSON.parse(localStorage.getItem(AI_CHAT_LS_KEY) || '[]'); } catch { return []; } };
const saveAiConversations = (convs: AIChatConv[]) => {
  // Strip large attachments to avoid localStorage quota
  const lite = convs.map(c => ({
    ...c,
    messages: c.messages.map(m => ({
      ...m,
      attachments: m.attachments.map(a => ({ ...a, dataUrl: a.mimeType.startsWith('image/') ? a.dataUrl.slice(0, 200) : '' })),
      images: m.images.map(img => img.slice(0, 200)),
    })),
  }));
  try { localStorage.setItem(AI_CHAT_LS_KEY, JSON.stringify(lite)); } catch { /* quota */ }
};

export const ProjectEditor: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [aspectRatio, setAspectRatio] = useState<string>('16:9');
  const [resolution, setResolution] = useState<string>('1K');
  const [fontFamily, setFontFamily] = useState<string>('Noto Sans');
  const [mainColor, setMainColor] = useState<string>('黑色');
  const [highlightColor, setHighlightColor] = useState<string>('金黃色');
  const [specialMark, setSpecialMark] = useState<string>('');
  const [backgroundColor, setBackgroundColor] = useState<string>('');
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [useAdvancedSettings, setUseAdvancedSettings] = useState(true);
  const [selectedSlides, setSelectedSlides] = useState<Set<string>>(new Set());

  const [slides, setSlides] = useState<Slide[]>([]);
  const [activeSlideId, setActiveSlideId] = useState<string>('');
  const [globalReference, setGlobalReference] = useState<string | null>(null);

  const defaultPrompt = useAdvancedSettings
    ? `幫我重新繪製這張投影片(直接畫，用nano banana)，使用極簡風格設計，可以適當加一些相關內容的簡單插圖(插畫風格與背景一致)，使用${fontFamily}系列字體，${mainColor}(主體)、${highlightColor}(重點字)字體，適當排版${specialMark ? `，特殊標記：${specialMark}` : ''}${backgroundColor ? `，背景色：${backgroundColor}` : ''}，比例${aspectRatio}(橫向)${globalReference ? '，請參考提供的風格圖' : ''}`
    : `請根據提供的原始投影片圖片進行修改(用nano banana直接輸出圖片)，保持原始版面配置、比例和所有元素位置不變${globalReference ? '，請參考提供的風格圖' : ''}`;
  
  // Progress states
  const [parsingProgress, setParsingProgress] = useState<{current: number, total: number} | null>(null);
  const [savingProgress, setSavingProgress] = useState<{current: number, total: number} | null>(null);
  const [generateProgress, setGenerateProgress] = useState<{current: number, total: number} | null>(null);
  
  // Real Drawing state
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [brushSize, setBrushSize] = useState(4);
  const PEN_COLORS: { color: string; label: string }[] = [
    { color: '#ef4444', label: '紅色' },
    { color: '#f97316', label: '橘色' },
    { color: '#eab308', label: '黃色' },
    { color: '#22c55e', label: '綠色' },
    { color: '#3b82f6', label: '藍色' },
    { color: '#a855f7', label: '紫色' },
    { color: '#ffffff', label: '白色' },
  ];
  const [penColor, setPenColor] = useState(PEN_COLORS[0].color);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // Rubber-band selection
  const gridRef = useRef<HTMLDivElement>(null);
  const slideCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const lastAnchorId = useRef<string | null>(null);
  const dragStartPos = useRef<{x: number, y: number} | null>(null);
  const [dragBox, setDragBox] = useState<{x1:number, y1:number, x2:number, y2:number} | null>(null);
  const generateAbortController = useRef<AbortController | null>(null);
  const textFileInputRef = useRef<HTMLInputElement | null>(null);
  const imageUploadInputRef = useRef<HTMLInputElement | null>(null);
  const globalReferenceRef = useRef<string | null>(null);
  const defaultPromptRef = useRef<string>('');
  const activeSlideIdRef = useRef<string>('');

  // Progressive HQ preview: ref avoids re-rendering 200+ grid cards on every HQ load
  const hqPreviewUrls = useRef<Map<string, string>>(new Map());
  const hqLoadingSet = useRef<Set<string>>(new Set());
  const [activeHqTick, setActiveHqTick] = useState(0); // bump to re-render canvas when active slide HQ loads

  // Local-first generation state
  const [pendingImages, setPendingImages] = useState<Map<string, string>>(new Map());
  const [backedUpIds, setBackedUpIds] = useState<Map<string, number>>(new Map());
  const [lastBackupTime, setLastBackupTime] = useState<Date | null>(null);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const backupFailCount = useRef(0);
  const [isExporting, setIsExporting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showExitModal, setShowExitModal] = useState(false);
  const [prevSessionWarning, setPrevSessionWarning] = useState<number | null>(null);
  const [showTextUploadModal, setShowTextUploadModal] = useState(false);
  const [showGenerateConfirmModal, setShowGenerateConfirmModal] = useState(false);
  const [imageHistories, setImageHistories] = useState<Map<string, { stack: string[]; pos: number }>>(new Map());
  const imageHistoriesRef = useRef<Map<string, { stack: string[]; pos: number }>>(new Map());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [isDragOverPage, setIsDragOverPage] = useState(false);

  // Resizable sidebar
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const isResizing = useRef(false);
  const sidebarListRef = useRef<HTMLDivElement | null>(null);
  // Extra reference images for local modify (@1, @2, ...)
  const [localExtraImages, setLocalExtraImages] = useState<{ id: string; dataUrl: string; name: string }[]>([]);
  const localExtraImagesRef = useRef<{ label: string; dataUrl: string }[]>([]);
  const extraImgInputRef = useRef<HTMLInputElement | null>(null);
  const [globalExtraPrompt, setGlobalExtraPrompt] = useState('');
  const [textHistories, setTextHistories] = useState<Map<string, { stack: string[]; pos: number }>>(new Map());
  const [textSaving, setTextSaving] = useState(false);
  const textSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [polishDirection, setPolishDirection] = useState('');
  const [isPolishing, setIsPolishing] = useState(false);
  const [polishedPreview, setPolishedPreview] = useState<{ slideId: string; text: string } | null>(null);
  const [showTemplateGallery, setShowTemplateGallery] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareLabel, setShareLabel] = useState('');
  const [shareSelectedResults, setShareSelectedResults] = useState<Set<string>>(new Set());
  const [isSharing, setIsSharing] = useState(false);
  const [showAddSlideModal, setShowAddSlideModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [addSlideCount, setAddSlideCount] = useState(1);
  // Insert between slides (sidebar + grid)
  const [sidebarInsertMenu, setSidebarInsertMenu] = useState<number | null>(null);
  const [gridInsertMenu, setGridInsertMenu] = useState<number | null>(null);
  const insertFileRef = useRef<HTMLInputElement | null>(null);
  const insertImageRef = useRef<HTMLInputElement | null>(null);
  const insertTargetIdx = useRef<number>(-1);
  // AI Chat panel (right side) — persistent conversations
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [aiConversations, setAiConversations] = useState<AIChatConv[]>(loadAiConversations);
  const [aiActiveConvId, setAiActiveConvId] = useState<string | null>(null);
  const [aiChatInput, setAiChatInput] = useState('');
  const [aiChatLoading, setAiChatLoading] = useState(false);
  const [aiChatAttachments, setAiChatAttachments] = useState<{ name: string; mimeType: string; dataUrl: string }[]>([]);
  const [aiChatTaggedSlides, setAiChatTaggedSlides] = useState<Set<number>>(new Set());
  const [aiChatTagPicker, setAiChatTagPicker] = useState(false);
  const [aiChatHistoryOpen, setAiChatHistoryOpen] = useState(false);
  const aiChatScrollRef = useRef<HTMLDivElement | null>(null);
  const aiChatFileRef = useRef<HTMLInputElement | null>(null);
  const aiChatAbortRef = useRef<AbortController | null>(null);
  const aiActiveConv = aiConversations.find(c => c.id === aiActiveConvId) || null;
  const aiChatMsgs = aiActiveConv?.messages || [];
  const [downloadScopeModal, setDownloadScopeModal] = useState<'save' | 'export' | null>(null);
  const [appModal, setAppModal] = useState<{ title: string; body: React.ReactNode; type?: 'error' | 'success' | 'warning' | 'info' } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = React.useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }, []);

  // 429 auto-retry state
  const [retryModal429, setRetryModal429] = useState<{ successCount: number; toRetrySlides: string[] } | null>(null);
  const [autoRetryStatus, setAutoRetryStatus] = useState<{ countdown: number; doneCount: number; pendingCount: number } | null>(null);
  const autoRetryConfigRef = useRef<{ toRetrySlides: string[]; doneCount: number } | null>(null);
  const autoRetryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoRetryIsWaiting = useRef(false);
  const retryModal429Ref = useRef<{ successCount: number; toRetrySlides: string[] } | null>(null);
  const handleGenerateRef = useRef<(skip?: boolean) => void>(() => {});

  // Prompt local draft state to avoid IME composition feedback loop
  const [promptDraft, setPromptDraft] = useState('');
  const isComposing = useRef(false);
  // Captured at local-modify click time — bypasses stale Firestore mask/base
  const localMaskDataRef = useRef<string | null>(null);
  const localBaseDataRef = useRef<string | null>(null);
  const localPromptRef = useRef<string>('');
  const localAspectRatioRef = useRef<string>('');
  const localOverrideSlideIdsRef = useRef<string[] | null>(null);

  const getAspectRatioString = (w: number, h: number): string => {
    const r = w / h;
    if (Math.abs(r - 1) < 0.05) return '1:1';
    if (Math.abs(r - 16/9) < 0.1) return '16:9';
    if (Math.abs(r - 9/16) < 0.1) return '9:16';
    if (Math.abs(r - 4/3) < 0.1) return '4:3';
    if (Math.abs(r - 3/4) < 0.1) return '3:4';
    if (Math.abs(r - 3/2) < 0.08) return '3:2';
    if (Math.abs(r - 2/3) < 0.08) return '2:3';
    return r >= 1 ? '1:1' : '1:1';
  };


  // Preview panel state
  const [previewOpen, setPreviewOpen] = useState(false);

  // Restore persisted reference image, extra prompt, and per-project advanced settings on mount
  React.useEffect(() => {
    if (!id) return;
    const savedRef = localStorage.getItem(`refImg_${id}`);
    const savedPrompt = localStorage.getItem(`extraPrompt_${id}`);
    if (savedRef) setGlobalReference(savedRef);
    if (savedPrompt) setGlobalExtraPrompt(savedPrompt);
    try {
      const s = JSON.parse(localStorage.getItem(`advancedSettings_${id}`) || '{}');
      if (s.aspectRatio) setAspectRatio(s.aspectRatio);
      if (s.resolution) setResolution(s.resolution);
      if (s.fontFamily) setFontFamily(s.fontFamily);
      if (s.mainColor) setMainColor(s.mainColor);
      if (s.highlightColor) setHighlightColor(s.highlightColor);
      if (s.specialMark !== undefined) setSpecialMark(s.specialMark);
      if (s.backgroundColor !== undefined) setBackgroundColor(s.backgroundColor);
      if (s.useAdvancedSettings !== undefined) setUseAdvancedSettings(s.useAdvancedSettings);
    } catch { /* ignore corrupt data */ }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save reference image to localStorage whenever it changes
  React.useEffect(() => {
    if (!id) return;
    if (globalReference) localStorage.setItem(`refImg_${id}`, globalReference);
    else localStorage.removeItem(`refImg_${id}`);
  }, [globalReference, id]);

  // Save extra prompt to localStorage whenever it changes
  React.useEffect(() => {
    if (!id) return;
    if (globalExtraPrompt) localStorage.setItem(`extraPrompt_${id}`, globalExtraPrompt);
    else localStorage.removeItem(`extraPrompt_${id}`);
  }, [globalExtraPrompt, id]);

  // Persist advanced settings per-project so each project has independent settings
  React.useEffect(() => {
    if (!id) return;
    localStorage.setItem(`advancedSettings_${id}`, JSON.stringify({ aspectRatio, resolution, fontFamily, mainColor, highlightColor, specialMark, backgroundColor, useAdvancedSettings }));
  }, [id, aspectRatio, resolution, fontFamily, mainColor, highlightColor, specialMark, backgroundColor, useAdvancedSettings]);

  // Build a localStorage key scoped to the current API channel + key so different users don't clash
  const getGeneratingKey = () => {
    const ch = localStorage.getItem('apiChannel') || 'platform';
    const k = ch === 'platform' ? '' : (localStorage.getItem(ch === 'vertex' ? 'vertexApiKey' : 'geminiApiKey') || '').slice(-6);
    return `vertexGenerating_${ch}_${k}`;
  };

  // Check for previous unfinished generation on mount
  React.useEffect(() => {
    const key = getGeneratingKey();
    const ts = localStorage.getItem(key);
    if (ts) {
      const elapsed = Date.now() - Number(ts);
      if (elapsed < 5 * 60 * 1000) { // within 5 minutes
        setPrevSessionWarning(Number(ts));
      } else {
        localStorage.removeItem(key);
      }
    }
    // Also clean up legacy key
    localStorage.removeItem('vertexGenerating');
  }, []);

  // Auth State
  const [userId, setUserId] = useState<string | null>(null);
  const authNullTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      // Cancel any pending logout-navigation (guards against brief cross-tab null blips)
      if (authNullTimer.current) { clearTimeout(authNullTimer.current); authNullTimer.current = null; }
      if (user) {
        setUserId(user.uid);
        // Optional: Verify ownership
        if (id) {
           const pDoc = await getDoc(doc(db, 'projects', id));
           if (pDoc.exists() && pDoc.data()?.userId !== user.uid) {
               navigate('/home'); 
           }
        }
      } else {
        // Debounce: wait 2.5s before treating null as a real logout.
        // Firebase can briefly emit null during cross-tab token refresh.
        authNullTimer.current = setTimeout(() => {
          setUserId(null);
          navigate('/');
        }, 2500);
      }
    });
    return () => {
      unsubAuth();
      if (authNullTimer.current) clearTimeout(authNullTimer.current);
    };
  }, [navigate, id]);

  const activeSlide = slides.find(s => s.id === activeSlideId);

  // Grid/thumbnails: use compressed images to avoid scroll lag with many slides
  const getPreviewSrc = (slideId: string, slide: Slide): string | null =>
    pendingImages.get(slideId) || slide.generatedImage || slide.originalImage || null;
  // Editor canvas: use HQ for sharp preview (activeHqTick forces re-read of ref when HQ loads)
  const getCanvasSrc = (slideId: string, slide: Slide): string | null =>
    pendingImages.get(slideId) || slide.generatedImage || hqPreviewUrls.current.get(slideId) || slide.originalImage || null;
  void activeHqTick; // ensure React re-renders when active HQ loads

  // Initialize text history for text-only slides
  React.useEffect(() => {
    if (!activeSlideId) return;
    const slide = slides.find(s => s.id === activeSlideId);
    if (slide && !slide.originalImage && !slide.generatedImage) {
      setTextHistories(prev => {
        if (prev.has(activeSlideId)) return prev;
        const next = new Map(prev);
        next.set(activeSlideId, { stack: [slide.prompt], pos: 0 });
        return next;
      });
    }
  }, [activeSlideId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTextChange = (slideId: string, newText: string) => {
    setSlides(prev => prev.map(s => s.id === slideId ? { ...s, prompt: newText } : s));
    if (textSaveTimer.current) clearTimeout(textSaveTimer.current);
    setTextSaving(true);
    textSaveTimer.current = setTimeout(() => {
      if (id) updateDoc(doc(db, 'projects', id, 'slides', slideId), { prompt: newText }).catch(console.error);
      setTextHistories(prev => {
        const hist = prev.get(slideId);
        if (!hist || hist.stack[hist.pos] === newText) { setTextSaving(false); return prev; }
        const newStack = [...hist.stack.slice(0, hist.pos + 1), newText];
        const next = new Map(prev);
        next.set(slideId, { stack: newStack, pos: newStack.length - 1 });
        setTextSaving(false);
        return next;
      });
    }, 1200);
  };

  const handleTextUndo = (slideId: string) => {
    setTextHistories(prev => {
      const hist = prev.get(slideId);
      if (!hist || hist.pos <= 0) return prev;
      const newPos = hist.pos - 1;
      const text = hist.stack[newPos];
      setSlides(p => p.map(s => s.id === slideId ? { ...s, prompt: text } : s));
      if (id) updateDoc(doc(db, 'projects', id, 'slides', slideId), { prompt: text }).catch(console.error);
      const next = new Map(prev);
      next.set(slideId, { ...hist, pos: newPos });
      return next;
    });
  };

  const handleTextRedo = (slideId: string) => {
    setTextHistories(prev => {
      const hist = prev.get(slideId);
      if (!hist || hist.pos >= hist.stack.length - 1) return prev;
      const newPos = hist.pos + 1;
      const text = hist.stack[newPos];
      setSlides(p => p.map(s => s.id === slideId ? { ...s, prompt: text } : s));
      if (id) updateDoc(doc(db, 'projects', id, 'slides', slideId), { prompt: text }).catch(console.error);
      const next = new Map(prev);
      next.set(slideId, { ...hist, pos: newPos });
      return next;
    });
  };

  const handlePolishText = async (slideId: string, text: string) => {
    if (!text.trim() || isPolishing) return;
    setIsPolishing(true);
    setPolishedPreview(null);
    try {
      const apiKey = getApiKey();
      const { polishTextWithAI } = await import('../utils/gemini');
      const polished = await polishTextWithAI(text, polishDirection, apiKey);
      // Show preview instead of directly replacing original text
      setPolishedPreview({ slideId, text: polished });
    } catch (err: any) {
      console.error('Polish failed:', err);
      showAlert('AI 潤色失敗：' + (err?.message || '未知錯誤'), '錯誤');
    } finally {
      setIsPolishing(false);
    }
  };

  React.useEffect(() => {
    setPromptDraft('');
    // Clear canvas when switching slides to prevent mask bleed-over
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  }, [activeSlideId]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard navigation between slides — imperative img update for instant feedback
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const idx = slides.findIndex(s => s.id === activeSlideId);
      const jumpTo = (nextSlide: Slide) => {
        // Instant canvas update before React re-renders 200+ cards
        if (imgRef.current) {
          const src = pendingImages.get(nextSlide.id) || nextSlide.generatedImage
            || hqPreviewUrls.current.get(nextSlide.id) || nextSlide.originalImage;
          if (src) imgRef.current.src = src;
        }
        setActiveSlideId(nextSlide.id);
      };
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') && idx > 0) {
        jumpTo(slides[idx - 1]);
      } else if ((e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'Enter') && idx >= 0 && idx < slides.length - 1) {
        jumpTo(slides[idx + 1]);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [slides, activeSlideId]);

  // Auto-scroll sidebar to active slide
  React.useEffect(() => {
    if (!activeSlideId || !previewOpen) return;
    requestAnimationFrame(() => {
      const container = sidebarListRef.current;
      if (!container) return;
      const el = container.querySelector(`[data-sidebar-slide="${activeSlideId}"]`) as HTMLElement | null;
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }, [activeSlideId, previewOpen]);

  // Always-on auto-backup: triggers after new unbacked images appear, with exponential backoff on failure
  React.useEffect(() => {
    const unbacked = Array.from(pendingImages.entries()).filter(([sid, img]) => backedUpIds.get(sid) !== img.length);
    if (unbacked.length === 0 || isBackingUp || backupFailCount.current >= 3) return;
    const delay = backupFailCount.current === 0 ? 2000 : Math.min(5000 * Math.pow(2, backupFailCount.current - 1), 30000);
    const timer = setTimeout(() => { handleBackup(); }, delay);
    return () => clearTimeout(timer);
  }, [pendingImages, backedUpIds, isBackingUp]); // eslint-disable-line react-hooks/exhaustive-deps

  // Warn on browser close/refresh when pending images exist
  React.useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (pendingImages.size > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [pendingImages.size]);

  // Keep refs in sync so onSnapshot callback always reads latest values without re-subscribing
  globalReferenceRef.current = globalReference;
  defaultPromptRef.current = defaultPrompt;
  activeSlideIdRef.current = activeSlideId;
  retryModal429Ref.current = retryModal429;

  // Lazy-load HQ preview images: active slide first, then nearby
  const hqQueueRef = useRef<string[]>([]);
  const hqActiveCount = useRef(0);
  const HQ_CONCURRENCY = 2;

  const loadNextHQ = React.useCallback(() => {
    while (hqActiveCount.current < HQ_CONCURRENCY && hqQueueRef.current.length > 0) {
      const slideId = hqQueueRef.current.shift()!;
      const slide = slides.find(s => s.id === slideId);
      const hqSrc = slide?.originalImageHQ;
      if (!hqSrc || hqLoadingSet.current.has(slideId)) continue;
      hqLoadingSet.current.add(slideId);
      hqActiveCount.current++;
      const img = new Image();
      img.onload = () => {
        hqPreviewUrls.current.set(slideId, hqSrc);
        // Only trigger re-render if this is the active slide's HQ
        if (slideId === activeSlideIdRef.current) setActiveHqTick(t => t + 1);
        hqActiveCount.current--;
        loadNextHQ();
      };
      img.onerror = () => { hqLoadingSet.current.delete(slideId); hqActiveCount.current--; loadNextHQ(); };
      img.src = hqSrc;
    }
  }, [slides]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    // If active slide already has HQ in ref but canvas hasn't shown it yet, trigger render
    if (activeSlideId && hqPreviewUrls.current.has(activeSlideId)) {
      setActiveHqTick(t => t + 1);
    }
    const activeIdx = slides.findIndex(s => s.id === activeSlideId);
    const candidates = slides
      .map((s, i) => ({ id: s.id, dist: activeIdx >= 0 ? Math.abs(i - activeIdx) : i }))
      .filter(c => {
        const s = slides.find(sl => sl.id === c.id);
        return s?.originalImageHQ && !hqPreviewUrls.current.has(c.id) && !hqLoadingSet.current.has(c.id);
      })
      .sort((a, b) => a.dist - b.dist)
      .map(c => c.id);
    if (candidates.length === 0) return;
    hqQueueRef.current = candidates;
    loadNextHQ();
  }, [activeSlideId, slides, loadNextHQ]); // eslint-disable-line react-hooks/exhaustive-deps

  // Post-generate auto-retry logic — always retry every 5s until success
  React.useEffect(() => {
    if (!autoRetryIsWaiting.current) return;
    if (isGenerating) return;
    autoRetryIsWaiting.current = false;
    const config = autoRetryConfigRef.current;
    if (!config) return;
    const newDone = config.doneCount + 1;
    config.doneCount = newDone;
    const another429 = retryModal429Ref.current;
    console.log(`[AutoRetry] 第 ${newDone} 次重試完成，${another429 ? '仍有 429 錯誤' : '✓ 成功'}`);
    // Succeeded (no new 429) — stop
    if (!another429) {
      autoRetryConfigRef.current = null;
      if (autoRetryTimerRef.current) clearInterval(autoRetryTimerRef.current);
      autoRetryTimerRef.current = null;
      setAutoRetryStatus(null);
      showToast('✓ 自動重試成功！所有投影片已生成。', 'success');
      return;
    }
    // Still failing — continue, 5 seconds then retry
    config.toRetrySlides = another429.toRetrySlides;
    console.log(`[AutoRetry] 繼續，5 秒後進行第 ${newDone + 1} 次重試，待重試 ${another429.toRetrySlides.length} 張...`);
    setRetryModal429(null);
    let cd = 5;
    setAutoRetryStatus({ countdown: cd, doneCount: newDone, pendingCount: another429.toRetrySlides.length });
    if (autoRetryTimerRef.current) clearInterval(autoRetryTimerRef.current);
    autoRetryTimerRef.current = setInterval(() => {
      cd--;
      if (cd <= 0) {
        clearInterval(autoRetryTimerRef.current!); autoRetryTimerRef.current = null;
        const cfg = autoRetryConfigRef.current;
        if (!cfg) return;
        setAutoRetryStatus(prev => prev ? { ...prev, countdown: -1 } : null);
        autoRetryIsWaiting.current = true;
        setTimeout(() => handleGenerateRef.current(true), 50);
      } else {
        setAutoRetryStatus(prev => prev ? { ...prev, countdown: cd } : null);
      }
    }, 1000);
  }, [isGenerating]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!id || !userId) return;
    const slidesRef = collection(db, 'projects', id, 'slides');
    const q = query(slidesRef, orderBy('createdAt', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const dbSlides: Slide[] = snapshot.docs.map(doc => {
         const d = doc.data();
         return {
           id: doc.id,
           originalImage: d.originalImage,
           generatedImage: d.generatedImage,
           originalImageHQ: d.originalImageHQ || null,
           generatedImageHQ: d.generatedImageHQ || null,
           maskImage: d.maskImage,
           prompt: d.prompt,
           status: d.status,
           order: d.order ?? d.createdAt ?? 0,
           imageHistory: d.imageHistory || [],
           imageHistoryPos: d.imageHistoryPos ?? -1,
           generatedImageDriveUrl: d.generatedImageDriveUrl || null,
         } as Slide;
      });
      dbSlides.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      setSlides(dbSlides);
      // Restore history from Firestore for slides not yet in memory
      setImageHistories(prev => {
        const next = new Map(prev);
        let changed = false;
        dbSlides.forEach(slide => {
          if (prev.has(slide.id)) return;
          if (slide.imageHistory && slide.imageHistory.length > 0) {
            // Has saved history — restore it
            const pos = slide.imageHistoryPos ?? slide.imageHistory.length - 1;
            next.set(slide.id, { stack: slide.imageHistory, pos });
            changed = true;
          } else if (slide.originalImage) {
            // No saved history — seed with original (+ generated if exists)
            const stack: string[] = [slide.originalImage];
            if (slide.generatedImage) stack.push(slide.generatedImage);
            next.set(slide.id, { stack, pos: stack.length - 1 });
            changed = true;
          } else if (!slide.originalImage && slide.generatedImage) {
            // Text-only slide with generated image — '' sentinel lets undo restore text view
            const stack: string[] = ['', slide.generatedImage];
            next.set(slide.id, { stack, pos: 1 });
            changed = true;
          }
        });
        if (changed) imageHistoriesRef.current = next;
        return changed ? next : prev;
      });
      
      // Auto-select first slide if none selected
      if (dbSlides.length > 0 && !activeSlideIdRef.current) {
          setActiveSlideId(dbSlides[0].id);
      }


    });
    return () => unsubscribe();
  }, [id, userId]);  // Only re-subscribe when project/auth changes

  const handleTemplateApply = ({ imageUrl, settings, resolvedExtraPrompt }: ApplyParams) => {
    setShowTemplateGallery(false);
    setGlobalReference(imageUrl);
    if (settings) {
      if (settings.fontFamily) setFontFamily(settings.fontFamily);
      if (settings.mainColor) setMainColor(settings.mainColor);
      if (settings.highlightColor) setHighlightColor(settings.highlightColor);
      if (settings.specialMark !== undefined) setSpecialMark(settings.specialMark);
      if (settings.backgroundColor) setBackgroundColor(settings.backgroundColor);
    }
    if (resolvedExtraPrompt !== null) setGlobalExtraPrompt(resolvedExtraPrompt);
  };

  const [isGeneratingLabel, setIsGeneratingLabel] = useState(false);
  const generateShareLabel = async () => {
    setIsGeneratingLabel(true);
    try {
      const { geminiApiFetch } = await import('../utils/gemini');
      const modelName = localStorage.getItem('vertexModel') || localStorage.getItem('geminiModel') || 'gemini-2.0-flash';
      const styleDesc = `字體：${fontFamily}，主色：${mainColor}，重點色：${highlightColor}${specialMark ? `，標記：${specialMark}` : ''}${backgroundColor ? `，背景色：${backgroundColor}` : ''}`;
      const resp = await geminiApiFetch(modelName, {
        contents: [{ role: 'user', parts: [{ text: `請用8個字以內為以下投影片模板風格取一個簡短好記的名稱，直接回覆名稱文字，不要加標點符號或其他說明：\n${styleDesc}` }] }],
      });
      if (!resp.ok) { console.error('AI naming failed:', resp.status); return; }
      const data = await resp.json();
      const name = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
      if (name) setShareLabel(name);
    } catch (err) { console.error('AI naming error:', err); }
    finally { setIsGeneratingLabel(false); }
  };

  const handleShareTemplate = async () => {
    if (!id || !globalReference || !shareLabel.trim()) return;
    setIsSharing(true);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('請先登入');
      const docId = `${user.uid}_${Date.now()}`;
      // Upload reference image
      let refUrl = globalReference;
      if (globalReference.startsWith('data:')) {
        const b64 = globalReference.split(',')[1];
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: 'image/jpeg' });
        const sRef = storageRef(storage, `sharedTemplates/${docId}/reference.jpg`);
        await uploadBytes(sRef, blob);
        refUrl = await getDownloadURL(sRef);
      }
      // Upload selected result images (max 3)
      const resultUrls: string[] = [];
      const selected = [...shareSelectedResults].slice(0, 3);
      for (let i = 0; i < selected.length; i++) {
        const slideId = selected[i];
        const img = pendingImages.get(slideId) || slides.find(s => s.id === slideId)?.generatedImage;
        if (!img) continue;
        if (img.startsWith('data:')) {
          const b64 = img.split(',')[1];
          const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
          const blob = new Blob([bytes], { type: 'image/jpeg' });
          const sRef = storageRef(storage, `sharedTemplates/${docId}/result_${i}.jpg`);
          await uploadBytes(sRef, blob);
          resultUrls.push(await getDownloadURL(sRef));
        } else {
          resultUrls.push(img);
        }
      }
      await setDoc(doc(db, 'sharedTemplates', docId), {
        userId: user.uid,
        userName: user.displayName || user.email?.split('@')[0] || '匿名',
        label: shareLabel.trim(),
        referenceUrl: refUrl,
        resultUrls,
        settings: { fontFamily, mainColor, highlightColor, specialMark, backgroundColor, extraPrompt: globalExtraPrompt },
        avgRating: 0, ratingCount: 0, ratings: {},
        createdAt: Date.now(),
      });
      showToast('模板已分享到社群！', 'success');
      setShowShareModal(false); setShareLabel(''); setShareSelectedResults(new Set());
    } catch (err: any) {
      console.error('Share failed:', err);
      showToast('分享失敗：' + (err?.message || '未知錯誤'), 'error');
    } finally { setIsSharing(false); }
  };

  const addSlide = async (type: 'image' | 'text' = 'image', count: number = 1, insertAfterIdx?: number) => {
    if (!id) return;
    if (insertAfterIdx !== undefined && insertAfterIdx >= 0 && insertAfterIdx < slides.length) {
      const curOrder = slides[insertAfterIdx].order ?? 0;
      const nextOrder = insertAfterIdx + 1 < slides.length ? (slides[insertAfterIdx + 1].order ?? curOrder + 1000 * (count + 1)) : curOrder + 1000 * (count + 1);
      const gap = (nextOrder - curOrder) / (count + 1);
      let lastId = '';
      for (let i = 0; i < count; i++) {
        const newId = Math.random().toString(36).substr(2, 9);
        const order = Math.round(curOrder + gap * (i + 1));
        await setDoc(doc(db, 'projects', id, 'slides', newId), {
          originalImage: null, generatedImage: null, maskImage: null, prompt: '',
          status: type === 'text' ? 'draft' : 'empty', createdAt: Date.now() + i, order
        });
        lastId = newId;
      }
      if (lastId) { setActiveSlideId(lastId); }
      return;
    }
    let maxOrder = slides.reduce((m, s) => Math.max(m, s.order ?? 0), 0);
    let lastId = '';
    for (let i = 0; i < count; i++) {
      const newId = Math.random().toString(36).substr(2, 9);
      maxOrder += 1000;
      await setDoc(doc(db, 'projects', id, 'slides', newId), {
        originalImage: null, generatedImage: null, maskImage: null,
        prompt: '',
        status: type === 'text' ? 'draft' : 'empty',
        createdAt: Date.now() + i,
        order: maxOrder
      });
      lastId = newId;
    }
    if (lastId) {
      setActiveSlideId(lastId);
    }
  };

  const deleteSlide = async (e: React.MouseEvent, slideId: string) => {
    e.stopPropagation();
    if (!id) return;
    // Optimistic UI: remove immediately
    const index = slides.findIndex(s => s.id === slideId);
    setSlides(prev => prev.filter(s => s.id !== slideId));
    if (activeSlideId === slideId) {
      const nextSlide = slides[index === 0 ? 1 : index - 1];
      setActiveSlideId(nextSlide ? nextSlide.id : '');
    }
    const newSelected = new Set(selectedSlides);
    newSelected.delete(slideId);
    setSelectedSlides(newSelected);
    try {
      await deleteDoc(doc(db, 'projects', id, 'slides', slideId));
    } catch (err) {
      console.error('Delete failed:', err);
      showAlert('刪除失敗，請稍後再試。', '錯誤');
    }
  };

  const deleteSelectedSlides = async () => {
    if (!id || selectedSlides.size === 0) return;
    const toDelete = new Set(selectedSlides);
    // Optimistic UI
    setSlides(prev => prev.filter(s => !toDelete.has(s.id)));
    if (toDelete.has(activeSlideId)) {
      const remaining = slides.filter(s => !toDelete.has(s.id));
      setActiveSlideId(remaining.length > 0 ? remaining[0].id : '');
    }
    setSelectedSlides(new Set());
    setShowDeleteConfirm(false);
    try {
      const fb = writeBatch(db);
      toDelete.forEach(sid => fb.delete(doc(db, 'projects', id as string, 'slides', sid)));
      await fb.commit();
    } catch (err) {
      console.error('Batch delete failed:', err);
      showAlert('刪除失敗，請稍後再試。', '錯誤');
    }
  };

  const toggleSlideSelection = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSelected = new Set(selectedSlides);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedSlides(newSelected);
  };

  const handleSlideClick = (e: React.MouseEvent, slideId: string, index: number) => {
    if (e.shiftKey && lastAnchorId.current !== null) {
      const anchorIdx = slides.findIndex(s => s.id === lastAnchorId.current);
      const [from, to] = [Math.min(anchorIdx, index), Math.max(anchorIdx, index)];
      setSelectedSlides(new Set(slides.slice(from, to + 1).map(s => s.id)));
    } else if (e.ctrlKey || e.metaKey) {
      setSelectedSlides(prev => {
        const next = new Set(prev);
        if (next.has(slideId)) next.delete(slideId); else next.add(slideId);
        return next;
      });
      lastAnchorId.current = slideId;
    } else {
      // Plain click: open preview without resetting selection
      lastAnchorId.current = slideId;
      setActiveSlideId(slideId);
      setPreviewOpen(true);
    }
  };

  const handleGridMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-slide-card]')) return;
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    setDragBox(null);
  };

  React.useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragStartPos.current) return;
      const x1 = Math.min(dragStartPos.current.x, e.clientX);
      const y1 = Math.min(dragStartPos.current.y, e.clientY);
      const x2 = Math.max(dragStartPos.current.x, e.clientX);
      const y2 = Math.max(dragStartPos.current.y, e.clientY);
      if (x2 - x1 > 4 || y2 - y1 > 4) setDragBox({ x1, y1, x2, y2 });
    };
    const onMouseUp = (e: MouseEvent) => {
      if (!dragStartPos.current) return;
      setDragBox(prev => {
        if (prev && gridRef.current) {
          const newSelected = new Set<string>();
          slideCardRefs.current.forEach((el, sid) => {
            const r = el.getBoundingClientRect();
            if (!(r.right < prev.x1 || r.left > prev.x2 || r.bottom < prev.y1 || r.top > prev.y2))
              newSelected.add(sid);
          });
          if (newSelected.size > 0) {
            if (e.ctrlKey || e.metaKey) setSelectedSlides(old => new Set([...old, ...newSelected]));
            else setSelectedSlides(newSelected);
          }
        }
        return null;
      });
      dragStartPos.current = null;
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [slides]);

  const handleBackup = async () => {
    const unbacked = Array.from(pendingImages.entries()).filter(([sid, img]) => backedUpIds.get(sid) !== img.length);
    if (!id || !userId || unbacked.length === 0 || isBackingUp) return;
    setIsBackingUp(true);
    try {
      const newlyBacked = new Set<string>();
      for (let i = 0; i < unbacked.length; i += 2) {
        const chunk = unbacked.slice(i, i + 2);
        const uploaded = await Promise.all(chunk.map(async ([slideId, base64img]) => {
          // Use higher quality compression for Firestore backup (2048px / 0.92)
          const genUrl = await compressForFirestore(base64img);
          const genHQUrl = await uploadHQToStorage(id, slideId, 'generatedImage', base64img);
          return { slideId, genUrl, genHQUrl };
        }));
        const fb = writeBatch(db);
        uploaded.forEach(({ slideId, genUrl, genHQUrl }) => {
          fb.update(doc(db, 'projects', id, 'slides', slideId), {
            generatedImage: genUrl,
            ...(genHQUrl ? { generatedImageHQ: genHQUrl } : {}),
          });
          newlyBacked.add(slideId);
        });
        await fb.commit();
      }
      // Keep pendingImages in memory (original quality for this session)
      setBackedUpIds(prev => {
        const next = new Map(prev);
        unbacked.forEach(([sid, img]) => { if (newlyBacked.has(sid)) next.set(sid, img.length); });
        return next;
      });
      setLastBackupTime(new Date());
      backupFailCount.current = 0;
    } catch (err) {
      console.error('Backup failed:', err);
      backupFailCount.current += 1;
    } finally {
      setIsBackingUp(false);
    }
  };

  const unbackedCount = Array.from(pendingImages.entries()).filter(([sid, img]) => backedUpIds.get(sid) !== img.length).length;

  // ── Markdown renderer (react-markdown + GFM + KaTeX) ──
  const mdComponents: Record<string, React.FC<any>> = React.useMemo(() => ({
    h1: ({ children }: any) => <h1 style={{ fontSize: '1rem', fontWeight: 700, margin: '0.4rem 0 0.15rem' }}>{children}</h1>,
    h2: ({ children }: any) => <h2 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0.35rem 0 0.1rem' }}>{children}</h2>,
    h3: ({ children }: any) => <h3 style={{ fontSize: '0.85rem', fontWeight: 600, margin: '0.3rem 0 0.1rem' }}>{children}</h3>,
    p: ({ children }: any) => <p style={{ margin: '0.15rem 0', lineHeight: 1.6 }}>{children}</p>,
    ul: ({ children }: any) => <ul style={{ margin: '0.15rem 0', paddingLeft: '1.2rem' }}>{children}</ul>,
    ol: ({ children }: any) => <ol style={{ margin: '0.15rem 0', paddingLeft: '1.2rem' }}>{children}</ol>,
    li: ({ children }: any) => <li style={{ marginBottom: '0.05rem' }}>{children}</li>,
    strong: ({ children }: any) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
    hr: () => <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '0.3rem 0' }} />,
    code: ({ inline, children, className }: any) => inline
      ? <code style={{ background: 'var(--bg-tertiary)', padding: '0.1rem 0.25rem', borderRadius: '3px', fontSize: '0.78em' }}>{children}</code>
      : <pre style={{ background: 'var(--bg-tertiary)', padding: '0.5rem 0.6rem', borderRadius: '0.3rem', overflow: 'auto', fontSize: '0.72rem', margin: '0.2rem 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}><code className={className}>{children}</code></pre>,
    table: ({ children }: any) => <div style={{ overflowX: 'auto', margin: '0.2rem 0' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>{children}</table></div>,
    thead: ({ children }: any) => <thead style={{ background: 'var(--bg-tertiary)' }}>{children}</thead>,
    th: ({ children }: any) => <th style={{ padding: '0.25rem 0.4rem', borderBottom: '2px solid var(--border-color)', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>{children}</th>,
    td: ({ children }: any) => <td style={{ padding: '0.2rem 0.4rem', borderBottom: '1px solid var(--border-color)' }}>{children}</td>,
    blockquote: ({ children }: any) => <blockquote style={{ margin: '0.2rem 0', paddingLeft: '0.6rem', borderLeft: '3px solid var(--accent-color)', color: 'var(--text-secondary)' }}>{children}</blockquote>,
    a: ({ href, children }: any) => <a href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-color)', textDecoration: 'underline' }}>{children}</a>,
  }), []);

  // ── AI Chat helpers ──
  const updateAiConv = (convId: string, updater: (c: AIChatConv) => AIChatConv) => {
    setAiConversations(prev => {
      const next = prev.map(c => c.id === convId ? updater(c) : c);
      saveAiConversations(next);
      return next;
    });
  };
  const addMsgToConv = (convId: string, msg: AIChatMsg) => {
    updateAiConv(convId, c => ({ ...c, messages: [...c.messages, msg], updatedAt: Date.now() }));
  };
  const startNewAiChat = () => {
    const newConv: AIChatConv = { id: Date.now().toString(), title: '新對話', projectId: id || '', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
    setAiConversations(prev => { const next = [newConv, ...prev]; saveAiConversations(next); return next; });
    setAiActiveConvId(newConv.id);
    setAiChatHistoryOpen(false);
  };
  const deleteAiConv = (convId: string) => {
    setAiConversations(prev => { const next = prev.filter(c => c.id !== convId); saveAiConversations(next); return next; });
    if (aiActiveConvId === convId) setAiActiveConvId(null);
  };

  // ── AI Chat send handler ──
  const handleAiChatSend = async () => {
    const trimmed = aiChatInput.trim();
    if (!trimmed && aiChatAttachments.length === 0) return;
    const activeIdx = slides.findIndex(s => s.id === activeSlideId);
    const currentImg = activeSlide ? getCanvasSrc(activeSlideId, activeSlide) : null;

    // Auto-create conversation if none active
    let convId = aiActiveConvId;
    if (!convId) {
      const newConv: AIChatConv = { id: Date.now().toString(), title: '新對話', projectId: id || '', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
      setAiConversations(prev => { const next = [newConv, ...prev]; saveAiConversations(next); return next; });
      convId = newConv.id;
      setAiActiveConvId(convId);
    }
    const isFirstMsg = aiChatMsgs.length === 0;

    const userMsg: AIChatMsg = {
      id: Date.now().toString(), role: 'user', text: trimmed, images: [], attachments: [...aiChatAttachments],
      taggedSlides: Array.from(aiChatTaggedSlides), timestamp: Date.now(),
    };
    addMsgToConv(convId, userMsg);
    setAiChatInput(''); setAiChatAttachments([]); setAiChatTaggedSlides(new Set()); setAiChatTagPicker(false);
    setAiChatLoading(true);
    setTimeout(() => aiChatScrollRef.current?.scrollTo({ top: aiChatScrollRef.current.scrollHeight, behavior: 'smooth' }), 50);

    // Auto-generate title for new conversations
    if (isFirstMsg && trimmed) {
      const cid = convId;
      generateChatTitle(trimmed).then(title => {
        updateAiConv(cid, c => ({ ...c, title }));
      }).catch(() => {});
    }

    const ctrl = new AbortController(); aiChatAbortRef.current = ctrl;
    try {
      // Helper: ensure image source is a base64 data URL (convert URLs via fetch)
      const toDataUrl = async (src: string): Promise<string> => {
        if (src.startsWith('data:')) return src;
        return fetchImageAsBase64(src);
      };
      // Build Gemini message parts
      const parts: GeminiChatMessage['parts'] = [];
      // Always include current slide
      if (currentImg) {
        const dataUrl = await toDataUrl(currentImg);
        const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        parts.push({ text: `[目前投影片: 第 ${activeIdx + 1} 頁]` });
        parts.push({ inlineData: { mimeType: 'image/jpeg', data: b64 } });
      }
      // Include tagged slides
      for (const idx of userMsg.taggedSlides) {
        const s = slides[idx];
        if (!s) continue;
        const src = getPreviewSrc(s.id, s);
        if (src) {
          const dataUrl = await toDataUrl(src);
          const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
          parts.push({ text: `[TAG: 第 ${idx + 1} 頁]` });
          parts.push({ inlineData: { mimeType: 'image/jpeg', data: b64 } });
        }
      }
      // Include uploaded attachments
      for (const a of userMsg.attachments) {
        const b64 = a.dataUrl.includes(',') ? a.dataUrl.split(',')[1] : a.dataUrl;
        parts.push({ inlineData: { mimeType: a.mimeType, data: b64 } });
      }
      // User text
      if (trimmed) parts.push({ text: trimmed });

      // Build conversation history
      const history: GeminiChatMessage[] = [];
      // System context
      history.push({ role: 'user', parts: [{ text: '你是投影片助手。使用者會提供投影片圖片並向你提問。請用繁體中文回答，支援 Markdown 和 LaTeX 數學公式格式。回答要簡潔、精確。' }] });
      history.push({ role: 'model', parts: [{ text: '好的，我是你的投影片助手。請提供投影片圖片或問題，我會幫你解答。' }] });
      // Previous messages (last 10 turns)
      const recentMsgs = aiChatMsgs.slice(-10);
      for (const m of recentMsgs) {
        if (m.role === 'user') {
          const p: GeminiChatMessage['parts'] = [];
          if (m.text) p.push({ text: m.text });
          history.push({ role: 'user', parts: p.length > 0 ? p : [{ text: '(附件)' }] });
        } else {
          history.push({ role: 'model', parts: [{ text: m.text || '...' }] });
        }
      }
      // Current user message
      history.push({ role: 'user', parts });

      const resp = await chatWithGemini(history, undefined, { generateImage: false }, ctrl.signal);
      addMsgToConv(convId, { id: (Date.now() + 1).toString(), role: 'assistant', text: resp.text, images: resp.images, attachments: [], taggedSlides: [], timestamp: Date.now() });
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        addMsgToConv(convId, { id: (Date.now() + 1).toString(), role: 'assistant', text: `❌ 錯誤: ${err?.message || '未知錯誤'}`, images: [], attachments: [], taggedSlides: [], timestamp: Date.now() });
      }
    } finally {
      setAiChatLoading(false);
      setTimeout(() => aiChatScrollRef.current?.scrollTo({ top: aiChatScrollRef.current.scrollHeight, behavior: 'smooth' }), 100);
    }
  };

  const handleBack = () => {
    if (unbackedCount > 0) {
      setShowExitModal(true);
    } else {
      navigate('/home');
    }
  };

  const handleExitWithBackup = async () => {
    setShowExitModal(false);
    await handleBackup();
    navigate('/home');
  };

  const handleExitDirect = () => {
    setShowExitModal(false);
    navigate('/home');
  };

  const MAX_HISTORY = 3;
  const pushToHistory = async (slideId: string, img: string) => {
    if (!id) return;
    const current = imageHistoriesRef.current;
    const slide = slides.find(s => s.id === slideId);
    // '' is a sentinel meaning "text state" (no image) — allows undo past pos=0 for text-only slides
    const initStack: string[] = slide?.originalImage ? [slide.originalImage] : [''];
    const entry = current.get(slideId) || { stack: initStack, pos: initStack.length - 1 };
    // Build new stack: take everything up to current pos, then append new image
    const newStack = [...entry.stack.slice(0, entry.pos + 1), img];
    // Trim: keep original at index 0, remove oldest gen (index 1) if over MAX_HISTORY
    while (newStack.length > MAX_HISTORY) newStack.splice(1, 1);
    const newEntry = { stack: newStack, pos: newStack.length - 1 };
    const next = new Map(current);
    next.set(slideId, newEntry);
    imageHistoriesRef.current = next;
    setImageHistories(next);
    // Fire-and-forget: back up full-quality image to Google Drive (if configured)
    const driveScriptUrl = localStorage.getItem('driveScriptUrl') || import.meta.env.VITE_DRIVE_SCRIPT_URL || '';
    if (driveScriptUrl) {
      const ts = Date.now();
      uploadToDrive(img, `${slideId}_${ts}.jpg`, driveScriptUrl)
        .then(url => {
          if (url && id) {
            console.log('[Drive] Backed up:', url);
            updateDoc(doc(db, 'projects', id, 'slides', slideId), { generatedImageDriveUrl: url }).catch(console.error);
          }
        })
        .catch(console.warn);
    }
    // Compress each entry for Firestore (avoid 1MB limit from 2K images)
    const firestoreStack = await Promise.all(
      newStack.map(s => s.startsWith('data:') ? compressForFirestore(s) : Promise.resolve(s))
    );
    await updateDoc(doc(db, 'projects', id, 'slides', slideId), {
      imageHistory: firestoreStack,
      imageHistoryPos: newEntry.pos,
    }).catch(console.error);
  };

  const handleUndo = async (slideId: string) => {
    if (!id) return;
    const entry = imageHistoriesRef.current.get(slideId);
    if (!entry || entry.pos <= 0) return; // already at original (index 0)
    const newPos = entry.pos - 1;
    const next = new Map(imageHistoriesRef.current);
    next.set(slideId, { ...entry, pos: newPos });
    imageHistoriesRef.current = next;
    setImageHistories(next);
    if (newPos === 0) {
      // Reached original
      setPendingImages(p => { const m = new Map(p); m.delete(slideId); return m; });
      updateDoc(doc(db, 'projects', id, 'slides', slideId), { imageHistoryPos: 0, generatedImage: null }).catch(console.error);
    } else {
      const prevImg = entry.stack[newPos];
      setPendingImages(p => new Map(p).set(slideId, prevImg));
      updateDoc(doc(db, 'projects', id, 'slides', slideId), { imageHistoryPos: newPos, generatedImage: prevImg }).catch(console.error);
    }
  };

  const handleRedo = async (slideId: string) => {
    if (!id) return;
    const entry = imageHistoriesRef.current.get(slideId);
    if (!entry || entry.pos >= entry.stack.length - 1) return;
    const newPos = entry.pos + 1;
    const next = new Map(imageHistoriesRef.current);
    next.set(slideId, { ...entry, pos: newPos });
    imageHistoriesRef.current = next;
    setImageHistories(next);
    const nextImg = entry.stack[newPos];
    setPendingImages(p => new Map(p).set(slideId, nextImg));
    updateDoc(doc(db, 'projects', id, 'slides', slideId), { imageHistoryPos: newPos, generatedImage: nextImg }).catch(console.error);
  };

  const handleRevertToOriginal = (slideId: string) => {
    const entry = imageHistoriesRef.current.get(slideId);
    if (!entry || entry.pos === 0) return; // already at original
    const next = new Map(imageHistoriesRef.current);
    next.set(slideId, { ...entry, pos: 0 });
    imageHistoriesRef.current = next;
    setImageHistories(next);
    setPendingImages(prev => { const m = new Map(prev); m.delete(slideId); return m; });
    if (id) updateDoc(doc(db, 'projects', id, 'slides', slideId), { imageHistoryPos: 0, generatedImage: null }).catch(console.error);
  };

  const handleDragStart = (e: React.DragEvent, slideId: string) => {
    setDraggingId(slideId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, slideId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (slideId !== draggingId) setDragOverId(slideId);
  };

  const handleDrop = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggingId || !id) { setDraggingId(null); setDragOverId(null); return; }
    // Determine which slides to move: all selected if dragging a selected slide, else just the one
    const movingIds = selectedSlides.has(draggingId) ? slides.filter(s => selectedSlides.has(s.id)).map(s => s.id) : [draggingId];
    const movingSet = new Set(movingIds);
    if (movingSet.has(targetId)) { setDraggingId(null); setDragOverId(null); return; }
    const toIdx = slides.findIndex(s => s.id === targetId);
    if (toIdx === -1) { setDraggingId(null); setDragOverId(null); return; }
    // Remove moving slides, keeping their relative order
    const remaining = slides.filter(s => !movingSet.has(s.id));
    const movingSlides = slides.filter(s => movingSet.has(s.id));
    // Insert before or after target based on original positions
    const firstMovingIdx = slides.findIndex(s => movingSet.has(s.id));
    const insertIdx = remaining.findIndex(s => s.id === targetId);
    const insertAt = firstMovingIdx < toIdx ? insertIdx + 1 : insertIdx;
    remaining.splice(insertAt, 0, ...movingSlides);
    const fb = writeBatch(db);
    remaining.forEach((slide, idx) => {
      fb.update(doc(db, 'projects', id, 'slides', slide.id), { order: (idx + 1) * 1000 });
    });
    await fb.commit();
    setDraggingId(null);
    setDragOverId(null);
  };

  const handleDragEnd = () => { setDraggingId(null); setDragOverId(null); };

  // Sidebar resize
  const handleResizeStart = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const newW = Math.min(600, Math.max(180, startW + (ev.clientX - startX)));
      setSidebarWidth(newW);
    };
    const onUp = () => {
      isResizing.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [sidebarWidth]);

  const setPrompt = (prompt: string) => {
    if (!id || !activeSlideId) return;
    updateDoc(doc(db, 'projects', id, 'slides', activeSlideId), { prompt });
  };

  // Load current slide image onto the canvas so strokes are drawn directly on the image
  const enterDrawingMode = () => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) { setIsDrawingMode(true); return; }
    const ctx = canvas.getContext('2d');
    if (!ctx) { setIsDrawingMode(true); return; }
    // Set canvas internal resolution to match image natural size
    canvas.width = img.naturalWidth || img.offsetWidth;
    canvas.height = img.naturalHeight || img.offsetHeight;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    setIsDrawingMode(true);
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawingMode || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clientX = ('touches' in e) ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = ('touches' in e) ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !isDrawingMode || !canvasRef.current) return;
    e.preventDefault(); // prevent scroll on touch
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clientX = ('touches' in e) ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = ('touches' in e) ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    ctx.lineWidth = brushSize * scaleX;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowBlur = 0;
    ctx.strokeStyle = penColor;
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    if (!canvasRef.current) return;
    // Re-draw the base image to clear strokes
    const img = imgRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (ctx && img) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    }
  };

  // ── Word / TXT helpers ──────────────────────────────────────────────────
  const parseTextIntoPages = (text: string): string[] => {
    const parts = text.split(/(?=第[一二三四五六七八九十百千\d]+頁)/);
    return parts
      .map(p => p.replace(/^第[一二三四五六七八九十百千\d]+頁[\s\n]*/, '').trim())
      .filter(p => p.length > 0);
  };

  const extractDocxText = async (file: File): Promise<string> => {
    const zip = new JSZip();
    const content = await zip.loadAsync(file);
    const docXml = await content.files['word/document.xml'].async('string');
    const paragraphs = docXml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [];
    return paragraphs.map(p => {
      const texts = p.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
      return texts.map(t => t.replace(/<[^>]+>/g, '')).join('');
    }).filter(l => l.trim()).join('\n');
  };


  const handleTextFileProcess = async (file: File) => {
    if (!file || !id) return;
    let rawText = '';
    try {
      if (file.name.endsWith('.txt')) {
        rawText = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = e => resolve(e.target?.result as string);
          reader.onerror = reject;
          reader.readAsText(file, 'UTF-8');
        });
      } else {
        rawText = await extractDocxText(file);
      }
      const pages = parseTextIntoPages(rawText);
      if (pages.length === 0) {
        showAlert('找不到頁面標記，請確保文件中有「第一頁」、「第二頁」等標示。', '解析失敗');
        return;
      }
      const baseTimestamp = Date.now();
      const newSlideIds: string[] = [];
      const fb = writeBatch(db);
      pages.forEach((pageText, idx) => {
        const newId = `${baseTimestamp}_txt_${idx}`;
        newSlideIds.push(newId);
        fb.set(doc(db, 'projects', id as string, 'slides', newId), {
          originalImage: null, originalImageHQ: null,
          generatedImage: null, generatedImageHQ: null, maskImage: null,
          prompt: pageText, status: 'draft',
          createdAt: baseTimestamp + idx, order: (baseTimestamp + idx) * 1000
        });
      });
      await fb.commit();
      setSelectedSlides(new Set(newSlideIds));
      setActiveSlideId(newSlideIds[0]);
    } catch (err) {
      console.error(err);
      showAlert('解析文件時發生錯誤，請確認檔案格式正確。', '錯誤');
    } finally {
      setSavingProgress(null);
    }
  };
  const handlePPTUpload = async (file: File) => {
    if (!file || !id) return;
    let exactTotalSlides = 1;
    try { const zip = new JSZip(); const content = await zip.loadAsync(file); const sf = Object.keys(content.files).filter(n => n.startsWith('ppt/slides/slide') && n.endsWith('.xml')); if (sf.length > 0) exactTotalSlides = sf.length; } catch(err) { console.warn('slide count fail'); }
    setParsingProgress({ current: 0, total: exactTotalSlides });
    const progressInterval = setInterval(() => { setParsingProgress(prev => { if (!prev) return prev; const next = prev.current + 1; return { ...prev, current: next >= prev.total ? prev.total - 1 : next }; }); }, 2000);
    try {
      const formData = new FormData(); formData.append('file', file);
      const backendUrl = localStorage.getItem('backendUrl') || import.meta.env.VITE_BACKEND_URL || '';
      const res = await fetch(`${backendUrl}/upload-ppt/`, { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Failed to parse PPT.');
      const data = await res.json(); const base64images = data.slides as string[]; const totalSlidesReturned = base64images.length;
      if (totalSlidesReturned === 0) { showAlert('找不到投影片，請確認 PPT 檔案格式正確。', '錯誤'); clearInterval(progressInterval); setParsingProgress(null); return; }
      clearInterval(progressInterval); setParsingProgress({ current: totalSlidesReturned, total: totalSlidesReturned });
      await new Promise(r => setTimeout(r, 600)); setParsingProgress(null);
      setSavingProgress({ current: 0, total: totalSlidesReturned });
      const newSlideIds: string[] = []; const baseTimestamp = Date.now();
      const allResults: {newId:string,imageUrl:string,rawData:string,idx:number}[] = [];
      const UPLOAD_CONCURRENCY = 4;
      for (let ci = 0; ci < base64images.length; ci += UPLOAD_CONCURRENCY) {
        const chunk = base64images.slice(ci, ci + UPLOAD_CONCURRENCY);
        const chunkRes = await Promise.all(chunk.map(async (imgData, j) => { const idx = ci + j; const newId = baseTimestamp.toString() + '_' + idx; newSlideIds.push(newId); const imageUrl = await uploadImageToStorage(id as string, newId, 'originalImage', imgData); return { newId, imageUrl, rawData: imgData, idx }; }));
        allResults.push(...chunkRes);
        setSavingProgress({ current: Math.min(ci + UPLOAD_CONCURRENCY, totalSlidesReturned), total: totalSlidesReturned });
      }
      const BATCH_SIZE = 10;
      for (let bi = 0; bi < allResults.length; bi += BATCH_SIZE) {
        const chunk = allResults.slice(bi, bi + BATCH_SIZE);
        const fb = writeBatch(db);
        chunk.forEach(({ newId, imageUrl, idx }) => { fb.set(doc(db, 'projects', id as string, 'slides', newId), { originalImage: imageUrl, originalImageHQ: null, generatedImage: null, generatedImageHQ: null, maskImage: null, prompt: defaultPromptRef.current || '', status: 'draft', createdAt: baseTimestamp + idx, order: (baseTimestamp + idx) * 1000 }); });
        await fb.commit();
      }
      setSelectedSlides(new Set(newSlideIds)); setActiveSlideId(newSlideIds[0]);
      const projectId = id as string;
      allResults.forEach(({ newId, rawData }) => {
        uploadHQToStorage(projectId, newId, 'originalImage', rawData)
          .then(hqUrl => { if (hqUrl) updateDoc(doc(db, 'projects', projectId, 'slides', newId), { originalImageHQ: hqUrl }).catch(() => {}); })
          .catch(() => {});
      });
    } catch (err) { console.error(err); showAlert('儲存 PPT 時發生錯誤。', '錯誤'); }
    finally { clearInterval(progressInterval); setParsingProgress(null); setSavingProgress(null); }
  };

  const handlePDFUpload = async (file: File) => {
    if (!file || !id) return;
    setParsingProgress({ current: 0, total: 1 });
    try {
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const totalPages = pdfDoc.numPages;
      setParsingProgress({ current: 0, total: totalPages });
      const base64images: string[] = [];
      for (let i = 1; i <= totalPages; i++) {
        const page = await pdfDoc.getPage(i);
        const scale = 2; // 2x for good quality
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d')!;
        await page.render({ canvasContext: ctx, viewport } as any).promise;
        base64images.push(canvas.toDataURL('image/jpeg', 0.92));
        setParsingProgress({ current: i, total: totalPages });
      }
      if (base64images.length === 0) { showAlert('找不到頁面，請確認 PDF 檔案格式正確。', '錯誤'); setParsingProgress(null); return; }
      await new Promise(r => setTimeout(r, 400)); setParsingProgress(null);
      setSavingProgress({ current: 0, total: base64images.length });
      const newSlideIds: string[] = []; const baseTimestamp = Date.now();
      const allResults: {newId:string,imageUrl:string,rawData:string,idx:number}[] = [];
      const UPLOAD_CONCURRENCY = 4;
      for (let ci = 0; ci < base64images.length; ci += UPLOAD_CONCURRENCY) {
        const chunk = base64images.slice(ci, ci + UPLOAD_CONCURRENCY);
        const chunkRes = await Promise.all(chunk.map(async (imgData, j) => { const idx = ci + j; const newId = baseTimestamp.toString() + '_pdf_' + idx; newSlideIds.push(newId); const imageUrl = await uploadImageToStorage(id as string, newId, 'originalImage', imgData); return { newId, imageUrl, rawData: imgData, idx }; }));
        allResults.push(...chunkRes);
        setSavingProgress({ current: Math.min(ci + UPLOAD_CONCURRENCY, base64images.length), total: base64images.length });
      }
      const BATCH_SIZE = 10;
      for (let bi = 0; bi < allResults.length; bi += BATCH_SIZE) {
        const bchunk = allResults.slice(bi, bi + BATCH_SIZE);
        const fb = writeBatch(db);
        bchunk.forEach(({ newId, imageUrl, idx }) => { fb.set(doc(db, 'projects', id as string, 'slides', newId), { originalImage: imageUrl, originalImageHQ: null, generatedImage: null, generatedImageHQ: null, maskImage: null, prompt: defaultPromptRef.current || '', status: 'draft', createdAt: baseTimestamp + idx, order: (baseTimestamp + idx) * 1000 }); });
        await fb.commit();
      }
      setSelectedSlides(new Set(newSlideIds)); setActiveSlideId(newSlideIds[0]);
      const projectId = id as string;
      allResults.forEach(({ newId, rawData }) => {
        uploadHQToStorage(projectId, newId, 'originalImage', rawData)
          .then(hqUrl => { if (hqUrl) updateDoc(doc(db, 'projects', projectId, 'slides', newId), { originalImageHQ: hqUrl }).catch(() => {}); })
          .catch(() => {});
      });
    } catch (err) { console.error(err); showAlert('解析 PDF 時發生錯誤。', '錯誤'); }
    finally { setParsingProgress(null); setSavingProgress(null); }
  };

  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverPage(false);
    if (draggingId) return; // internal slide reorder — ignore
    if (parsingProgress || savingProgress || !id) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    const pptFiles = files.filter(f => f.name.endsWith('.pptx'));
    const pdfFiles = files.filter(f => f.name.endsWith('.pdf'));
    const textFiles = files.filter(f => f.name.endsWith('.docx') || f.name.endsWith('.txt'));
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    for (const f of pptFiles) await handlePPTUpload(f);
    for (const f of pdfFiles) await handlePDFUpload(f);
    for (const f of textFiles) await handleTextFileProcess(f);
    if (imageFiles.length > 0) {
      const dt = new DataTransfer();
      imageFiles.forEach(f => dt.items.add(f));
      await handleImageUpload(dt.files);
    }
    const skipped = files.length - pptFiles.length - pdfFiles.length - textFiles.length - imageFiles.length;
    if (skipped > 0) showToast(`已跳過 ${skipped} 個不支援的檔案`, 'info');
  };

  const handleImageUpload = async (fileList: FileList) => {
    const files = Array.from(fileList);
    if (!id || files.length === 0) return;
    setSavingProgress({ current: 0, total: files.length });
    try {
      const baseTimestamp = Date.now();
      const dp = defaultPromptRef.current || '';
      const newSlideIds: string[] = [];
      const slideData: { newId: string; imageUrl: string; base64: string; idx: number }[] = [];
      const CONCURRENCY = 4;
      let completed = 0;
      // Parallel compress with concurrency
      for (let ci = 0; ci < files.length; ci += CONCURRENCY) {
        const chunk = files.slice(ci, ci + CONCURRENCY);
        const results = await Promise.all(chunk.map(async (file, j) => {
          const idx = ci + j;
          const base64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(file); });
          const imageUrl = await compressForFirestore(base64);
          const newId = `${baseTimestamp}_img_${idx}`;
          return { newId, imageUrl, base64, idx };
        }));
        slideData.push(...results);
        results.forEach(r => newSlideIds.push(r.newId));
        completed += chunk.length;
        setSavingProgress({ current: completed, total: files.length });
      }
      // Batch write to Firestore in chunks of 10 to stay under ~10MB payload limit
      const BATCH_SIZE = 10;
      for (let bi = 0; bi < slideData.length; bi += BATCH_SIZE) {
        const batchChunk = slideData.slice(bi, bi + BATCH_SIZE);
        const fb = writeBatch(db);
        batchChunk.forEach(({ newId, imageUrl, idx }) => {
          fb.set(doc(db, 'projects', id as string, 'slides', newId), {
            originalImage: imageUrl, originalImageHQ: null,
            generatedImage: null, generatedImageHQ: null, maskImage: null,
            prompt: dp, status: 'draft',
            createdAt: baseTimestamp + idx, order: (baseTimestamp + idx) * 1000,
          });
        });
        await fb.commit();
      }
      setSelectedSlides(new Set(newSlideIds));
      setActiveSlideId(newSlideIds[0]);
      // Deferred HQ uploads in background — don't block UI
      const projectId = id;
      slideData.forEach(({ newId, base64 }) => {
        uploadHQToStorage(projectId, newId, 'originalImage', base64)
          .then(hqUrl => { if (hqUrl) updateDoc(doc(db, 'projects', projectId, 'slides', newId), { originalImageHQ: hqUrl }).catch(() => {}); })
          .catch(() => {});
      });
    } catch (err) {
      console.error(err);
      showAlert('上傳圖片時發生錯誤。', '錯誤');
    } finally {
      setSavingProgress(null);
    }
  };

  // Insert images at a specific position (between slides)
  const handleInsertImages = async (fileList: FileList, afterIdx: number) => {
    const files = Array.from(fileList);
    if (!id || files.length === 0) return;
    const curOrder = afterIdx >= 0 ? (slides[afterIdx]?.order ?? 0) : 0;
    const nextOrder = afterIdx + 1 < slides.length ? (slides[afterIdx + 1]?.order ?? curOrder + 1000 * (files.length + 1)) : curOrder + 1000 * (files.length + 1);
    const gap = (nextOrder - curOrder) / (files.length + 1);
    setSavingProgress({ current: 0, total: files.length });
    try {
      const dp = defaultPromptRef.current || '';
      const newSlideIds: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const base64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(files[i]); });
        const imageUrl = await compressForFirestore(base64);
        const newId = Math.random().toString(36).substr(2, 9);
        const order = Math.round(curOrder + gap * (i + 1));
        await setDoc(doc(db, 'projects', id, 'slides', newId), {
          originalImage: imageUrl, originalImageHQ: null, generatedImage: null, generatedImageHQ: null, maskImage: null,
          prompt: dp, status: 'draft', createdAt: Date.now() + i, order
        });
        newSlideIds.push(newId);
        setSavingProgress({ current: i + 1, total: files.length });
        // HQ upload in background
        const projectId = id;
        uploadHQToStorage(projectId, newId, 'originalImage', base64)
          .then(hqUrl => { if (hqUrl) updateDoc(doc(db, 'projects', projectId, 'slides', newId), { originalImageHQ: hqUrl }).catch(() => {}); })
          .catch(() => {});
      }
      if (newSlideIds.length > 0) setActiveSlideId(newSlideIds[0]);
    } catch (err) { console.error(err); showAlert('上傳圖片時發生錯誤。', '錯誤'); }
    finally { setSavingProgress(null); }
  };

  // Insert files (PPT/PDF/Word/TXT) — delegates to existing handlers (appends at end)
  const handleInsertFiles = async (fileList: FileList) => {
    const files = Array.from(fileList);
    for (const f of files) {
      if (f.name.endsWith('.pdf')) await handlePDFUpload(f);
      else if (f.name.endsWith('.pptx')) await handlePPTUpload(f);
      else if (f.name.endsWith('.docx') || f.name.endsWith('.txt')) await handleTextFileProcess(f);
    }
  };

  // ────────────────────────────────────────────────────────────────────────

  const handleCancelGenerate = () => {
    generateAbortController.current?.abort();
  };

  const handleGenerate = async (skipRefCheck = false) => {
    if (!id) return;
    // In auto-retry mode: only retry the previously-failed slides, skip all other checks
    const isAutoRetry = skipRefCheck && !!autoRetryConfigRef.current;
    const isLocalModifyOverride = !!localOverrideSlideIdsRef.current;
    if (!isAutoRetry && !isLocalModifyOverride) {
      if (selectedSlides.size === 0) { showAlert('請先選取至少一張投影片。', '提示'); return; }
      if (!skipRefCheck && !globalExtraPrompt.trim()) { showAlert('請先輸入額外提示詞再開始生成。', '提示'); return; }
      const hasContent = Array.from(selectedSlides).some(sid => {
        const s = slides.find(sl => sl.id === sid);
        return s?.originalImage || s?.prompt;
      });
      if (!hasContent) { showAlert('請先上傳 PPT/PDF、圖片或 Word/TXT 檔案再開始生成。', '提示'); return; }
    }

    const abort = new AbortController();
    generateAbortController.current = abort;
    // Auto-retry: only process the slides that actually failed last time
    // Local modify override: use ref-based slide IDs to avoid stale closure
    const localOverride = localOverrideSlideIdsRef.current;
    localOverrideSlideIdsRef.current = null;
    const slideIds = isAutoRetry
      ? [...autoRetryConfigRef.current!.toRetrySlides]
      : localOverride || Array.from(selectedSlides);
    const total = slideIds.length;
    setGenerateProgress({ current: 0, total });
    setIsGenerating(true);
    localStorage.setItem(getGeneratingKey(), Date.now().toString());

    const handledSlideIds = new Set<string>();
    try {
      // Set initiating state using batch
      const initialBatch = writeBatch(db);
      slideIds.forEach(slideId => {
         initialBatch.update(doc(db, 'projects', id, 'slides', slideId), { status: 'generating' });
      });
      await initialBatch.commit();
      const apiKey = getApiKey();
      const model = localStorage.getItem('vertexModel') || localStorage.getItem('geminiModel') || "gemini-3.1-flash-image-preview";
      
      const { generateImageDesign } = await import('../utils/gemini');
      let completedCount = 0;

      const results: ({ slideId: string; genUrl: string } | null)[] = [];
      const INTER_REQUEST_DELAY_MS = 3000; // avoid 429 RESOURCE_EXHAUSTED

      const failedSlides: { slideId: string; error: string }[] = [];

      const processSlide = async (slideId: string) => {
        const slide = slides.find(s => s.id === slideId);
        if (!slide || (!slide.originalImage && !slide.prompt)) {
          completedCount++;
          setGenerateProgress({ current: completedCount, total });
          return null;
        }
        try {
          // Local modify: use the captured current image (with strokes baked in) directly
          const capturedBase = localBaseDataRef.current;
          const capturedPrompt = localPromptRef.current;
          const capturedAspectRatio = localAspectRatioRef.current;
          localBaseDataRef.current = null;
          localMaskDataRef.current = null;
          localPromptRef.current = '';
          localAspectRatioRef.current = '';
          const isLocalModify = !!capturedPrompt;
          // Prefer HQ original for better generation quality, fall back to compressed
          const origSrc = slide.originalImageHQ || slide.originalImage;
          const base64Original = capturedBase
            ? await fetchImageAsBase64(capturedBase)
            : (origSrc ? await fetchImageAsBase64(origSrc) : null);
          const base64Ref = (!isLocalModify && globalReference) ? await fetchImageAsBase64(globalReference) : null;
          // For local modify: strokes are already baked into capturedBase, no separate mask needed
          let base64Mask: string | null = null;
          if (!isLocalModify && slide.maskImage) {
            base64Mask = await fetchImageAsBase64(slide.maskImage);
          }
          // For local modify: use only the toolbar prompt, no globalExtraPrompt
          // For full generation: always use defaultPromptRef (reflects current font/color/settings)
          // rather than slide.prompt which was baked in at slide creation time
          // Exception: text-only slides (no original image) — must include slide.prompt as the content
          const isTextSlide = !slide.originalImage && !capturedBase && !isLocalModify;
          const slideTextContent = isTextSlide && slide.prompt?.trim()
            ? `以下是投影片的文字內容，請根據這段文字來生成投影片圖片：\n${slide.prompt.trim()}\n\n`
            : '';
          const bgColorPrompt = backgroundColor.trim() ? `背景色：${backgroundColor.trim()}\n` : '';
          const finalPrompt = isLocalModify
            ? (capturedPrompt || 'Edit the masked area.')
            : (slideTextContent + bgColorPrompt + (globalExtraPrompt.trim() ? globalExtraPrompt.trim() + '\n' : '') + defaultPromptRef.current);
          const finalAspectRatio = isLocalModify && capturedAspectRatio ? capturedAspectRatio : (useAdvancedSettings ? aspectRatio : '');
          // Capture extra images for local modify
          const capturedExtras = isLocalModify ? [...localExtraImagesRef.current] : undefined;
          if (isLocalModify) localExtraImagesRef.current = [];
          // Auto-retry every 5 s on 429/499 for up to 60 s before escalating
          let generatedImg = '';
          {
            const RETRY_INTERVAL = 5_000;
            const RETRY_DEADLINE = Date.now() + 60_000;
            let lastErr: unknown;
            while (true) {
              try {
                generatedImg = await generateImageDesign(
                  base64Original, base64Ref, base64Mask,
                  finalPrompt, apiKey, model, finalAspectRatio, resolution, abort.signal,
                  capturedExtras
                );
                break;
              } catch (e: unknown) {
                if ((e as {name?:string})?.name === 'AbortError') throw e;
                lastErr = e;
                const errMsg = String((e as {message?:string})?.message ?? e);
                const isRetryable = errMsg.includes('429') || errMsg.includes('499') || errMsg.includes('CANCELLED');
                if (!isRetryable || Date.now() >= RETRY_DEADLINE) { throw lastErr; }
                console.warn(`[${errMsg.includes('429') ? '429' : '499'}] 5 秒後自動重試...`);
                await new Promise<void>(r => {
                  const t = setTimeout(r, RETRY_INTERVAL);
                  abort.signal.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true });
                });
                if (abort.signal.aborted) throw new DOMException('Aborted', 'AbortError');
              }
            }
          }
          if (isLocalModify && canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
            updateDoc(doc(db, 'projects', id, 'slides', slideId), { maskImage: null }).catch(() => {});
          }
          setPendingImages(prev => new Map(prev).set(slideId, generatedImg));
          pushToHistory(slideId, generatedImg);
          const compressedGen = await compressImage(generatedImg, 1200, 0.7);
          await updateDoc(doc(db, 'projects', id, 'slides', slideId), { status: 'done', generatedImage: compressedGen });
          handledSlideIds.add(slideId);
          completedCount++;
          setGenerateProgress({ current: completedCount, total });
          return { slideId, genUrl: generatedImg };
        } catch (err: any) {
          if (err?.name === 'AbortError') throw err;
          const msg = err?.message || String(err);
          const isQuotaErr = msg.includes('429') || msg.includes('499') || msg.includes('CANCELLED');
          console.error(`Slide ${slideId} failed:`, msg);
          failedSlides.push({ slideId, error: msg });
          await updateDoc(doc(db, 'projects', id, 'slides', slideId), { status: 'draft' }).catch(() => {});
          handledSlideIds.add(slideId);
          completedCount++;
          setGenerateProgress({ current: completedCount, total });
          // Stop all remaining slides on quota/server exhaustion
          if (isQuotaErr) throw new Error('QUOTA_EXHAUSTED:' + msg);
          return null;
        }
      };

      try {
        for (let i = 0; i < slideIds.length; i++) {
          if (abort.signal.aborted) throw new DOMException('Aborted', 'AbortError');
          const result = await processSlide(slideIds[i]);
          results.push(result);
          if (i < slideIds.length - 1) {
            await new Promise<void>((resolve) => {
              const t = setTimeout(resolve, INTER_REQUEST_DELAY_MS);
              abort.signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
            });
            if (abort.signal.aborted) throw new DOMException('Aborted', 'AbortError');
          }
        }
      } catch (loopErr: any) {
        if ((loopErr as any)?.name === 'AbortError') {
          // User cancelled — silent exit
        } else if (String(loopErr).includes('QUOTA_EXHAUSTED')) {
          const successCount = results.filter(Boolean).length;
          const toRetrySlides = slideIds.filter((_, i) => !results[i]);
          setRetryModal429({ successCount, toRetrySlides });
          // Auto-start retry if not already running (useEffect handles continuation)
          if (!autoRetryConfigRef.current) {
            beginAutoRetry(toRetrySlides);
          }
        } else {
          throw loopErr;
        }
      }

      // Mark any skipped slides (no image) back to draft
      const skipBatch = writeBatch(db);
      let hasSkipped = false;
      results.forEach((r, i) => {
        if (r === null) {
          const slideId = Array.from(selectedSlides)[i];
          skipBatch.update(doc(db, 'projects', id, 'slides', slideId), { status: 'draft' });
          hasSkipped = true;
        }
      });
      if (hasSkipped) await skipBatch.commit();
      
      setIsDrawingMode(false);
      
    } catch (e) {
      console.error('Generation failed:', e);
      showToast('生成失敗，請稍後再試。', 'error');
    } finally {
      // Reset only slides that were set to 'generating' but never handled (e.g. aborted mid-loop)
      try {
        const resetBatch = writeBatch(db);
        const unhandled = slideIds.filter(sid => !handledSlideIds.has(sid));
        unhandled.forEach(sid => resetBatch.update(doc(db, 'projects', id, 'slides', sid), { status: 'draft' }));
        if (unhandled.length > 0) await resetBatch.commit();
      } catch (_) { /* best effort */ }
      setGenerateProgress(null);
      setIsGenerating(false);
      localStorage.removeItem(getGeneratingKey());
      setPrevSessionWarning(null);
    }
  };

  const handleSaveToLocal = async (scope: 'all' | 'selected' = 'all') => {
    const baseSlides = scope === 'selected' ? slides.filter(s => selectedSlides.has(s.id)) : slides;
    const exportedSlides = baseSlides.filter(s => pendingImages.get(s.id) || s.generatedImage || s.originalImage);
    if (exportedSlides.length === 0) { showToast('沒有可下載的投影片。', 'info'); return; }

    // HQ priority: Drive (original) → pendingImages (session) → Firestore compressed → original
    const getImgSrc = (slide: Slide) =>
      slide.generatedImageDriveUrl || pendingImages.get(slide.id) || slide.generatedImage || slide.originalImage;

    // Try File System Access API (Chrome/Edge)
    if ('showDirectoryPicker' in window) {
      try {
        const dirHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
        for (let i = 0; i < exportedSlides.length; i++) {
          const imgSrc = getImgSrc(exportedSlides[i]);
          if (!imgSrc) continue;
          const base64 = await fetchImageAsBase64(imgSrc);
          const blob = await fetch(base64).then(r => r.blob());
          const filename = `slide_${String(i + 1).padStart(2, '0')}.jpg`;
          const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
        }
        showToast(`✓ 已儲存 ${exportedSlides.length} 張投影片至資料夾。`, 'success');
        return;
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        console.warn('File System API unavailable, falling back to ZIP:', err);
      }
    }

    // Fallback: ZIP download
    const zip = new JSZip();
    for (let i = 0; i < exportedSlides.length; i++) {
      const imgSrc = getImgSrc(exportedSlides[i]);
      if (!imgSrc) continue;
      const base64 = await fetchImageAsBase64(imgSrc);
      zip.file(`slide_${String(i + 1).padStart(2, '0')}.jpg`, base64.split(',')[1], { base64: true });
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `slides_${id}.zip`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleExport = async (scope: 'all' | 'selected' = 'all') => {
    if (isExporting) return;
    setIsExporting(true);
    try {
    const baseSlides = scope === 'selected' ? slides.filter(s => selectedSlides.has(s.id)) : slides;
    const exportedSlides = baseSlides.filter(s => s.originalImage || s.generatedImage);
    if (exportedSlides.length === 0) { showToast('沒有可匯出的投影片。', 'info'); setIsExporting(false); return; }

    // Fetch all images + detect natural dimensions
    const slideImageData: { base64: string; natW: number; natH: number }[] = [];
    for (const slide of exportedSlides) {
      const imgUrl = slide.generatedImageDriveUrl || pendingImages.get(slide.id) || slide.generatedImage || slide.originalImage;
      if (imgUrl) {
        const base64Data = await fetchImageAsBase64(imgUrl);
        const dims = await new Promise<{ natW: number; natH: number }>(resolve => {
          const img = new Image();
          img.onload = () => resolve({ natW: img.naturalWidth, natH: img.naturalHeight });
          img.onerror = () => resolve({ natW: 16, natH: 9 });
          img.src = base64Data;
        });
        slideImageData.push({ base64: base64Data, ...dims });
      }
    }

    // Determine PPTX layout from the first image's actual ratio
    const pres = new pptxgen();
    const refRatio = slideImageData.length > 0 ? slideImageData[0].natW / slideImageData[0].natH : 16 / 9;
    const layoutW = 10;
    const layoutH = parseFloat((layoutW / refRatio).toFixed(4));
    pres.defineLayout({ name: 'AUTO_RATIO', width: layoutW, height: layoutH });
    pres.layout = 'AUTO_RATIO';

    // Add each slide, letterboxing images that differ from the layout ratio
    for (const { base64, natW, natH } of slideImageData) {
      const imgRatio = natW / natH;
      const slideRatio = layoutW / layoutH;
      let x = 0, y = 0, w = layoutW, h = layoutH;
      if (Math.abs(imgRatio - slideRatio) > 0.02) {
        if (imgRatio > slideRatio) {
          // wider image → letterbox top/bottom
          w = layoutW; h = layoutW / imgRatio;
          y = (layoutH - h) / 2;
        } else {
          // taller image → pillarbox left/right
          h = layoutH; w = layoutH * imgRatio;
          x = (layoutW - w) / 2;
        }
      }
      pres.addSlide().addImage({ data: base64, x, y, w, h });
    }
    
    await pres.writeFile({ fileName: `Designt_${id}.pptx` });
    showToast(`✓ PPTX 已匯出（${exportedSlides.length} 頁）。`, 'success');
    } finally {
      setIsExporting(false);
    }
  };

  handleGenerateRef.current = handleGenerate;

  const beginAutoRetry = (toRetrySlides: string[]) => {
    const cfg = { toRetrySlides: [...toRetrySlides], doneCount: 0 };
    autoRetryConfigRef.current = cfg;
    console.log(`[AutoRetry] 啟動自動重試：每 5 秒，待重試投影片 ${cfg.toRetrySlides.length} 張`);
    setRetryModal429(null);
    let cd = 5;
    setAutoRetryStatus({ countdown: cd, doneCount: 0, pendingCount: toRetrySlides.length });
    if (autoRetryTimerRef.current) clearInterval(autoRetryTimerRef.current);
    autoRetryTimerRef.current = setInterval(() => {
      cd--;
      if (cd <= 0) {
        clearInterval(autoRetryTimerRef.current!); autoRetryTimerRef.current = null;
        setAutoRetryStatus(prev => prev ? { ...prev, countdown: -1 } : null);
        autoRetryIsWaiting.current = true;
        setTimeout(() => handleGenerateRef.current(true), 50);
      } else {
        setAutoRetryStatus(prev => prev ? { ...prev, countdown: cd } : null);
      }
    }, 1000);
  };

  const stopAutoRetry = () => {
    console.log('[AutoRetry] 已停止自動重試。');
    if (autoRetryTimerRef.current) clearInterval(autoRetryTimerRef.current);
    autoRetryTimerRef.current = null;
    autoRetryConfigRef.current = null;
    autoRetryIsWaiting.current = false;
    setAutoRetryStatus(null);
  };


  return (
    <div style={{ height: 'calc(100vh - 4rem)', display: 'flex', flexDirection: 'column', position: 'relative' }}
      onDragOver={e => { e.preventDefault(); if (!draggingId) setIsDragOverPage(true); }}
      onDragLeave={e => { if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOverPage(false); }}
      onDrop={handleFileDrop}>
      {isDragOverPage && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 9999, background: 'rgba(52,152,219,0.12)', border: '3px dashed var(--accent-color)', borderRadius: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ background: 'var(--bg-primary)', padding: '1.5rem 2.5rem', borderRadius: '1rem', boxShadow: '0 8px 32px rgba(0,0,0,0.2)', textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📥</div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>拖放檔案到這裡</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>支援 PPT、PDF、Word、TXT、圖片</div>
          </div>
        </div>
      )}
      {showTemplateGallery && (
        <TemplateGalleryModal
          currentExtraPrompt={globalExtraPrompt}
          currentSettings={{ fontFamily, mainColor, highlightColor, specialMark, backgroundColor }}
          currentImageUrl={globalReference}
          onClose={() => setShowTemplateGallery(false)}
          onApply={handleTemplateApply}
        />
      )}
      {/* Exit Confirmation Modal */}
      {showGenerateConfirmModal && (() => {
        const allSorted = [...slides].sort((a,b)=>(a.order??0)-(b.order??0));
        const sorted = allSorted.filter(s => selectedSlides.has(s.id));
        const slideNums = sorted.map(s => allSorted.findIndex(x=>x.id===s.id)+1);
        const sl: React.CSSProperties = { fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 0.3rem' };
        const bx: React.CSSProperties = { background: 'var(--bg-secondary)', borderRadius: '0.55rem', padding: '0.6rem 0.8rem', fontSize: '0.84rem', color: 'var(--text-primary)' };
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
            onClick={() => setShowGenerateConfirmModal(false)}>
            <div style={{ background: 'var(--bg-primary)', borderRadius: '1.1rem', padding: '1.5rem 1.75rem', width: '100%', maxWidth: '500px', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column', gap: '1rem' }}
              onClick={e => e.stopPropagation()}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>確認生成設定</h3>

              <div>
                <p style={sl}>投影片（共 {sorted.length} 張）</p>
                <div style={{ ...bx, lineHeight: 1.9 }}>{slideNums.join('、')} 頁</div>
              </div>

              <div>
                <p style={sl}>風格參考圖</p>
                {globalReference
                  ? <img src={globalReference} alt="ref" style={{ width: '100%', maxHeight: '110px', objectFit: 'cover', borderRadius: '0.5rem', border: '1px solid var(--border-color)' }} />
                  : <div style={{ ...bx, color: 'var(--text-secondary)', fontStyle: 'italic' }}>未上傳（不使用風格參考）</div>}
              </div>

              <div>
                <p style={sl}>額外提示詞</p>
                <div style={{ ...bx, color: globalExtraPrompt.trim() ? 'var(--text-primary)' : 'var(--text-secondary)', fontStyle: globalExtraPrompt.trim() ? 'normal' : 'italic' }}>
                  {globalExtraPrompt.trim() || '（無）'}
                </div>
              </div>

              <div>
                <p style={sl}>進階設定 {!useAdvancedSettings && <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 400 }}>（未啟用）</span>}</p>
                <div style={{ ...bx, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.3rem 1rem', fontSize: '0.82rem', opacity: useAdvancedSettings ? 1 : 0.4 }}>
                  <span><strong>比例：</strong>{aspectRatio}</span>
                  <span><strong>解析度：</strong>{resolution}</span>
                  <span><strong>字體：</strong>{fontFamily}</span>
                  <span><strong>主要顏色：</strong>{mainColor}</span>
                  <span style={{ gridColumn: 'span 2' }}><strong>重點標示顏色：</strong>{highlightColor}</span>
                  {specialMark && <span style={{ gridColumn: 'span 2' }}><strong>特殊標記：</strong>{specialMark}</span>}
                  {backgroundColor && <span style={{ gridColumn: 'span 2' }}><strong>背景色：</strong>{backgroundColor}</span>}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', paddingTop: '0.25rem' }}>
                <Button variant="secondary" onClick={() => setShowGenerateConfirmModal(false)}>取消</Button>
                <Button onClick={() => { setShowGenerateConfirmModal(false); handleGenerate(); }} icon={Sparkles}
                  style={{ backgroundColor: 'var(--accent-color)', color: '#fff' }}>確認，開始生成</Button>
              </div>
            </div>
          </div>
        );
      })()}

      {showExitModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={() => setShowExitModal(false)}>
          <div style={{ backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', padding: '2rem', width: '360px', boxShadow: '0 20px 60px rgba(0,0,0,0.4)', display: 'flex', flexDirection: 'column', gap: '1rem' }}
            onClick={e => e.stopPropagation()}>
            <div>
              <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem' }}>未備份的圖片</h3>
              <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                有 <strong>{unbackedCount}</strong> 張已生成的圖片尚未備份到雲端，離開後將會消失。
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <Button onClick={handleExitWithBackup} disabled={isBackingUp} style={{ width: '100%', justifyContent: 'center', backgroundColor: 'var(--accent-color)', color: '#fff' }}>
                {isBackingUp ? '備份中...' : '備份後退出'}
              </Button>
              <Button variant="secondary" onClick={handleExitDirect} style={{ width: '100%', justifyContent: 'center' }}>
                直接退出
              </Button>
              <Button variant="ghost" onClick={() => setShowExitModal(false)} style={{ width: '100%', justifyContent: 'center' }}>
                取消
              </Button>
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={() => setShowDeleteConfirm(false)}>
          <div style={{ backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', padding: '2rem', width: '360px', boxShadow: '0 20px 60px rgba(0,0,0,0.4)', display: 'flex', flexDirection: 'column', gap: '1rem' }}
            onClick={e => e.stopPropagation()}>
            <div>
              <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem', color: '#ef4444' }}>確認刪除</h3>
              <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                確定要刪除選取的 <strong>{selectedSlides.size}</strong> 張投影片嗎？此操作無法復原。
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Button onClick={deleteSelectedSlides} style={{ flex: 1, justifyContent: 'center', backgroundColor: '#ef4444', color: '#fff', border: 'none' }}>
                確認刪除
              </Button>
              <Button variant="secondary" onClick={() => setShowDeleteConfirm(false)} style={{ flex: 1, justifyContent: 'center' }}>
                取消
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* Word/TXT format instructions modal */}
      {showTextUploadModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={() => setShowTextUploadModal(false)}>
          <div style={{ backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', padding: '1.75rem', width: '480px', maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.4)', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}
            onClick={e => e.stopPropagation()}>
            <div>
              <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FileText size={18} /> Word / TXT 格式說明
              </h3>
              <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                請在文件中用 <strong>「第一頁」「第二頁」</strong>... 標記每張投影片的開始位置，每一頁的文字將作為 AI 生成該張投影片的提示詞。
              </p>
            </div>
            <div style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', padding: '1rem', fontFamily: 'monospace', fontSize: '0.82rem', lineHeight: 2, color: 'var(--text-secondary)', border: '1px solid var(--border-color)', whiteSpace: 'pre-wrap' }}>{`第一頁
標題：損益表的真相
重點：現金流比獲利更重要，費用可美化但現金不能

第二頁
標題：資產負債表解析
重點：資產 = 負債 + 股東權益

第三頁
...`}</div>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              ⚠️ 請搭配<strong>風格參考圖</strong>使用，上傳後選取全部投影片再點「1-Click Modify」生成。
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <Button onClick={() => { setShowTextUploadModal(false); textFileInputRef.current?.click(); }}
                style={{ flex: 1, justifyContent: 'center', backgroundColor: 'var(--accent-color)', color: '#fff' }}>
                確認，開啟檔案
              </Button>
              <Button variant="secondary" onClick={() => setShowTextUploadModal(false)}
                style={{ flex: 1, justifyContent: 'center' }}>
                取消
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Previous session warning banner */}
      {prevSessionWarning && !isGenerating && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 1rem', marginBottom: '0.5rem', backgroundColor: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 'var(--radius-md)', fontSize: '0.82rem', color: '#b45309' }}>
          <span>⚠️ 偵測到上一次的生成可能還在 Vertex AI 執行中（{Math.round((Date.now() - prevSessionWarning) / 1000)} 秒前開始）。建議等待約 60 秒再重新生成，避免 429 錯誤。</span>
          <button onClick={() => { localStorage.removeItem(getGeneratingKey()); setPrevSessionWarning(null); }}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#b45309', fontWeight: 600, whiteSpace: 'nowrap' }}>
            忽略
          </button>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', padding: '0 0.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {previewOpen ? (
            <button onClick={() => { setPreviewOpen(false); requestAnimationFrame(() => { const el = slideCardRefs.current.get(activeSlideId); if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }); }} style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: '0.3rem', cursor: 'pointer', padding: '0.25rem 0.55rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.72rem' }}>
              <ArrowLeft size={13} /> 退出預覽
            </button>
          ) : (
            <>
              <button onClick={handleBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}>
                <ArrowLeft size={15} />
              </button>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>回到專案列表</span>
            </>
          )}
        </div>
        {/* Page indicator — preview mode only */}
        {previewOpen && slides.length > 0 && (() => {
          const currentIdx = slides.findIndex(s => s.id === activeSlideId);
          const pageNum = currentIdx >= 0 ? currentIdx + 1 : 1;
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              <input
                type="text"
                defaultValue={pageNum}
                key={activeSlideId}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = parseInt((e.target as HTMLInputElement).value);
                    if (val >= 1 && val <= slides.length) {
                      setActiveSlideId(slides[val - 1].id);
                    } else {
                      (e.target as HTMLInputElement).value = String(pageNum);
                    }
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                onBlur={(e) => {
                  const val = parseInt(e.target.value);
                  if (val >= 1 && val <= slides.length) {
                    setActiveSlideId(slides[val - 1].id);
                  } else {
                    e.target.value = String(pageNum);
                  }
                }}
                style={{ width: '2.5rem', textAlign: 'center', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '0.25rem', padding: '0.15rem 0.25rem', fontSize: '0.8rem', color: 'var(--text-primary)', outline: 'none' }}
              />
              <span>/ {slides.length}</span>
            </div>
          );
        })()}
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          {!previewOpen && (
            <button onClick={() => { if (selectedSlides.size === slides.length) setSelectedSlides(new Set()); else setSelectedSlides(new Set(slides.map(s => s.id))); }}
              style={{ padding: '0.3rem 0.6rem', fontSize: '0.72rem', fontWeight: 500, border: '1px solid var(--border-color)', borderRadius: '0.3rem', cursor: 'pointer', background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>
              {selectedSlides.size === slides.length ? '取消全選' : '全選所有頁面'}
            </button>
          )}
          {!previewOpen && selectedSlides.size > 0 && (
            <button onClick={() => setShowDeleteConfirm(true)}
              style={{ padding: '0.3rem 0.6rem', fontSize: '0.72rem', fontWeight: 500, border: '1px solid #ef4444', borderRadius: '0.3rem', cursor: 'pointer', background: 'var(--bg-primary)', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
              <Trash2 size={12} /> 刪除 ({selectedSlides.size})
            </button>
          )}
          {!previewOpen && (
            <button onClick={() => setPreviewOpen(true)}
              style={{ padding: '0.3rem 0.6rem', fontSize: '0.72rem', fontWeight: 500, border: '1px solid var(--border-color)', borderRadius: '0.3rem', cursor: 'pointer', background: 'var(--bg-primary)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
              <Eye size={12} /> 預覽
            </button>
          )}
          {pendingImages.size > 0 && (() => {
            const unbackedCount = Array.from(pendingImages.entries()).filter(([sid, img]) => backedUpIds.get(sid) !== img.length).length;
            return unbackedCount > 0 ? (
              <button onClick={() => { backupFailCount.current = 0; handleBackup(); }} disabled={isBackingUp}
                style={{ padding: '0.3rem 0.6rem', fontSize: '0.72rem', fontWeight: 600, border: 'none', borderRadius: '0.3rem', cursor: isBackingUp ? 'not-allowed' : 'pointer', background: 'var(--accent-color)', color: '#fff', opacity: isBackingUp ? 0.7 : 1 }}>
                {isBackingUp ? '備份中...' : `備份 (${unbackedCount})`}
              </button>
            ) : (
              <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>✓ 已備份 {lastBackupTime?.toLocaleTimeString()}</span>
            );
          })()}
          <button onClick={() => setDownloadScopeModal('save')}
            style={{ padding: '0.3rem 0.6rem', fontSize: '0.72rem', fontWeight: 500, border: '1px solid var(--border-color)', borderRadius: '0.3rem', cursor: 'pointer', background: 'var(--bg-secondary)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
            <Download size={12} /> 下載圖片
          </button>
          <button onClick={() => setDownloadScopeModal('export')} disabled={isExporting}
            style={{ padding: '0.3rem 0.6rem', fontSize: '0.72rem', fontWeight: 600, border: 'none', borderRadius: '0.3rem', cursor: isExporting ? 'not-allowed' : 'pointer', background: 'var(--accent-color)', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.2rem', opacity: isExporting ? 0.6 : 1 }}>
            <Download size={12} /> {isExporting ? '匯出中...' : '匯出 PPTX'}
          </button>
          {previewOpen && (
            <button onClick={() => setAiChatOpen(v => !v)}
              style={{ padding: '0.3rem 0.6rem', fontSize: '0.72rem', fontWeight: 600, border: aiChatOpen ? 'none' : '1px solid var(--border-color)', borderRadius: '0.3rem', cursor: 'pointer', background: aiChatOpen ? 'var(--accent-color)' : 'var(--bg-secondary)', color: aiChatOpen ? '#fff' : 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <MessageSquare size={12} /> AI 助手
            </button>
          )}
        </div>
      </div>

      {/* Main Workspace */}
      <div style={{ flex: 1, display: 'flex', gap: '0.75rem', minHeight: 0, position: 'relative' }}>

        {/* ===== MODE A: Grid + Right Sidebar ===== */}
        {!previewOpen && (
          <div style={{ flex: 1, display: 'flex', gap: '0.75rem', minHeight: 0 }}>
          {/* Slide Grid */}
          <div ref={gridRef} onMouseDown={handleGridMouseDown} style={{ flex: 1, overflowY: 'auto', padding: '0.25rem', userSelect: 'none' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
              {slides.map((slide, index) => (
                <div key={slide.id} style={{ position: 'relative' }}>
                <div
                  data-slide-card
                  ref={(el) => { if (el) slideCardRefs.current.set(slide.id, el); else slideCardRefs.current.delete(slide.id); }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => handleSlideClick(e, slide.id, index)}
                  draggable
                  onDragStart={(e) => handleDragStart(e, slide.id)}
                  onDragOver={(e) => handleDragOver(e, slide.id)}
                  onDrop={(e) => handleDrop(e, slide.id)}
                  onDragEnd={handleDragEnd}
                  style={{ backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', border: `2px solid ${dragOverId === slide.id ? '#f59e0b' : activeSlideId === slide.id ? 'var(--accent-color)' : selectedSlides.has(slide.id) ? 'var(--accent-color)' : 'var(--border-color)'}`, cursor: 'grab', overflow: 'hidden', transition: 'border-color 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease', boxShadow: dragOverId === slide.id ? '0 0 0 2px #f59e0b' : activeSlideId === slide.id ? '0 0 0 1px var(--accent-color)' : 'var(--shadow-sm)', opacity: draggingId && (slide.id === draggingId || (selectedSlides.has(draggingId) && selectedSlides.has(slide.id))) ? 0.4 : 1 }}>
                  <div style={{ aspectRatio: '16/9', backgroundColor: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    {getPreviewSrc(slide.id, slide) ? (
                      <img src={getPreviewSrc(slide.id, slide)!} alt={`Slide ${index + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : slide.prompt ? (
                      <div style={{ padding: '0.4rem 0.5rem', width: '100%', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '2px', backgroundColor: 'var(--bg-secondary)' }}>
                        <FileText size={10} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />
                        <span style={{ fontSize: '0.55rem', color: 'var(--text-secondary)', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical' }}>{slide.prompt}</span>
                      </div>
                    ) : (
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Empty</span>
                    )}
                  </div>
                  {(() => {
                    const hist = imageHistories.get(slide.id);
                    if (!hist || hist.stack.length === 0) return null;
                    const canUndo = hist.pos >= 0;
                    const canRedo = hist.pos < hist.stack.length - 1;
                    const sBtn = (on: boolean): React.CSSProperties => ({ background: 'var(--bg-secondary)', border: 'none', borderRadius: '3px', padding: '2px 5px', cursor: on ? 'pointer' : 'not-allowed', opacity: on ? 1 : 0.35, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' });
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem', padding: '0.2rem 0.5rem', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}
                        onClick={e => e.stopPropagation()}>
                        <button style={sBtn(canUndo)} disabled={!canUndo} title="上一步" onClick={() => handleUndo(slide.id)}><ChevronLeft size={11} /></button>
                        <span style={{ fontSize: '0.62rem', color: 'var(--text-secondary)' }}>{hist.pos + 1}/{hist.stack.length}</span>
                        <button style={sBtn(canRedo)} disabled={!canRedo} title="下一步" onClick={() => handleRedo(slide.id)}><ChevronRight size={11} /></button>
                        <button style={{ ...sBtn(true), marginLeft: '2px' }} title="還原原圖" onClick={() => handleRevertToOriginal(slide.id)}><RotateCcw size={11} /></button>
                      </div>
                    );
                  })()}
                  <div style={{ padding: '0.5rem 0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div onClick={(e) => toggleSlideSelection(slide.id, e)} style={{ cursor: 'pointer', color: selectedSlides.has(slide.id) ? 'var(--accent-color)' : 'var(--border-color)' }}>
                        <CheckSquare size={16} fill={selectedSlides.has(slide.id) ? 'var(--accent-color)' : 'transparent'} color={selectedSlides.has(slide.id) ? 'white' : 'currentColor'} />
                      </div>
                      <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Slide {index + 1}</span>
                    </div>
                    <Button variant="ghost" size="sm" onClick={(e) => deleteSlide(e, slide.id)} style={{ padding: '0.15rem', color: 'var(--text-secondary)' }}>
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
                {/* Grid insert zone — right edge of card */}
                <div
                  onClick={(e) => { e.stopPropagation(); setGridInsertMenu(prev => prev === index ? null : index); }}
                  onMouseEnter={(e) => { if (gridInsertMenu === null) { const btn = e.currentTarget.querySelector('[data-grid-insert-btn]') as HTMLElement; if (btn) btn.style.opacity = '1'; } }}
                  onMouseLeave={(e) => { if (gridInsertMenu === null) { const btn = e.currentTarget.querySelector('[data-grid-insert-btn]') as HTMLElement; if (btn) btn.style.opacity = '0'; } }}
                  style={{ position: 'absolute', right: '-8px', top: 0, bottom: 0, width: '16px', cursor: 'pointer', zIndex: 5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  {gridInsertMenu === null && (
                    <div data-grid-insert-btn style={{ opacity: 0, transition: 'opacity 0.15s', background: 'var(--accent-color)', color: '#fff', borderRadius: '50%', width: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700, boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }}>+</div>
                  )}
                  {gridInsertMenu === index && (
                    <div style={{ position: 'absolute', right: '20px', top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: '0.25rem', padding: '0.4rem', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '0.4rem', boxShadow: 'var(--shadow-md)', zIndex: 20, whiteSpace: 'nowrap' }}
                      onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => { insertTargetIdx.current = index; insertFileRef.current?.click(); setGridInsertMenu(null); }}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.3rem 0.5rem', fontSize: '0.72rem', fontWeight: 600, border: 'none', borderRadius: '0.25rem', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', width: '100%', textAlign: 'left' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-secondary)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                        <Upload size={13} /> 插入檔案
                      </button>
                      <button onClick={() => { insertTargetIdx.current = index; insertImageRef.current?.click(); setGridInsertMenu(null); }}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.3rem 0.5rem', fontSize: '0.72rem', fontWeight: 600, border: 'none', borderRadius: '0.25rem', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', width: '100%', textAlign: 'left' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-secondary)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                        <ImagePlus size={13} /> 插入圖片
                      </button>
                      <button onClick={() => { addSlide('text', 1, index); setGridInsertMenu(null); }}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.3rem 0.5rem', fontSize: '0.72rem', fontWeight: 600, border: 'none', borderRadius: '0.25rem', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', width: '100%', textAlign: 'left' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-secondary)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                        <FileText size={13} /> 插入文字頁
                      </button>
                    </div>
                  )}
                </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right Sidebar */}
          <div style={{ width: '260px', flexShrink: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0.25rem 0.25rem 0.25rem 0' }}>

            {/* 1. Upload PPT / Word / 新增頁面 */}
            <div style={{ backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>上傳 / 新增</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: (parsingProgress || savingProgress) ? 'not-allowed' : 'pointer', fontSize: '0.75rem', fontWeight: 600, padding: '0.4rem 0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.3rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                {parsingProgress ? (
                  <><Sparkles size={13} style={{ animation: 'spin 2s linear infinite', color: 'var(--accent-color)' }} /> 轉換 {parsingProgress.current}/{parsingProgress.total}</>
                ) : savingProgress ? (
                  <><Sparkles size={13} style={{ animation: 'spin 2s linear infinite', color: 'var(--accent-color)' }} /> 儲存 {savingProgress.current}/{savingProgress.total}</>
                ) : (
                  <><Plus size={13} /> 上傳 PPT/PDF</>
                )}
                <input type="file" accept=".pptx,.pdf" style={{ display: 'none' }} disabled={parsingProgress !== null || savingProgress !== null} onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    if (file.name.endsWith('.pdf')) await handlePDFUpload(file);
                    else await handlePPTUpload(file);
                  }
                  e.target.value = '';
                }} />
              </label>
              <button
                disabled={parsingProgress !== null || savingProgress !== null}
                onClick={() => setShowTextUploadModal(true)}
                style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: (parsingProgress || savingProgress) ? 'not-allowed' : 'pointer', fontSize: '0.75rem', fontWeight: 600, padding: '0.4rem 0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.3rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                <FileText size={13} /> Word/TXT
              </button>
              <input ref={textFileInputRef} type="file" accept=".docx,.txt" style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  handleTextFileProcess(file);
                  e.target.value = '';
                }} />
              <button
                disabled={parsingProgress !== null || savingProgress !== null}
                onClick={() => imageUploadInputRef.current?.click()}
                style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: (parsingProgress || savingProgress) ? 'not-allowed' : 'pointer', fontSize: '0.75rem', fontWeight: 600, padding: '0.4rem 0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.3rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                <ImagePlus size={13} /> 上傳圖片
              </button>
              <input ref={imageUploadInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    handleImageUpload(e.target.files);
                  }
                  e.target.value = '';
                }} />
              <Button size="sm" variant="secondary" onClick={() => setShowAddSlideModal(true)} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem' }}><Plus size={13} /> 新增頁面</Button>
            </div>

            {/* 2. 風格參考 */}
            <div style={{ backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>風格參考</span>
              {globalReference ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <div onClick={() => setShowTemplateGallery(true)} style={{ width: '80px', aspectRatio: '16/9', borderRadius: '4px', overflow: 'hidden', border: '1px solid var(--border-color)', cursor: 'pointer' }} title="更換風格圖">
                    <img src={globalReference} alt="Ref" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <button onClick={() => { setShowShareModal(true); setShareLabel(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--accent-color)', display: 'flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.7rem' }} title="分享模板到社群"><Share2 size={11}/> 分享</button>
                    <button onClick={() => setGlobalReference(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.7rem' }}><X size={11}/> 移除</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowTemplateGallery(true)} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.5rem', border: '1px dashed var(--border-color)', borderRadius: '6px', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.75rem', background: 'none', justifyContent: 'center' }}>
                  <ImageIcon size={13} /> 選擇風格參考圖
                </button>
              )}
            </div>

            {/* 3. 額外提示詞 */}
            <div style={{ backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>額外提示詞</span>
                {globalExtraPrompt && (
                  <button onClick={() => setGlobalExtraPrompt('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}><X size={12}/></button>
                )}
              </div>
              <textarea
                value={globalExtraPrompt}
                onChange={e => setGlobalExtraPrompt(e.target.value)}
                placeholder="輸入提示詞來引導 AI 生成投影片…"
                rows={6}
                style={{ width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '0.3rem', outline: 'none', fontSize: '0.75rem', color: 'var(--text-primary)', padding: '0.4rem 0.5rem', resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>

            {/* 4. 進階設定 */}
            {(() => {
              const inputS: React.CSSProperties = { padding: '0.3rem 0.5rem', fontSize: '0.75rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', outline: 'none', width: '100%' };
              const selectS: React.CSSProperties = { ...inputS, cursor: 'pointer' };
              return (
                <div style={{ backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>進階設定</span>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer', fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
                      <input type="checkbox" checked={useAdvancedSettings} onChange={e => setUseAdvancedSettings(e.target.checked)}
                        style={{ accentColor: 'var(--accent-color)', cursor: 'pointer' }} />
                      套用
                    </label>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', opacity: useAdvancedSettings ? 1 : 0.4, pointerEvents: useAdvancedSettings ? 'auto' : 'none' }}>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-secondary)' }}>比例</span>
                      <select style={selectS} value={aspectRatio} onChange={e => setAspectRatio(e.target.value)}>
                        <option value="16:9">16:9</option><option value="9:16">9:16</option><option value="21:9">21:9</option><option value="1:1">1:1</option><option value="1:4">1:4</option><option value="1:8">1:8</option><option value="2:3">2:3</option><option value="3:2">3:2</option><option value="3:4">3:4</option><option value="4:1">4:1</option><option value="4:3">4:3</option><option value="4:5">4:5</option><option value="5:4">5:4</option><option value="8:1">8:1</option>
                      </select>
                    </div>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-secondary)' }}>解析度</span>
                      <select style={selectS} value={resolution} onChange={e => setResolution(e.target.value)}>
                        <option value="0.5K">0.5K</option><option value="1K">1K</option><option value="2K">2K</option><option value="4K">4K</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', opacity: useAdvancedSettings ? 1 : 0.4, pointerEvents: useAdvancedSettings ? 'auto' : 'none' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-secondary)' }}>字體</span>
                    <input style={inputS} value={fontFamily} onChange={e => setFontFamily(e.target.value)} placeholder="Noto Sans" />
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-secondary)' }}>主要顏色</span>
                      <input style={inputS} value={mainColor} onChange={e => setMainColor(e.target.value)} placeholder="黑色" />
                    </div>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-secondary)' }}>重點標示</span>
                      <input style={inputS} value={highlightColor} onChange={e => setHighlightColor(e.target.value)} placeholder="金黃色" />
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-secondary)' }}>特殊標記（選填）</span>
                    <input style={inputS} value={specialMark} onChange={e => setSpecialMark(e.target.value)} placeholder="例：螢光筆、underline" />
                    <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginTop: '0.15rem' }}>
                      {['螢光筆', 'underline', '粗體'].map(tag => (
                        <button key={tag} onClick={() => setSpecialMark(v => v ? v + '、' + tag : tag)}
                          style={{ fontSize: '0.65rem', padding: '0.15rem 0.35rem', border: '1px solid var(--border-color)', borderRadius: '999px', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          + {tag}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-secondary)' }}>背景色（選填）</span>
                    <input style={inputS} value={backgroundColor} onChange={e => setBackgroundColor(e.target.value)} placeholder="例：白色" />
                  </div>
                  </div>
                </div>
              );
            })()}

            {/* 5. 開始生成 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: 'auto' }}>
              <div style={{ position: 'relative' }} title={!globalExtraPrompt.trim() ? '請先輸入額外提示詞' : ''}>
                <button onClick={() => setShowGenerateConfirmModal(true)} disabled={isGenerating || !globalExtraPrompt.trim() || !!autoRetryStatus}
                  style={{ width: '100%', padding: '0.5rem', fontSize: '0.8rem', fontWeight: 700, border: 'none', borderRadius: '0.3rem', cursor: (!globalExtraPrompt.trim() || !!autoRetryStatus) ? 'not-allowed' : 'pointer', background: 'var(--accent-color)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem', opacity: (!globalExtraPrompt.trim() || !!autoRetryStatus) ? 0.5 : 1 }}>
                  <Sparkles size={14} /> {generateProgress ? `生成中 ${generateProgress.current}/${generateProgress.total}` : '開始生成'}
                </button>
              </div>
              {isGenerating && (
                <button onClick={handleCancelGenerate} style={{ width: '100%', background: 'none', border: '1px solid var(--border-color)', borderRadius: '0.3rem', cursor: 'pointer', padding: '0.35rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.2rem', fontSize: '0.72rem' }}>
                  <X size={12} /> 取消生成
                </button>
              )}
              {!isGenerating && !!autoRetryStatus && (
                <button onClick={stopAutoRetry} style={{ width: '100%', background: 'none', border: '1px solid var(--border-color)', borderRadius: '0.3rem', cursor: 'pointer', padding: '0.35rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.2rem', fontSize: '0.72rem' }}>
                  <X size={12} /> 停止重試
                </button>
              )}
            </div>

          </div>
          </div>
        )}

        {/* ===== MODE B: Preview Open ??Sidebar + Canvas ===== */}
        {previewOpen && (<>
          {/* Left Sidebar */}
          <div style={{ width: `${sidebarWidth}px`, display: 'flex', flexDirection: 'column', gap: '1.5rem', overflowY: 'auto', flexShrink: 0, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)', padding: '0.5rem' }}>
            {/* 進階設定 */}
            {(() => {
              const rowStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.25rem' };
              const labelStyle: React.CSSProperties = { fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' };
              const inputStyle: React.CSSProperties = { width: '100%', padding: '0.35rem 0.6rem', fontSize: '0.82rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' };
              const selectStyle: React.CSSProperties = { ...inputStyle, cursor: 'pointer' };
              return (
                <div style={{ backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                  <button onClick={() => setShowAdvancedSettings(v => !v)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.7rem 1rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.9rem' }}>
                    <span>進階設定</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{showAdvancedSettings ? '▲ 收合' : '▼ 展開'}</span>
                  </button>
                  {showAdvancedSettings && (
                    <div style={{ padding: '0 1rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', borderTop: '1px solid var(--border-color)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', paddingTop: '0.75rem' }}>
                        <div style={rowStyle}>
                          <label style={labelStyle}>比例</label>
                          <select style={selectStyle} value={aspectRatio} onChange={e => setAspectRatio(e.target.value)}>
                            <option value="16:9">16:9</option>
                            <option value="9:16">9:16</option>
                            <option value="21:9">21:9</option>
                            <option value="1:1">1:1</option>
                            <option value="1:4">1:4</option>
                            <option value="1:8">1:8</option>
                            <option value="2:3">2:3</option>
                            <option value="3:2">3:2</option>
                            <option value="3:4">3:4</option>
                            <option value="4:1">4:1</option>
                            <option value="4:3">4:3</option>
                            <option value="4:5">4:5</option>
                            <option value="5:4">5:4</option>
                            <option value="8:1">8:1</option>
                          </select>
                        </div>
                        <div style={rowStyle}>
                          <label style={labelStyle}>解析度</label>
                          <select style={selectStyle} value={resolution} onChange={e => setResolution(e.target.value)}>
                            <option value="0.5K">0.5K</option>
                            <option value="1K">1K</option>
                            <option value="2K">2K</option>
                            <option value="4K">4K</option>
                          </select>
                        </div>
                      </div>
                      <div style={rowStyle}>
                        <label style={labelStyle}>字體（提示詞）</label>
                        <input style={inputStyle} value={fontFamily} onChange={e => setFontFamily(e.target.value)} placeholder="Noto Sans" />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                        <div style={rowStyle}>
                          <label style={labelStyle}>主要顏色</label>
                          <input style={inputStyle} value={mainColor} onChange={e => setMainColor(e.target.value)} placeholder="黑色" />
                        </div>
                        <div style={rowStyle}>
                          <label style={labelStyle}>重點標示顏色</label>
                          <input style={inputStyle} value={highlightColor} onChange={e => setHighlightColor(e.target.value)} placeholder="金黃色" />
                        </div>
                      </div>
                      <div style={rowStyle}>
                        <label style={labelStyle}>特殊標記（選填）</label>
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.3rem' }}>
                          {['淺鴨黃色螢光筆', 'underline', '粗體重點', '紅色底線'].map(tag => (
                            <button key={tag} onClick={() => setSpecialMark(v => v ? v + '、' + tag : tag)}
                              style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: '999px', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                              + {tag}
                            </button>
                          ))}
                        </div>
                        <input style={inputStyle} value={specialMark} onChange={e => setSpecialMark(e.target.value)} placeholder="例：淺鴨黃色螢光筆、underline（可自行輸入）" />
                      </div>
                      <div style={rowStyle}>
                        <label style={labelStyle}>背景色（選填）</label>
                        <input style={inputStyle} value={backgroundColor} onChange={e => setBackgroundColor(e.target.value)} placeholder="例：白色、淺灰色、深藍色" />
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Slides List - sidebar mode */}
            <div style={{ backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', padding: '1rem', flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '1rem', margin: 0 }}>Slides Gallery</h3>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <Button size="sm" variant="ghost" onClick={() => { if (selectedSlides.size === slides.length) setSelectedSlides(new Set()); else setSelectedSlides(new Set(slides.map(s => s.id))); }} style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}>
                    {selectedSlides.size === slides.length ? '取消全選' : '全選'}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setShowAddSlideModal(true)} style={{ padding: '0.25rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}><Plus size={16} />新增頁面</Button>
                </div>
              </div>
              <div ref={sidebarListRef} style={{ display: 'flex', flexDirection: 'column', gap: '0', flex: 1 }}>
                {/* Hidden file inputs for insert */}
                <input ref={insertFileRef} type="file" accept=".pptx,.pdf,.docx,.txt" multiple hidden onChange={async (e) => {
                  if (e.target.files && e.target.files.length > 0) await handleInsertFiles(e.target.files);
                  e.target.value = ''; setSidebarInsertMenu(null); setGridInsertMenu(null);
                }} />
                <input ref={insertImageRef} type="file" accept="image/*" multiple hidden onChange={async (e) => {
                  if (e.target.files && e.target.files.length > 0) await handleInsertImages(e.target.files, insertTargetIdx.current);
                  e.target.value = ''; setSidebarInsertMenu(null); setGridInsertMenu(null);
                }} />
                {slides.map((slide, index) => (
                  <React.Fragment key={slide.id}>
                    <div data-sidebar-slide={slide.id} onClick={() => setActiveSlideId(slide.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem', borderRadius: 'var(--radius-md)', cursor: 'pointer', backgroundColor: activeSlideId === slide.id ? 'var(--bg-secondary)' : 'transparent', border: `1px solid ${activeSlideId === slide.id ? 'var(--border-color)' : 'transparent'}` }}>
                      <div onClick={(e) => toggleSlideSelection(slide.id, e)} style={{ cursor: 'pointer', color: selectedSlides.has(slide.id) ? 'var(--accent-color)' : 'var(--border-color)' }}>
                        <CheckSquare size={18} fill={selectedSlides.has(slide.id) ? 'var(--accent-color)' : 'transparent'} color={selectedSlides.has(slide.id) ? 'white' : 'currentColor'} />
                      </div>
                      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', width: '20px' }}>{index + 1}</span>
                      <div style={{ flex: 1, aspectRatio: '16/9', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {getPreviewSrc(slide.id, slide) ? (<img loading="lazy" src={getPreviewSrc(slide.id, slide)!} alt="Slide" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />) : slide.prompt ? (<div style={{ padding: '0.3rem', width: '100%', height: '100%', overflow: 'hidden', backgroundColor: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', gap: '2px' }}><FileText size={9} style={{ color: 'var(--accent-color)', flexShrink: 0 }} /><span style={{ fontSize: '0.5rem', color: 'var(--text-secondary)', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical' }}>{slide.prompt}</span></div>) : (<span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Empty</span>)}
                      </div>
                      <Button variant="ghost" size="sm" onClick={(e) => deleteSlide(e, slide.id)} style={{ padding: '0.25rem', color: 'var(--text-secondary)' }}><Trash2 size={14} /></Button>
                    </div>
                    {/* Insert zone between slides */}
                    <div
                      style={{ position: 'relative', height: sidebarInsertMenu === index ? 'auto' : '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
                      onClick={(e) => { e.stopPropagation(); setSidebarInsertMenu(prev => prev === index ? null : index); }}
                      onMouseEnter={(e) => { if (sidebarInsertMenu === null) { const line = e.currentTarget.querySelector('[data-insert-line]') as HTMLElement; if (line) line.style.opacity = '1'; } }}
                      onMouseLeave={(e) => { if (sidebarInsertMenu === null) { const line = e.currentTarget.querySelector('[data-insert-line]') as HTMLElement; if (line) line.style.opacity = '0'; } }}
                    >
                      <div data-insert-line style={{ position: 'absolute', left: '8px', right: '8px', height: '2px', background: 'var(--accent-color)', borderRadius: '1px', opacity: sidebarInsertMenu === index ? 1 : 0, transition: 'opacity 0.15s', pointerEvents: 'none' }} />
                      {sidebarInsertMenu === null && (
                        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', opacity: 0, transition: 'opacity 0.15s', pointerEvents: 'none', background: 'var(--accent-color)', color: '#fff', borderRadius: '50%', width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 700, zIndex: 2 }}
                          ref={(el) => {
                            if (!el) return;
                            const parent = el.parentElement;
                            if (!parent) return;
                            parent.addEventListener('mouseenter', () => { el.style.opacity = '1'; el.style.pointerEvents = 'auto'; });
                            parent.addEventListener('mouseleave', () => { el.style.opacity = '0'; el.style.pointerEvents = 'none'; });
                          }}>+</div>
                      )}
                      {sidebarInsertMenu === index && (
                        <div style={{ display: 'flex', gap: '0.3rem', padding: '0.35rem 0', zIndex: 3 }}>
                          <button onClick={(e) => { e.stopPropagation(); insertTargetIdx.current = index; insertFileRef.current?.click(); }}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.2rem 0.45rem', fontSize: '0.65rem', fontWeight: 600, border: '1px solid var(--border-color)', borderRadius: '0.25rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            <Upload size={11} /> 檔案
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); insertTargetIdx.current = index; insertImageRef.current?.click(); }}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.2rem 0.45rem', fontSize: '0.65rem', fontWeight: 600, border: '1px solid var(--border-color)', borderRadius: '0.25rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            <ImagePlus size={11} /> 圖片
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); addSlide('text', 1, index); setSidebarInsertMenu(null); }}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.2rem 0.45rem', fontSize: '0.65rem', fontWeight: 600, border: '1px solid var(--border-color)', borderRadius: '0.25rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            <FileText size={11} /> 文字
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); setSidebarInsertMenu(null); }}
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.2rem', border: 'none', borderRadius: '0.25rem', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                            <X size={12} />
                          </button>
                        </div>
                      )}
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>

          {/* Resize Handle */}
          <div
            onMouseDown={handleResizeStart}
            style={{ width: '6px', cursor: 'col-resize', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '3px', transition: 'background 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-color)')}
            onMouseLeave={e => { if (!isResizing.current) e.currentTarget.style.background = 'transparent'; }}
          >
            <div style={{ width: '2px', height: '32px', borderRadius: '1px', background: 'var(--border-color)' }} />
          </div>

          {/* Canvas Area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem', minWidth: 0 }}>
            <div style={{ flex: 1, backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', border: activeSlide?.status === 'empty' ? '1px dashed var(--border-color)' : '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', position: 'relative', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
              {activeSlide && !activeSlide.originalImage && !activeSlide.generatedImage && !pendingImages.get(activeSlideId) && activeSlide.status !== 'empty' ? (
                // ── Text-only slide: show text editor ──
                <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', padding: '1.25rem', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <FileText size={15} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>文字內容編輯</span>
                    {textSaving && <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginLeft: 'auto' }}>儲存中...</span>}
                    {!textSaving && <span style={{ fontSize: '0.72rem', color: 'var(--accent-color)', marginLeft: 'auto' }}>● 已儲存</span>}
                  </div>
                  <textarea
                    value={activeSlide.prompt}
                    onChange={e => handleTextChange(activeSlideId, e.target.value)}
                    placeholder="在此輸入投影片內容，AI 將根據這段文字生成投影片圖片..."
                    style={{ flex: 1, resize: 'none', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.875rem', fontSize: '0.92rem', lineHeight: 1.8, fontFamily: 'inherit', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', outline: 'none', width: '100%', boxSizing: 'border-box' }}
                  />
                  {/* AI 潤色 結果預覽 — 不會覆蓋原始文字，需手動套用 */}
                  {polishedPreview && polishedPreview.slideId === activeSlideId && (
                    <div style={{ border: '1px solid var(--accent-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden', flexShrink: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.4rem 0.75rem', backgroundColor: 'rgba(var(--accent-rgb,99,102,241),0.08)', borderBottom: '1px solid var(--accent-color)' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-color)' }}><Sparkles size={12} style={{ display:'inline', marginRight:'0.3rem' }}/>AI 潤色結果（預覽）</span>
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <button onClick={() => { handleTextChange(activeSlideId, polishedPreview.text); setPolishedPreview(null); }}
                            style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem', backgroundColor: 'var(--accent-color)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: 600 }}>
                            套用
                          </button>
                          <button onClick={() => setPolishedPreview(null)}
                            style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem', background: 'none', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                            放棄
                          </button>
                        </div>
                      </div>
                      <div style={{ padding: '0.6rem 0.75rem', fontSize: '0.88rem', lineHeight: 1.8, color: 'var(--text-primary)', maxHeight: '140px', overflowY: 'auto', whiteSpace: 'pre-wrap', backgroundColor: 'var(--bg-secondary)' }}>
                        {polishedPreview.text}
                      </div>
                    </div>
                  )}

                  {(() => {
                    const hist = textHistories.get(activeSlideId);
                    const canUndo = !!hist && hist.pos > 0;
                    const canRedo = !!hist && hist.pos < hist.stack.length - 1;
                    const btnStyle = (enabled: boolean): React.CSSProperties => ({ background: 'none', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0.3rem 0.6rem', cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.35, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.78rem' });
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button style={btnStyle(canUndo)} disabled={!canUndo} onClick={() => handleTextUndo(activeSlideId)}><ChevronLeft size={13}/> 上一步</button>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{hist ? `${hist.pos + 1}/${hist.stack.length}` : '1/1'}</span>
                        <button style={btnStyle(canRedo)} disabled={!canRedo} onClick={() => handleTextRedo(activeSlideId)}>下一步 <ChevronRight size={13}/></button>
                        {(() => { const imgHist = imageHistories.get(activeSlideId); const canViewImg = !!imgHist && imgHist.stack.length > 0 && imgHist.pos < imgHist.stack.length - 1; const hasImg = !!imgHist && imgHist.stack.length > 0; return hasImg ? (<button style={{ ...btnStyle(true), marginLeft: '0.25rem', color: 'var(--accent-color)', borderColor: 'var(--accent-color)' }} onClick={() => canViewImg ? handleRedo(activeSlideId) : (setPendingImages(p => new Map(p).set(activeSlideId, imgHist!.stack[imgHist!.pos])), updateDoc(doc(db, 'projects', id!, 'slides', activeSlideId), { generatedImage: imgHist!.stack[imgHist!.pos] }).catch(console.error))} title="切換到生成圖片">查看圖片 <ChevronRight size={13}/></button>) : null; })()}
                        <div style={{ width: '1px', height: '18px', backgroundColor: 'var(--border-color)', flexShrink: 0 }} />
                        <input
                          value={polishDirection}
                          onChange={e => setPolishDirection(e.target.value)}
                          placeholder="潤色方向（選填，例：更正式、更簡潔）"
                          style={{ flex: 1, minWidth: '160px', padding: '0.28rem 0.55rem', fontSize: '0.78rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-primary)', color: 'var(--text-primary)', outline: 'none' }}
                        />
                        <button
                          disabled={isPolishing || !activeSlide?.prompt?.trim()}
                          onClick={() => handlePolishText(activeSlideId, activeSlide?.prompt || '')}
                          style={{ ...btnStyle(!isPolishing && !!activeSlide?.prompt?.trim()), backgroundColor: 'var(--accent-color)', color: 'white', border: 'none', padding: '0.3rem 0.75rem', gap: '0.3rem' }}
                        >
                          <Sparkles size={13}/> {isPolishing ? 'AI 潤色中...' : 'AI 潤色'}
                        </button>
                      </div>
                    );
                  })()}
                </div>
              ) : activeSlide?.status === 'empty' ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: 'var(--text-secondary)' }}>
                  <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem' }}><ImageIcon size={32} /></div>
                  <p>Preview Area</p>
                  <p style={{ fontSize: '0.875rem', marginTop: '0.5rem', opacity: 0.7 }}>Select a generated slide to view.</p>
                </div>
              ) : (
                <>
                  <img ref={imgRef} src={(activeSlideId && activeSlide ? getCanvasSrc(activeSlideId, activeSlide) : undefined) || ''} alt="Editor Canvas" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: activeSlide?.status === 'generating' ? 0.5 : 1, transition: 'opacity 0.3s' }} />
                  <canvas ref={canvasRef} onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseLeave={stopDrawing} onTouchStart={startDrawing} onTouchMove={draw} onTouchEnd={stopDrawing} style={(() => {
                    const img = imgRef.current;
                    if (!img) return { position: 'absolute' as const, inset: 0, width: '100%', height: '100%', pointerEvents: (isDrawingMode ? 'auto' : 'none') as any, cursor: isDrawingMode ? 'crosshair' : 'default', zIndex: 10 };
                    // Compute actual rendered image rect inside objectFit:contain
                    const natW = img.naturalWidth || 1;
                    const natH = img.naturalHeight || 1;
                    const elemW = img.offsetWidth;
                    const elemH = img.offsetHeight;
                    const scale = Math.min(elemW / natW, elemH / natH);
                    const renderedW = natW * scale;
                    const renderedH = natH * scale;
                    const offsetX = (elemW - renderedW) / 2;
                    const offsetY = (elemH - renderedH) / 2;
                    return { position: 'absolute' as const, top: img.offsetTop + offsetY, left: img.offsetLeft + offsetX, width: renderedW, height: renderedH, pointerEvents: (isDrawingMode ? 'auto' : 'none') as any, cursor: isDrawingMode ? 'crosshair' : 'default', opacity: 1, mixBlendMode: 'normal' as const, zIndex: 10 };
                  })()} />
                  {activeSlide?.status === 'generating' && (
                    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'var(--bg-primary)', padding: '1rem 2rem', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)', fontWeight: 500, zIndex: 20 }}>
                      <Sparkles size={16} style={{ display: 'inline', marginRight: '0.5rem', animation: 'spin 2s linear infinite' }} /> Generating with Gemini...
                    </div>
                  )}
                  {/* Prev/Next slide nav buttons */}
                  {(() => { const idx = slides.findIndex(s => s.id === activeSlideId); const hasPrev = idx > 0; const hasNext = idx < slides.length - 1; const navBtn = (enabled: boolean): React.CSSProperties => ({ position: 'absolute', top: '50%', transform: 'translateY(-50%)', zIndex: 15, background: enabled ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.15)', border: 'none', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: enabled ? 'pointer' : 'default', color: 'white', transition: 'background 0.2s' }); return (<><button style={{ ...navBtn(hasPrev), left: '10px' }} disabled={!hasPrev} onClick={() => { if (hasPrev) setActiveSlideId(slides[idx-1].id); }}><ChevronLeft size={20} /></button><button style={{ ...navBtn(hasNext), right: '10px' }} disabled={!hasNext} onClick={() => { if (hasNext) setActiveSlideId(slides[idx+1].id); }}><ChevronRight size={20} /></button></>); })()}
                </>
              )}
            </div>
            {(activeSlide?.status === 'draft' || activeSlide?.status === 'done') && !(!activeSlide.originalImage && !activeSlide.generatedImage && !pendingImages.get(activeSlideId)) && (
              <div style={{ backgroundColor: 'var(--bg-primary)', display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)', overflow: 'visible' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0, overflowX: 'auto', maxWidth: '60%', overflow: 'visible' }}>
                  {(() => {
                    const hist = activeSlideId ? imageHistories.get(activeSlideId) : undefined;
                    const canUndo = !!hist && hist.pos > 0;
                    const canRedo = !!hist && hist.pos < hist.stack.length - 1;
                    if (!hist || hist.stack.length === 0) return null;
                    const btnStyle = (enabled: boolean): React.CSSProperties => ({
                      background: 'none', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
                      padding: '0.3rem 0.45rem', cursor: enabled ? 'pointer' : 'not-allowed',
                      opacity: enabled ? 1 : 0.35, color: 'var(--text-secondary)',
                      display: 'flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.72rem',
                    });
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', paddingRight: '0.75rem', borderRight: '1px solid var(--border-color)' }}>
                        <button style={btnStyle(canUndo)} disabled={!canUndo} title="上一步" onClick={() => handleUndo(activeSlideId)}>
                          <ChevronLeft size={13} /> 上一步
                        </button>
                        <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', minWidth: '28px', textAlign: 'center' }}>
                          {hist.pos + 1}/{hist.stack.length}
                        </span>
                        <button style={btnStyle(canRedo)} disabled={!canRedo} title="下一步（最新版）" onClick={() => handleRedo(activeSlideId)}>
                          下一步 <ChevronRight size={13} />
                        </button>
                        <button style={{ ...btnStyle(true), marginLeft: '0.2rem', borderColor: 'var(--border-color)' }} title="還原原始圖片" onClick={() => handleRevertToOriginal(activeSlideId)}>
                          <RotateCcw size={13} /> 原圖
                        </button>
                      </div>
                    );
                  })()}
                  <Button variant={isDrawingMode ? 'primary' : 'secondary'} onClick={() => { if (isDrawingMode) { clearCanvas(); setIsDrawingMode(false); } else { enterDrawingMode(); } }} style={{ whiteSpace: 'nowrap' }}>
                    {isDrawingMode ? <X size={18} style={{ marginRight: '0.5rem' }} /> : <Circle size={18} style={{ marginRight: '0.5rem' }} />}
                    {isDrawingMode ? '清除並關閉' : '塗改區域'}
                  </Button>
                  {isDrawingMode && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginLeft: '0.5rem', padding: '0 0.5rem', borderLeft: '1px solid var(--border-color)' }}>
                      {PEN_COLORS.map(pc => (
                        <button key={pc.color} title={pc.label} onClick={() => setPenColor(pc.color)}
                          style={{ width: '20px', height: '20px', borderRadius: '50%', border: penColor === pc.color ? '2px solid var(--accent-color)' : '2px solid var(--border-color)', backgroundColor: pc.color, cursor: 'pointer', padding: 0, flexShrink: 0, boxShadow: penColor === pc.color ? '0 0 0 2px var(--bg-primary), 0 0 0 4px var(--accent-color)' : 'none', transition: 'box-shadow 0.15s' }} />
                      ))}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginLeft: '0.5rem', paddingLeft: '0.5rem', borderLeft: '1px solid var(--border-color)' }}>
                        <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>粗細</span>
                        <input type="range" min="2" max="20" value={brushSize} onChange={(e) => setBrushSize(parseInt(e.target.value))} style={{ width: '60px', accentColor: 'var(--accent-color)', cursor: 'pointer' }} />
                      </div>
                    </div>
                  )}
                  {/* Upload extra reference images */}
                  <Button variant="secondary" onClick={() => extraImgInputRef.current?.click()} style={{ whiteSpace: 'nowrap', marginLeft: '0.3rem' }}>
                    <ImagePlus size={16} style={{ marginRight: '0.4rem' }} />上傳圖片
                  </Button>
                  <input ref={extraImgInputRef} type="file" accept="image/*" multiple hidden onChange={(e) => {
                    const files = e.target.files;
                    if (!files) return;
                    Array.from(files).forEach(file => {
                      const reader = new FileReader();
                      reader.onload = () => {
                        const dataUrl = reader.result as string;
                        setLocalExtraImages(prev => {
                          const next = [...prev, { id: crypto.randomUUID(), dataUrl, name: file.name }];
                          return next;
                        });
                      };
                      reader.readAsDataURL(file);
                    });
                    e.target.value = '';
                  }} />
                  {/* Thumbnail strip for uploaded extra images — hidden in drawing mode */}
                  {localExtraImages.length > 0 && !isDrawingMode && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginLeft: '0.3rem', padding: '6px 0.4rem 0', borderLeft: '1px solid var(--border-color)', overflow: 'visible' }}>
                      {localExtraImages.map((img, idx) => (
                        <div key={img.id} style={{ position: 'relative', flexShrink: 0 }} title={`@${idx + 1} ${img.name}`}>
                          <img src={img.dataUrl} alt={`@${idx + 1}`} style={{ width: '32px', height: '32px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--border-color)' }} />
                          <span style={{ position: 'absolute', top: '-5px', left: '-4px', background: 'var(--accent-color)', color: '#fff', fontSize: '0.6rem', fontWeight: 700, borderRadius: '6px', padding: '0 3px', lineHeight: '14px' }}>@{idx + 1}</span>
                          <button onClick={() => setLocalExtraImages(prev => prev.filter(p => p.id !== img.id))}
                            style={{ position: 'absolute', top: '-5px', right: '-4px', background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: '50%', width: '14px', height: '14px', fontSize: '0.55rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1 }}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <input
                  placeholder={localExtraImages.length > 0 ? '用 @1 @2 引用圖片，例如：@1 logo 放左下角...' : '描述想修改的方向，例如：把標題放大、換背景顏色...'}
                  value={promptDraft}
                  onChange={(e) => setPromptDraft(e.target.value)}
                  onCompositionStart={() => { isComposing.current = true; }}
                  onCompositionEnd={(e) => { isComposing.current = false; if (activeSlide?.originalImage) setPrompt((e.target as HTMLInputElement).value); }}
                  onBlur={(e) => { if (!isComposing.current && activeSlide?.originalImage) setPrompt(e.target.value); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !isGenerating) { e.preventDefault(); if (activeSlideId) { const hasStrokes = isDrawingMode && canvasRef.current && canvasRef.current.width > 0; localBaseDataRef.current = hasStrokes ? canvasRef.current!.toDataURL('image/jpeg', 0.92) : (pendingImages.get(activeSlideId) || activeSlide?.generatedImage || activeSlide?.originalImage || null); localMaskDataRef.current = null; const colorLabel = PEN_COLORS.find(pc => pc.color === penColor)?.label || ''; const prefix = hasStrokes && colorLabel ? `${colorLabel}筆畫標記的區域幫我` : ''; localPromptRef.current = prefix + promptDraft; localAspectRatioRef.current = imgRef.current ? getAspectRatioString(imgRef.current.naturalWidth, imgRef.current.naturalHeight) : ''; localExtraImagesRef.current = localExtraImages.map((img, i) => ({ label: `@${i + 1}`, dataUrl: img.dataUrl })); localOverrideSlideIdsRef.current = [activeSlideId]; handleGenerateRef.current(true); } } }}
                  style={{ flex: 1, width: 0, minWidth: 0, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', outline: 'none', fontSize: '0.875rem', color: 'var(--text-primary)', padding: '0.5rem 0.75rem' }}
                />
                <button
                  onClick={() => { if (activeSlideId) { const hasStrokes = isDrawingMode && canvasRef.current && canvasRef.current.width > 0; localBaseDataRef.current = hasStrokes ? canvasRef.current!.toDataURL('image/jpeg', 0.92) : (pendingImages.get(activeSlideId) || activeSlide?.generatedImage || activeSlide?.originalImage || null); localMaskDataRef.current = null; const colorLabel = PEN_COLORS.find(pc => pc.color === penColor)?.label || ''; const prefix = hasStrokes && colorLabel ? `${colorLabel}筆畫標記的區域幫我` : ''; localPromptRef.current = prefix + promptDraft; localAspectRatioRef.current = imgRef.current ? getAspectRatioString(imgRef.current.naturalWidth, imgRef.current.naturalHeight) : ''; localExtraImagesRef.current = localExtraImages.map((img, i) => ({ label: `@${i + 1}`, dataUrl: img.dataUrl })); localOverrideSlideIdsRef.current = [activeSlideId]; handleGenerateRef.current(true); } }}
                  disabled={isGenerating}
                  style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.45rem 1rem', backgroundColor: isGenerating ? 'var(--bg-secondary)' : 'var(--accent-color)', color: isGenerating ? 'var(--text-secondary)' : 'white', border: 'none', borderRadius: 'var(--radius-md)', cursor: isGenerating ? 'not-allowed' : 'pointer', fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap' }}
                >
                  <Sparkles size={14} style={{ animation: isGenerating ? 'spin 2s linear infinite' : 'none' }} />
                  {isGenerating ? '生成中...' : '生成'}
                </button>
              </div>
            )}
          </div>

          {/* ── Right AI Chat Panel ── */}
          {aiChatOpen ? (
            <div style={{ width: '340px', flexShrink: 0, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 0.75rem', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
                <span style={{ fontWeight: 700, fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: '0.35rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                  <MessageSquare size={15} color="var(--accent-color)" style={{ flexShrink: 0 }} /> {aiActiveConv?.title || 'AI 助手'}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', flexShrink: 0 }}>
                  <button onClick={startNewAiChat} title="新對話" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.2rem', color: 'var(--text-secondary)' }}><Plus size={14} /></button>
                  <button onClick={() => setAiChatHistoryOpen(v => !v)} title="歷史對話" style={{ background: aiChatHistoryOpen ? 'var(--bg-tertiary)' : 'none', border: 'none', cursor: 'pointer', padding: '0.2rem', color: 'var(--text-secondary)', borderRadius: '0.2rem' }}><Clock size={13} /></button>
                  <button onClick={() => setAiChatOpen(false)} title="收合" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.2rem', color: 'var(--text-secondary)' }}><X size={15} /></button>
                </div>
              </div>
              {/* History panel */}
              {aiChatHistoryOpen ? (
                <div style={{ flex: 1, overflowY: 'auto', padding: '0.4rem' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', padding: '0.3rem 0.4rem', marginBottom: '0.2rem' }}>歷史對話 ({aiConversations.length})</div>
                  {aiConversations.length === 0 && (
                    <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.72rem' }}>尚無對話記錄</div>
                  )}
                  {aiConversations.map(conv => (
                    <div key={conv.id}
                      onClick={() => { setAiActiveConvId(conv.id); setAiChatHistoryOpen(false); }}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.45rem 0.5rem', cursor: 'pointer', borderRadius: '0.3rem', marginBottom: '0.15rem',
                        background: conv.id === aiActiveConvId ? 'var(--bg-tertiary)' : 'transparent',
                        border: conv.id === aiActiveConvId ? '1px solid var(--accent-color)' : '1px solid transparent',
                      }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.76rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>{conv.title}</div>
                        <div style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
                          {conv.messages.length} 則訊息 · {new Date(conv.updatedAt).toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' })} {new Date(conv.updatedAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); deleteAiConv(conv.id); }} title="刪除" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.2rem', color: 'var(--text-secondary)', flexShrink: 0, opacity: 0.5 }}><Trash2 size={11} /></button>
                    </div>
                  ))}
                </div>
              ) : (
              <>
              {/* Messages */}
              <div ref={aiChatScrollRef} style={{ flex: 1, overflowY: 'auto', padding: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {aiChatMsgs.length === 0 && (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', color: 'var(--text-secondary)', padding: '2rem 1rem', textAlign: 'center' }}>
                    <MessageSquare size={36} style={{ opacity: 0.2 }} />
                    <p style={{ fontSize: '0.82rem', fontWeight: 600, margin: 0 }}>投影片 AI 助手</p>
                    <p style={{ fontSize: '0.72rem', lineHeight: 1.6, margin: 0 }}>自動附帶當前投影片<br />可 TAG 其他頁面或上傳檔案<br />支援提問、翻譯、摘要等</p>
                  </div>
                )}
                {aiChatMsgs.map(msg => (
                  <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                    {msg.taggedSlides.length > 0 && (
                      <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap', marginBottom: '0.2rem', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                        {msg.taggedSlides.map(idx => (
                          <span key={idx} style={{ fontSize: '0.6rem', padding: '0.1rem 0.3rem', background: 'var(--accent-color)', color: '#fff', borderRadius: '4px', fontWeight: 600 }}>第 {idx + 1} 頁</span>
                        ))}
                      </div>
                    )}
                    {msg.attachments.length > 0 && (
                      <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap', marginBottom: '0.2rem', maxWidth: '90%', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                        {msg.attachments.map((a, i) => (
                          a.mimeType.startsWith('image/') ? (
                            <img key={i} src={a.dataUrl} alt={a.name} style={{ maxHeight: '60px', maxWidth: '100px', borderRadius: '0.3rem', border: '1px solid var(--border-color)' }} />
                          ) : (
                            <div key={i} style={{ padding: '0.2rem 0.4rem', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '0.25rem', fontSize: '0.62rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}><Paperclip size={9} />{a.name}</div>
                          )
                        ))}
                      </div>
                    )}
                    {msg.text && (
                      <div style={{
                        maxWidth: '90%', padding: '0.5rem 0.65rem', borderRadius: '0.6rem', fontSize: '0.78rem', lineHeight: 1.6, wordBreak: 'break-word',
                        ...(msg.role === 'user'
                          ? { background: 'var(--accent-color)', color: '#fff', borderBottomRightRadius: '0.15rem' }
                          : { background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderBottomLeftRadius: '0.15rem' }),
                      }}>
                        {msg.role === 'assistant' ? (
                          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={mdComponents}>{msg.text}</ReactMarkdown>
                        ) : (
                          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 'inherit' }}>{msg.text}</pre>
                        )}
                      </div>
                    )}
                    <span style={{ fontSize: '0.55rem', color: 'var(--text-secondary)', marginTop: '0.1rem', paddingInline: '0.15rem' }}>
                      {new Date(msg.timestamp).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
                {aiChatLoading && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-secondary)', fontSize: '0.72rem', padding: '0.3rem' }}>
                    <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> AI 思考中…
                    <button onClick={() => aiChatAbortRef.current?.abort()} style={{ marginLeft: '0.2rem', padding: '0.1rem 0.3rem', fontSize: '0.62rem', border: '1px solid var(--border-color)', borderRadius: '0.2rem', cursor: 'pointer', background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>取消</button>
                  </div>
                )}
              </div>
              {/* Tag picker */}
              {aiChatTagPicker && (
                <div style={{ maxHeight: '150px', overflowY: 'auto', borderTop: '1px solid var(--border-color)', padding: '0.4rem', display: 'flex', flexWrap: 'wrap', gap: '0.25rem', background: 'var(--bg-secondary)' }}>
                  {slides.map((s, idx) => {
                    const active = aiChatTaggedSlides.has(idx);
                    return (
                      <button key={s.id} onClick={() => setAiChatTaggedSlides(prev => { const n = new Set(prev); if (active) n.delete(idx); else n.add(idx); return n; })}
                        style={{ padding: '0.2rem 0.4rem', fontSize: '0.65rem', fontWeight: 600, border: `1px solid ${active ? 'var(--accent-color)' : 'var(--border-color)'}`, borderRadius: '0.25rem', cursor: 'pointer', background: active ? 'var(--accent-color)' : 'var(--bg-primary)', color: active ? '#fff' : 'var(--text-secondary)', transition: 'all 0.15s' }}>
                        {idx + 1}
                      </button>
                    );
                  })}
                </div>
              )}
              {/* Attachments preview */}
              {aiChatAttachments.length > 0 && (
                <div style={{ display: 'flex', gap: '0.25rem', padding: '0.3rem 0.5rem', borderTop: '1px solid var(--border-color)', flexWrap: 'wrap', background: 'var(--bg-secondary)' }}>
                  {aiChatAttachments.map((a, i) => (
                    <div key={i} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '0.2rem', padding: '0.15rem 0.35rem', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '0.25rem', fontSize: '0.62rem' }}>
                      {a.mimeType.startsWith('image/') ? <img src={a.dataUrl} alt="" style={{ width: '20px', height: '20px', objectFit: 'cover', borderRadius: '2px' }} /> : <Paperclip size={9} />}
                      <span style={{ maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                      <button onClick={() => setAiChatAttachments(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-secondary)', lineHeight: 1 }}><X size={10} /></button>
                    </div>
                  ))}
                </div>
              )}
              {/* Input area */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.5rem', borderTop: '1px solid var(--border-color)', flexShrink: 0 }}>
                <input ref={aiChatFileRef} type="file" multiple hidden onChange={(e) => {
                  if (!e.target.files) return;
                  Array.from(e.target.files).forEach(file => {
                    const reader = new FileReader();
                    reader.onload = () => setAiChatAttachments(prev => [...prev, { name: file.name, mimeType: file.type || 'application/octet-stream', dataUrl: reader.result as string }]);
                    reader.readAsDataURL(file);
                  });
                  e.target.value = '';
                }} />
                <button onClick={() => aiChatFileRef.current?.click()} title="上傳檔案" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem', color: 'var(--text-secondary)', flexShrink: 0 }}><Paperclip size={15} /></button>
                <button onClick={() => setAiChatTagPicker(v => !v)} title="TAG 投影片"
                  style={{ background: aiChatTaggedSlides.size > 0 ? 'var(--accent-color)' : 'none', border: 'none', cursor: 'pointer', padding: '0.2rem 0.35rem', color: aiChatTaggedSlides.size > 0 ? '#fff' : 'var(--text-secondary)', flexShrink: 0, borderRadius: '0.2rem', fontSize: '0.65rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
                  <ImagePlus size={13} />{aiChatTaggedSlides.size > 0 && ` ${aiChatTaggedSlides.size}`}
                </button>
                <input
                  value={aiChatInput}
                  onChange={e => setAiChatInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !aiChatLoading) { e.preventDefault(); e.stopPropagation(); handleAiChatSend(); } }}
                  placeholder="問投影片問題..."
                  style={{ flex: 1, padding: '0.35rem 0.5rem', fontSize: '0.78rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', outline: 'none', minWidth: 0 }}
                />
                <button onClick={handleAiChatSend} disabled={aiChatLoading} title="送出"
                  style={{ background: aiChatLoading ? 'var(--bg-secondary)' : 'var(--accent-color)', border: 'none', cursor: aiChatLoading ? 'not-allowed' : 'pointer', padding: '0.3rem', borderRadius: '0.3rem', color: aiChatLoading ? 'var(--text-secondary)' : '#fff', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Send size={14} />
                </button>
              </div>
              </>
              )}
            </div>
          ) : null}
        </>)}
      </div>

      {/* Share Template Modal */}
      {showShareModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 10100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
          onClick={() => { if (!isSharing) setShowShareModal(false); }}>
          <div style={{ backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', boxShadow: '0 16px 48px rgba(0,0,0,0.3)', padding: '1.75rem', width: '520px', maxWidth: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', gap: '0', overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}>
            {/* Header - fixed */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '0.75rem', flexShrink: 0 }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}><Share2 size={16} style={{ verticalAlign: 'middle', marginRight: '0.4rem' }} />分享模板到社群</h3>
              <button onClick={() => setShowShareModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}><X size={18} /></button>
            </div>

            {/* Scrollable content */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>模板名稱</label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input value={shareLabel} onChange={e => setShareLabel(e.target.value)} placeholder={isGeneratingLabel ? 'AI 命名中...' : '例：極簡商務風、科技藍白風格'}
                  style={{ flex: 1, padding: '0.5rem 0.75rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', fontSize: '0.88rem', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', outline: 'none' }} />
                <button onClick={generateShareLabel} disabled={isGeneratingLabel} title="AI 自動命名" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '34px', height: '34px', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: isGeneratingLabel ? 'var(--accent-color)' : 'var(--bg-secondary)', color: isGeneratingLabel ? 'white' : 'var(--accent-color)', cursor: isGeneratingLabel ? 'wait' : 'pointer', transition: 'all 0.2s' }}>
                  <Sparkles size={16} style={{ animation: isGeneratingLabel ? 'spin 1s linear infinite' : 'none' }} />
                </button>
              </div>
            </div>

            {globalReference && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>風格參考圖</label>
                <img src={globalReference} alt="Reference" style={{ width: '120px', maxHeight: '160px', objectFit: 'cover', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>進階設定 {!useAdvancedSettings && <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 400 }}>（未啟用）</span>}</label>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', flexWrap: 'wrap', gap: '0.3rem 0.8rem', opacity: useAdvancedSettings ? 1 : 0.4 }}>
                <span>字體：{fontFamily}</span><span>主色：{mainColor}</span><span>重點色：{highlightColor}</span>
                {specialMark && <span>標記：{specialMark}</span>}
                {backgroundColor && <span>背景色：{backgroundColor}</span>}
              </div>
              {globalExtraPrompt.trim() && (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '0.15rem' }}>
                  提示詞：{globalExtraPrompt.trim().slice(0, 80)}{globalExtraPrompt.trim().length > 80 ? '…' : ''}
                </div>
              )}
            </div>

            {slides.filter(s => s.generatedImage).length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>選擇效果圖（最多 3 張）</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '0.5rem', borderRadius: '6px' }}>
                  {slides.filter(s => s.generatedImage).map(s => {
                    const selected = shareSelectedResults.has(s.id);
                    return (
                      <div key={s.id}
                        onClick={() => setShareSelectedResults(prev => {
                          const next = new Set(prev);
                          if (next.has(s.id)) next.delete(s.id);
                          else if (next.size < 3) next.add(s.id);
                          return next;
                        })}
                        style={{ position: 'relative', cursor: 'pointer', borderRadius: '6px', overflow: 'hidden', border: `2px solid ${selected ? 'var(--accent-color)' : 'var(--border-color)'}`, opacity: selected ? 1 : 0.6, transition: 'all 0.15s' }}>
                        <img src={pendingImages.get(s.id) || s.generatedImage!} alt="result" style={{ width: '100%', height: 'auto', display: 'block' }} />
                        {selected && (
                          <div style={{ position: 'absolute', top: '3px', right: '3px', width: '18px', height: '18px', borderRadius: '50%', backgroundColor: 'var(--accent-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <CheckSquare size={11} color="#fff" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            </div>

            {/* Footer - fixed */}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', paddingTop: '0.75rem', flexShrink: 0, borderTop: '1px solid var(--border-color)' }}>
              <Button variant="secondary" onClick={() => setShowShareModal(false)} disabled={isSharing}>取消</Button>
              <Button onClick={handleShareTemplate} icon={Share2} disabled={isSharing || !shareLabel.trim()}
                style={{ backgroundColor: 'var(--accent-color)', color: '#fff' }}>
                {isSharing ? '分享中...' : '分享到社群'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Auto-retry floating status widget (429 error) */}
      {autoRetryStatus && (
        <div style={{ position: 'fixed', bottom: '1.5rem', left: '1.5rem', zIndex: 10200, backgroundColor: 'var(--bg-primary)', border: '1px solid #f59e0b', borderRadius: 'var(--radius-md)', boxShadow: '0 8px 24px rgba(0,0,0,0.2)', padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.35rem', minWidth: '240px', fontSize: '0.85rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
            <span style={{ fontWeight: 700, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.82rem' }}>
              ⚠ 429 錯誤 — 自動重試中
            </span>
            <button onClick={stopAutoRetry} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '2px', display: 'flex', alignItems: 'center' }} title="停止自動重試"><X size={14}/></button>
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
            {autoRetryStatus.countdown < 0
              ? '正在生成...'
              : `${autoRetryStatus.countdown} 秒後重試`}
            {autoRetryStatus.pendingCount > 0 && `（待重試 ${autoRetryStatus.pendingCount} 張）`}
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
            第 {autoRetryStatus.doneCount + 1} 次重試
          </div>
        </div>
      )}

      {/* Custom App Modal (replaces browser alert) */}
      {appModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 10100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
          onClick={() => setAppModal(null)}>
          <div style={{ backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', boxShadow: '0 16px 48px rgba(0,0,0,0.3)', padding: '1.75rem', width: '420px', maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
              <span style={{ fontSize: '1.4rem', lineHeight: 1, flexShrink: 0 }}>
                {appModal.type === 'error' ? '⚠️' : appModal.type === 'success' ? '✅' : appModal.type === 'warning' ? '⚠️' : 'ℹ️'}
              </span>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: '0 0 0.1rem', fontSize: '1rem', fontWeight: 700, color: appModal.type === 'error' ? '#ef4444' : 'var(--text-primary)' }}>{appModal.title}</h3>
              </div>
              <button onClick={() => setAppModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '2px', flexShrink: 0 }}><X size={18}/></button>
            </div>
            <div style={{ fontSize: '0.9rem', lineHeight: 1.7, color: 'var(--text-secondary)', paddingLeft: '2.1rem' }}>{appModal.body}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingLeft: '2.1rem' }}>
              <button onClick={() => setAppModal(null)}
                style={{ padding: '0.5rem 1.5rem', borderRadius: 'var(--radius-md)', border: 'none', backgroundColor: appModal.type === 'error' ? '#ef4444' : 'var(--accent-color)', color: '#fff', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600 }}>
                確定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div style={{ position: 'fixed', bottom: '1.5rem', right: '1.5rem', zIndex: 10200, display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.75rem 1.1rem', borderRadius: 'var(--radius-md)', backgroundColor: toast.type === 'success' ? '#16a34a' : toast.type === 'error' ? '#dc2626' : '#2563eb', color: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,0.25)', fontSize: '0.875rem', fontWeight: 500, maxWidth: '360px', animation: 'slideInRight 0.25s ease' }}>
          <span style={{ fontSize: '1rem', flexShrink: 0 }}>
            {toast.type === 'success' ? '✓' : toast.type === 'error' ? '✕' : 'ℹ'}
          </span>
          <span style={{ flex: 1 }}>{toast.message}</span>
          <button onClick={() => setToast(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.75)', padding: '2px', display: 'flex', flexShrink: 0 }}><X size={14}/></button>
        </div>
      )}

      {/* 下載範圍選擇 Modal */}
      {downloadScopeModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setDownloadScopeModal(null)}>
          <div style={{ backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', padding: '1.75rem', width: '340px', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
                {downloadScopeModal === 'save' ? '下載圖片' : '匯出 PPTX'}
              </h3>
              <button onClick={() => setDownloadScopeModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', padding: '2px' }}><X size={18}/></button>
            </div>
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>要{downloadScopeModal === 'save' ? '下載' : '匯出'}哪些頁面？</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <button onClick={() => { setDownloadScopeModal(null); downloadScopeModal === 'save' ? handleSaveToLocal('all') : handleExport('all'); }}
                style={{ padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', cursor: 'pointer', textAlign: 'left', fontSize: '0.875rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <span style={{ fontSize: '1.2rem' }}>📋</span>
                <div>
                  <div style={{ fontWeight: 600 }}>全部頁面</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>共 {slides.length} 頁</div>
                </div>
              </button>
              <button onClick={() => { setDownloadScopeModal(null); downloadScopeModal === 'save' ? handleSaveToLocal('selected') : handleExport('selected'); }}
                style={{ padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', cursor: selectedSlides.size === 0 ? 'not-allowed' : 'pointer', textAlign: 'left', fontSize: '0.875rem', color: selectedSlides.size === 0 ? 'var(--text-secondary)' : 'var(--text-primary)', opacity: selectedSlides.size === 0 ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: '0.6rem' }}
                disabled={selectedSlides.size === 0}>
                <span style={{ fontSize: '1.2rem' }}>✅</span>
                <div>
                  <div style={{ fontWeight: 600 }}>已勾選的頁面</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>共 {selectedSlides.size} 頁已勾選</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 新增頁面 Modal */}
      {showAddSlideModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowAddSlideModal(false)}>
          <div style={{ backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', padding: '1.75rem', width: '320px', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>新增頁面</h3>
              <button onClick={() => setShowAddSlideModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', padding: '2px' }}><X size={18}/></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>要新增幾頁？</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <button onClick={() => setAddSlideCount(c => Math.max(1, c - 1))}
                  style={{ width: '32px', height: '32px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', cursor: 'pointer', fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)' }}>−</button>
                <input type="number" min={1} max={99} value={addSlideCount}
                  onChange={e => setAddSlideCount(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
                  style={{ width: '56px', textAlign: 'center', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0.3rem', fontSize: '0.95rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', outline: 'none' }} />
                <button onClick={() => setAddSlideCount(c => Math.min(99, c + 1))}
                  style={{ width: '32px', height: '32px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', cursor: 'pointer', fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)' }}>+</button>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>頁（上限 99）</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowAddSlideModal(false)}
                style={{ padding: '0.5rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', background: 'none', cursor: 'pointer', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                取消
              </button>
              <button onClick={async () => { setShowAddSlideModal(false); await addSlide('text', addSlideCount); }}
                style={{ padding: '0.5rem 1.25rem', borderRadius: 'var(--radius-md)', border: 'none', backgroundColor: 'var(--accent-color)', color: '#fff', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Plus size={14}/> 新增 {addSlideCount} 頁
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rubber-band selection overlay */}
      {dragBox && (
        <div style={{
          position: 'fixed',
          left: dragBox.x1,
          top: dragBox.y1,
          width: dragBox.x2 - dragBox.x1,
          height: dragBox.y2 - dragBox.y1,
          border: '1px solid var(--accent-color)',
          backgroundColor: 'rgba(99,102,241,0.08)',
          pointerEvents: 'none',
          zIndex: 9999,
          borderRadius: '2px',
        }} />
      )}
    </div>
  );
};

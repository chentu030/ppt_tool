import React, { useState, useRef } from 'react';
import { showAlert } from '../utils/dialog';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { ArrowLeft, Download, Image as ImageIcon, Plus, Trash2, X, Circle, Sparkles, CheckSquare, Eye, RotateCcw, ChevronLeft, ChevronRight, FileText, Share2 } from 'lucide-react';
import TemplateGalleryModal from '../components/TemplateGalleryModal';
import type { ApplyParams } from '../components/TemplateGalleryModal';
import pptxgen from 'pptxgenjs';
import JSZip from 'jszip';
import { collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, writeBatch, query, orderBy, getDoc } from 'firebase/firestore';
import { db, auth, storage } from '../firebase';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { onAuthStateChanged } from 'firebase/auth';
import { uploadImageToStorage, uploadHQToStorage, fetchImageAsBase64, compressImage, compressForFirestore, uploadToDrive } from '../utils/storageHelper';
import { getApiKey } from '../utils/gemini';

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
  const [selectedSlides, setSelectedSlides] = useState<Set<string>>(new Set(['1']));

  const [slides, setSlides] = useState<Slide[]>([]);
  const [activeSlideId, setActiveSlideId] = useState<string>('');
  const [globalReference, setGlobalReference] = useState<string | null>(null);

  const defaultPrompt = `幫我重新繪製這張投影片(直接畫，用nano banana)，使用極簡風格設計，可以適當加一些相關內容的簡單插圖(插畫風格與背景一致)，使用${fontFamily}系列字體，${mainColor}(主體)、${highlightColor}(重點字)字體，適當排版${specialMark ? `，特殊標記：${specialMark}` : ''}${backgroundColor ? `，背景色：${backgroundColor}` : ''}，比例${aspectRatio}(橫向)${globalReference ? '，請參考提供的風格圖' : ''}`;
  
  // Progress states
  const [parsingProgress, setParsingProgress] = useState<{current: number, total: number} | null>(null);
  const [savingProgress, setSavingProgress] = useState<{current: number, total: number} | null>(null);
  const [generateProgress, setGenerateProgress] = useState<{current: number, total: number} | null>(null);
  
  // Real Drawing state
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [brushSize, setBrushSize] = useState(40);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // Rubber-band selection
  const gridRef = useRef<HTMLDivElement>(null);
  const slideCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const lastAnchorId = useRef<string | null>(null);
  const dragStartPos = useRef<{x: number, y: number} | null>(null);
  const [dragBox, setDragBox] = useState<{x1:number, y1:number, x2:number, y2:number} | null>(null);
  const maskSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generateAbortController = useRef<AbortController | null>(null);
  const textFileInputRef = useRef<HTMLInputElement | null>(null);
  const globalReferenceRef = useRef<string | null>(null);
  const defaultPromptRef = useRef<string>('');
  const activeSlideIdRef = useRef<string>('');

  // Local-first generation state
  const [pendingImages, setPendingImages] = useState<Map<string, string>>(new Map());
  const [backedUpIds, setBackedUpIds] = useState<Set<string>>(new Set());
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
  const [addSlideType, setAddSlideType] = useState<'image' | 'text'>('image');
  const [addSlideCount, setAddSlideCount] = useState(1);
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
  const [retryIntervalSec, setRetryIntervalSec] = useState(5);
  const [retryStopCond, setRetryStopCond] = useState<'success' | 'retries' | 'time'>('success');
  const [retryMaxTimes, setRetryMaxTimes] = useState(3);
  const [retryUntilTime, setRetryUntilTime] = useState(() => {
    const d = new Date(); d.setHours(d.getHours() + 1);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  });
  const [autoRetryStatus, setAutoRetryStatus] = useState<{ countdown: number; doneCount: number } | null>(null);
  const autoRetryConfigRef = useRef<{ toRetrySlides: string[]; intervalSec: number; stopCond: 'success' | 'retries' | 'time'; maxTimes: number; untilTime: string; doneCount: number } | null>(null);
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

  // Convert canvas mask → white-on-black PNG at the same resolution as the base image
  const buildLocalMask = (canvasDataUrl: string, baseDataUrl: string): Promise<string> =>
    new Promise((resolve) => {
      const baseImg = new Image();
      baseImg.onload = () => {
        const maskImg = new Image();
        maskImg.onload = () => {
          const c = document.createElement('canvas');
          c.width = baseImg.naturalWidth; c.height = baseImg.naturalHeight;
          const ctx = c.getContext('2d')!;
          ctx.fillStyle = 'black'; ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(maskImg, 0, 0, c.width, c.height);
          const d = ctx.getImageData(0, 0, c.width, c.height);
          for (let i = 0; i < d.data.length; i += 4) {
            const bright = d.data[i] > 10 || d.data[i+1] > 10 || d.data[i+2] > 10 || d.data[i+3] > 10;
            d.data[i] = bright ? 255 : 0; d.data[i+1] = bright ? 255 : 0;
            d.data[i+2] = bright ? 255 : 0; d.data[i+3] = 255;
          }
          ctx.putImageData(d, 0, 0);
          resolve(c.toDataURL('image/png'));
        };
        maskImg.src = canvasDataUrl;
      };
      baseImg.src = baseDataUrl;
    });

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
    localStorage.setItem(`advancedSettings_${id}`, JSON.stringify({ aspectRatio, resolution, fontFamily, mainColor, highlightColor, specialMark, backgroundColor }));
  }, [id, aspectRatio, resolution, fontFamily, mainColor, highlightColor, specialMark, backgroundColor]);

  // Check for previous unfinished generation on mount
  React.useEffect(() => {
    const ts = localStorage.getItem('vertexGenerating');
    if (ts) {
      const elapsed = Date.now() - Number(ts);
      if (elapsed < 5 * 60 * 1000) { // within 5 minutes
        setPrevSessionWarning(Number(ts));
      } else {
        localStorage.removeItem('vertexGenerating');
      }
    }
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
    setPromptDraft(activeSlide?.prompt || '');
    // Clear canvas when switching slides to prevent mask bleed-over
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  }, [activeSlideId]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard navigation between slides
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const idx = slides.findIndex(s => s.id === activeSlideId);
      if (e.key === 'ArrowLeft' && idx > 0) {
        const prevId = slides[idx - 1].id;
        setActiveSlideId(prevId); setSelectedSlides(new Set([prevId]));
      } else if ((e.key === 'ArrowRight' || e.key === 'Enter') && idx >= 0 && idx < slides.length - 1) {
        const nextId = slides[idx + 1].id;
        setActiveSlideId(nextId); setSelectedSlides(new Set([nextId]));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [slides, activeSlideId]);

  // Always-on auto-backup: triggers after new unbacked images appear, with exponential backoff on failure
  React.useEffect(() => {
    const unbacked = Array.from(pendingImages.entries()).filter(([sid]) => !backedUpIds.has(sid));
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

  // Post-generate auto-retry logic
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
    // Succeeded (no new 429) — stop in all modes
    if (!another429) {
      autoRetryConfigRef.current = null;
      if (autoRetryTimerRef.current) clearInterval(autoRetryTimerRef.current);
      autoRetryTimerRef.current = null;
      setAutoRetryStatus(null);
      showToast('✓ 自動重試成功！所有投影片已生成。', 'success');
      return;
    }
    // Still failing — check stop conditions
    if (config.stopCond === 'retries' && newDone >= config.maxTimes) {
      console.log(`[AutoRetry] 已達 ${config.maxTimes} 次上限，停止。`);
      autoRetryConfigRef.current = null;
      if (autoRetryTimerRef.current) clearInterval(autoRetryTimerRef.current);
      autoRetryTimerRef.current = null;
      setAutoRetryStatus(null);
      showToast(`自動重試已達 ${config.maxTimes} 次上限，仍有失敗。`, 'info');
      return;
    }
    if (config.stopCond === 'time' && config.untilTime) {
      const now = new Date();
      const [h, m] = config.untilTime.split(':').map(Number);
      if (now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m)) {
        console.log(`[AutoRetry] 已到達設定時間 ${config.untilTime}，停止。`);
        autoRetryConfigRef.current = null;
        if (autoRetryTimerRef.current) clearInterval(autoRetryTimerRef.current);
        autoRetryTimerRef.current = null;
        setAutoRetryStatus(null);
        showToast('已到達設定時間，停止自動重試。', 'info');
        return;
      }
    }
    // Continue — update failed slides and start next countdown
    config.toRetrySlides = another429.toRetrySlides;
    console.log(`[AutoRetry] 繼續，${config.intervalSec} 秒後進行第 ${newDone + 1} 次重試，待重試 ${another429.toRetrySlides.length} 張...`);
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
        console.log(`[AutoRetry] 倒數結束，開始第 ${cfg.doneCount + 1} 次重試...`);
        setAutoRetryStatus(prev => prev ? { ...prev, countdown: -1 } : null);
        autoRetryIsWaiting.current = true;
        setTimeout(() => handleGenerateRef.current(true), 50);
      } else {
        if (cd % 30 === 0 || cd <= 10) console.log(`[AutoRetry] 倒數 ${cd} 秒後重試...`);
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
          setSelectedSlides(new Set([dbSlides[0].id]));
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

  const addSlide = async (type: 'image' | 'text' = 'image', count: number = 1) => {
    if (!id) return;
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
      setSelectedSlides(prev => new Set(prev).add(lastId));
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
      setSelectedSlides(new Set([slideId]));
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
    const unbacked = Array.from(pendingImages.entries()).filter(([sid]) => !backedUpIds.has(sid));
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
      setBackedUpIds(prev => new Set([...prev, ...newlyBacked]));
      setLastBackupTime(new Date());
      backupFailCount.current = 0;
    } catch (err) {
      console.error('Backup failed:', err);
      backupFailCount.current += 1;
      if (backupFailCount.current >= 3) {
        showAlert('備份多次失敗，請手動點擊備份按鈕或重新整理頁面再試。', '錯誤');
      } else {
        showToast(`備份失敗，${Math.round(5 * Math.pow(2, backupFailCount.current - 1))} 秒後自動重試…`, 'error');
      }
    } finally {
      setIsBackingUp(false);
    }
  };

  const unbackedCount = pendingImages.size - backedUpIds.size;

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
    if (!draggingId || draggingId === targetId || !id) { setDraggingId(null); setDragOverId(null); return; }
    const fromIdx = slides.findIndex(s => s.id === draggingId);
    const toIdx = slides.findIndex(s => s.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const reordered = [...slides];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    const batch = writeBatch(db);
    reordered.forEach((slide, idx) => {
      batch.update(doc(db, 'projects', id, 'slides', slide.id), { order: (idx + 1) * 1000 });
    });
    await batch.commit();
    setDraggingId(null);
    setDragOverId(null);
  };

  const handleDragEnd = () => { setDraggingId(null); setDragOverId(null); };

  const setPrompt = (prompt: string) => {
    if (!id || !activeSlideId) return;
    updateDoc(doc(db, 'projects', id, 'slides', activeSlideId), { prompt });
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawingMode || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Initialize dimensions if not set
    if (canvas.width !== canvas.offsetWidth || canvas.height !== canvas.offsetHeight) {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    }

    const rect = canvas.getBoundingClientRect();
    const x = ('touches' in e) ? e.touches[0].clientX - rect.left : (e as React.MouseEvent).clientX - rect.left;
    const y = ('touches' in e) ? e.touches[0].clientY - rect.top  : (e as React.MouseEvent).clientY - rect.top;

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
    const x = ('touches' in e) ? e.touches[0].clientX - rect.left : (e as React.MouseEvent).clientX - rect.left;
    const y = ('touches' in e) ? e.touches[0].clientY - rect.top  : (e as React.MouseEvent).clientY - rect.top;

    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // Add strong shadow for contrast against both light and dark slides
    ctx.shadowBlur = 10;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 1)'; // Draw a solid mask
    
    // For visual overlay, mix-blend-mode or opacity handled by canvas CSS
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);

    // Debounce mask save: only write after 800ms of no new strokes
    if (maskSaveTimer.current) clearTimeout(maskSaveTimer.current);
    maskSaveTimer.current = setTimeout(() => {
      if (canvasRef.current && activeSlideId && id) {
        const maskDataUrl = canvasRef.current.toDataURL('image/png');
        uploadImageToStorage(id, activeSlideId, 'maskImage', maskDataUrl)
          .then(maskUrl => updateDoc(doc(db, 'projects', id, 'slides', activeSlideId), { maskImage: maskUrl }))
          .catch(err => console.error('Mask upload failed:', err));
      }
    }, 800);
  };

  const clearCanvas = () => {
    if (canvasRef.current && activeSlideId && id) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
      // Only write to Firestore if the slide actually has a mask saved
      const activeSlide = slides.find(s => s.id === activeSlideId);
      if (activeSlide?.maskImage) {
        updateDoc(doc(db, 'projects', id, 'slides', activeSlideId), { maskImage: null });
      }
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
  // ────────────────────────────────────────────────────────────────────────

  const handleCancelGenerate = () => {
    generateAbortController.current?.abort();
  };

  const handleGenerate = async (skipRefCheck = false) => {
    if (!id) return;
    // In auto-retry mode: only retry the previously-failed slides, skip all other checks
    const isAutoRetry = skipRefCheck && !!autoRetryConfigRef.current;
    if (!isAutoRetry) {
      if (selectedSlides.size === 0) { showAlert('請先選取至少一張投影片。', '提示'); return; }
      if (!skipRefCheck && !globalReference) { showAlert('請先上傳風格參考圖片才能開始生成。', '提示'); return; }
      const hasContent = Array.from(selectedSlides).some(sid => {
        const s = slides.find(sl => sl.id === sid);
        return s?.originalImage || s?.prompt;
      });
      if (!hasContent) { showAlert('請先上傳 PPT、圖片或 Word/TXT 檔案再開始生成。', '提示'); return; }
    }

    const abort = new AbortController();
    generateAbortController.current = abort;
    // Auto-retry: only process the slides that actually failed last time
    const slideIds = isAutoRetry
      ? [...autoRetryConfigRef.current!.toRetrySlides]
      : Array.from(selectedSlides);
    const total = slideIds.length;
    setGenerateProgress({ current: 0, total });
    setIsGenerating(true);
    localStorage.setItem('vertexGenerating', Date.now().toString());

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
          // Local modify: use the captured current image & canvas mask directly
          const capturedBase = localBaseDataRef.current;
          const capturedMask = localMaskDataRef.current;
          const capturedPrompt = localPromptRef.current;
          const capturedAspectRatio = localAspectRatioRef.current;
          localBaseDataRef.current = null;
          localMaskDataRef.current = null;
          localPromptRef.current = '';
          localAspectRatioRef.current = '';
          const isLocalModify = !!capturedMask;
          // Always fetch base as proper data URL (fetchImageAsBase64 handles data: URLs as-is)
          const base64Original = capturedBase
            ? await fetchImageAsBase64(capturedBase)
            : (slide.originalImage ? await fetchImageAsBase64(slide.originalImage) : null);
          const base64Ref = (!isLocalModify && globalReference) ? await fetchImageAsBase64(globalReference) : null;
          // For local modify: scale canvas mask to match base image dimensions & convert to white-on-black
          let base64Mask: string | null = null;
          if (isLocalModify && capturedMask && base64Original) {
            base64Mask = await buildLocalMask(capturedMask, base64Original);
          } else if (!isLocalModify && slide.maskImage) {
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
          const finalAspectRatio = isLocalModify && capturedAspectRatio ? capturedAspectRatio : aspectRatio;
          // Auto-retry every 5 s on 429 for up to 60 s before escalating to modal
          let generatedImg = '';
          {
            const RETRY_INTERVAL = 5_000;
            const RETRY_DEADLINE = Date.now() + 60_000;
            let lastErr: unknown;
            while (true) {
              try {
                generatedImg = await generateImageDesign(
                  base64Original, base64Ref, base64Mask,
                  finalPrompt, apiKey, model, finalAspectRatio, resolution, abort.signal
                );
                break;
              } catch (e: unknown) {
                if ((e as {name?:string})?.name === 'AbortError') throw e;
                lastErr = e;
                const is429 = String((e as {message?:string})?.message ?? e).includes('429');
                if (!is429 || Date.now() >= RETRY_DEADLINE) { throw lastErr; }
                console.warn('[429] 5 秒後自動重試...');
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
          completedCount++;
          setGenerateProgress({ current: completedCount, total });
          return { slideId, genUrl: generatedImg };
        } catch (err: any) {
          if (err?.name === 'AbortError') throw err;
          const msg = err?.message || String(err);
          const is429 = msg.includes('429');
          console.error(`Slide ${slideId} failed:`, msg);
          failedSlides.push({ slideId, error: msg });
          await updateDoc(doc(db, 'projects', id, 'slides', slideId), { status: 'draft' }).catch(() => {});
          completedCount++;
          setGenerateProgress({ current: completedCount, total });
          // Stop all remaining slides on quota exhaustion — quota won't recover mid-run
          if (is429) throw new Error('QUOTA_EXHAUSTED:' + msg);
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
      // Always reset any still-generating slides back to draft
      try {
        const resetBatch = writeBatch(db);
        const stillGenerating = slides.filter(s => s.status === 'generating');
        stillGenerating.forEach(s => resetBatch.update(doc(db, 'projects', id, 'slides', s.id), { status: 'draft' }));
        if (stillGenerating.length > 0) await resetBatch.commit();
      } catch (_) { /* best effort */ }
      setGenerateProgress(null);
      setIsGenerating(false);
      localStorage.removeItem('vertexGenerating');
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

  const startAutoRetry = () => {
    if (!retryModal429) return;
    const intervalSec = Math.max(1, retryIntervalSec);
    const cfg = {
      toRetrySlides: [...retryModal429.toRetrySlides],
      intervalSec, stopCond: retryStopCond,
      maxTimes: retryMaxTimes, untilTime: retryUntilTime, doneCount: 0,
    };
    autoRetryConfigRef.current = cfg;
    console.log(`[AutoRetry] 啟動自動重試：每 ${retryIntervalSec} 秒，待重試投影片 ${cfg.toRetrySlides.length} 張，停止條件：${retryStopCond}`);
    setRetryModal429(null);
    let cd = intervalSec;
    setAutoRetryStatus({ countdown: cd, doneCount: 0 });
    if (autoRetryTimerRef.current) clearInterval(autoRetryTimerRef.current);
    autoRetryTimerRef.current = setInterval(() => {
      cd--;
      if (cd <= 0) {
        clearInterval(autoRetryTimerRef.current!); autoRetryTimerRef.current = null;
        console.log(`[AutoRetry] 倒數結束，開始第 ${(autoRetryConfigRef.current?.doneCount ?? 0) + 1} 次重試...`);
        setAutoRetryStatus(prev => prev ? { ...prev, countdown: -1 } : null);
        autoRetryIsWaiting.current = true;
        setTimeout(() => handleGenerateRef.current(true), 50);
      } else {
        if (cd % 30 === 0 || cd <= 10) console.log(`[AutoRetry] 倒數 ${cd} 秒後重試...`);
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

  const fmtCountdown = (sec: number) => {
    if (sec < 0) return '生成中...';
    const m = Math.floor(sec / 60), s = sec % 60;
    return m > 0 ? `${m} 分 ${String(s).padStart(2,'0')} 秒` : `${s} 秒`;
  };

  return (
    <div style={{ height: 'calc(100vh - 4rem)', display: 'flex', flexDirection: 'column' }}>
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
                <p style={sl}>進階設定</p>
                <div style={{ ...bx, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.3rem 1rem', fontSize: '0.82rem' }}>
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
          <button onClick={() => { localStorage.removeItem('vertexGenerating'); setPrevSessionWarning(null); }}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#b45309', fontWeight: 600, whiteSpace: 'nowrap' }}>
            忽略
          </button>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', padding: '0 0.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {previewOpen ? (
            <button onClick={() => setPreviewOpen(false)} style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: '0.3rem', cursor: 'pointer', padding: '0.25rem 0.55rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.72rem' }}>
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
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          {!previewOpen && (
            <button onClick={() => { if (selectedSlides.size === slides.length) setSelectedSlides(new Set()); else setSelectedSlides(new Set(slides.map(s => s.id))); }}
              style={{ padding: '0.3rem 0.6rem', fontSize: '0.72rem', fontWeight: 500, border: '1px solid var(--border-color)', borderRadius: '0.3rem', cursor: 'pointer', background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>
              {selectedSlides.size === slides.length ? '取消全選' : '全選所有頁面'}
            </button>
          )}
          {!previewOpen && (
            <button onClick={() => setPreviewOpen(true)}
              style={{ padding: '0.3rem 0.6rem', fontSize: '0.72rem', fontWeight: 500, border: '1px solid var(--border-color)', borderRadius: '0.3rem', cursor: 'pointer', background: 'var(--bg-primary)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
              <Eye size={12} /> 預覽
            </button>
          )}
          {pendingImages.size > 0 && (() => {
            const unbackedCount = pendingImages.size - backedUpIds.size;
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
        </div>
      </div>

      {/* Main Workspace */}
      <div style={{ flex: 1, display: 'flex', gap: '0.75rem', minHeight: 0 }}>

        {/* ===== MODE A: Grid + Right Sidebar ===== */}
        {!previewOpen && (
          <div style={{ flex: 1, display: 'flex', gap: '0.75rem', minHeight: 0 }}>
          {/* Slide Grid */}
          <div ref={gridRef} onMouseDown={handleGridMouseDown} style={{ flex: 1, overflowY: 'auto', padding: '0.25rem', userSelect: 'none' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
              {slides.map((slide, index) => (
                <div key={slide.id}
                  data-slide-card
                  ref={(el) => { if (el) slideCardRefs.current.set(slide.id, el); else slideCardRefs.current.delete(slide.id); }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => handleSlideClick(e, slide.id, index)}
                  draggable
                  onDragStart={(e) => handleDragStart(e, slide.id)}
                  onDragOver={(e) => handleDragOver(e, slide.id)}
                  onDrop={(e) => handleDrop(e, slide.id)}
                  onDragEnd={handleDragEnd}
                  style={{ backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', border: `2px solid ${dragOverId === slide.id ? '#f59e0b' : activeSlideId === slide.id ? 'var(--accent-color)' : selectedSlides.has(slide.id) ? 'var(--accent-color)' : 'var(--border-color)'}`, cursor: 'grab', overflow: 'hidden', transition: 'border-color 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease', boxShadow: dragOverId === slide.id ? '0 0 0 2px #f59e0b' : activeSlideId === slide.id ? '0 0 0 1px var(--accent-color)' : 'var(--shadow-sm)', opacity: draggingId === slide.id ? 0.4 : 1 }}>
                  <div style={{ aspectRatio: '16/9', backgroundColor: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    {(pendingImages.get(slide.id) || slide.generatedImage || slide.originalImage) ? (
                      <img src={pendingImages.get(slide.id) || slide.generatedImage || slide.originalImage!} alt={`Slide ${index + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
                  <><Plus size={13} /> 上傳 PPT</>
                )}
                <input type="file" accept=".pptx" style={{ display: 'none' }} disabled={parsingProgress !== null || savingProgress !== null} onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file || !id) return;
                  let exactTotalSlides = 1;
                  try { const zip = new JSZip(); const content = await zip.loadAsync(file); const sf = Object.keys(content.files).filter(n => n.startsWith('ppt/slides/slide') && n.endsWith('.xml')); if (sf.length > 0) exactTotalSlides = sf.length; } catch(err) { console.warn("slide count fail"); }
                  setParsingProgress({ current: 0, total: exactTotalSlides });
                  const progressInterval = setInterval(() => { setParsingProgress(prev => { if (!prev) return prev; const next = prev.current + 1; return { ...prev, current: next >= prev.total ? prev.total - 1 : next }; }); }, 2000);
                  try {
                    const formData = new FormData(); formData.append("file", file);
                    const backendUrl = localStorage.getItem("backendUrl") || import.meta.env.VITE_BACKEND_URL || '';
                    const res = await fetch(`${backendUrl}/upload-ppt/`, { method: "POST", body: formData });
                    if (!res.ok) throw new Error("Failed to parse PPT.");
                    const data = await res.json(); const base64images = data.slides as string[]; const totalSlidesReturned = base64images.length;
                    if (totalSlidesReturned === 0) { showAlert('找不到投影片，請確認 PPT 檔案格式正確。', '錯誤'); clearInterval(progressInterval); setParsingProgress(null); return; }
                    clearInterval(progressInterval); setParsingProgress({ current: totalSlidesReturned, total: totalSlidesReturned });
                    await new Promise(r => setTimeout(r, 600)); setParsingProgress(null);
                    setSavingProgress({ current: 0, total: totalSlidesReturned });
                    const newSlideIds: string[] = []; const baseTimestamp = Date.now();
                    setSavingProgress({ current: 0, total: totalSlidesReturned });
                    const allUploadResults: {newId:string,imageUrl:string,hqUrl:string|null,idx:number}[] = [];
                    const UPLOAD_CONCURRENCY = 4;
                    for (let ci = 0; ci < base64images.length; ci += UPLOAD_CONCURRENCY) {
                      const chunk = base64images.slice(ci, ci + UPLOAD_CONCURRENCY);
                      const chunkRes = await Promise.all(chunk.map(async (imgData, j) => { const idx = ci + j; const newId = baseTimestamp.toString() + '_' + idx; newSlideIds.push(newId); const [imageUrl, hqUrl] = await Promise.all([uploadImageToStorage(id as string, newId, 'originalImage', imgData), uploadHQToStorage(id as string, newId, 'originalImage', imgData)]); return { newId, imageUrl, hqUrl, idx }; }));
                      allUploadResults.push(...chunkRes);
                      setSavingProgress({ current: Math.min(ci + UPLOAD_CONCURRENCY, totalSlidesReturned), total: totalSlidesReturned });
                    }
                    const fb = writeBatch(db);
                    allUploadResults.forEach(({ newId, imageUrl, hqUrl, idx }) => { fb.set(doc(db, 'projects', id as string, 'slides', newId), { originalImage: imageUrl, originalImageHQ: hqUrl || null, generatedImage: null, generatedImageHQ: null, maskImage: null, prompt: defaultPrompt, status: 'draft', createdAt: baseTimestamp + idx, order: (baseTimestamp + idx) * 1000 }); });
                    await fb.commit();
                    setSelectedSlides(new Set(newSlideIds)); setActiveSlideId(newSlideIds[0]);
                  } catch (err) { console.error(err); showAlert('儲存 PPT 時發生錯誤。', '錯誤'); }
                  finally { clearInterval(progressInterval); setParsingProgress(null); setSavingProgress(null); e.target.value = ''; }
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
                    <button onClick={() => setShowShareModal(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--accent-color)', display: 'flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.7rem' }} title="分享模板到社群"><Share2 size={11}/> 分享</button>
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
                placeholder="額外指令（選填）"
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
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>進階設定</span>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-secondary)' }}>比例</span>
                      <select style={selectS} value={aspectRatio} onChange={e => setAspectRatio(e.target.value)}>
                        <option value="16:9">16:9</option><option value="9:16">9:16</option><option value="1:1">1:1</option><option value="4:3">4:3</option><option value="3:4">3:4</option><option value="3:2">3:2</option>
                      </select>
                    </div>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-secondary)' }}>解析度</span>
                      <select style={selectS} value={resolution} onChange={e => setResolution(e.target.value)}>
                        <option value="1K">1K</option><option value="2K">2K</option><option value="4K">4K</option>
                      </select>
                    </div>
                  </div>
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
              );
            })()}

            {/* 5. 開始生成 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: 'auto' }}>
              <div style={{ position: 'relative' }} title={!globalReference ? '請先上傳風格參考圖' : ''}>
                <button onClick={() => setShowGenerateConfirmModal(true)} disabled={isGenerating || !globalReference || !!autoRetryStatus}
                  style={{ width: '100%', padding: '0.5rem', fontSize: '0.8rem', fontWeight: 700, border: 'none', borderRadius: '0.3rem', cursor: (!globalReference || !!autoRetryStatus) ? 'not-allowed' : 'pointer', background: 'var(--accent-color)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem', opacity: (!globalReference || !!autoRetryStatus) ? 0.5 : 1 }}>
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
          <div style={{ width: '280px', display: 'flex', flexDirection: 'column', gap: '1.5rem', overflowY: 'auto', flexShrink: 0 }}>
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
                            <option value="1:1">1:1</option>
                            <option value="4:3">4:3</option>
                            <option value="3:4">3:4</option>
                            <option value="3:2">3:2</option>
                          </select>
                        </div>
                        <div style={rowStyle}>
                          <label style={labelStyle}>解析度</label>
                          <select style={selectStyle} value={resolution} onChange={e => setResolution(e.target.value)}>
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', overflowY: 'auto', flex: 1 }}>
                {slides.map((slide, index) => (
                  <div key={slide.id} onClick={() => setActiveSlideId(slide.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem', borderRadius: 'var(--radius-md)', cursor: 'pointer', backgroundColor: activeSlideId === slide.id ? 'var(--bg-secondary)' : 'transparent', border: `1px solid ${activeSlideId === slide.id ? 'var(--border-color)' : 'transparent'}` }}>
                    <div onClick={(e) => toggleSlideSelection(slide.id, e)} style={{ cursor: 'pointer', color: selectedSlides.has(slide.id) ? 'var(--accent-color)' : 'var(--border-color)' }}>
                      <CheckSquare size={18} fill={selectedSlides.has(slide.id) ? 'var(--accent-color)' : 'transparent'} color={selectedSlides.has(slide.id) ? 'white' : 'currentColor'} />
                    </div>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', width: '20px' }}>{index + 1}</span>
                    <div style={{ flex: 1, aspectRatio: '16/9', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {(pendingImages.get(slide.id) || slide.generatedImage || slide.originalImage) ? (<img loading="lazy" src={pendingImages.get(slide.id) || slide.generatedImage || slide.originalImage!} alt="Slide" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />) : slide.prompt ? (<div style={{ padding: '0.3rem', width: '100%', height: '100%', overflow: 'hidden', backgroundColor: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', gap: '2px' }}><FileText size={9} style={{ color: 'var(--accent-color)', flexShrink: 0 }} /><span style={{ fontSize: '0.5rem', color: 'var(--text-secondary)', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical' }}>{slide.prompt}</span></div>) : (<span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Empty</span>)}
                    </div>
                    <Button variant="ghost" size="sm" onClick={(e) => deleteSlide(e, slide.id)} style={{ padding: '0.25rem', color: 'var(--text-secondary)' }}><Trash2 size={14} /></Button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Canvas Area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
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
                  <img ref={imgRef} src={(activeSlideId ? pendingImages.get(activeSlideId) : undefined) || activeSlide?.generatedImage || activeSlide?.originalImage || ''} alt="Editor Canvas" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: activeSlide?.status === 'generating' ? 0.5 : 1, transition: 'opacity 0.3s' }} />
                  <canvas ref={canvasRef} onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseLeave={stopDrawing} onTouchStart={startDrawing} onTouchMove={draw} onTouchEnd={stopDrawing} style={{ position: 'absolute', top: imgRef.current ? imgRef.current.offsetTop : 0, left: imgRef.current ? imgRef.current.offsetLeft : 0, width: imgRef.current ? imgRef.current.offsetWidth : '100%', height: imgRef.current ? imgRef.current.offsetHeight : '100%', pointerEvents: isDrawingMode ? 'auto' : 'none', cursor: isDrawingMode ? 'crosshair' : 'default', opacity: 0.6, mixBlendMode: 'normal', zIndex: 10 }} />
                  {activeSlide?.status === 'generating' && (
                    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'var(--bg-primary)', padding: '1rem 2rem', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)', fontWeight: 500, zIndex: 20 }}>
                      <Sparkles size={16} style={{ display: 'inline', marginRight: '0.5rem', animation: 'spin 2s linear infinite' }} /> Generating with Gemini...
                    </div>
                  )}
                  {/* Prev/Next slide nav buttons */}
                  {(() => { const idx = slides.findIndex(s => s.id === activeSlideId); const hasPrev = idx > 0; const hasNext = idx < slides.length - 1; const navBtn = (enabled: boolean): React.CSSProperties => ({ position: 'absolute', top: '50%', transform: 'translateY(-50%)', zIndex: 15, background: enabled ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.15)', border: 'none', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: enabled ? 'pointer' : 'default', color: 'white', transition: 'background 0.2s' }); return (<><button style={{ ...navBtn(hasPrev), left: '10px' }} disabled={!hasPrev} onClick={() => { if (hasPrev) { const prevId = slides[idx-1].id; setActiveSlideId(prevId); setSelectedSlides(new Set([prevId])); } }}><ChevronLeft size={20} /></button><button style={{ ...navBtn(hasNext), right: '10px' }} disabled={!hasNext} onClick={() => { if (hasNext) { const nextId = slides[idx+1].id; setActiveSlideId(nextId); setSelectedSlides(new Set([nextId])); } }}><ChevronRight size={20} /></button></>); })()}
                </>
              )}
            </div>
            {(activeSlide?.status === 'draft' || activeSlide?.status === 'done') && !(!activeSlide.originalImage && !activeSlide.generatedImage && !pendingImages.get(activeSlideId)) && (
              <div style={{ backgroundColor: 'var(--bg-primary)', display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem 1.25rem', borderRadius: 'var(--radius-xl)', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-md)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
                  <button onClick={() => { setIsDrawingMode(!isDrawingMode); if (isDrawingMode) clearCanvas(); }} style={{ padding: '0.6rem 1rem', fontSize: '0.85rem', fontWeight: 600, border: isDrawingMode ? 'none' : '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', cursor: 'pointer', background: isDrawingMode ? 'var(--accent-color)' : 'var(--bg-secondary)', color: isDrawingMode ? '#fff' : 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap', transition: 'all 0.2s ease', boxShadow: isDrawingMode ? 'var(--shadow-md)' : 'none' }}>
                    {isDrawingMode ? <X size={15} /> : <Circle size={15} />}
                    {isDrawingMode ? '清除並關閉' : '局部重繪'}
                  </button>
                  {isDrawingMode && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: '0.5rem', padding: '0 0.75rem', borderLeft: '1px solid var(--border-color)' }}>
                      <Circle size={12} style={{ color: 'var(--text-secondary)' }} />
                      <input type="range" min="5" max="100" value={brushSize} onChange={(e) => setBrushSize(parseInt(e.target.value))} style={{ width: '80px', accentColor: 'var(--accent-color)', cursor: 'pointer' }} />
                      <Circle size={20} style={{ color: 'var(--text-secondary)' }} />
                    </div>
                  )}
                  {(() => {
                    const hist = activeSlideId ? imageHistories.get(activeSlideId) : undefined;
                    const canUndo = !!hist && hist.pos > 0;
                    const canRedo = !!hist && hist.pos < hist.stack.length - 1;
                    if (!hist || hist.stack.length === 0) return null;
                    const btnStyle = (enabled: boolean): React.CSSProperties => ({
                      background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
                      padding: '0.5rem 0.75rem', cursor: enabled ? 'pointer' : 'not-allowed',
                      opacity: enabled ? 1 : 0.5, color: 'var(--text-secondary)',
                      display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem', fontWeight: 600, transition: 'all 0.2s ease'
                    });
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginLeft: '0.5rem', paddingLeft: '1rem', borderLeft: '1px solid var(--border-color)' }}>
                        <button style={btnStyle(canUndo)} disabled={!canUndo} title="上一步" onClick={() => handleUndo(activeSlideId)}
                          onMouseEnter={e => { if(canUndo) { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; } }} onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'; }}>
                          <ChevronLeft size={14} strokeWidth={2.5} /> 上一步
                        </button>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', minWidth: '32px', textAlign: 'center', fontWeight: 600 }}>
                          {hist.pos + 1}/{hist.stack.length}
                        </span>
                        <button style={btnStyle(canRedo)} disabled={!canRedo} title="下一步（最新版）" onClick={() => handleRedo(activeSlideId)}
                          onMouseEnter={e => { if(canRedo) { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; } }} onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'; }}>
                          下一步 <ChevronRight size={14} strokeWidth={2.5} />
                        </button>
                        <button style={{ ...btnStyle(true), marginLeft: '0.4rem', borderColor: 'var(--border-color)', color: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.05)' }} title="還原原始圖片" onClick={() => handleRevertToOriginal(activeSlideId)}
                          onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'; }} onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.05)'; }}>
                          <RotateCcw size={14} strokeWidth={2.5} /> 原圖
                        </button>
                      </div>
                    );
                  })()}
                </div>
                <input
                  placeholder="你想修改什麼內容？ (例如：背景換成藍色)"
                  value={promptDraft}
                  onChange={(e) => setPromptDraft(e.target.value)}
                  onCompositionStart={() => { isComposing.current = true; }}
                  onCompositionEnd={(e) => { isComposing.current = false; if (activeSlide?.originalImage) setPrompt((e.target as HTMLInputElement).value); }}
                  onBlur={(e) => { if (!isComposing.current && activeSlide?.originalImage) setPrompt(e.target.value); e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !isGenerating) { e.preventDefault(); if (activeSlideId) { localMaskDataRef.current = canvasRef.current ? canvasRef.current.toDataURL('image/png') : null; localBaseDataRef.current = pendingImages.get(activeSlideId) || activeSlide?.generatedImage || activeSlide?.originalImage || null; localPromptRef.current = promptDraft; localAspectRatioRef.current = imgRef.current ? getAspectRatioString(imgRef.current.naturalWidth, imgRef.current.naturalHeight) : ''; setSelectedSlides(new Set([activeSlideId])); setTimeout(() => handleGenerate(true), 0); } } }}
                  style={{ flex: 1, width: 0, minWidth: 0, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', outline: 'none', fontSize: '0.9rem', color: 'var(--text-primary)', padding: '0.8rem 1.2rem', transition: 'border-color 0.2s', boxShadow: 'var(--shadow-inner)' }}
                  onFocus={e => e.currentTarget.style.borderColor = 'var(--accent-color)'}
                />
                <button
                  onClick={() => { if (activeSlideId) { localMaskDataRef.current = canvasRef.current ? canvasRef.current.toDataURL('image/png') : null; localBaseDataRef.current = pendingImages.get(activeSlideId) || activeSlide?.generatedImage || activeSlide?.originalImage || null; localPromptRef.current = promptDraft; localAspectRatioRef.current = imgRef.current ? getAspectRatioString(imgRef.current.naturalWidth, imgRef.current.naturalHeight) : ''; setSelectedSlides(new Set([activeSlideId])); setTimeout(() => handleGenerate(true), 0); } }}
                  disabled={isGenerating}
                  style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.8rem 1.5rem', backgroundColor: isGenerating ? 'var(--bg-tertiary)' : 'var(--accent-color)', color: isGenerating ? 'var(--text-secondary)' : 'white', border: 'none', borderRadius: 'var(--radius-lg)', cursor: isGenerating ? 'not-allowed' : 'pointer', fontSize: '0.95rem', fontWeight: 600, whiteSpace: 'nowrap', transition: 'all 0.2s ease', boxShadow: isGenerating ? 'none' : 'var(--shadow-md)' }}
                  onMouseEnter={e => { if(!isGenerating) e.currentTarget.style.transform = 'translateY(-2px)'; }}
                  onMouseLeave={e => { if(!isGenerating) e.currentTarget.style.transform = 'none'; }}
                >
                  <Sparkles size={16} style={{ animation: isGenerating ? 'spin 2s linear infinite' : 'none' }} strokeWidth={2.5} />
                  {isGenerating ? '生成中...' : '開始生成'}
                </button>
              </div>
            )}
          </div>
        </>)}
      </div>

      {/* Share Template Modal */}
      {showShareModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 10100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
          onClick={() => { if (!isSharing) setShowShareModal(false); }}>
          <div style={{ backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-float)', padding: '2rem', width: '560px', maxWidth: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', gap: '1.25rem', overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-color)' }}><Share2 size={18} strokeWidth={2.5} /> 分享模板到社群</h3>
              <button onClick={() => setShowShareModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}><X size={18} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>模板名稱</label>
              <input value={shareLabel} onChange={e => setShareLabel(e.target.value)} placeholder="例：極簡商務風、科技藍白風格"
                style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', fontSize: '0.88rem', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', outline: 'none' }} />
            </div>

            {globalReference && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>風格參考圖</label>
                <img src={globalReference} alt="Reference" style={{ width: '120px', maxHeight: '160px', objectFit: 'cover', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>進階設定</label>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', flexWrap: 'wrap', gap: '0.3rem 0.8rem' }}>
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '0.5rem', maxHeight: '220px', overflowY: 'auto', borderRadius: '6px' }}>
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

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', paddingTop: '0.25rem' }}>
              <Button variant="secondary" onClick={() => setShowShareModal(false)} disabled={isSharing}>取消</Button>
              <Button onClick={handleShareTemplate} icon={Share2} disabled={isSharing || !shareLabel.trim()}
                style={{ backgroundColor: 'var(--accent-color)', color: '#fff' }}>
                {isSharing ? '分享中...' : '分享到社群'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 429 Error Modal with auto-retry config */}
      {retryModal429 && !autoRetryStatus && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 10100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
          onClick={() => setRetryModal429(null)}>
          <div style={{ backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', boxShadow: '0 16px 48px rgba(0,0,0,0.3)', padding: '1.75rem', width: '440px', maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}
            onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
              <span style={{ fontSize: '1.4rem', lineHeight: 1, flexShrink: 0 }}>⚠️</span>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#ef4444' }}>429 錯誤：API 使用量過高</h3>
              </div>
              <button onClick={() => setRetryModal429(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '2px', flexShrink: 0 }}><X size={18}/></button>
            </div>
            {/* Error info */}
            <div style={{ paddingLeft: '2rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                目前重試 3 次失敗，因為目前 Gemini API 使用者過多，請等待 5–10 分鐘再嘗試。
              </p>
              <div style={{ background: 'var(--bg-secondary)', borderRadius: '0.5rem', padding: '0.5rem 0.75rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                成功：{retryModal429.successCount} 張　／　待重試：{retryModal429.toRetrySlides.length} 張
              </div>
            </div>
            {/* Auto-retry config */}
            <div style={{ paddingLeft: '2rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>自動重試設定</span>
              {/* Interval */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
                <span style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>每</span>
                <input type="number" min={5} max={3600} value={retryIntervalSec}
                  onChange={e => setRetryIntervalSec(Math.max(5, Math.min(3600, Number(e.target.value) || 5)))}
                  style={{ width: '64px', textAlign: 'center', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0.3rem', fontSize: '0.875rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', outline: 'none' }} />
                <span style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>秒自動重試一次</span>
              </div>
              {/* Stop condition */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.875rem' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>停止條件：</span>
                {/* Success */}
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input type="radio" name="retryStop" checked={retryStopCond === 'success'} onChange={() => setRetryStopCond('success')} />
                  <span>成功為止</span>
                </label>
                {/* Max retries */}
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input type="radio" name="retryStop" checked={retryStopCond === 'retries'} onChange={() => setRetryStopCond('retries')} />
                  <span>最多重試</span>
                  <input type="number" min={1} max={20} value={retryMaxTimes}
                    onChange={e => setRetryMaxTimes(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                    onClick={() => setRetryStopCond('retries')}
                    style={{ width: '48px', textAlign: 'center', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0.2rem', fontSize: '0.875rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', outline: 'none' }} />
                  <span>次</span>
                </label>
                {/* Until time */}
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input type="radio" name="retryStop" checked={retryStopCond === 'time'} onChange={() => setRetryStopCond('time')} />
                  <span>直到</span>
                  <input type="time" value={retryUntilTime}
                    onChange={e => setRetryUntilTime(e.target.value)}
                    onClick={() => setRetryStopCond('time')}
                    style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0.2rem 0.4rem', fontSize: '0.875rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', outline: 'none' }} />
                </label>
              </div>
            </div>
            {/* Buttons */}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setRetryModal429(null)}
                style={{ padding: '0.5rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', background: 'none', cursor: 'pointer', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                確定
              </button>
              <button onClick={startAutoRetry}
                style={{ padding: '0.5rem 1.25rem', borderRadius: 'var(--radius-md)', border: 'none', backgroundColor: 'var(--accent-color)', color: '#fff', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                ▶ 開始自動重試
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auto-retry floating status widget */}
      {autoRetryStatus && (
        <div style={{ position: 'fixed', bottom: '1.5rem', left: '1.5rem', zIndex: 10200, backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', boxShadow: '0 8px 24px rgba(0,0,0,0.2)', padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: '220px', fontSize: '0.85rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
            <span style={{ fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: autoRetryStatus.countdown < 0 ? '#f59e0b' : '#3b82f6', animation: autoRetryStatus.countdown < 0 ? 'pulse 1s infinite' : 'none' }} />
              自動重試中
            </span>
            <button onClick={stopAutoRetry} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '2px', display: 'flex', alignItems: 'center' }} title="停止自動重試"><X size={14}/></button>
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
            {autoRetryStatus.countdown < 0 ? '正在生成...' : `${fmtCountdown(autoRetryStatus.countdown)} 後重試`}
          </div>
          {autoRetryStatus.doneCount > 0 && (
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>已重試 {autoRetryStatus.doneCount} 次</div>
          )}
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
          <div style={{ backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', padding: '1.75rem', width: '360px', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>新增頁面</h3>
              <button onClick={() => setShowAddSlideModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', padding: '2px' }}><X size={18}/></button>
            </div>

            {/* Type selector */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>頁面類型</span>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                {([['image', '🖼️', '圖片投影片', '上傳或生成圖片'], ['text', '📝', '文字頁', '純文字編輯頁']] as const).map(([type, emoji, label, desc]) => (
                  <button key={type} onClick={() => setAddSlideType(type)}
                    style={{ flex: 1, padding: '0.75rem', borderRadius: 'var(--radius-md)', border: `2px solid ${addSlideType === type ? 'var(--accent-color)' : 'var(--border-color)'}`, background: addSlideType === type ? 'rgba(var(--accent-rgb,99,102,241),0.07)' : 'var(--bg-secondary)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem', transition: 'border-color 0.15s' }}>
                    <span style={{ fontSize: '1.5rem' }}>{emoji}</span>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: addSlideType === type ? 'var(--accent-color)' : 'var(--text-primary)' }}>{label}</span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Count input */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>新增頁數</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <button onClick={() => setAddSlideCount(c => Math.max(1, c - 1))}
                  style={{ width: '32px', height: '32px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', cursor: 'pointer', fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)' }}>−</button>
                <input type="number" min={1} max={20} value={addSlideCount}
                  onChange={e => setAddSlideCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                  style={{ width: '56px', textAlign: 'center', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0.3rem', fontSize: '0.95rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', outline: 'none' }} />
                <button onClick={() => setAddSlideCount(c => Math.min(20, c + 1))}
                  style={{ width: '32px', height: '32px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', cursor: 'pointer', fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)' }}>+</button>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>頁（最多 20）</span>
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowAddSlideModal(false)}
                style={{ padding: '0.5rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', background: 'none', cursor: 'pointer', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                取消
              </button>
              <button onClick={async () => { setShowAddSlideModal(false); await addSlide(addSlideType, addSlideCount); }}
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

import React, { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { ArrowLeft, Download, Image as ImageIcon, Plus, Trash2, X, Circle, Sparkles, CheckSquare, Eye, EyeOff, RotateCcw, ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import pptxgen from 'pptxgenjs';
import JSZip from 'jszip';
import { collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, writeBatch, query, orderBy, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { uploadImageToStorage, uploadHQToStorage, fetchImageAsBase64, compressImage, uploadToDrive } from '../utils/storageHelper';

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

  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [resolution, setResolution] = useState('1K');
  const [selectedSlides, setSelectedSlides] = useState<Set<string>>(new Set(['1']));

  const [slides, setSlides] = useState<Slide[]>([]);
  const [activeSlideId, setActiveSlideId] = useState<string>('');
  const [globalReference, setGlobalReference] = useState<string | null>(null);

  const defaultPrompt = `幫我重新繪製這張投影片(直接畫，用nano banana)，使用極簡風格設計，可以適當加一些相關內容的簡單插圖(插畫風格與背景一致)，使用noto sans系列字體，黑色(主體)、金黃色(重點字)字體，適當排版，比例${aspectRatio}(橫向)${globalReference ? '，請參考提供的風格圖' : ''}`;
  
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
  const [isGenerating, setIsGenerating] = useState(false);
  const [showExitModal, setShowExitModal] = useState(false);
  const [prevSessionWarning, setPrevSessionWarning] = useState<number | null>(null);
  const [showTextUploadModal, setShowTextUploadModal] = useState(false);
  const [imageHistories, setImageHistories] = useState<Map<string, { stack: string[]; pos: number }>>(new Map());
  const imageHistoriesRef = useRef<Map<string, { stack: string[]; pos: number }>>(new Map());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [globalExtraPrompt, setGlobalExtraPrompt] = useState('');
  const [textHistories, setTextHistories] = useState<Map<string, { stack: string[]; pos: number }>>(new Map());
  const [textSaving, setTextSaving] = useState(false);
  const textSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Prompt local draft state to avoid IME composition feedback loop
  const [promptDraft, setPromptDraft] = useState('');
  const isComposing = useRef(false);

  // Preview panel state
  const [previewOpen, setPreviewOpen] = useState(false);

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

  React.useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (user) => {
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
        setUserId(null);
        navigate('/');
      }
    });
    return () => unsubAuth();
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

  React.useEffect(() => {
    setPromptDraft(activeSlide?.prompt || '');
    // Clear canvas when switching slides to prevent mask bleed-over
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  }, [activeSlideId]);  // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'slide' | 'reference') => {
    const file = e.target.files?.[0];
    if (!file || !id) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64Data = event.target?.result as string;
      try {
        if (type === 'reference') {
          // Compress and store reference only in React state — no Firestore write
          const refUrl = await uploadImageToStorage(id, '_shared', 'referenceStyle', base64Data);
          setGlobalReference(refUrl);
        } else {
           if (activeSlideId) {
              const imgUrl = await uploadImageToStorage(id, activeSlideId, 'originalImage', base64Data);
              await updateDoc(doc(db, 'projects', id, 'slides', activeSlideId), { originalImage: imgUrl, maskImage: null, status: 'draft' });
           }
        }
      } catch (err) {
        console.error('Upload failed:', err);
        alert('Failed to upload image.');
      }
    };
    reader.readAsDataURL(file);
  };

  const addSlide = async () => {
    if (!id) return;
    const newId = Math.random().toString(36).substr(2, 9);
    const maxOrder = slides.reduce((m, s) => Math.max(m, s.order ?? 0), 0);
    await setDoc(doc(db, 'projects', id, 'slides', newId), {
       originalImage: null, generatedImage: null, maskImage: null, prompt: '', status: 'empty', createdAt: Date.now(), order: maxOrder + 1000
    });
    setActiveSlideId(newId);
    setSelectedSlides(prev => new Set(prev).add(newId));
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
      alert('刪除失敗，請稍後再試。');
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
    if (!id || unbacked.length === 0 || isBackingUp) return;
    setIsBackingUp(true);
    try {
      const newlyBacked = new Set<string>();
      for (let i = 0; i < unbacked.length; i += 2) {
        const chunk = unbacked.slice(i, i + 2);
        const uploaded = await Promise.all(chunk.map(async ([slideId, base64img]) => {
          // Use higher quality compression for Firestore backup (2048px / 0.92)
          const genUrl = await compressImage(base64img, 1200, 0.7);
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
    } catch (err) {
      console.error('Backup failed:', err);
      alert('Backup failed. Please try again.');
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
    const initStack: string[] = slide?.originalImage ? [slide.originalImage] : [];
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
      newStack.map(s => s.startsWith('data:') ? compressImage(s, 600, 0.6) : Promise.resolve(s))
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
        alert('找不到頁面標記，請確保文件中有「第一頁」、「第二頁」等標示。');
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
      alert('解析文件時發生錯誤，請確認檔案格式正確。');
    } finally {
      setSavingProgress(null);
    }
  };
  // ────────────────────────────────────────────────────────────────────────

  const handleCancelGenerate = () => {
    generateAbortController.current?.abort();
  };

  const handleGenerate = async () => {
    if (selectedSlides.size === 0 || !id) return alert('Please select at least one slide to modify.');
    if (!globalReference) return alert('請先上傳風格參考圖片才能開始生成。');
    const hasContent = Array.from(selectedSlides).some(sid => {
      const s = slides.find(sl => sl.id === sid);
      return s?.originalImage || s?.prompt;
    });
    if (!hasContent) return alert('Please upload a PPT, image, or Word/TXT file first before generating.');
    
    const abort = new AbortController();
    generateAbortController.current = abort;
    const total = selectedSlides.size;
    setGenerateProgress({ current: 0, total });
    setIsGenerating(true);
    localStorage.setItem('vertexGenerating', Date.now().toString());

    try {
      // Set initiating state using batch
      const initialBatch = writeBatch(db);
      selectedSlides.forEach(slideId => {
         initialBatch.update(doc(db, 'projects', id, 'slides', slideId), { status: 'generating' });
      });
      await initialBatch.commit();
      const apiKey = localStorage.getItem('vertexApiKey') || import.meta.env.VITE_VERTEX_API_KEY || '';
      const model = localStorage.getItem('vertexModel') || localStorage.getItem('geminiModel') || "gemini-3-pro-image-preview";
      
      const { generateImageDesign } = await import('../utils/gemini');
      let completedCount = 0;

      const results: ({ slideId: string; genUrl: string } | null)[] = [];
      const slideIds = Array.from(selectedSlides);
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
          const base64Original = slide.originalImage ? await fetchImageAsBase64(slide.originalImage) : null;
          const base64Ref = globalReference ? await fetchImageAsBase64(globalReference) : null;
          const base64Mask = slide.maskImage ? await fetchImageAsBase64(slide.maskImage) : null;
          const generatedImg = await generateImageDesign(
            base64Original, base64Ref, base64Mask,
            slide.prompt + (globalExtraPrompt.trim() ? '\n' + globalExtraPrompt.trim() : ''), apiKey, model, aspectRatio, resolution, abort.signal
          );
          setPendingImages(prev => new Map(prev).set(slideId, generatedImg));
          pushToHistory(slideId, generatedImg);
          await updateDoc(doc(db, 'projects', id, 'slides', slideId), { status: 'done' });
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
          const result = await processSlide(slideIds[i]);
          results.push(result);
          if (i < slideIds.length - 1) {
            await new Promise(resolve => setTimeout(resolve, INTER_REQUEST_DELAY_MS));
          }
        }
      } catch (loopErr: any) {
        if ((loopErr as any)?.name === 'AbortError') {
          // User cancelled — silent exit
        } else if (String(loopErr).includes('QUOTA_EXHAUSTED')) {
          const successCount = results.filter(Boolean).length;
          alert(
            `⚠️ API quota 已耗盡 (429 Resource Exhausted)\n\n` +
            `成功：${successCount} 張 / 失敗：${failedSlides.length} 張\n\n` +
            `解決方案：\n` +
            `1. 明天 quota 重置後再試\n` +
            `2. 在 Settings 換一組新的 Vertex AI API Key\n` +
            `3. 在 Google Cloud Console 確認剩餘額度`
          );
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
      alert('Failed to generate design.');
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

  const handleSaveToLocal = async () => {
    const exportedSlides = slides.filter(s => pendingImages.get(s.id) || s.generatedImage || s.originalImage);
    if (exportedSlides.length === 0) return alert('No slides to save.');

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
        alert(`✓ Saved ${exportedSlides.length} slides to folder.`);
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

  const handleExport = async () => {
    const exportedSlides = slides.filter(s => s.originalImage || s.generatedImage);
    if (exportedSlides.length === 0) return alert('No slides to export.');

    const pres = new pptxgen();
    
    // Map custom aspect ratios
    if (aspectRatio === '16:9') pres.layout = 'LAYOUT_16x9';
    else if (aspectRatio === '4:3') pres.layout = 'LAYOUT_4x3';
    else {
      // Define custom Layouts. Coordinates are typically in inches for pptxgenjs.
      let w = 10, h = 5.625; // default 16:9
      if (aspectRatio === '5:3') { w = 10; h = 6; }
      else if (aspectRatio === '3:2') { w = 10; h = 6.666; }
      else if (aspectRatio === '1:1') { w = 10; h = 10; }
      
      pres.defineLayout({ name: `CUSTOM_${aspectRatio}`, width: w, height: h });
      pres.layout = `CUSTOM_${aspectRatio}`;
    }

    // Fetch all images from URLs → base64 for PPTX embedding (prefer HQ)
    for (const slide of exportedSlides) {
      // HQ priority: Drive (original) → pendingImages (session) → Firestore compressed → original
      const imgUrl = slide.generatedImageDriveUrl || pendingImages.get(slide.id) || slide.generatedImage || slide.originalImage;
      if (imgUrl) {
        const base64Data = await fetchImageAsBase64(imgUrl);
        const pptSlide = pres.addSlide();
        pptSlide.addImage({ 
          data: base64Data, 
          x: 0, y: 0, w: '100%', h: '100%', 
          sizing: { type: 'contain', w: '100%', h: '100%' } 
        });
      }
    }
    
    await pres.writeFile({ fileName: `Designt_${id}.pptx` });
  };

  return (
    <div style={{ height: 'calc(100vh - 4rem)', display: 'flex', flexDirection: 'column' }}>
      {/* Exit Confirmation Modal */}
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Button variant="ghost" size="sm" onClick={handleBack} style={{ padding: '0.4rem' }}>
            <ArrowLeft size={18} />
          </Button>
          <span style={{ fontSize: '0.9rem', fontWeight: 700, whiteSpace: 'nowrap' }}>Project Editor</span>
        </div>
        
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <label style={{ fontSize: '0.875rem' }}>Ratio:</label>
            <select 
              value={aspectRatio} 
              onChange={(e) => setAspectRatio(e.target.value)}
              style={{ padding: '0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', backgroundColor: 'transparent', color: 'inherit' }}
            >
              <option value="16:9">16:9</option>
              <option value="4:3">4:3</option>
              <option value="3:2">3:2</option>
              <option value="1:1">1:1</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <label style={{ fontSize: '0.875rem' }}>Res:</label>
            <select 
              value={resolution} 
              onChange={(e) => setResolution(e.target.value)}
              style={{ padding: '0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', backgroundColor: 'transparent', color: 'inherit' }}
            >
              <option value="1K">1K</option>
              <option value="2K">2K</option>
              <option value="4K">4K</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }} title={!globalReference ? '請先上傳風格參考圖' : ''}>
            <Button variant="secondary" onClick={handleGenerate} icon={Sparkles} disabled={isGenerating || !globalReference}
              style={{ opacity: !globalReference ? 0.5 : 1 }}>
              {generateProgress ? `Generating... ${generateProgress.current}/${generateProgress.total}` : '1-Click Modify'}
            </Button>
            {isGenerating && (
              <Button variant="ghost" onClick={handleCancelGenerate} icon={X} style={{ padding: '0.4rem 0.6rem', color: 'var(--text-secondary)' }}>
                取消
              </Button>
            )}
          </div>
          {pendingImages.size > 0 && (() => {
            const unbackedCount = pendingImages.size - backedUpIds.size;
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {unbackedCount > 0 ? (
                  <Button variant="secondary" onClick={handleBackup} disabled={isBackingUp}
                    style={{ backgroundColor: 'var(--accent-color)', color: '#fff', opacity: isBackingUp ? 0.7 : 1 }}>
                    {isBackingUp ? '備份中...' : `備份 (${unbackedCount})`}
                  </Button>
                ) : (
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    ✓ 已備份 {lastBackupTime?.toLocaleTimeString()}
                  </span>
                )}
              </div>
            );
          })()}
          <Button icon={Download} onClick={handleSaveToLocal} variant="secondary">Save Images</Button>
          <Button icon={Download} onClick={handleExport}>Export PPTX</Button>
        </div>
      </div>

      {/* Main Workspace */}
      <div style={{ flex: 1, display: 'flex', flexDirection: previewOpen ? 'row' : 'column', gap: '1rem', minHeight: 0 }}>

        {/* ===== MODE A: Preview Hidden ??Compact bar + Grid ===== */}
        {!previewOpen && (<>
          {/* Combined controls + extra prompt row */}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
            {/* Extra prompt — flex:1 to fill remaining space */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: '160px', backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', padding: '0.5rem 0.75rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>額外提示詞</span>
              <input
                value={globalExtraPrompt}
                onChange={e => setGlobalExtraPrompt(e.target.value)}
                placeholder="額外指令（選填）"
                style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: '0.875rem', color: 'var(--text-primary)', minWidth: 0 }}
              />
              {globalExtraPrompt && (
                <button onClick={() => setGlobalExtraPrompt('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}><X size={14}/></button>
              )}
            </div>
            {/* Reference Style compact */}
            <div style={{ backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', padding: '0.5rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, whiteSpace: 'nowrap' }}>風格參考</span>
              {globalReference ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <div style={{ width: '40px', aspectRatio: '16/9', borderRadius: '4px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                    <img src={globalReference} alt="Ref" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                  <button onClick={() => setGlobalReference(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--text-secondary)' }}><X size={12}/></button>
                </div>
              ) : (
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.25rem 0.5rem', border: '1px dashed var(--border-color)', borderRadius: '6px', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                  <ImageIcon size={12} /> 上傳風格圖（選填）
                  <input type="file" accept="image/*" onChange={(e) => handleFileUpload(e, 'reference')} style={{ display: 'none' }} />
                </label>
              )}
            </div>

            {/* PPT Upload compact */}
            <label style={{ backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', padding: '0.5rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: (parsingProgress || savingProgress) ? 'not-allowed' : 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
              {parsingProgress ? (
                <><Sparkles size={14} style={{ animation: 'spin 2s linear infinite', color: 'var(--accent-color)' }} /> 轉換 {parsingProgress.current}/{parsingProgress.total}</>
              ) : savingProgress ? (
                <><Sparkles size={14} style={{ animation: 'spin 2s linear infinite', color: 'var(--accent-color)' }} /> 儲存 {savingProgress.current}/{savingProgress.total}</>
              ) : (
                <><Plus size={14} /> 上傳 PPT</>
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
                  if (totalSlidesReturned === 0) { alert("No slides found."); clearInterval(progressInterval); setParsingProgress(null); return; }
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
                } catch (err) { console.error(err); alert("Error saving PPT."); }
                finally { clearInterval(progressInterval); setParsingProgress(null); setSavingProgress(null); e.target.value = ''; }
              }} />
            </label>

            {/* Word / TXT Upload compact */}
            <button
              disabled={parsingProgress !== null || savingProgress !== null}
              onClick={() => setShowTextUploadModal(true)}
              style={{ backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', padding: '0.5rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: (parsingProgress || savingProgress) ? 'not-allowed' : 'pointer', fontSize: '0.8rem', fontWeight: 600, color: 'inherit' }}>
              <FileText size={14} /> Word/TXT
            </button>
            <input ref={textFileInputRef} type="file" accept=".docx,.txt" style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                handleTextFileProcess(file);
                e.target.value = '';
              }} />

            {/* Gallery controls */}
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', paddingLeft: '0.75rem', borderLeft: '1px solid var(--border-color)' }}>
              <Button size="sm" variant="ghost" onClick={() => {
                if (selectedSlides.size === slides.length) setSelectedSlides(new Set());
                else setSelectedSlides(new Set(slides.map(s => s.id)));
              }} style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}>
                {selectedSlides.size === slides.length ? 'Deselect All' : 'Select All'}
              </Button>
              <Button size="sm" variant="secondary" onClick={addSlide} style={{ padding: '0.25rem 0.5rem' }}><Plus size={14} /></Button>
            </div>

            {/* Show Preview */}
            <button onClick={() => setPreviewOpen(true)}
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.4rem 0.75rem', backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: 500, marginLeft: 'auto' }}>
              <Eye size={14} /> Preview
            </button>
          </div>

          {/* Google Drive-style grid */}
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
        </>)}

        {/* ===== MODE B: Preview Open ??Sidebar + Canvas ===== */}
        {previewOpen && (<>
          {/* Left Sidebar */}
          <div style={{ width: '280px', display: 'flex', flexDirection: 'column', gap: '1.5rem', overflowY: 'auto', flexShrink: 0 }}>
            {/* Reference Style */}
            <div style={{ backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', padding: '1rem' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Reference Style <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 400 }}>(選填)</span></span>
                {globalReference && <Button variant="ghost" size="sm" onClick={() => setGlobalReference(null)} style={{ padding: 0 }}><X size={16}/></Button>}
              </h3>
              {globalReference ? (
                <div style={{ width: '100%', aspectRatio: '16/9', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                  <img src={globalReference} alt="Reference" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              ) : (
                <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', padding: '2rem 1rem', border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-md)', cursor: 'pointer', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
                  <ImageIcon size={24} style={{ marginBottom: '0.5rem' }} />
                  <span style={{ fontSize: '0.875rem' }}>Upload Style Ref</span>
                  <input type="file" accept="image/*" onChange={(e) => handleFileUpload(e, 'reference')} style={{ display: 'none' }} />
                </label>
              )}
            </div>

            {/* PPT Upload Area */}
            <div style={{ backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', padding: '1rem' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Import PowerPoint</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>Turn a .pptx into image slides instantly.</p>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', width: '100%', padding: '0.75rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', cursor: (parsingProgress || savingProgress) ? 'not-allowed' : 'pointer', color: 'var(--text-primary)', fontWeight: 500, opacity: (parsingProgress || savingProgress) ? 0.9 : 1, position: 'relative', overflow: 'hidden', backgroundColor: 'var(--bg-secondary)' }}>
                {parsingProgress && (<div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: `${Math.max(5, (parsingProgress.current / parsingProgress.total) * 100)}%`, backgroundColor: 'rgba(59, 130, 246, 0.15)', transition: 'width 0.4s ease-out', zIndex: 0 }} />)}
                <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {parsingProgress ? (<><Sparkles size={18} style={{ animation: 'spin 2s linear infinite', color: 'var(--accent-color)' }} /><span>轉換中：第 {parsingProgress.current} 張 / 共 {parsingProgress.total} 張</span></>) : savingProgress ? (<><Sparkles size={18} style={{ animation: 'spin 2s linear infinite', color: 'var(--accent-color)' }} /><span>儲存中：第 {savingProgress.current} 張 / 共 {savingProgress.total} 張</span></>) : (<><Plus size={18} /><span>Upload Base PPT</span></>)}
                </div>
                <input type="file" accept=".pptx" style={{ display: 'none' }} disabled={parsingProgress !== null || savingProgress !== null} onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file || !id) return;
                  let exactTotalSlides = 1;
                  try { const zip = new JSZip(); const content = await zip.loadAsync(file); const slideFiles = Object.keys(content.files).filter(name => name.startsWith('ppt/slides/slide') && name.endsWith('.xml')); if (slideFiles.length > 0) exactTotalSlides = slideFiles.length; } catch(err) { console.warn("Failed to pre-parse slide count"); }
                  setParsingProgress({ current: 0, total: exactTotalSlides });
                  const progressInterval = setInterval(() => { setParsingProgress(prev => { if (!prev) return prev; const next = prev.current + 1; return { ...prev, current: next >= prev.total ? prev.total - 1 : next }; }); }, 2000);
                  try {
                    const formData = new FormData(); formData.append("file", file);
                    const backendUrl = localStorage.getItem("backendUrl") || import.meta.env.VITE_BACKEND_URL || '';
                    const res = await fetch(`${backendUrl}/upload-ppt/`, { method: "POST", body: formData });
                    if (!res.ok) throw new Error("Failed to parse PPT.");
                    const data = await res.json(); const base64images = data.slides as string[]; const totalSlidesReturned = base64images.length;
                    if (totalSlidesReturned === 0) { alert("No slides found."); clearInterval(progressInterval); setParsingProgress(null); return; }
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
                  } catch (err) { console.error(err); alert("Error saving PPT."); }
                  finally { clearInterval(progressInterval); setParsingProgress(null); setSavingProgress(null); e.target.value = ''; }
                }} />
              </label>
            </div>

            {/* Slides List - sidebar mode */}
            <div style={{ backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', padding: '1rem', flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '1rem', margin: 0 }}>Slides Gallery</h3>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <Button size="sm" variant="ghost" onClick={() => { if (selectedSlides.size === slides.length) setSelectedSlides(new Set()); else setSelectedSlides(new Set(slides.map(s => s.id))); }} style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}>
                    {selectedSlides.size === slides.length ? 'Deselect All' : 'Select All'}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={addSlide} style={{ padding: '0.25rem 0.5rem' }}><Plus size={16} /></Button>
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
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setPreviewOpen(false)} title="Hide preview" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}>
                <EyeOff size={16} /> Hide
              </button>
            </div>
            <div style={{ flex: 1, backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', border: activeSlide?.status === 'empty' ? '1px dashed var(--border-color)' : '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', position: 'relative', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
              {activeSlide && !activeSlide.originalImage && !activeSlide.generatedImage && activeSlide.status !== 'empty' ? (
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
                  {(() => {
                    const hist = textHistories.get(activeSlideId);
                    const canUndo = !!hist && hist.pos > 0;
                    const canRedo = !!hist && hist.pos < hist.stack.length - 1;
                    const btnStyle = (enabled: boolean): React.CSSProperties => ({ background: 'none', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0.3rem 0.6rem', cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.35, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.78rem' });
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <button style={btnStyle(canUndo)} disabled={!canUndo} onClick={() => handleTextUndo(activeSlideId)}><ChevronLeft size={13}/> 上一步</button>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{hist ? `${hist.pos + 1}/${hist.stack.length}` : '1/1'}</span>
                        <button style={btnStyle(canRedo)} disabled={!canRedo} onClick={() => handleTextRedo(activeSlideId)}>下一步 <ChevronRight size={13}/></button>
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
                  <img ref={imgRef} src={(activeSlideId ? pendingImages.get(activeSlideId) : undefined) || activeSlide?.generatedImage || activeSlide?.originalImage || ''} alt="Editor Canvas" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', opacity: activeSlide?.status === 'generating' ? 0.5 : 1, transition: 'opacity 0.3s' }} />
                  <canvas ref={canvasRef} onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseLeave={stopDrawing} onTouchStart={startDrawing} onTouchMove={draw} onTouchEnd={stopDrawing} style={{ position: 'absolute', top: imgRef.current ? imgRef.current.offsetTop : 0, left: imgRef.current ? imgRef.current.offsetLeft : 0, width: imgRef.current ? imgRef.current.offsetWidth : '100%', height: imgRef.current ? imgRef.current.offsetHeight : '100%', pointerEvents: isDrawingMode ? 'auto' : 'none', cursor: isDrawingMode ? 'crosshair' : 'default', opacity: 0.6, mixBlendMode: 'normal', zIndex: 10 }} />
                  {activeSlide?.status === 'generating' && (
                    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'var(--bg-primary)', padding: '1rem 2rem', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)', fontWeight: 500, zIndex: 20 }}>
                      <Sparkles size={16} style={{ display: 'inline', marginRight: '0.5rem', animation: 'spin 2s linear infinite' }} /> Generating with Gemini...
                    </div>
                  )}
                </>
              )}
            </div>
            {(activeSlide?.status === 'draft' || activeSlide?.status === 'done') && !(!activeSlide.originalImage && !activeSlide.generatedImage) && (
              <div style={{ backgroundColor: 'var(--bg-primary)', display: 'flex', gap: '1rem', padding: '1rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
                  <Button variant={isDrawingMode ? 'primary' : 'secondary'} onClick={() => { setIsDrawingMode(!isDrawingMode); if (isDrawingMode) clearCanvas(); }} style={{ whiteSpace: 'nowrap' }}>
                    {isDrawingMode ? <X size={18} style={{ marginRight: '0.5rem' }} /> : <Circle size={18} style={{ marginRight: '0.5rem' }} />}
                    {isDrawingMode ? 'Clear & Close' : 'Draw Area'}
                  </Button>
                  {isDrawingMode && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: '0.5rem', padding: '0 0.5rem', borderLeft: '1px solid var(--border-color)' }}>
                      <Circle size={12} style={{ color: 'var(--text-secondary)' }} />
                      <input type="range" min="5" max="100" value={brushSize} onChange={(e) => setBrushSize(parseInt(e.target.value))} style={{ width: '80px', accentColor: 'var(--accent-color)', cursor: 'pointer' }} />
                      <Circle size={20} style={{ color: 'var(--text-secondary)' }} />
                    </div>
                  )}
                  {(() => {
                    const hist = activeSlideId ? imageHistories.get(activeSlideId) : undefined;
                    const canUndo = !!hist && hist.pos >= 0;
                    const canRedo = !!hist && hist.pos < hist.stack.length - 1;
                    if (!hist || hist.stack.length === 0) return null;
                    const btnStyle = (enabled: boolean): React.CSSProperties => ({
                      background: 'none', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
                      padding: '0.3rem 0.45rem', cursor: enabled ? 'pointer' : 'not-allowed',
                      opacity: enabled ? 1 : 0.35, color: 'var(--text-secondary)',
                      display: 'flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.72rem',
                    });
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginLeft: '0.5rem', paddingLeft: '0.75rem', borderLeft: '1px solid var(--border-color)' }}>
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
                </div>
                <div style={{ flex: 1, display: 'flex' }}>
                  <Input
                    placeholder="What do you want Gemini to change?"
                    value={promptDraft}
                    onChange={(e) => setPromptDraft(e.target.value)}
                    onCompositionStart={() => { isComposing.current = true; }}
                    onCompositionEnd={(e) => { isComposing.current = false; setPrompt((e.target as HTMLInputElement).value); }}
                    onBlur={(e) => { if (!isComposing.current) setPrompt(e.target.value); }}
                    style={{ width: '100%', backgroundColor: 'transparent', border: 'none', boxShadow: 'none' }}
                  />
                </div>
              </div>
            )}
          </div>
        </>)}
      </div>

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

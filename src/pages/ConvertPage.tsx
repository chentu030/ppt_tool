import React, { useCallback, useRef, useState } from 'react';
import { Download, FileImage, Loader2, UploadCloud, X, AlertTriangle, CheckCircle2, Image as ImageIcon } from 'lucide-react';

const OCR_SERVICE_URL = import.meta.env.VITE_OCR_SERVICE_URL ?? 'http://localhost:8080';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SlideAnalysis {
  index: number;
  filename: string;
  width: number;
  height: number;
  is_photo: boolean;
  est_svg_mb: number;
  svg_warn: boolean;
}

type Step = 'upload' | 'analyzing' | 'decide' | 'processing' | 'done' | 'error';

// ── Helpers ───────────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: '0 0 0.35rem', fontSize: '0.75rem', fontWeight: 700,
      color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {children}
    </p>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)',
      padding: '1rem', ...style }}>
      {children}
    </div>
  );
}

function StatusBadge({ warn }: { warn: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
      fontSize: '0.72rem', fontWeight: 600, padding: '0.15rem 0.5rem',
      borderRadius: '999px',
      background: warn ? 'rgba(245,158,11,0.15)' : 'rgba(34,197,94,0.15)',
      color: warn ? '#d97706' : '#16a34a' }}>
      {warn ? <AlertTriangle size={11} /> : <CheckCircle2 size={11} />}
      {warn ? '建議 PNG' : '適合 SVG'}
    </span>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function ConvertPage() {
  const [step, setStep] = useState<Step>('upload');
  const [jobId, setJobId] = useState<string>('');
  const [slides, setSlides] = useState<SlideAnalysis[]>([]);
  const [svgDecisions, setSvgDecisions] = useState<Record<number, boolean>>({});
  const [useInpaint, setUseInpaint] = useState(true);
  const [inpaintQuality, setInpaintQuality] = useState<'fast' | 'high'>('fast');
  const [progress, setProgress] = useState({ current: 0, total: 0, message: '' });
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Upload + Analyze ────────────────────────────────────────────────────────

  const handleFiles = useCallback(async (fileList: FileList) => {
    if (!fileList.length) return;
    setStep('analyzing');
    setError('');

    const fd = new FormData();
    Array.from(fileList).forEach(f => fd.append('files', f));

    try {
      const res = await fetch(`${OCR_SERVICE_URL}/analyze`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error(`伺服器錯誤 ${res.status}`);
      const data = await res.json();
      setJobId(data.job_id);
      setSlides(data.slides);
      // Default SVG decisions: follow server recommendation
      const defaults: Record<number, boolean> = {};
      data.slides.forEach((s: SlideAnalysis) => { defaults[s.index] = !s.svg_warn; });
      setSvgDecisions(defaults);
      setStep('decide');
    } catch (e: any) {
      setError(e.message ?? '連線失敗');
      setStep('error');
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  // ── Start Processing ────────────────────────────────────────────────────────

  const startProcess = useCallback(async () => {
    setStep('processing');
    setProgress({ current: 0, total: slides.length, message: '啟動中...' });

    const body = {
      job_id: jobId,
      use_inpaint: useInpaint,
      inpaint_quality: inpaintQuality,
      svg_decisions: Object.entries(svgDecisions).map(([idx, use_svg]) => ({
        index: Number(idx), use_svg,
      })),
    };

    try {
      const res = await fetch(`${OCR_SERVICE_URL}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`伺服器錯誤 ${res.status}`);
    } catch (e: any) {
      setError(e.message ?? '無法啟動處理');
      setStep('error');
      return;
    }

    // Poll status
    if (pollRef.current) clearInterval(pollRef.current);
    let failCount = 0;
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${OCR_SERVICE_URL}/status/${jobId}`);
        if (r.status === 404) {
          clearInterval(pollRef.current!);
          setError('找不到任務（伺服器重啟，請重新上傳）');
          setStep('error');
          return;
        }
        if (!r.ok) {
          failCount++;
          if (failCount >= 5) {
            clearInterval(pollRef.current!);
            setError(`伺服器錯誤 ${r.status}，請稍後重試`);
            setStep('error');
          }
          return;
        }
        failCount = 0;
        const d = await r.json();
        setProgress(d.progress ?? progress);
        if (d.status === 'done') {
          clearInterval(pollRef.current!);
          setStep('done');
        } else if (d.status === 'error') {
          clearInterval(pollRef.current!);
          setError(d.error ?? '處理失敗');
          setStep('error');
        }
      } catch {
        failCount++;
        if (failCount >= 5) {
          clearInterval(pollRef.current!);
          setError('無法連線至轉換服務，請確認網路後重試');
          setStep('error');
        }
      }
    }, 1500);
  }, [jobId, slides.length, svgDecisions, useInpaint, inpaintQuality]);

  // ── Download ─────────────────────────────────────────────────────────────────

  const downloadResult = useCallback(() => {
    window.open(`${OCR_SERVICE_URL}/download/${jobId}`, '_blank');
  }, [jobId]);

  // ── Reset ────────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (jobId) fetch(`${OCR_SERVICE_URL}/${jobId}`, { method: 'DELETE' }).catch(() => {});
    setStep('upload');
    setJobId('');
    setSlides([]);
    setSvgDecisions({});
    setError('');
    setProgress({ current: 0, total: 0, message: '' });
  }, [jobId]);

  // ── Render helpers ────────────────────────────────────────────────────────────

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  // ── JSX ───────────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: '760px', margin: '0 auto', padding: '2rem 1.5rem', display: 'flex',
      flexDirection: 'column', gap: '1.5rem' }}>

      {/* Header */}
      <div>
        <h1 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          圖片投影片 → 可編輯 PPTX
        </h1>
        <p style={{ margin: '0.35rem 0 0', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
          上傳 PPTX 或圖片，使用 OCR 提取文字，並可選擇將背景轉換為 SVG 向量格式。
        </p>
      </div>

      {/* ── Step: Upload ── */}
      {step === 'upload' && (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? 'var(--accent-color)' : 'var(--border-color)'}`,
            borderRadius: 'var(--radius-lg)', padding: '3rem 2rem',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem',
            cursor: 'pointer', transition: 'border-color 0.15s',
            background: dragging ? 'var(--bg-secondary)' : 'transparent',
          }}>
          <UploadCloud size={40} style={{ color: 'var(--text-secondary)' }} />
          <div style={{ textAlign: 'center' }}>
            <p style={{ margin: 0, fontWeight: 600, color: 'var(--text-primary)' }}>
              拖曳或點擊上傳
            </p>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              支援 .pptx、.png、.jpg 或多張圖片
            </p>
          </div>
          <input ref={fileRef} type="file" multiple hidden
            accept=".pptx,.ppt,.png,.jpg,.jpeg,.webp,.zip"
            onChange={e => e.target.files && handleFiles(e.target.files)} />
        </div>
      )}

      {/* ── Step: Analyzing ── */}
      {step === 'analyzing' && (
        <Card style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Loader2 size={22} style={{ animation: 'spin 1.5s linear infinite', flexShrink: 0,
            color: 'var(--accent-color)' }} />
          <div>
            <p style={{ margin: 0, fontWeight: 600 }}>分析投影片中...</p>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              正在偵測背景類型與估算 SVG 大小
            </p>
          </div>
        </Card>
      )}

      {/* ── Step: Decide ── */}
      {step === 'decide' && (
        <>
          {/* Mode options */}
          <Card>
            <SectionTitle>轉換選項</SectionTitle>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer',
              fontSize: '0.875rem', marginTop: '0.4rem' }}>
              <input type="checkbox" checked={useInpaint}
                onChange={e => setUseInpaint(e.target.checked)}
                style={{ width: 15, height: 15 }} />
              <span><strong>修補背景</strong><span style={{ color: 'var(--text-secondary)' }}> — 移除文字殘留，還原乾淨底圖</span></span>
            </label>
            {useInpaint && (
              <div style={{ marginTop: '0.6rem', marginLeft: '1.5rem', display: 'flex', gap: '0.5rem' }}>
                {([['fast', '⚡ 快速模式', '~0.5秒/張（OpenCV）'], ['high', '✨ 高品質', '~30秒/張（AI LaMa）']] as const).map(
                  ([val, label, desc]) => (
                    <button key={val} onClick={() => setInpaintQuality(val)}
                      style={{ padding: '0.35rem 0.85rem', borderRadius: 'var(--radius-sm)',
                        border: `1px solid ${inpaintQuality === val ? 'var(--accent-color)' : 'var(--border-color)'}`,
                        background: inpaintQuality === val ? 'var(--accent-color)' : 'none',
                        color: inpaintQuality === val ? '#fff' : 'var(--text-secondary)',
                        cursor: 'pointer', fontSize: '0.8rem', textAlign: 'left' as const }}>
                      <div style={{ fontWeight: 600 }}>{label}</div>
                      <div style={{ fontSize: '0.72rem', opacity: 0.85 }}>{desc}</div>
                    </button>
                  )
                )}
              </div>
            )}
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              不勾選則直接使用原始圖片背景（最快）
            </p>
          </Card>

          {/* Per-slide SVG decisions */}
          <div>
            <SectionTitle>每頁背景格式</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.4rem' }}>
              {slides.map(s => (
                <div key={s.index} style={{
                  display: 'flex', alignItems: 'center', gap: '0.75rem',
                  padding: '0.65rem 0.85rem', borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)', background: 'var(--bg-secondary)',
                }}>
                  <FileImage size={16} style={{ flexShrink: 0, color: 'var(--text-secondary)' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem',
                      flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.875rem',
                        color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                        第 {s.index + 1} 張
                      </span>
                      <StatusBadge warn={s.svg_warn} />
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        {s.width}×{s.height}px
                        {s.svg_warn && ` · SVG 預估 ${s.est_svg_mb} MB`}
                      </span>
                    </div>
                  </div>
                  {/* Toggle */}
                  <div style={{ display: 'flex', background: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
                    overflow: 'hidden', flexShrink: 0, fontSize: '0.78rem' }}>
                    {(['png', 'svg'] as const).map(fmt => {
                      const active = fmt === 'svg' ? svgDecisions[s.index] : !svgDecisions[s.index];
                      return (
                        <button key={fmt}
                          onClick={() => setSvgDecisions(prev => ({ ...prev, [s.index]: fmt === 'svg' }))}
                          style={{
                            padding: '0.3rem 0.75rem', border: 'none', cursor: 'pointer',
                            fontWeight: active ? 700 : 400, fontSize: '0.78rem',
                            background: active ? 'var(--accent-color)' : 'transparent',
                            color: active ? '#fff' : 'var(--text-secondary)',
                            transition: 'background 0.15s',
                          }}>
                          {fmt.toUpperCase()}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            {/* Bulk buttons */}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              {[{ label: '全部 PNG', val: false }, { label: '全部 SVG', val: true }].map(({ label, val }) => (
                <button key={label} onClick={() => {
                  const all: Record<number, boolean> = {};
                  slides.forEach(s => { all[s.index] = val; });
                  setSvgDecisions(all);
                }}
                  style={{ padding: '0.3rem 0.75rem', fontSize: '0.78rem', borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)', background: 'none', cursor: 'pointer',
                    color: 'var(--text-secondary)' }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <button onClick={reset}
              style={{ padding: '0.55rem 1.1rem', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-color)', background: 'none',
                cursor: 'pointer', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              重新上傳
            </button>
            <button onClick={startProcess}
              style={{ padding: '0.55rem 1.4rem', borderRadius: 'var(--radius-md)',
                border: 'none', background: 'var(--accent-color)', color: '#fff',
                cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <ImageIcon size={15} />
              開始轉換
            </button>
          </div>
        </>
      )}

      {/* ── Step: Processing ── */}
      {step === 'processing' && (
        <Card style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Loader2 size={20} style={{ animation: 'spin 1.5s linear infinite', flexShrink: 0,
              color: 'var(--accent-color)' }} />
            <div>
              <p style={{ margin: 0, fontWeight: 600 }}>轉換中...</p>
              <p style={{ margin: '0.15rem 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                {progress.message}
              </p>
            </div>
          </div>
          {/* Progress bar */}
          <div style={{ height: '6px', borderRadius: '3px', background: 'var(--border-color)',
            overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: '3px',
              background: 'var(--accent-color)', width: `${pct}%`,
              transition: 'width 0.4s ease' }} />
          </div>
          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)',
            textAlign: 'right' }}>
            {progress.current} / {progress.total} 張 ({pct}%)
          </p>
        </Card>
      )}

      {/* ── Step: Done ── */}
      {step === 'done' && (
        <Card style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: '1rem', padding: '2rem' }}>
          <CheckCircle2 size={48} style={{ color: '#16a34a' }} />
          <div style={{ textAlign: 'center' }}>
            <p style={{ margin: 0, fontWeight: 700, fontSize: '1.05rem',
              color: 'var(--text-primary)' }}>轉換完成！</p>
            <p style={{ margin: '0.3rem 0 0', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              共 {slides.length} 張投影片，文字已可編輯。
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button onClick={downloadResult}
              style={{ padding: '0.65rem 1.5rem', borderRadius: 'var(--radius-md)',
                border: 'none', background: 'var(--accent-color)', color: '#fff',
                cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Download size={16} />
              下載可編輯 PPTX
            </button>
            <button onClick={reset}
              style={{ padding: '0.65rem 1.25rem', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-color)', background: 'none',
                cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              再轉換一份
            </button>
          </div>
        </Card>
      )}

      {/* ── Step: Error ── */}
      {step === 'error' && (
        <Card style={{ border: '1px solid #fca5a5' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
            <X size={20} style={{ color: '#ef4444', flexShrink: 0, marginTop: '2px' }} />
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontWeight: 700, color: '#ef4444' }}>轉換失敗</p>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem',
                color: 'var(--text-secondary)' }}>{error}</p>
            </div>
            <button onClick={reset}
              style={{ padding: '0.45rem 1rem', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-color)', background: 'none',
                cursor: 'pointer', fontSize: '0.82rem', flexShrink: 0,
                color: 'var(--text-secondary)' }}>
              重試
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}

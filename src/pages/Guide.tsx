import React, { useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, ZoomIn, X } from 'lucide-react';

const TOTAL_SLIDES = 17;
const slides = Array.from({ length: TOTAL_SLIDES }, (_, i) => ({
  src: `/guide/投影片${i + 1}.PNG`,
  label: `第 ${i + 1} 頁`,
}));

export const Guide: React.FC = () => {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '2rem', maxWidth: '960px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.5rem' }}>
        <BookOpen size={22} style={{ color: 'var(--accent-color)' }} />
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>操作說明</h1>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '2rem', lineHeight: 1.6 }}>
        以下為本平台的操作教學，請依照順序瀏覽各步驟說明。點擊圖片可放大檢視。
      </p>

      {/* Image Grid */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {slides.map((slide, idx) => (
          <div key={idx} style={{
            border: '1px solid var(--border-color)',
            borderRadius: '0.5rem',
            overflow: 'hidden',
            backgroundColor: 'var(--bg-secondary)',
            transition: 'box-shadow 0.2s ease',
          }}>
            {/* Slide label */}
            <div style={{
              padding: '0.5rem 0.8rem',
              fontSize: '0.78rem',
              fontWeight: 600,
              color: 'var(--text-secondary)',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <span>{slide.label}</span>
              <button
                onClick={() => setLightboxIdx(idx)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.25rem',
                  fontSize: '0.72rem', padding: '0.15rem 0.4rem', borderRadius: '0.25rem',
                }}
                title="放大檢視"
              >
                <ZoomIn size={13} /> 放大
              </button>
            </div>
            <img
              src={slide.src}
              alt={slide.label}
              onClick={() => setLightboxIdx(idx)}
              style={{
                width: '100%',
                display: 'block',
                cursor: 'pointer',
              }}
              loading="lazy"
            />
          </div>
        ))}
      </div>

      {/* Lightbox */}
      {lightboxIdx !== null && (
        <div
          onClick={() => setLightboxIdx(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            backgroundColor: 'rgba(0,0,0,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '2rem',
          }}
        >
          {/* Close button */}
          <button
            onClick={() => setLightboxIdx(null)}
            style={{
              position: 'absolute', top: '1rem', right: '1rem',
              background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '50%',
              width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: '#fff',
            }}
          >
            <X size={18} />
          </button>

          {/* Prev button */}
          {lightboxIdx > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxIdx(lightboxIdx - 1); }}
              style={{
                position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)',
                background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '50%',
                width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: '#fff',
              }}
            >
              <ChevronLeft size={22} />
            </button>
          )}

          {/* Image */}
          <img
            src={slides[lightboxIdx].src}
            alt={slides[lightboxIdx].label}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '90vw', maxHeight: '85vh',
              borderRadius: '0.5rem',
              boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
            }}
          />

          {/* Next button */}
          {lightboxIdx < slides.length - 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxIdx(lightboxIdx + 1); }}
              style={{
                position: 'absolute', right: '1rem', top: '50%', transform: 'translateY(-50%)',
                background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '50%',
                width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: '#fff',
              }}
            >
              <ChevronRight size={22} />
            </button>
          )}

          {/* Page indicator */}
          <div style={{
            position: 'absolute', bottom: '1.5rem', left: '50%', transform: 'translateX(-50%)',
            color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem', fontWeight: 600,
          }}>
            {lightboxIdx + 1} / {slides.length}
          </div>
        </div>
      )}
    </div>
  );
};

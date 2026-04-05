import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { AuthModal } from '../components/AuthModal';
import { Presentation, Sparkles, ArrowRight, MousePointerClick } from 'lucide-react';

export const Landing: React.FC = () => {
  const navigate = useNavigate();
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return (
    <div style={{ 
      minHeight: '100vh', 
      display: 'flex', 
      flexDirection: 'column',
      backgroundColor: 'var(--bg-primary)',
      backgroundImage: 'radial-gradient(circle at center, rgba(59, 130, 246, 0.05) 0%, transparent 70%)',
      overflow: 'hidden',
      position: 'relative'
    }}>
      {/* Interactive Spotlight Effect */}
      <div 
        style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          pointerEvents: 'none',
          background: `radial-gradient(600px circle at ${mousePos.x}px ${mousePos.y}px, rgba(59, 130, 246, 0.04), transparent 40%)`,
          zIndex: 0
        }}
      />

      <nav style={{ padding: '1.5rem 3rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative', zIndex: 10 }}>
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}
        >
          <div style={{ 
            backgroundColor: 'var(--text-primary)', 
            color: 'var(--bg-primary)', 
            padding: '0.5rem', 
            borderRadius: 'var(--radius-sm)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
          }}>
            <Presentation size={24} />
          </div>
          <h1 style={{ fontSize: '1.5rem', margin: 0, fontWeight: 700, letterSpacing: '-0.03em' }}>Designt.io</h1>
        </motion.div>
        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          style={{ display: 'flex', gap: '1rem' }}
        >
          <Button variant="ghost" onClick={() => setIsAuthOpen(true)}>登入</Button>
          <Button onClick={() => setIsAuthOpen(true)}>開始使用</Button>
        </motion.div>
      </nav>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 2rem', position: 'relative', zIndex: 10 }}>
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          style={{ maxWidth: '800px', position: 'relative' }}
        >
          {/* Subtle floating decorative elements */}
          <motion.div
            animate={{ y: [0, -10, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            style={{ position: 'absolute', top: '-2rem', left: '-3rem', color: 'var(--accent-color)', opacity: 0.5 }}
          >
            <Sparkles size={32} />
          </motion.div>
          <motion.div
            animate={{ y: [0, 15, 0] }}
            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
            style={{ position: 'absolute', bottom: '2rem', right: '-4rem', color: 'var(--accent-color)', opacity: 0.3 }}
          >
            <MousePointerClick size={40} />
          </motion.div>

          <motion.div 
            whileHover={{ scale: 1.05 }}
            style={{ 
              display: 'inline-flex', alignItems: 'center', gap: '0.5rem', 
              padding: '0.5rem 1rem', 
              background: 'rgba(59, 130, 246, 0.1)', 
              color: 'var(--accent-color)',
              border: '1px solid rgba(59, 130, 246, 0.2)',
              borderRadius: '99px', 
              marginBottom: '2rem', 
              fontSize: '0.875rem', 
              fontWeight: 600,
              backdropFilter: 'blur(8px)',
              cursor: 'default'
            }}
          >
            <Sparkles size={16} /> Awwwards 級別的 AI 簡報設計
          </motion.div>
          
          <h1 style={{ fontSize: '4.5rem', marginBottom: '1.5rem', lineHeight: 1.1, fontWeight: 800, letterSpacing: '-0.02em', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center' }}>
              {Array.from('讓 AI 為你設計').map((char, i) => (
                <motion.span
                  key={`line1-${i}`}
                  whileHover={{ y: -8, scale: 1.05 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 15 }}
                  style={{ display: 'inline-block', whiteSpace: char === ' ' ? 'pre' : 'normal' }}
                >
                  {char}
                </motion.span>
              ))}
            </div>
            <div style={{ 
              display: 'flex', 
              flexWrap: 'wrap', 
              justifyContent: 'center',
              background: 'linear-gradient(135deg, var(--text-primary) 0%, var(--text-secondary) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              color: 'var(--text-secondary)' 
            }}>
              {Array.from('令人驚豔的專業簡報').map((char, i) => (
                <motion.span
                  key={`line2-${i}`}
                  whileHover={{ y: -8, scale: 1.05 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 15 }}
                  style={{ display: 'inline-block' }}
                >
                  {char}
                </motion.span>
              ))}
            </div>
          </h1>
          
          <p style={{ fontSize: '1.25rem', marginBottom: '3rem', maxWidth: '600px', margin: '0 auto 3rem auto', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            只需上傳草稿、選擇喜歡的風格，讓強大的 Gemini 模型為你自動重繪、排版，瞬間打造出專家級的視覺體驗。
          </p>
          
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
            <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
              <Button size="lg" icon={ArrowRight} onClick={() => setIsAuthOpen(true)} style={{ padding: '0 2rem', fontSize: '1.1rem', height: '3.5rem' }}>
                免費開始設計
              </Button>
            </motion.div>
            <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
              <Button size="lg" variant="secondary" onClick={() => navigate('/home')} style={{ padding: '0 2rem', fontSize: '1.1rem', height: '3.5rem', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                觀看展示 (免登入)
              </Button>
            </motion.div>
          </div>
        </motion.div>
      </main>

      <AuthModal isOpen={isAuthOpen} onClose={() => setIsAuthOpen(false)} />
    </div>
  );
};

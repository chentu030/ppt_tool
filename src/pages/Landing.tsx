import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { AuthModal } from '../components/AuthModal';
import { Presentation, Sparkles, ArrowRight } from 'lucide-react';

export const Landing: React.FC = () => {
  const navigate = useNavigate();
  const [isAuthOpen, setIsAuthOpen] = useState(false);

  return (
    <div style={{ 
      minHeight: '100vh', 
      display: 'flex', 
      flexDirection: 'column',
      background: 'radial-gradient(circle at center, var(--bg-secondary) 0%, var(--bg-primary) 100%)' 
    }}>
      <nav style={{ padding: '1.5rem 3rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', padding: '0.5rem', borderRadius: 'var(--radius-sm)' }}>
            <Presentation size={24} />
          </div>
          <h1 style={{ fontSize: '1.5rem', margin: 0 }}>Designt.io</h1>
        </div>
        <div>
          <Button variant="ghost" onClick={() => setIsAuthOpen(true)}>Sign In</Button>
          <Button onClick={() => setIsAuthOpen(true)}>Get Started</Button>
        </div>
      </nav>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 2rem' }}>
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          style={{ maxWidth: '800px' }}
        >
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', background: 'var(--bg-tertiary)', borderRadius: '99px', marginBottom: '2rem', fontSize: '0.875rem', fontWeight: 500 }}>
            <Sparkles size={16} /> Awwwards-level PPT Design AI
          </div>
          <h1 style={{ fontSize: '4rem', marginBottom: '1.5rem', lineHeight: 1.1 }}>
            Design Pitch Decks<br />
            <span style={{ color: 'var(--text-secondary)' }}>That Wow Investors.</span>
          </h1>
          <p style={{ fontSize: '1.25rem', marginBottom: '3rem', maxWidth: '600px', margin: '0 auto 3rem auto' }}>
            Upload your draft, choose a reference style, and let Gemini-3-Pro transform your slides into award-winning presentations.
          </p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
            <Button size="lg" icon={ArrowRight} onClick={() => setIsAuthOpen(true)}>Start Designing for Free</Button>
            <Button size="lg" variant="secondary" onClick={() => navigate('/home')}>View Demo (Skip Auth)</Button>
          </div>
        </motion.div>
      </main>

      <AuthModal isOpen={isAuthOpen} onClose={() => setIsAuthOpen(false)} />
    </div>
  );
};

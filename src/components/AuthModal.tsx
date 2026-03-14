import React, { useState, useEffect } from 'react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { auth } from '../firebase';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';

const GOOGLE_CLIENT_ID = '240166589655-ltaqhugqi2ai3sirlbgnqbifg45lki3f.apps.googleusercontent.com';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

declare global {
  interface Window {
    google: any;
    handleGoogleCredential: (response: any) => void;
  }
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    window.handleGoogleCredential = async (response: any) => {
      setLoading(true);
      setError('');
      try {
        const credential = GoogleAuthProvider.credential(response.credential);
        await signInWithCredential(auth, credential);
        onClose();
        window.location.href = '/home';
      } catch (err: any) {
        setError(err.message || 'Google Sign-In failed.');
      } finally {
        setLoading(false);
      }
    };
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    if (!window.google?.accounts?.id) return;
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: window.handleGoogleCredential,
    });
    window.google.accounts.id.renderButton(
      document.getElementById('google-signin-btn'),
      { theme: 'outline', size: 'large', width: '100%', text: 'continue_with' }
    );
  }, [isOpen]);

  const handleGoogleSignIn = () => {
    if (!window.google?.accounts?.id) {
      setError('Google Sign-In not loaded. Please refresh.');
      return;
    }
    setError('');
    window.google.accounts.id.prompt((notification: any) => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        const btn = document.getElementById('google-signin-btn');
        if (btn) btn.click();
      }
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Sign In">
      {error && (
        <div style={{ 
          marginBottom: '1rem', 
          padding: '0.75rem', 
          backgroundColor: 'rgba(239, 68, 68, 0.1)', 
          color: '#ef4444', 
          borderRadius: 'var(--radius-sm)', 
          fontSize: '0.875rem' 
        }}>
          {error}
        </div>
      )}
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {/* Google-rendered sign-in button (primary) */}
        <div id="google-signin-btn" style={{ display: 'flex', justifyContent: 'center', minHeight: '44px' }} />

        {/* Fallback button in case GIS renderButton doesn't work */}
        <Button
          onClick={handleGoogleSignIn}
          fullWidth
          disabled={loading}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', opacity: loading ? 0.7 : 1 }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
            <path d="M9.003 18c2.43 0 4.467-.806 5.956-2.18L12.05 13.56c-.806.54-1.836.86-3.047.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9.003 18z" fill="#34A853"/>
            <path d="M3.964 10.712c-.18-.54-.282-1.117-.282-1.71 0-.593.102-1.17.282-1.71V4.96H.957C.347 6.175 0 7.55 0 9.002c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9.003 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.464.891 11.426 0 9.003 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29c.708-2.127 2.692-3.71 5.036-3.71z" fill="#EA4335"/>
          </svg>
          {loading ? 'Signing in...' : 'Continue with Google'}
        </Button>

        <p style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0.5rem 0 0' }}>
          使用 Google 帳號快速登入，無需註冊
        </p>
      </div>
    </Modal>
  );
};

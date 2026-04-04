import React, { useState, useEffect, useCallback } from 'react';
import { _setDialogListener } from '../../utils/dialog';
import type { DialogConfig } from '../../utils/dialog';

const DialogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [cfg, setCfg] = useState<DialogConfig | null>(null);

  const close = useCallback((value: boolean) => {
    if (!cfg) return;
    cfg.resolve(value);
    setCfg(null);
  }, [cfg]);

  useEffect(() => {
    _setDialogListener((newCfg) => setCfg(newCfg));
    return () => _setDialogListener(() => {});
  }, []);

  const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)',
    zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
  };
  const boxStyle: React.CSSProperties = {
    backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)',
    boxShadow: '0 20px 60px rgba(0,0,0,0.35)', padding: '1.75rem',
    width: '400px', maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: '1rem',
  };
  const btnBase: React.CSSProperties = {
    padding: '0.5rem 1.25rem', borderRadius: 'var(--radius-md)', border: 'none',
    cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, transition: 'opacity 0.15s',
  };
  const primaryBtn: React.CSSProperties = { ...btnBase, background: 'var(--accent-color)', color: '#fff' };
  const secondaryBtn: React.CSSProperties = {
    ...btnBase, background: 'var(--bg-secondary)', color: 'var(--text-primary)',
    border: '1px solid var(--border-color)',
  };

  return (
    <>
      {children}
      {cfg && (
        <div style={overlayStyle} onClick={() => cfg.type === 'alert' && close(true)}>
          <div style={boxStyle} onClick={e => e.stopPropagation()}>
            {cfg.title && (
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {cfg.title}
              </h3>
            )}
            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.6, whiteSpace: 'pre-line' }}>
              {cfg.message}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.25rem' }}>
              {cfg.type === 'confirm' && (
                <button style={secondaryBtn} onClick={() => close(false)}>
                  {cfg.cancelLabel || '取消'}
                </button>
              )}
              <button style={primaryBtn} onClick={() => close(true)}>
                {cfg.type === 'confirm' ? (cfg.confirmLabel || '確認') : (cfg.confirmLabel || '確定')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default DialogProvider;

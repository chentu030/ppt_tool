import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Home, Settings, LogOut, Presentation, Pin, PinOff, MessageSquareText, BookOpen, MessageSquarePlus } from 'lucide-react';
import { auth } from '../firebase';
import { signOut } from 'firebase/auth';

const COLLAPSED_WIDTH = '48px';
const EXPANDED_WIDTH = '200px';

export const Sidebar: React.FC = () => {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const expanded = pinned || hovered;

  const navItems = [
    { icon: Home, label: '專案列表', path: '/home' },
    // { icon: FileOutput, label: '圖片轉可編輯', path: '/convert' },  // Hidden for now
    { icon: MessageSquareText, label: 'AI 對話', path: '/ai-chat' },
    { icon: Settings, label: '設定', path: '/settings' },
    { icon: BookOpen, label: '操作說明', path: '/guide' },
    { icon: MessageSquarePlus, label: '意見回饋', path: '/feedback' },
  ];

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      window.location.href = '/';
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH,
        minWidth: expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH,
        height: '100vh',
        borderRight: '1px solid var(--border-color)',
        padding: expanded ? '1.5rem 1rem' : '1.5rem 0.4rem',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--bg-primary)',
        position: 'sticky',
        top: 0,
        transition: 'width var(--transition-smooth), min-width var(--transition-smooth), padding var(--transition-smooth)',
        overflow: 'hidden',
        flexShrink: 0,
        zIndex: 50,
      }}
    >
      {/* Logo + Pin */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: expanded ? 'space-between' : 'center', marginBottom: '2.5rem', padding: expanded ? '0 0.4rem' : '0', minHeight: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0, justifyContent: expanded ? 'flex-start' : 'center' }}>
          <div style={{
            backgroundColor: 'var(--accent-color)', color: 'var(--accent-text)',
            padding: '0.5rem', borderRadius: 'var(--radius-md)',
            flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: 'var(--shadow-sm)'
          }}>
            <Presentation size={20} />
          </div>
          {expanded && (
            <span style={{ fontSize: '1.1rem', fontWeight: 800, whiteSpace: 'nowrap', color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>Designt.io</span>
          )}
        </div>
        {expanded && (
          <button
            onClick={() => setPinned(!pinned)}
            title={pinned ? '取消釘選' : '釘選側邊欄'}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '6px', borderRadius: 'var(--radius-sm)',
              color: pinned ? 'var(--accent-color)' : 'var(--text-secondary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, opacity: 0.6, transition: 'all var(--transition-fast)'
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = '1'}
            onMouseLeave={e => e.currentTarget.style.opacity = '0.6'}
          >
            {pinned ? <Pin size={16} /> : <PinOff size={16} />}
          </button>
        )}
      </div>

      {expanded && <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '1rem', paddingLeft: '0.8rem' }}>OVERVIEW</div>}

      <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            title={!expanded ? item.label : undefined}
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: expanded ? '0.75rem 0.8rem' : '0.75rem',
              borderRadius: 'var(--radius-md)',
              color: isActive ? 'var(--accent-color)' : 'var(--text-secondary)',
              backgroundColor: isActive ? 'var(--accent-light)' : 'transparent',
              fontSize: '0.85rem',
              fontWeight: isActive ? 700 : 500,
              transition: 'all 0.15s ease',
              justifyContent: expanded ? 'flex-start' : 'center',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            })}
          >
            <item.icon size={18} strokeWidth={2.5} style={{ flexShrink: 0 }} />
            {expanded && item.label}
          </NavLink>
        ))}
      </nav>

      {expanded && <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.8rem', paddingLeft: '0.6rem', marginTop: 'auto' }}>SETTINGS</div>}
      <div style={{ marginTop: expanded ? 0 : 'auto', paddingTop: expanded ? 0 : '1rem', borderTop: expanded ? 'none' : '1px solid var(--border-color)' }}>
        <button
          onClick={handleSignOut}
          title={!expanded ? '登出' : undefined}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.6rem',
            padding: expanded ? '0.6rem 0.8rem' : '0.6rem',
            width: '100%', borderRadius: '0.5rem', color: '#ef4444',
            background: 'none', border: 'none', cursor: 'pointer',
            justifyContent: expanded ? 'flex-start' : 'center',
            whiteSpace: 'nowrap', overflow: 'hidden', fontSize: '0.85rem', fontWeight: 600,
            transition: 'background-color 0.15s ease'
          }}
          onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
          onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
        >
          <LogOut size={18} strokeWidth={2.5} style={{ flexShrink: 0 }} />
          {expanded && '登出'}
        </button>
      </div>
    </div>
  );
};

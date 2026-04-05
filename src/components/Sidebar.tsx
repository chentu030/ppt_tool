import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Home, Settings, LogOut, Presentation, Pin, PinOff, MessageSquareText } from 'lucide-react';
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
        padding: expanded ? '0.75rem 0.6rem' : '0.75rem 0.35rem',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--bg-primary)',
        position: 'sticky',
        top: 0,
        transition: 'width 0.2s ease, min-width 0.2s ease, padding 0.2s ease',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {/* Logo + Pin */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: expanded ? 'space-between' : 'center', marginBottom: '1rem', padding: expanded ? '0.3rem 0.4rem' : '0.3rem 0', minHeight: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0, justifyContent: expanded ? 'flex-start' : 'center' }}>
          <div style={{
            backgroundColor: 'var(--accent-color)', color: 'var(--accent-text)',
            padding: '0.3rem', borderRadius: '0.3rem',
            flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Presentation size={16} />
          </div>
          {expanded && (
            <span style={{ fontSize: '0.85rem', fontWeight: 700, whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>Designt.io</span>
          )}
        </div>
        {expanded && (
          <button
            onClick={() => setPinned(!pinned)}
            title={pinned ? '取消釘選' : '釘選側邊欄'}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '3px', borderRadius: '0.2rem',
              color: pinned ? 'var(--accent-color)' : 'var(--text-secondary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, opacity: 0.7,
            }}
          >
            {pinned ? <Pin size={13} /> : <PinOff size={13} />}
          </button>
        )}
      </div>

      <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            title={!expanded ? item.label : undefined}
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: expanded ? '0.45rem 0.6rem' : '0.45rem',
              borderRadius: '0.35rem',
              color: isActive ? '#fff' : 'var(--text-secondary)',
              backgroundColor: isActive ? 'var(--accent-color)' : 'transparent',
              fontSize: '0.78rem',
              fontWeight: isActive ? 600 : 500,
              transition: 'all 0.15s ease',
              justifyContent: expanded ? 'flex-start' : 'center',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            })}
          >
            <item.icon size={15} style={{ flexShrink: 0 }} />
            {expanded && item.label}
          </NavLink>
        ))}
      </nav>

      <div style={{ marginTop: 'auto', paddingTop: '0.5rem', borderTop: '1px solid var(--border-color)' }}>
        <button
          onClick={handleSignOut}
          title={!expanded ? '登出' : undefined}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            padding: expanded ? '0.45rem 0.6rem' : '0.45rem',
            width: '100%', borderRadius: '0.35rem', color: 'var(--text-secondary)',
            background: 'none', border: 'none', cursor: 'pointer',
            justifyContent: expanded ? 'flex-start' : 'center',
            whiteSpace: 'nowrap', overflow: 'hidden', fontSize: '0.78rem',
          }}
        >
          <LogOut size={15} style={{ flexShrink: 0 }} />
          {expanded && '登出'}
        </button>
      </div>
    </div>
  );
};

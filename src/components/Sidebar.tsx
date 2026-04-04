import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Home, Settings, LogOut, Presentation, Pin, PinOff, FileOutput, MessageSquareText } from 'lucide-react';
import { motion } from 'framer-motion';
import { auth } from '../firebase';
import { signOut } from 'firebase/auth';

const COLLAPSED_WIDTH = '60px';
const EXPANDED_WIDTH = '280px';

export const Sidebar: React.FC = () => {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const expanded = pinned || hovered;

  const navItems = [
    { icon: Home, label: 'Projects', path: '/home' },
    // { icon: FileOutput, label: '圖片轉可編輯', path: '/convert' },  // Hidden for now
    { icon: MessageSquareText, label: 'AI 對話', path: '/ai-chat' },
    { icon: Settings, label: 'Settings', path: '/settings' },
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
    <motion.div 
      className="sidebar"
      initial={{ x: -20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH,
        minWidth: expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH,
        height: '100vh',
        borderRight: '1px solid var(--border-color)',
        padding: expanded ? '2rem 1.5rem' : '2rem 0.5rem',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--bg-primary)',
        position: 'sticky',
        top: 0,
        transition: 'width 0.25s ease, min-width 0.25s ease, padding 0.25s ease',
        overflow: 'hidden',
      }}
    >
      {/* Logo + Pin */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3rem', minHeight: '36px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ 
            backgroundColor: 'var(--accent-color)', color: 'var(--accent-text)', 
            padding: '0.5rem', borderRadius: 'var(--radius-sm)',
            flexShrink: 0,
          }}>
            <Presentation size={24} />
          </div>
          {expanded && (
            <h2 style={{ fontSize: '1.25rem', margin: 0, whiteSpace: 'nowrap' }}>Designt.io</h2>
          )}
        </div>
        {expanded && (
          <button
            onClick={() => setPinned(!pinned)}
            title={pinned ? 'Unpin sidebar' : 'Pin sidebar'}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '0.35rem', borderRadius: 'var(--radius-sm)',
              color: pinned ? 'var(--accent-color)' : 'var(--text-secondary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
              transition: 'color 0.15s ease',
            }}
          >
            {pinned ? <Pin size={16} /> : <PinOff size={16} />}
          </button>
        )}
      </div>

      <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            title={!expanded ? item.label : undefined}
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: expanded ? '0.75rem 1rem' : '0.75rem',
              borderRadius: 'var(--radius-md)',
              color: isActive ? 'var(--accent-text)' : 'var(--text-secondary)',
              backgroundColor: isActive ? 'var(--accent-color)' : 'transparent',
              fontWeight: 500,
              transition: 'all 0.2s ease',
              justifyContent: expanded ? 'flex-start' : 'center',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            })}
          >
            <item.icon size={20} style={{ flexShrink: 0 }} />
            {expanded && item.label}
          </NavLink>
        ))}
      </nav>

      <div style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
        <button 
          onClick={handleSignOut}
          title={!expanded ? 'Sign out' : undefined}
          style={{ 
            display: 'flex', alignItems: 'center', gap: '0.75rem', 
            padding: expanded ? '0.75rem 1rem' : '0.75rem',
            width: '100%', borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)',
            background: 'none', border: 'none', cursor: 'pointer',
            justifyContent: expanded ? 'flex-start' : 'center',
            whiteSpace: 'nowrap', overflow: 'hidden',
          }}
        >
          <LogOut size={20} style={{ flexShrink: 0 }} />
          {expanded && 'Sign out'}
        </button>
      </div>
    </motion.div>
  );
};

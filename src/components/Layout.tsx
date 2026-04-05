import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { motion, AnimatePresence } from 'framer-motion';

export const Layout: React.FC = () => {
  return (
    <div style={{ display: 'flex', height: '100vh', backgroundColor: 'var(--bg-body)', overflow: 'hidden' }}>
      <Sidebar />
      <main style={{ flex: 1, padding: '1rem', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{
          flex: 1,
          backgroundColor: 'var(--bg-primary)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-sm)',
          border: '1px solid var(--border-color)',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative'
        }}>
          <AnimatePresence mode="wait">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              style={{ width: '100%', flex: 1, display: 'flex', flexDirection: 'column' }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
};

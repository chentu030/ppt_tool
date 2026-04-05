import { useEffect } from 'react';
import DialogProvider from './components/ui/DialogProvider';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Landing } from './pages/Landing';
import { Home } from './pages/Home';
import { ProjectEditor } from './pages/ProjectEditor';
import { Settings } from './pages/Settings';
import { ConvertPage } from './pages/ConvertPage';
import { AIChatPage } from './pages/AIChatPage';
import { Guide } from './pages/Guide';

function App() {
  useEffect(() => {
    const theme = localStorage.getItem('theme') || 'light';
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    }
  }, []);

  return (
    <DialogProvider>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        {/* Protected / App routes wrapped in Layout */}
        <Route element={<Layout />}>
          <Route path="/home" element={<Home />} />
          <Route path="/project/:id" element={<ProjectEditor />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/convert" element={<ConvertPage />} />
          <Route path="/ai-chat" element={<AIChatPage />} />
          <Route path="/guide" element={<Guide />} />
        </Route>
      </Routes>
    </BrowserRouter>
    </DialogProvider>
  )
}

export default App

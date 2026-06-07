/**
 * App.jsx - Root component with React Router setup.
 * Routes: /, /wizard, /wizard/:id, /library, /chat
 */
import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { HomePage } from './pages/HomePage';
import { WizardPage } from './pages/WizardPage';
import { LibraryPage } from './pages/LibraryPage';
import { ChatPage } from './pages/ChatPage';
import { DialogueCreator } from './pages/DialogueCreator';
import { SettingsPage } from './pages/SettingsPage';
import { PresetPage } from './pages/PresetPage';
import { ToastProvider } from './components/shared/Toast';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { initBackground } from './services/background-service';
import { initTheme } from './services/theme-service';

export default function App() {
  // Initialize background and theme on app load
  useEffect(() => {
    initBackground();
    initTheme();
  }, []);

  return (
    <ToastProvider>
      <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/wizard" element={<WizardPage />} />
            <Route path="/wizard/:id" element={<WizardPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/dialogue" element={<DialogueCreator />} />
            <Route path="/preset" element={<PresetPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </ErrorBoundary>
    </ToastProvider>
  );
}

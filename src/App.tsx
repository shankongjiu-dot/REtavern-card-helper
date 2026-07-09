/**
 * App.tsx - Root component with React Router setup.
 * Routes: /, /wizard, /wizard/:id, /library, /chat
 */
import { lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { ToastProvider } from './components/shared/Toast';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { initBackground } from './services/background-service';
import { initTheme } from './services/theme-service';

const HomePage = lazy(() => import('./pages/HomePage').then(({ HomePage }) => ({ default: HomePage })));
const WizardPage = lazy(() => import('./pages/WizardPage').then(({ WizardPage }) => ({ default: WizardPage })));
const LibraryPage = lazy(() => import('./pages/LibraryPage').then(({ LibraryPage }) => ({ default: LibraryPage })));
const ChatPage = lazy(() => import('./pages/ChatPage').then(({ ChatPage }) => ({ default: ChatPage })));
const DialogueCreator = lazy(() => import('./pages/DialogueCreator').then(({ DialogueCreator }) => ({ default: DialogueCreator })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(({ SettingsPage }) => ({ default: SettingsPage })));
const PresetPage = lazy(() => import('./pages/PresetPage').then(({ PresetPage }) => ({ default: PresetPage })));
const NovelAnalysisPage = lazy(() => import('./pages/NovelAnalysisPage').then(({ NovelAnalysisPage }) => ({ default: NovelAnalysisPage })));
const NovelWorkshopPage = lazy(() => import('./components/novel-workshop').then(({ NovelWorkshop }) => ({ default: NovelWorkshop })));
const CardEditorChatPage = lazy(() => import('./pages/CardEditorChatPage').then(({ CardEditorChatPage }) => ({ default: CardEditorChatPage })));
const DraftsPage = lazy(() => import('./pages/DraftsPage').then(({ DraftsPage }) => ({ default: DraftsPage })));

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
              <Route path="/novel-analysis" element={<NovelAnalysisPage />} />
              <Route path="/novel-workshop" element={<NovelWorkshopPage />} />
              <Route path="/preset" element={<PresetPage />} />
              <Route path="/drafts" element={<DraftsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/card-editor-chat" element={<CardEditorChatPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ErrorBoundary>
    </ToastProvider>
  );
}

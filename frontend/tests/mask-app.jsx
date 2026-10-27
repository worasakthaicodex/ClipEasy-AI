import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles.css';

const fixture = new URL('./output/mask-fixture.mp4', location.href).href;
const sourcePath = new URLSearchParams(location.search).get('source');
const project = { name: 'Mask test', filePath: 'mask-test.clipeasy.json', dirPath: 'mask-test',
  data: { clips: [], media: [], sequence: [{ id: 'mask-test-video', name: 'Mask fixture', path: sourcePath,
    url: fixture, track: 1, inPoint: 0, offset: 0, duration: 3, srcDuration: 3, fps: 20 }] } };
window.__saved = structuredClone(project);
window.__saves = 0;
window.__errors = [];
window.addEventListener('error', event => window.__errors.push(event.message));
window.addEventListener('unhandledrejection', event => window.__errors.push(String(event.reason)));
window.aiclip = {
  backendUrl: 'http://127.0.0.1:8439',
  recentProjects: async () => [project],
  openRecentProject: async () => structuredClone(window.__saved),
  openProject: async () => structuredClone(window.__saved),
  getAppSettings: async () => ({ language: 'en', theme: 'dark' }),
  setAppSettings: async () => null,
  saveProject: async saved => { window.__saved = structuredClone(saved); window.__saves++; return { ok: true }; },
  finalizeExport: async (path, output) => { window.__exported = { path, output }; return { bytes: 1 }; },
  onGoHome: cb => { window.__goHome = cb; return () => {}; },
  onSaveProject: cb => { window.__saveNow = cb; return () => {}; },
  onOpenSettings: () => () => {},
};
import('../src/App').then(({ default: App }) => createRoot(document.getElementById('root')).render(<App />));

// Isolated, non-persistent demo data for screenshots of the real application UI.
// This entry does not read the user's recent projects or application preferences.
import React from 'react';
import { createRoot } from 'react-dom/client';
import city from '../src/assets/ratio-city-blue-hour-v1.png';
import '../src/styles.css';

const videoPath = new URLSearchParams(location.search).get('video');
const demoVideo = new URL('/tests/output/city-demo.mp4', location.origin).href;
const segment = (id, name, offset, duration, inPoint = 0) => ({ id, name, path: videoPath, url: demoVideo, track: 1,
  offset, duration, inPoint, srcDuration: 60, fps: 25, transform: { videoFx: 'cinema-bars', volume: 75 } });
const project = { name: 'City Stories', dirPath: 'Demo Projects / City Stories', filePath: 'city-stories.clipeasy.json',
  updatedAt: '2026-10-27T08:00:00.000Z', data: {
    clips: [{ id: 'city-source', name: 'Blue Hour — City Skyline.mp4', path: videoPath, url: demoVideo, duration: 60, fps: 25 }],
    media: [{ name: 'City Skyline.png', path: 'demo-city.png', url: city, kind: 'image' }],
    sequence: [segment('city-01', 'Blue Hour — Opening', 0, 22), segment('city-02', 'Reflections', 22, 20, 22), segment('city-03', 'City After Dark', 42, 18, 42),
      { id: 'title-01', type: 'text', name: 'CITY STORIES', text: 'CITY STORIES', track: 3, offset: 0, duration: 18, inPoint: 0, srcDuration: 18,
        transform: { y: 45 }, style: { size: 42, boxW: 560, color: '#ffffff', bold: true, font: 'Arial', align: 'center', shadow: true } },
      { id: 'subtitle-01', type: 'text', name: 'A BLUE HOUR FILM', text: 'A BLUE HOUR FILM', track: 3, offset: 0, duration: 18, inPoint: 0, srcDuration: 18,
        transform: { y: 91 }, style: { size: 14, boxW: 500, color: '#b4f8ee', font: 'Arial', align: 'center' } }]
  } };
let saved = structuredClone(project);
window.aiclip = {
  backendUrl: 'http://127.0.0.1:8420',
  recentProjects: async () => [saved], openRecentProject: async () => structuredClone(saved), openProject: async () => structuredClone(saved),
  getAppSettings: async () => ({ language: 'en', theme: 'dark', startMaximized: true }), setAppSettings: async () => null,
  saveProject: async (next) => { saved = structuredClone(next); return { ...next, updatedAt: '2026-10-27T08:00:00.000Z' }; },
  onGoHome: callback => { window.portfolioHome = callback; return () => {}; },
  onSaveProject: () => () => {}, onOpenSettings: () => () => {},
};
import('../src/App').then(({default: App}) => createRoot(document.getElementById('root')).render(<App />));

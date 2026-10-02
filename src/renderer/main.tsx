import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import Quick from './Quick';
import './styles.css';

/** Ten sam renderer obsługuje dwa okna: główne i szybkie szukanie (otwierane z #quick). */
const isQuick = window.location.hash === '#quick';
if (isQuick) document.documentElement.classList.add('quick-window');

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isQuick ? <Quick /> : <App />}</React.StrictMode>
);

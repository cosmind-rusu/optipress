import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';

 if (import.meta.env.PROD && 'serviceWorker' in navigator) {
   window.addEventListener('load', () => {
     void navigator.serviceWorker.register('/sw.js');
   });
 }

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

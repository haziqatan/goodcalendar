import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthCallback } from './components/AuthCallback';
import './styles.css';

const isAuthCallback = window.location.pathname === '/auth/callback';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isAuthCallback ? <AuthCallback /> : <App />}
  </React.StrictMode>,
);

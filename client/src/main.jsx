// StrictMode removed — causes double socket/WebRTC connections that break host assignment
import { createRoot } from 'react-dom/client'
import axios from 'axios'
import './index.css'
import App from './App.jsx'
import { Buffer } from 'buffer'

// Global polyfills for WebRTC and older libraries in Vite
window.Buffer = Buffer;
window.process = { env: { NODE_ENV: import.meta.env.MODE } };
window.global = window;

// Global axios interceptors for client-side logging and auth
axios.interceptors.request.use(request => {
  const isAuthRoute = request.url?.includes('/auth/login') || request.url?.includes('/auth/register');
  const token = localStorage.getItem('token');
  
  if (token && !isAuthRoute) {
    request.headers['Authorization'] = `Bearer ${token}`;
  }
  
  console.log(`[Client Request] ${request.method?.toUpperCase()} ${request.url}`);
  return request;
}, error => {
  return Promise.reject(error);
});

axios.interceptors.response.use(response => {
  return response;
}, error => {
  if (error.response?.status === 401) {
    console.warn('[Client] 401 Unauthorized detected. Clearing token and redirecting to login.');
    localStorage.removeItem('token');
    localStorage.removeItem('smartmeet_user');
    if (!window.location.pathname.includes('/login')) {
      window.location.href = '/login';
    }
  }
  console.error('[Client Error]:', error.response?.status, error.config?.url, error.response?.data || error.message);
  return Promise.reject(error);
});

createRoot(document.getElementById('root')).render(
  <App />
)

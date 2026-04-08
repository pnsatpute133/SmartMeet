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

// Global axios interceptors for client-side logging
axios.interceptors.request.use(request => {
  console.log('[Client Request]:', request.method?.toUpperCase(), request.url, request.data || '');
  return request;
});

axios.interceptors.response.use(response => {
  // console.log('[Client Response]:', response.status, response.config.url, response.data);
  return response;
}, error => {
  console.error('[Client Error]:', error.response?.status, error.config?.url, error.response?.data || error.message);
  return Promise.reject(error);
});

createRoot(document.getElementById('root')).render(
  <App />
)

// StrictMode removed — causes double socket/WebRTC connections that break host assignment
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { Buffer } from 'buffer'

// Global polyfills for WebRTC and older libraries in Vite
window.Buffer = Buffer;
window.process = { env: { NODE_ENV: import.meta.env.MODE } };
window.global = window;

createRoot(document.getElementById('root')).render(
  <App />
)

import { useState } from 'react';
import axios from 'axios';
import { useNavigate, Link } from 'react-router-dom';
import { Video } from 'lucide-react';
import useAuthStore from '../store/useAuthStore';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { login } = useAuthStore();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await axios.post(`${import.meta.env.VITE_API_URL || 'http://localhost:5002/api'}/auth/login`, {
        email,
        password
      });
      console.log('API response:', response.data);
      
      if (response.status === 200) {
        localStorage.setItem("token", response.data.token);
        login(response.data);
        navigate('/');
      }
    } catch (error) {
      console.error('Error:', error.response?.data || error.message);
      setError(error.response?.data?.message || error.message || 'Server error. Is the backend running?');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md bg-dark-surface p-8 rounded-2xl shadow-xl">
        <div className="flex flex-col items-center mb-8">
          <div className="bg-brand-blue p-3 rounded-xl mb-4">
            <Video className="w-8 h-8 text-dark-bg" />
          </div>
          <h1 className="text-3xl font-normal">Welcome Back</h1>
          <p className="text-gray-400 mt-2">Log in to SmartMeet</p>
        </div>

        {error && (
          <div className="bg-brand-red/10 text-brand-red p-3 rounded-lg mb-4 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Email</label>
            <input 
              id="login-email"
              name="email"
              type="email" 
              required
              className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg focus:ring-2 focus:ring-brand-blue outline-none transition-all"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Password</label>
            <input 
              id="login-password"
              name="password"
              type="password" 
              required
              className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg focus:ring-2 focus:ring-brand-blue outline-none transition-all"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <button 
            type="submit" 
            className="w-full bg-brand-blue hover:bg-brand-blueHover text-dark-bg font-medium py-3 rounded-lg transition-colors mt-2"
          >
            Log In
          </button>
        </form>

        <p className="mt-6 text-center text-gray-400 text-sm">
          Don't have an account? <Link to="/register" className="text-brand-blue hover:underline">Sign up</Link>
        </p>
      </div>
    </div>
  );
}

import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import useAuthStore from './store/useAuthStore';

// Lazy load components for better initial performance
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const MeetingRoom = lazy(() => import('./pages/MeetingRoom'));

function ProtectedRoute({ children }) {
  const { user } = useAuthStore();
  console.log('[Auth Status Check]:', user ? `Logged in as ${user.name}` : 'Not logged in');
  return user ? children : <Navigate to="/login" replace />;
}

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-[#202124] text-white font-sans selection:bg-blue-500/30">
        <Suspense fallback={
          <div className="flex h-screen w-screen items-center justify-center bg-[#202124]">
             <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        }>
          <Routes>
            {/* Auth Routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            
            {/* Protected Routes */}
            <Route 
              path="/" 
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/meeting/:id" 
              element={
                <ProtectedRoute>
                  <MeetingRoom />
                </ProtectedRoute>
              } 
            />

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </div>
    </Router>
  );
}

export default App;

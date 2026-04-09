import { create } from 'zustand';

const getUserFromStorage = () => {
  try {
    const userJson = localStorage.getItem('smartmeet_user');
    return userJson ? JSON.parse(userJson) : null;
  } catch (error) {
    console.error('Error parsing user from localStorage:', error);
    localStorage.removeItem('smartmeet_user'); // Clean up corrupt data
    return null;
  }
};

const useAuthStore = create((set) => ({
  user: getUserFromStorage(),
  login: (userData) => {
    localStorage.setItem('smartmeet_user', JSON.stringify(userData));
    set({ user: userData });
  },
  logout: () => {
    localStorage.removeItem('smartmeet_user');
    localStorage.removeItem('token');
    set({ user: null });
  },
}));

export default useAuthStore;

import { createContext, useContext, useState, useEffect } from 'react';
import api, { setToken } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/settings')
      .then(r => setUser(r.data))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    if (data.token) setToken(data.token);
    setUser(data.user);
    return data;
  };

  const register = async (email, password) => {
    const { data } = await api.post('/auth/register', { email, password });
    if (data.token) setToken(data.token);
    setUser(data.user);
    return data;
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch (_) {
      // ignore — server session may already be cleared
    } finally {
      setToken(null);
      setUser(null);
    }
  };

  const updateUser = (updates) => setUser(u => ({ ...u, ...updates }));

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, register, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

import { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchMe = useCallback(async () => {
    try {
      const res = await api.get('/auth/me');
      setUser(res.data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const login = async (email, password) => {
    setError(null);
    const res = await api.post('/auth/login', { email, password });
    setUser(res.data.user);
    return res.data;
  };

  const register = async (email, password) => {
    setError(null);
    const res = await api.post('/auth/register', { email, password });
    setUser(res.data.user);
    return res.data;
  };

  const logout = async () => {
    await api.post('/auth/logout');
    setUser(null);
  };

  return { user, loading, error, login, register, logout, refetch: fetchMe };
}

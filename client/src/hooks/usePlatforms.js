import { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';

export function usePlatforms() {
  const [status, setStatus] = useState({ youtube: false, instagram: false, tiktok: false });
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await api.get('/oauth/status');
      setStatus(res.data);
    } catch {
      // silently fail — user just won't see connected status
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const connect = (platform) => {
    // Redirect to backend OAuth initiation (cookie auth is sent automatically)
    window.location.href = `/api/oauth/${platform}`;
  };

  const disconnect = async (platform) => {
    await api.delete(`/oauth/${platform}`);
    setStatus((prev) => ({ ...prev, [platform]: false }));
  };

  return { status, loading, connect, disconnect, refetch: fetchStatus };
}

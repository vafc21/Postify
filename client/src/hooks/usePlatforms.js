import { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';

// In production the frontend and backend are on separate domains.
// VITE_API_URL must be set to the backend origin (e.g. https://postify-api.onrender.com).
// In development it is left unset and Vite's dev-proxy handles /api/* forwarding.
const API_ORIGIN = import.meta.env.VITE_API_URL || '';

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
    // Full URL required in production where frontend/backend live on different origins.
    window.location.href = `${API_ORIGIN}/api/oauth/${platform}`;
  };

  const disconnect = async (platform) => {
    await api.delete(`/oauth/${platform}`);
    setStatus((prev) => ({ ...prev, [platform]: false }));
  };

  return { status, loading, connect, disconnect, refetch: fetchStatus };
}

import axios from 'axios';

const TOKEN_KEY = 'postify_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token) => {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
};

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
  withCredentials: true,
});

// Attach the stored JWT as a Bearer token. This is what makes auth work when
// the frontend and backend live on different domains, where the cookie alone
// gets blocked as a third-party cookie.
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// If a request comes back 401 with a token in hand, the session has expired or
// been invalidated. Clear it and bounce to /login instead of surfacing a generic
// "Failed to save" alert on every subsequent action. Login/register 401s (bad
// credentials) are left alone so their own error messages still show.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const url = error.config?.url || '';
    const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/register');
    if (status === 401 && getToken() && !isAuthEndpoint) {
      setToken(null);
      if (window.location.pathname !== '/login') {
        window.location.assign('/login');
      }
    }
    return Promise.reject(error);
  }
);

export default api;

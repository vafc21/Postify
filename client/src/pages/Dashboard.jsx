import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { usePlatforms } from '../hooks/usePlatforms';
import { useAuth } from '../hooks/useAuth';
import PlatformCard from '../components/PlatformCard';
import PostStatus from '../components/PostStatus';
import api from '../utils/api';
import { Upload, Settings, Zap, LogOut, CheckCircle2, AlertCircle } from 'lucide-react';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const { status, loading: platformLoading, connect, disconnect, refetch } = usePlatforms();
  const [posts, setPosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // Handle OAuth redirects back to dashboard
  useEffect(() => {
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');

    if (connected) {
      setToast({ type: 'success', message: `${connected} connected successfully!` });
      refetch();
      setSearchParams({});
    } else if (error) {
      setToast({ type: 'error', message: `OAuth failed: ${error.replace(/_/g, ' ')}` });
      setSearchParams({});
    }
  }, [searchParams]);

  // Auto-dismiss toast
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  useEffect(() => {
    api.get('/posts?limit=10').then((res) => {
      setPosts(res.data.posts || []);
    }).catch(() => {}).finally(() => setPostsLoading(false));
  }, []);

  const platforms = ['youtube', 'instagram', 'tiktok'];

  return (
    <div className="min-h-screen bg-[#0f0f13]">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium shadow-xl transition-all ${
          toast.type === 'success'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
            : 'bg-red-500/10 border-red-500/30 text-red-300'
        }`}>
          {toast.type === 'success'
            ? <CheckCircle2 className="w-4 h-4" />
            : <AlertCircle className="w-4 h-4" />}
          {toast.message}
        </div>
      )}

      {/* Navbar */}
      <nav className="border-b border-white/10 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" fill="white" />
            </div>
            <span className="text-lg font-bold text-white">Postify</span>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/upload"
              className="flex items-center gap-1.5 bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
            >
              <Upload className="w-4 h-4" />
              New Post
            </Link>
            <Link
              to="/settings"
              className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm px-3 py-2 rounded-lg hover:bg-white/5 transition"
            >
              <Settings className="w-4 h-4" />
              Settings
            </Link>
            <button
              onClick={logout}
              className="flex items-center gap-1.5 text-slate-500 hover:text-red-400 text-sm px-3 py-2 rounded-lg hover:bg-white/5 transition"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </nav>

      {/* Main */}
      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-slate-400 text-sm mt-1">
            Welcome back{user?.email ? `, ${user.email.split('@')[0]}` : ''}!
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left: Platforms */}
          <div className="lg:col-span-1">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">
              Connected Platforms
            </h2>
            <div className="space-y-3">
              {platforms.map((p) => (
                <PlatformCard
                  key={p}
                  platform={p}
                  connected={status[p]}
                  loading={platformLoading}
                  onConnect={connect}
                  onDisconnect={disconnect}
                />
              ))}
            </div>

            {/* Quick links */}
            <div className="mt-6 pt-6 border-t border-white/10 space-y-2">
              <Link
                to="/upload"
                className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition py-2"
              >
                <Upload className="w-4 h-4" />
                Upload a video
              </Link>
              <Link
                to="/settings"
                className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition py-2"
              >
                <Settings className="w-4 h-4" />
                Manage API keys
              </Link>
            </div>
          </div>

          {/* Right: Recent Posts */}
          <div className="lg:col-span-2">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">
              Recent Posts
            </h2>

            {postsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="bg-[#1a1a24] border border-white/10 rounded-xl p-4 animate-pulse">
                    <div className="h-4 bg-white/5 rounded w-3/4 mb-3" />
                    <div className="h-3 bg-white/5 rounded w-1/2" />
                  </div>
                ))}
              </div>
            ) : posts.length === 0 ? (
              <div className="bg-[#1a1a24] border border-white/10 rounded-xl p-10 text-center">
                <div className="w-12 h-12 bg-indigo-500/10 rounded-xl flex items-center justify-center mx-auto mb-3">
                  <Upload className="w-6 h-6 text-indigo-400" />
                </div>
                <p className="text-slate-400 text-sm">No posts yet.</p>
                <Link
                  to="/upload"
                  className="inline-block mt-3 text-indigo-400 hover:text-indigo-300 text-sm font-medium"
                >
                  Upload your first video →
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {posts.map((post) => (
                  <PostStatus key={post.id} post={post} />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

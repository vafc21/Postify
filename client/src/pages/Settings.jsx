import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import ApiKeyInput from '../components/ApiKeyInput';
import api from '../utils/api';
import {
  ArrowLeft, Zap, Save, Loader2, CheckCircle2, AlertCircle,
  RefreshCw, Key, Mic, Bot
} from 'lucide-react';

function SectionCard({ title, icon: Icon, children }) {
  return (
    <div className="bg-[#1a1a24] border border-white/10 rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-5">
        <div className="w-8 h-8 bg-indigo-500/10 rounded-lg flex items-center justify-center">
          <Icon className="w-4 h-4 text-indigo-400" />
        </div>
        <h2 className="font-semibold text-white">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium shadow-xl ${
      toast.type === 'success'
        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
        : 'bg-red-500/10 border-red-500/30 text-red-300'
    }`}>
      {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
      {toast.message}
    </div>
  );
}

export default function Settings() {
  const { logout } = useAuth();

  const [settings, setSettings] = useState({
    groqKey: '',
    openaiKey: '',
    claudeKey: '',
    preferredTranscription: 'groq',
    hasGroqKey: false,
    hasOpenaiKey: false,
    hasClaudeKey: false,
  });

  const [toast, setToast] = useState(null);
  const [savingTranscription, setSavingTranscription] = useState(false);
  const [savingClaude, setSavingClaude] = useState(false);
  const [loading, setLoading] = useState(true);

  const showToast = (type, message) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    api.get('/settings').then((res) => {
      setSettings({
        groqKey: res.data.groqKey || '',
        openaiKey: res.data.openaiKey || '',
        claudeKey: res.data.claudeKey || '',
        preferredTranscription: res.data.preferredTranscription || 'groq',
        hasGroqKey: res.data.hasGroqKey || false,
        hasOpenaiKey: res.data.hasOpenaiKey || false,
        hasClaudeKey: res.data.hasClaudeKey || false,
      });
    }).catch(() => {
      showToast('error', 'Failed to load settings');
    }).finally(() => setLoading(false));
  }, []);

  const saveTranscription = async () => {
    setSavingTranscription(true);
    try {
      await api.post('/settings/transcription', {
        groqKey: settings.groqKey,
        openaiKey: settings.openaiKey,
        preferredTranscription: settings.preferredTranscription,
      });
      showToast('success', 'Transcription settings saved!');
      // Refresh to get masked values
      const res = await api.get('/settings');
      setSettings((prev) => ({
        ...prev,
        groqKey: res.data.groqKey || '',
        openaiKey: res.data.openaiKey || '',
        hasGroqKey: res.data.hasGroqKey,
        hasOpenaiKey: res.data.hasOpenaiKey,
      }));
    } catch (err) {
      showToast('error', err.response?.data?.error || 'Failed to save transcription settings');
    } finally {
      setSavingTranscription(false);
    }
  };

  const saveClaude = async () => {
    setSavingClaude(true);
    try {
      await api.post('/settings/claude', { claudeKey: settings.claudeKey });
      showToast('success', 'Claude API key saved!');
      const res = await api.get('/settings');
      setSettings((prev) => ({
        ...prev,
        claudeKey: res.data.claudeKey || '',
        hasClaudeKey: res.data.hasClaudeKey,
      }));
    } catch (err) {
      showToast('error', err.response?.data?.error || 'Failed to save Claude API key');
    } finally {
      setSavingClaude(false);
    }
  };

  const hasBothTranscription = settings.hasGroqKey && settings.hasOpenaiKey;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0f0f13] flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f0f13]">
      <Toast toast={toast} />

      {/* Navbar */}
      <nav className="border-b border-white/10 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/dashboard" className="text-slate-400 hover:text-white transition">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-indigo-500 rounded-lg flex items-center justify-center">
                <Zap className="w-4 h-4 text-white" fill="white" />
              </div>
              <span className="font-bold text-white">Settings</span>
            </div>
          </div>
        </div>
      </nav>

      {/* Main */}
      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="text-slate-400 text-sm mt-1">
            Manage your API keys and preferences. All keys are encrypted before storage.
          </p>
        </div>

        {/* Transcription API */}
        <SectionCard title="Transcription API" icon={Mic}>
          <div className="space-y-4">
            <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-lg px-4 py-3 text-xs text-indigo-300">
              Groq is free and fast — recommended. OpenAI Whisper is a paid alternative.
              If you add both, you can pick which one to use.
            </div>

            <ApiKeyInput
              label="Groq API Key (Free — Recommended)"
              value={settings.groqKey}
              onChange={(v) => setSettings({ ...settings, groqKey: v })}
              placeholder="gsk_..."
              hint="Get your free key at console.groq.com"
              saved={settings.hasGroqKey}
            />

            <ApiKeyInput
              label="OpenAI Whisper API Key"
              value={settings.openaiKey}
              onChange={(v) => setSettings({ ...settings, openaiKey: v })}
              placeholder="sk-..."
              hint="Uses whisper-1 model. Charged per minute of audio."
              saved={settings.hasOpenaiKey}
            />

            {/* Toggle when both keys saved */}
            {hasBothTranscription && (
              <div>
                <label className="text-sm font-medium text-slate-300 mb-2 block">
                  Preferred Transcription Provider
                </label>
                <div className="flex gap-2">
                  {['groq', 'openai'].map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setSettings({ ...settings, preferredTranscription: option })}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition border ${
                        settings.preferredTranscription === option
                          ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300'
                          : 'bg-[#0f0f13] border-white/10 text-slate-400 hover:text-white'
                      }`}
                    >
                      {option === 'groq' ? 'Groq (Recommended)' : 'OpenAI Whisper'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                onClick={saveTranscription}
                disabled={savingTranscription}
                className="flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-60 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
              >
                {savingTranscription ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
                ) : (
                  <><Save className="w-4 h-4" /> Save</>
                )}
              </button>
            </div>
          </div>
        </SectionCard>

        {/* Claude API */}
        <SectionCard title="AI Captions (Claude)" icon={Bot}>
          <div className="space-y-4">
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg px-4 py-3 text-xs text-amber-300">
              Bring your own Anthropic API key and you'll be billed directly on your account.
              If left blank, the app will use its own shared key (may have rate limits).
            </div>

            <ApiKeyInput
              label="Anthropic API Key (Optional)"
              value={settings.claudeKey}
              onChange={(v) => setSettings({ ...settings, claudeKey: v })}
              placeholder="sk-ant-..."
              hint="Get your key at console.anthropic.com. Uses claude-haiku-4-5."
              saved={settings.hasClaudeKey}
            />

            <div className="flex justify-end pt-2">
              <button
                onClick={saveClaude}
                disabled={savingClaude}
                className="flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-60 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
              >
                {savingClaude ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
                ) : (
                  <><Save className="w-4 h-4" /> Save</>
                )}
              </button>
            </div>
          </div>
        </SectionCard>

        {/* Danger zone */}
        <div className="bg-[#1a1a24] border border-red-500/20 rounded-2xl p-6">
          <h2 className="font-semibold text-red-400 mb-3">Account</h2>
          <button
            onClick={logout}
            className="text-sm text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500/60 px-4 py-2 rounded-lg transition"
          >
            Sign out
          </button>
        </div>
      </main>
    </div>
  );
}

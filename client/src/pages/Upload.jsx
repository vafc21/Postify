import { useState } from 'react';
import { Link } from 'react-router-dom';
import DropZone from '../components/DropZone';
import ProgressBar from '../components/ProgressBar';
import { YouTubeIcon, InstagramIcon, TikTokIcon } from '../components/PlatformIcons';
import { usePlatforms } from '../hooks/usePlatforms';
import {
  ArrowLeft, Zap, Send, CheckCircle2, ExternalLink, AlertTriangle
} from 'lucide-react';

// Full backend origin — required in production where frontend/backend are on
// separate domains. Falls back to '' (same origin) for Vite dev proxy.
const API_ORIGIN = import.meta.env.VITE_API_URL || '';

const PLATFORM_UI = {
  youtube: {
    label: 'YouTube Shorts',
    Icon: YouTubeIcon,
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    check: 'border-red-500/50 bg-red-500/10',
  },
  instagram: {
    label: 'Instagram Reels',
    Icon: InstagramIcon,
    color: 'text-pink-400',
    bg: 'bg-pink-500/10',
    check: 'border-pink-500/50 bg-pink-500/10',
  },
  tiktok: {
    label: 'TikTok',
    Icon: TikTokIcon,
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    check: 'border-cyan-500/50 bg-cyan-500/10',
  },
};

function ResultsPanel({ results, captions }) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-white">Post Results</h3>
      {Object.entries(results).map(([platform, result]) => {
        const ui = PLATFORM_UI[platform];
        if (!ui) return null;
        const { Icon, color, bg } = ui;
        return (
          <div
            key={platform}
            className={`border rounded-xl p-4 ${
              result.success
                ? 'border-emerald-500/30 bg-emerald-500/5'
                : 'border-red-500/30 bg-red-500/5'
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-7 h-7 rounded-lg ${bg} flex items-center justify-center`}>
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
              <span className="text-sm font-medium text-white capitalize">{platform}</span>
              {result.success ? (
                <span className="ml-auto text-xs text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Posted
                  {(result.videoUrl || result.mediaUrl) && (
                    <a
                      href={result.videoUrl || result.mediaUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-1"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </span>
              ) : (
                <span className="ml-auto text-xs text-red-400">{result.error || 'Failed'}</span>
              )}
            </div>
            {captions?.[platform] && (
              <div className="mt-2 text-xs text-slate-400 bg-black/20 rounded-lg p-3 space-y-1">
                {captions[platform].title && (
                  <p><span className="text-slate-500">Title: </span>{captions[platform].title}</p>
                )}
                {captions[platform].caption && (
                  <p><span className="text-slate-500">Caption: </span>{captions[platform].caption}</p>
                )}
                {captions[platform].description && (
                  <p><span className="text-slate-500">Description: </span>{captions[platform].description}</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function Upload() {
  const { status: platformStatus } = usePlatforms();

  const [file, setFile] = useState(null);
  const [description, setDescription] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [pipelineError, setPipelineError] = useState('');
  const [finalResults, setFinalResults] = useState(null);
  const [finalCaptions, setFinalCaptions] = useState(null);
  const [done, setDone] = useState(false);

  const togglePlatform = (p) => {
    setSelectedPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file || selectedPlatforms.length === 0) return;

    setSubmitting(true);
    setCurrentStep(1);
    setPipelineError('');
    setFinalResults(null);
    setFinalCaptions(null);
    setDone(false);

    const formData = new FormData();
    formData.append('video', file);
    formData.append('description', description);
    formData.append('platforms', JSON.stringify(selectedPlatforms));

    try {
      const response = await fetch(`${API_ORIGIN}/api/upload`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let receivedDone = false;

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.step === 0) {
              setPipelineError(data.error || 'Pipeline failed');
              setSubmitting(false);
              receivedDone = true;
              return;
            }
            setCurrentStep(data.step);
            if (data.step === 5 && data.results) {
              setFinalResults(data.results);
              setFinalCaptions(data.captions);
              setDone(true);
              setSubmitting(false);
              receivedDone = true;
            }
          } catch (_) {}
        }
      }

      // Stream closed without a step-5 event (e.g. server crashed mid-pipeline)
      if (!receivedDone) {
        setPipelineError('Connection lost. Please check your posts and try again.');
        setCurrentStep(0);
        setSubmitting(false);
      }
    } catch (err) {
      setPipelineError(err.message || 'Upload failed');
      setCurrentStep(0);
      setSubmitting(false);
    }
  };

  const reset = () => {
    setFile(null);
    setDescription('');
    setSelectedPlatforms([]);
    setCurrentStep(0);
    setPipelineError('');
    setFinalResults(null);
    setFinalCaptions(null);
    setDone(false);
    setSubmitting(false);
  };

  const connectedPlatforms = Object.entries(platformStatus)
    .filter(([, v]) => v)
    .map(([k]) => k);

  return (
    <div className="min-h-screen bg-[#0f0f13]">
      {/* Navbar */}
      <nav className="border-b border-white/10 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <Link to="/dashboard" className="text-slate-400 hover:text-white transition">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-indigo-500 rounded-lg flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" fill="white" />
            </div>
            <span className="font-bold text-white">New Post</span>
          </div>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Upload Video</h1>
          <p className="text-slate-400 text-sm mt-1">
            Drop a video, pick your platforms, and Postify does the rest.
          </p>
        </div>

        {connectedPlatforms.length === 0 && (
          <div className="mb-6 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 flex items-center gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <p className="text-sm text-amber-300">
              No platforms connected.{' '}
              <Link to="/dashboard" className="underline hover:text-amber-200">
                Connect them on the Dashboard.
              </Link>
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Video File</label>
            <DropZone file={file} onFile={setFile} onClear={() => setFile(null)} />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Video Description
              <span className="text-slate-500 font-normal ml-2">
                (helps AI generate better captions)
              </span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Briefly describe what this video is about..."
              rows={3}
              className="w-full bg-[#1a1a24] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-3">Post To</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {Object.entries(PLATFORM_UI).map(([platform, ui]) => {
                const { label, Icon, color, bg, check } = ui;
                const isConnected = platformStatus[platform];
                const isSelected = selectedPlatforms.includes(platform);

                return (
                  <button
                    key={platform}
                    type="button"
                    disabled={!isConnected}
                    onClick={() => togglePlatform(platform)}
                    className={`relative flex items-center gap-3 rounded-xl border p-3.5 text-left transition-all ${
                      !isConnected
                        ? 'opacity-40 cursor-not-allowed border-white/5 bg-[#1a1a24]'
                        : isSelected
                        ? `${check} border`
                        : 'border-white/10 bg-[#1a1a24] hover:border-white/20'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center flex-shrink-0`}>
                      <Icon className={`w-4 h-4 ${color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-white">{label}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {isConnected ? 'Connected' : 'Not connected'}
                      </p>
                    </div>
                    {isSelected && (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {!submitting && !done && (
            <button
              type="submit"
              disabled={!file || selectedPlatforms.length === 0 || submitting}
              className="w-full flex items-center justify-center gap-2 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition"
            >
              <Send className="w-4 h-4" />
              Publish to{' '}
              {selectedPlatforms.length > 0
                ? selectedPlatforms.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(', ')
                : 'Selected Platforms'}
            </button>
          )}
        </form>

        {(submitting || pipelineError || done) && currentStep > 0 && (
          <div className="mt-6">
            <ProgressBar currentStep={currentStep} error={pipelineError} />
          </div>
        )}

        {done && finalResults && (
          <div className="mt-6">
            <ResultsPanel results={finalResults} captions={finalCaptions} />
            <div className="mt-4 flex gap-3">
              <button
                onClick={reset}
                className="flex-1 border border-white/10 hover:border-white/20 text-slate-300 hover:text-white text-sm font-medium py-2.5 rounded-xl transition"
              >
                Post Another Video
              </button>
              <Link
                to="/dashboard"
                className="flex-1 bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium py-2.5 rounded-xl transition text-center"
              >
                Go to Dashboard
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { YouTubeIcon, InstagramIcon, TikTokIcon } from './PlatformIcons';

const PLATFORM_CONFIG = {
  youtube: {
    label: 'YouTube Shorts',
    Icon: YouTubeIcon,
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    activeBorder: 'border-red-500/50',
    connectBtn: 'bg-red-500 hover:bg-red-600',
  },
  instagram: {
    label: 'Instagram Reels',
    Icon: InstagramIcon,
    color: 'text-pink-400',
    bg: 'bg-pink-500/10',
    activeBorder: 'border-pink-500/50',
    connectBtn: 'bg-gradient-to-r from-pink-500 to-purple-500 hover:opacity-90',
  },
  tiktok: {
    label: 'TikTok',
    Icon: TikTokIcon,
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    activeBorder: 'border-cyan-500/50',
    connectBtn: 'bg-cyan-500 hover:bg-cyan-600',
  },
};

export default function PlatformCard({ platform, connected, onConnect, onDisconnect, loading }) {
  const config = PLATFORM_CONFIG[platform];
  if (!config) return null;
  const { label, Icon, color, bg, activeBorder, connectBtn } = config;

  return (
    <div className={`rounded-xl border p-5 flex items-center gap-4 transition-all ${
      connected ? `${bg} ${activeBorder}` : 'bg-[#1a1a24] border-white/10'
    }`}>
      <div className={`w-11 h-11 rounded-xl ${bg} flex items-center justify-center flex-shrink-0`}>
        <Icon className={`w-6 h-6 ${color}`} />
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-medium text-white text-sm">{label}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          {connected ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs text-emerald-400">Connected</span>
            </>
          ) : (
            <>
              <XCircle className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-xs text-slate-500">Not connected</span>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <Loader2 className="w-4 h-4 text-slate-400 animate-spin flex-shrink-0" />
      ) : connected ? (
        <button
          onClick={() => onDisconnect(platform)}
          className="text-xs text-slate-400 hover:text-red-400 transition px-3 py-1.5 border border-white/10 hover:border-red-500/30 rounded-lg"
        >
          Disconnect
        </button>
      ) : (
        <button
          onClick={() => onConnect(platform)}
          className={`text-xs font-medium text-white px-3 py-1.5 rounded-lg transition ${connectBtn}`}
        >
          Connect
        </button>
      )}
    </div>
  );
}

import { CheckCircle2, XCircle, Clock, ExternalLink } from 'lucide-react';

function StatusBadge({ result, platform }) {
  if (!result) return <span className="text-xs text-slate-600">Not posted</span>;
  if (result.success) {
    return (
      <span className="flex items-center gap-1 text-xs text-emerald-400">
        <CheckCircle2 className="w-3.5 h-3.5" />
        Posted
        {(result.videoUrl || result.mediaUrl) && (
          <a
            href={result.videoUrl || result.mediaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1 hover:text-emerald-300"
          >
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs text-red-400">
      <XCircle className="w-3.5 h-3.5" />
      Failed
    </span>
  );
}

const STATUS_STYLES = {
  posted: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  processing: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  pending: 'text-slate-400 bg-slate-400/10 border-slate-400/20',
  failed: 'text-red-400 bg-red-400/10 border-red-400/20',
};

export default function PostStatus({ post }) {
  const {
    description,
    platforms = [],
    status,
    createdAt,
    youtubeResult,
    instagramResult,
    tiktokResult,
  } = post;

  const style = STATUS_STYLES[status] || STATUS_STYLES.pending;

  const date = new Date(createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const platformResults = {
    youtube: youtubeResult,
    instagram: instagramResult,
    tiktok: tiktokResult,
  };

  return (
    <div className="bg-[#1a1a24] border border-white/10 rounded-xl p-4 hover:border-white/20 transition">
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-sm text-slate-200 line-clamp-2 flex-1">
          {description || <span className="text-slate-500 italic">No description</span>}
        </p>
        <span className={`text-xs px-2.5 py-1 rounded-full border flex-shrink-0 ${style}`}>
          {status}
        </span>
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-slate-500 mb-3">
        {platforms.map((p) => (
          <div key={p} className="flex items-center gap-1.5">
            <span className="capitalize text-slate-400">{p}:</span>
            <StatusBadge result={platformResults[p]} platform={p} />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-1 text-xs text-slate-600">
        <Clock className="w-3 h-3" />
        {date}
      </div>
    </div>
  );
}

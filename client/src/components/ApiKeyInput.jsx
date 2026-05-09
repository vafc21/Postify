import { useState } from 'react';
import { Eye, EyeOff, Check, X, Key } from 'lucide-react';

export default function ApiKeyInput({
  label,
  value,
  onChange,
  placeholder = 'sk-...',
  hint,
  saved = false,
}) {
  const [show, setShow] = useState(false);

  const isMasked = value && value.includes('••••');

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-slate-300 flex items-center gap-1.5">
          <Key className="w-3.5 h-3.5 text-slate-500" />
          {label}
        </label>
        {saved && (
          <span className="text-xs text-emerald-400 flex items-center gap-1">
            <Check className="w-3 h-3" /> Saved
          </span>
        )}
      </div>

      <div className="relative">
        <input
          type={show && !isMasked ? 'text' : 'password'}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-[#0f0f13] border border-white/10 rounded-lg px-4 py-2.5 pr-10 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition font-mono"
        />
        {!isMasked && value && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition"
          >
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>

      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

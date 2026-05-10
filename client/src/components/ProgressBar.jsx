import { CheckCircle2, Loader2, Circle } from 'lucide-react';

const STEPS = [
  { id: 1, label: 'Uploading video' },
  { id: 2, label: 'Transcribing audio' },
  { id: 3, label: 'Generating AI captions' },
  { id: 4, label: 'Posting to platforms' },
  { id: 5, label: 'Done!' },
];

export default function ProgressBar({ currentStep, error }) {
  // Show actual progress percentage even when errored so the bar doesn't
  // misleadingly snap to 100% when something fails at step 2 of 5.
  const progressPct = `${(currentStep / 5) * 100}%`;

  return (
    <div className="bg-[#1a1a24] border border-white/10 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white">Publishing Progress</h3>
        {error ? (
          <span className="text-xs text-red-400">Failed</span>
        ) : currentStep === 5 ? (
          <span className="text-xs text-emerald-400">Complete</span>
        ) : (
          <span className="text-xs text-slate-400">Step {currentStep} of 5</span>
        )}
      </div>

      {/* Progress track */}
      <div className="mb-5">
        <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ease-out ${
              error ? 'bg-red-500' : 'bg-gradient-to-r from-indigo-500 to-purple-500'
            }`}
            style={{ width: progressPct }}
          />
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-2.5">
        {STEPS.map((step) => {
          const isDone = currentStep > step.id;
          const isActive = currentStep === step.id && !error;
          const isErrored = error && currentStep === step.id;

          return (
            <div key={step.id} className="flex items-center gap-3">
              {isDone ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              ) : isActive ? (
                <Loader2 className="w-4 h-4 text-indigo-400 animate-spin flex-shrink-0" />
              ) : isErrored ? (
                <Circle className="w-4 h-4 text-red-400 flex-shrink-0" />
              ) : (
                <Circle className="w-4 h-4 text-white/15 flex-shrink-0" />
              )}
              <span className={`text-sm transition-colors ${
                isDone ? 'text-emerald-400' :
                isActive ? 'text-white' :
                isErrored ? 'text-red-400' :
                'text-slate-600'
              }`}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}

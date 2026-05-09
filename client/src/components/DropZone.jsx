import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, Video, X, FileVideo } from 'lucide-react';

const ACCEPTED_TYPES = {
  'video/mp4': ['.mp4'],
  'video/quicktime': ['.mov'],
  'video/x-msvideo': ['.avi'],
  'video/webm': ['.webm'],
  'video/x-matroska': ['.mkv'],
};

export default function DropZone({ file, onFile, onClear }) {
  const onDrop = useCallback(
    (accepted) => { if (accepted[0]) onFile(accepted[0]); },
    [onFile]
  );

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    maxFiles: 1,
    maxSize: 500 * 1024 * 1024, // 500MB
  });

  if (file) {
    const sizeLabel =
      file.size > 1024 * 1024
        ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
        : `${(file.size / 1024).toFixed(0)} KB`;

    return (
      <div className="border-2 border-indigo-500/40 bg-indigo-500/5 rounded-2xl p-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-indigo-500/10 rounded-xl flex items-center justify-center flex-shrink-0">
            <FileVideo className="w-7 h-7 text-indigo-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-white text-sm truncate">{file.name}</p>
            <p className="text-xs text-slate-400 mt-0.5">{sizeLabel}</p>
          </div>
          <button
            onClick={onClear}
            className="text-slate-500 hover:text-red-400 transition flex-shrink-0 p-1"
            aria-label="Remove file"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Video preview */}
        <div className="mt-4 rounded-xl overflow-hidden bg-black aspect-video">
          <video
            src={URL.createObjectURL(file)}
            controls
            className="w-full h-full object-contain"
          />
        </div>
      </div>
    );
  }

  return (
    <div
      {...getRootProps()}
      className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all ${
        isDragReject
          ? 'border-red-500/50 bg-red-500/5'
          : isDragActive
          ? 'border-indigo-400 bg-indigo-500/10'
          : 'border-white/10 bg-[#1a1a24] hover:border-indigo-500/40 hover:bg-indigo-500/5'
      }`}
    >
      <input {...getInputProps()} />

      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 ${
        isDragActive ? 'bg-indigo-500/20' : 'bg-white/5'
      }`}>
        {isDragActive ? (
          <Video className="w-8 h-8 text-indigo-400" />
        ) : (
          <Upload className="w-8 h-8 text-slate-500" />
        )}
      </div>

      {isDragReject ? (
        <p className="text-red-400 font-medium text-sm">That file type isn't supported</p>
      ) : isDragActive ? (
        <p className="text-indigo-300 font-medium text-sm">Drop it!</p>
      ) : (
        <>
          <p className="text-white font-medium text-sm">
            Drag & drop your video here
          </p>
          <p className="text-slate-500 text-xs mt-1">
            or <span className="text-indigo-400">browse files</span>
          </p>
          <p className="text-slate-600 text-xs mt-3">
            MP4, MOV, AVI, WebM, MKV • Max 500MB
          </p>
        </>
      )}
    </div>
  );
}

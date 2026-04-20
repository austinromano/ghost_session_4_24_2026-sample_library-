import { useEffect, useRef } from 'react';

interface Props {
  stream: MediaStream;
  sharerName: string;
  isLocal: boolean;
  onStop?: () => void;
}

export default function ScreenShareView({ stream, sharerName, isLocal, onStop }: Props) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);

  return (
    <div
      className="relative rounded-xl overflow-hidden bg-black aspect-video w-full mb-3"
      style={{
        border: '1px solid rgba(59,130,246,0.35)',
        boxShadow: '0 0 0 1px rgba(59,130,246,0.15), 0 4px 16px rgba(0,0,0,0.35)',
      }}
    >
      <video ref={ref} autoPlay playsInline muted className="w-full h-full object-contain" />

      <div
        className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold text-white"
        style={{ background: 'rgba(59,130,246,0.85)', backdropFilter: 'blur(4px)' }}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
        {sharerName}{isLocal ? " · You're sharing" : ' · sharing screen'}
      </div>

      {isLocal && onStop && (
        <button
          onClick={onStop}
          className="absolute top-2 right-2 px-2.5 py-1 rounded-md text-[10px] font-bold text-white hover:bg-red-500 transition-colors"
          style={{ background: 'rgba(239,68,68,0.85)', backdropFilter: 'blur(4px)' }}
        >
          Stop sharing
        </button>
      )}
    </div>
  );
}

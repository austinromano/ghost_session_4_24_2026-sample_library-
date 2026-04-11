import { useState, useRef, useEffect, memo } from 'react';
import { motion } from 'framer-motion';
import { useAudioStore } from '../../stores/audioStore';
import { api } from '../../lib/api';
import { audioBufferCache, cacheBuffer, formatDate } from '../../lib/audio';
import Waveform from './Waveform';

export default memo(function StemRow({
  name, type, onDelete, onRename, fileId, projectId, trackId, createdAt, compact, widthPercent,
}: {
  name: string; type: string;
  onDelete: () => void;
  onRename: (newName: string) => void;
  fileId?: string | null; projectId?: string; trackId: string;
  createdAt?: string | null;
  compact?: boolean;
  widthPercent?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(name);
  const [isPlaying, setIsPlaying] = useState(false);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const isMuted = useAudioStore((s) => s.loadedTracks.get(trackId)?.muted ?? false);
  const setTrackMuted = useAudioStore((s) => s.setTrackMuted);
  const trackPitch = useAudioStore((s) => s.loadedTracks.get(trackId)?.pitch ?? 0);
  const setTrackPitch = useAudioStore((s) => s.setTrackPitch);
  const [showPitch, setShowPitch] = useState(false);
  const pitchRef = useRef<HTMLDivElement>(null);

  const downloadUrl = fileId && projectId ? api.getDirectDownloadUrl(projectId, fileId) : null;

  const [ready, setReady] = useState(fileId ? audioBufferCache.has(fileId) : false);
  const precachedRef = useRef(false);
  useEffect(() => {
    if (!fileId || ready) return;
    const id = setInterval(() => {
      if (audioBufferCache.has(fileId)) { setReady(true); clearInterval(id); }
    }, 200);
    return () => clearInterval(id);
  }, [fileId, ready]);

  // Pre-cache stem to C++ temp dir so drag-to-DAW is instant
  useEffect(() => {
    if (!ready || !downloadUrl || precachedRef.current) return;
    precachedRef.current = true;
    const ghostUrl = `ghost://precache-stem?url=${encodeURIComponent(downloadUrl)}&fileName=${encodeURIComponent(name + '.wav')}`;
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = ghostUrl;
    document.body.appendChild(iframe);
    setTimeout(() => iframe.remove(), 1000);
  }, [ready, downloadUrl, name]);

  const startTimeRef = useRef(0);
  const animFrameRef = useRef<number | null>(null);

  const handlePlay = () => {
    if (isPlaying && sourceRef.current) {
      try { sourceRef.current.stop(); } catch {}
      sourceRef.current = null;
      setIsPlaying(false);
      useAudioStore.setState({ soloPlayingTrackId: null, soloCurrentTime: 0, soloDuration: 0 });
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      return;
    }
    const buffer = fileId ? audioBufferCache.get(fileId) : null;
    if (!buffer) return;
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    const ctx = ctxRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    startTimeRef.current = ctx.currentTime;
    source.onended = () => {
      setIsPlaying(false);
      sourceRef.current = null;
      useAudioStore.setState({ soloPlayingTrackId: null, soloCurrentTime: 0, soloDuration: 0 });
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
    source.start(0);
    sourceRef.current = source;
    setIsPlaying(true);
    useAudioStore.setState({ soloPlayingTrackId: trackId, soloDuration: buffer.duration });

    const updatePlayhead = () => {
      if (!sourceRef.current) return;
      const elapsed = ctx.currentTime - startTimeRef.current;
      useAudioStore.setState({ soloCurrentTime: elapsed });
      animFrameRef.current = requestAnimationFrame(updatePlayhead);
    };
    updatePlayhead();
  };

  const handleDownload = async () => {
    if (!downloadUrl) return;
    const fileName = name + '.wav';
    const isPlugin = !!(window as any).chrome?.webview;

    if (isPlugin) {
      // Inside JUCE WebView — use ghost:// protocol so C++ downloads to disk
      const ghostUrl = `ghost://download-stem?url=${encodeURIComponent(downloadUrl)}&fileName=${encodeURIComponent(fileName)}`;
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = ghostUrl;
      document.body.appendChild(iframe);
      setTimeout(() => iframe.remove(), 1000);
    } else {
      // Normal browser — fetch as blob and trigger download
      if (!fileId || !projectId) return;
      try {
        const arrayBuffer = await api.downloadFile(projectId, fileId);
        const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      } catch (err) {
        console.error('Download failed:', err);
      }
    }
  };

  // Drag-to-DAW: on mousedown, fire ghost:// so C++ starts native drag
  // while the mouse button is still held down
  const handleDragGrip = (e: React.MouseEvent) => {
    if (!downloadUrl || !ready) return;
    e.preventDefault();
    e.stopPropagation();
    const ghostUrl = `ghost://drag-to-daw?url=${encodeURIComponent(downloadUrl)}&fileName=${encodeURIComponent(name + '.wav')}`;
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = ghostUrl;
    document.body.appendChild(iframe);
    setTimeout(() => iframe.remove(), 1000);
  };

  return (
    <div className="relative rounded-xl overflow-visible">
      <motion.div
        className="absolute -inset-px rounded-xl opacity-40 pointer-events-none"
        style={{
          background: 'linear-gradient(90deg, #00FFC8, #7C3AED, #EC4899, #F59E0B, #00B4D8, #00FFC8)',
          backgroundSize: '200% 100%',
        }}
        animate={{ backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
      />
    <div
      className={`group relative flex items-center rounded-xl overflow-hidden ${compact ? 'h-[48px]' : 'h-[95px]'}`}
      style={widthPercent !== undefined && widthPercent < 100 ? { width: `${widthPercent}%` } : undefined}
    >
      <div className="flex-1 h-full overflow-hidden bg-[#0A0412] relative">
        <Waveform seed={name + type} height={compact ? 48 : 95} fileId={fileId} projectId={projectId} trackId={trackId} />
        <div className="absolute inset-y-0 left-0 w-[45%] pointer-events-none" style={{ background: 'linear-gradient(90deg, rgba(10,4,18,0.85) 0%, rgba(10,4,18,0.4) 60%, transparent 100%)' }} />
        <div className={`absolute left-4 top-1/2 -translate-y-1/2 z-10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center ${compact ? 'gap-1' : 'gap-1.5'}`}>
          <motion.button
            onClick={handlePlay}
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-all ${
              isPlaying
                ? 'text-white shadow-[0_0_20px_rgba(124,58,237,0.5),0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.2)]'
                : ready
                  ? 'text-white shadow-[0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.15)] hover:shadow-[0_0_20px_rgba(124,58,237,0.4),0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.2)]'
                  : 'bg-white/5 text-ghost-text-muted opacity-40'
            }`}
            style={{ background: isPlaying || ready ? 'linear-gradient(180deg, #7C3AED 0%, #581C87 100%)' : undefined }}
            disabled={!ready}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            {isPlaying ? (
              <svg width="12" height="12" viewBox="0 0 12 14" fill="currentColor">
                <rect x="0" y="0" width="4" height="14" rx="1" />
                <rect x="8" y="0" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor" className="ml-0.5"><polygon points="0,0 10,6 0,12" /></svg>
            )}
          </motion.button>
          <motion.button
            onClick={() => setTrackMuted(trackId, !isMuted)}
            className="w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-[0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.15)] hover:shadow-[0_0_20px_rgba(124,58,237,0.4),0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.2)]"
            style={{ background: isMuted ? 'linear-gradient(180deg, #DC2626 0%, #991B1B 100%)' : 'linear-gradient(180deg, #7C3AED 0%, #581C87 100%)' }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            )}
          </motion.button>
        </div>
        <div className="absolute left-3 top-2 z-10 max-w-[40%]">
          {editing ? (
            <input
              autoFocus
              className="text-[13px] font-semibold text-white bg-black/60 border border-ghost-green/50 rounded px-1.5 py-0.5 outline-none focus:border-ghost-green w-full"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => {
                if (editName.trim() && editName !== name) onRename(editName.trim());
                setEditing(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') { setEditName(name); setEditing(false); }
              }}
            />
          ) : (
            <p
              className="text-[13px] font-bold text-white truncate cursor-pointer hover:text-ghost-green transition-colors"
              onClick={() => { setEditName(name); setEditing(true); }}
              title={name}
            >
              {name}
            </p>
          )}
          <p className="text-[10px] text-white/40 uppercase font-medium mt-0.5">{type === 'audio' ? 'stem' : type === 'fullmix' ? 'mix' : type}</p>
        </div>
        {createdAt && (
          <div className="absolute left-3 bottom-2 z-10">
            <p className="text-[11px] text-ghost-green font-medium" title={new Date(createdAt).toLocaleString()}>
              {formatDate(createdAt)}
            </p>
          </div>
        )}
        <div className="absolute top-1/2 -translate-y-1/2 z-10 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity" style={{ right: '20px' }}>
          {ready && downloadUrl && (
            <motion.button
              onMouseDown={handleDragGrip}
              title="Drag to DAW"
              className="w-11 h-11 rounded-full text-white flex items-center justify-center transition-all cursor-grab active:cursor-grabbing shadow-[0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.15)] hover:shadow-[0_0_20px_rgba(0,255,200,0.4),0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.2)]"
              style={{ background: 'linear-gradient(180deg, #059669 0%, #065F46 100%)' }}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <polyline points="19 12 12 19 5 12" />
              </svg>
            </motion.button>
          )}
          {widthPercent !== undefined && widthPercent < 100 && (
            <motion.button
              onClick={() => {
                useAudioStore.getState().loopTrackToFill(trackId, fileId || undefined);
                const track = useAudioStore.getState().loadedTracks.get(trackId);
                if (track && fileId) {
                  cacheBuffer(fileId, track.buffer);
                }
              }}
              title="Loop to fill"
              className="w-11 h-11 rounded-full text-white flex items-center justify-center transition-all shadow-[0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.15)] hover:shadow-[0_0_20px_rgba(34,197,94,0.4),0_2px_8px_rgba(0,0,0,0.3)]"
              style={{ background: 'linear-gradient(180deg, #059669 0%, #065F46 100%)' }}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="17 1 21 5 17 9" />
                <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                <polyline points="7 23 3 19 7 15" />
                <path d="M21 13v2a4 4 0 0 1-4 4H3" />
              </svg>
            </motion.button>
          )}
          <motion.button
            onClick={onDelete}
            title="Delete"
            className="w-11 h-11 rounded-full text-white flex items-center justify-center transition-all shadow-[0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.15)] hover:shadow-[0_0_20px_rgba(124,58,237,0.4),0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.2)]"
            style={{ background: 'linear-gradient(180deg, #7C3AED 0%, #581C87 100%)' }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </motion.button>
          <motion.button
            onClick={handleDownload}
            title="Download"
            className="w-11 h-11 rounded-full text-white flex items-center justify-center transition-all shadow-[0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.15)] hover:shadow-[0_0_20px_rgba(124,58,237,0.4),0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.2)]"
            style={{ background: 'linear-gradient(180deg, #7C3AED 0%, #581C87 100%)' }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </motion.button>
          <motion.button
            title="Post to Feed"
            className="w-11 h-11 rounded-full text-white flex items-center justify-center transition-all shadow-[0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.15)] hover:shadow-[0_0_20px_rgba(124,58,237,0.4),0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.2)]"
            style={{ background: 'linear-gradient(180deg, #7C3AED 0%, #581C87 100%)' }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 3L3 10l7 3 3 7 8-17z" />
            </svg>
          </motion.button>
        </div>
      </div>
    </div>
    </div>
  );
});

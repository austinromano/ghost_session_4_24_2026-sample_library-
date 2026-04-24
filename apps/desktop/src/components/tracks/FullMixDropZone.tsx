import { useState, memo } from 'react';
import { motion } from 'framer-motion';
import { api } from '../../lib/api';
import Waveform from './Waveform';
import { SAMPLE_LIBRARY_DRAG_MIME } from '../layout/SampleLibrarySection';

export default memo(function FullMixDropZone({ projectId, onFilesAdded, isBeat, compact, rightSlot }: { projectId: string; onFilesAdded: () => void; isBeat?: boolean; compact?: boolean; rightSlot?: React.ReactNode }) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState('');

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    // Library drag — no upload needed, server copies storage + creates track.
    const libPayload = e.dataTransfer.getData(SAMPLE_LIBRARY_DRAG_MIME);
    if (libPayload) {
      try {
        const { id, name } = JSON.parse(libPayload);
        if (id) {
          setUploading(true);
          setStatus(`Adding ${name || 'sample'}…`);
          try {
            await api.copySampleLibraryFileToProject(id, projectId);
            setStatus('Added from library');
            onFilesAdded();
          } catch (err: any) {
            setStatus(err?.message || 'Library import failed');
          } finally {
            setUploading(false);
            setTimeout(() => setStatus(''), 3000);
          }
          return;
        }
      } catch { /* fall through to OS-file path */ }
    }

    const droppedFiles = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith('audio/') || f.name.match(/\.(wav|mp3|flac|aiff|ogg|m4a|aac)$/i)
    );
    if (droppedFiles.length === 0) {
      setStatus('No audio files detected');
      setTimeout(() => setStatus(''), 2000);
      return;
    }
    setUploading(true);
    setStatus(`Uploading ${droppedFiles.length} file(s)...`);
    try {
      for (const file of droppedFiles) {
        const { fileId } = await api.uploadFile(projectId, file);
        const trackName = file.name.replace(/\.[^.]+$/, '');
        await api.addTrack(projectId, { name: trackName, type: 'fullmix', fileId, fileName: file.name } as any);
      }
      setStatus(`Added ${droppedFiles.length} mix(es)`);
      onFilesAdded();
    } catch (err: any) {
      setStatus(err.message || 'Upload failed');
    } finally {
      setUploading(false);
      setTimeout(() => setStatus(''), 3000);
    }
  };

  const handleBrowse = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'audio/*,.wav,.mp3,.flac,.aiff,.ogg,.m4a,.aac';
    input.onchange = () => {
      if (input.files && input.files.length > 0) {
        const fakeEvent = {
          preventDefault: () => {},
          dataTransfer: { files: input.files },
        } as unknown as React.DragEvent;
        handleDrop(fakeEvent);
      }
    };
    input.click();
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className="rounded-xl overflow-visible relative"
    >
      <motion.div
        className="absolute -inset-px rounded-xl opacity-40 pointer-events-none"
        style={{
          background: 'linear-gradient(90deg, #00FFC8, #7C3AED, #EC4899, #F59E0B, #00B4D8, #00FFC8)',
          backgroundSize: '200% 100%',
        }}
        animate={{ backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
      />
      <div className={`${compact ? 'h-[48px]' : 'h-[60px]'} relative overflow-hidden rounded-xl transition-all backdrop-blur-md ${dragOver ? 'bg-white/[0.06]' : 'bg-white/[0.03]'}`} style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 12px rgba(0,0,0,0.2)' }}>
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.07) 0%, transparent 40%, rgba(0,0,0,0.08) 100%)' }} />
        <div className="absolute inset-0 opacity-[0.15] pointer-events-none">
          <Waveform seed="fullmix-demo-placeholder" height={60} />
        </div>
        <div className="absolute inset-0 flex items-center gap-3 pl-8 pr-5">
          {uploading ? (
            <span className="text-[13px] text-ghost-green animate-pulse">{status}</span>
          ) : status ? (
            <span className="text-[13px] text-ghost-green">{status}</span>
          ) : (
            <>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={dragOver ? '#00FFC8' : '#ffffff'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))' }}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span className={`text-[13px] font-bold uppercase tracking-wide ml-2 ${dragOver ? 'text-ghost-green' : 'text-white'}`} style={{ textShadow: '0 2px 6px rgba(0,0,0,0.6), 0 0px 2px rgba(0,0,0,0.4)' }}>Drag audio files here</span>
              <div className="flex-1" />
              {rightSlot}
              <motion.button
                onClick={handleBrowse}
                className="w-[120px] h-11 rounded-full text-white text-[14px] font-semibold flex items-center justify-center gap-2 transition-all shadow-[0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.15)] hover:shadow-[0_0_20px_rgba(124,58,237,0.4),0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.2)] shrink-0"
                style={{ background: 'linear-gradient(180deg, #7C3AED 0%, #581C87 100%)' }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Upload
              </motion.button>
            </>
          )}
        </div>
      </div>
    </div>
  );
});

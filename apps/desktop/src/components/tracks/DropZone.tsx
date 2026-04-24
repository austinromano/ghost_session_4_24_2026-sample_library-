import { useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../../lib/api';
import Waveform from './Waveform';
import { SAMPLE_LIBRARY_DRAG_MIME } from '../layout/SampleLibrarySection';

export default function DropZone({ projectId, onFilesAdded }: { projectId: string; onFilesAdded: () => void }) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState('');

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    // Library drag — import without re-uploading.
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
      f.type.startsWith('audio/') || f.name.match(/\.(wav|mp3|flac|aiff|ogg|m4a|aac|stem)$/i)
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
        await api.addTrack(projectId, { name: trackName, type: 'audio', fileId, fileName: file.name });
      }
      setStatus(`Added ${droppedFiles.length} track(s)`);
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
      className={`rounded-xl overflow-hidden transition-all ${
        dragOver ? 'bg-ghost-green/[0.04] border border-ghost-green/30 shadow-glow-green' : 'glass-subtle'
      }`}
    >
      <div className="flex items-center gap-3 px-4 py-2.5">
        <button className="w-6 h-6 rounded-full bg-white/[0.06] flex items-center justify-center text-ghost-text-muted hover:text-ghost-green hover:bg-ghost-green/10 transition-all">
          <svg width="8" height="10" viewBox="0 0 10 12" fill="currentColor"><polygon points="0,0 10,6 0,12" /></svg>
        </button>
        <span className="text-[12px] font-semibold text-white/50 uppercase tracking-[0.1em]">Stems</span>
        <div className="flex-1" />
      </div>
      <div className={`h-[68px] relative overflow-hidden transition-colors ${dragOver ? 'bg-ghost-green/[0.03]' : 'bg-black/20'}`}>
        <div className="absolute inset-0 opacity-[0.07] pointer-events-none">
          <Waveform seed="stems-demo-placeholder" height={68} />
        </div>
        <div className="absolute inset-0 flex items-center gap-3 pl-8 pr-5">
          {uploading ? (
            <span className="text-[13px] text-ghost-green animate-pulse">{status}</span>
          ) : status ? (
            <span className="text-[13px] text-ghost-green">{status}</span>
          ) : (
            <>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={dragOver ? '#00FFC8' : 'rgba(255,255,255,0.25)'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))' }}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span className={`text-[13px] uppercase tracking-wide ml-2 ${dragOver ? 'text-ghost-green font-medium' : 'text-white/30'}`} style={{ textShadow: '0 2px 6px rgba(0,0,0,0.6), 0 0px 2px rgba(0,0,0,0.4)' }}>Drop your stems here</span>
              <div className="flex-1" />
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
}

import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { useAuthStore } from '../../stores/authStore';
import { useProjectStore } from '../../stores/projectStore';
import { api } from '../../lib/api';
import { onGlobalOnlineUsers, type OnlineUser } from '../../lib/socket';
import Avatar from '../common/Avatar';
import ChatPanel from '../session/ChatPanel';
import { useSessionStore } from '../../stores/sessionStore';
import { useAudioStore } from '../../stores/audioStore';
import { API_BASE } from '../../lib/constants';
import { audioBufferCache } from '../../lib/audio';

// Hooks
import { useNotifications } from '../../hooks/useNotifications';
import { useCursorTracking } from '../../hooks/useCursorTracking';
import RemoteCursors from '../session/RemoteCursors';
import { useSamplePacks, type SamplePack } from '../../hooks/useSamplePacks';

// Extracted components
import ProjectListSidebar from '../layout/ProjectListSidebar';
import PresenceFriendsList from '../layout/PresenceFriendsList';
import SettingsPopup from '../common/SettingsPopup';
import NotificationPopup, { BellIcon } from '../common/NotificationPopup';
import InviteModal from '../common/InviteModal';
import VideoGrid from '../video/VideoGrid';
import StemRow from '../tracks/StemRow';
import Waveform from '../tracks/Waveform';
import FullMixDropZone from '../tracks/FullMixDropZone';
import SocialFeed from '../social/SocialFeed';
import TransportBar from '../audio/TransportBar';
import { TrackWithWidth, ArrangementDropZone, ArrangementScrollView, BarRuler, BarGridOverlay, ArrangementPlayhead, DraggableTrackList } from '../project/ArrangementComponents';

// ── SamplePackContentView (tightly coupled to parent state, kept inline) ──

function SamplePackContentView({
  pack, onRenamePack, onDeletePack, onRemoveSample, onRefresh, members, onInvite,
}: {
  pack: SamplePack & { items?: any[] };
  onRenamePack: (id: string, name: string) => void;
  onDeletePack: (id: string) => void;
  onRemoveSample: (packId: string, itemId: string) => void;
  onRefresh: (id: string) => void;
  members: { userId: string; displayName: string; role: string; avatarUrl?: string | null }[];
  onInvite: () => void;
}) {
  const items = pack.items || [];
  const [packDragOver, setPackDragOver] = useState(false);
  const [packUploading, setPackUploading] = useState(false);
  const [showPackMenu, setShowPackMenu] = useState(false);
  const packMenuRef = useRef<HTMLDivElement>(null);
  const [packStatus, setPackStatus] = useState('');

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (packMenuRef.current && !packMenuRef.current.contains(e.target as Node)) {
        setShowPackMenu(false);
      }
    };
    if (showPackMenu) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPackMenu]);

  const handlePackDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setPackDragOver(false);
    const droppedFiles = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith('audio/') || f.name.match(/\.(wav|mp3|flac|aiff|ogg|m4a|aac)$/i)
    );
    if (droppedFiles.length === 0) {
      setPackStatus('No audio files detected');
      setTimeout(() => setPackStatus(''), 2000);
      return;
    }
    setPackUploading(true);
    setPackStatus(`Uploading ${droppedFiles.length} file(s)...`);
    try {
      for (const file of droppedFiles) {
        const { fileId } = await api.uploadFile(pack.id, file);
        const sampleName = file.name.replace(/\.[^.]+$/, '');
        await api.addSamplePackItem(pack.id, { name: sampleName, fileId });
      }
      setPackStatus(`Added ${droppedFiles.length} sample(s)`);
      onRefresh(pack.id);
    } catch (err: any) {
      setPackStatus(err.message || 'Upload failed');
    } finally {
      setPackUploading(false);
      setTimeout(() => setPackStatus(''), 3000);
    }
  };

  const handlePackBrowse = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'audio/*,.wav,.mp3,.flac,.aiff,.ogg,.m4a,.aac';
    input.onchange = () => {
      if (input.files && input.files.length > 0) {
        const fakeEvent = { preventDefault: () => {}, dataTransfer: { files: input.files } } as unknown as React.DragEvent;
        handlePackDrop(fakeEvent);
      }
    };
    input.click();
  };

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2">
        {/* Pack info bar */}
        <div className="mb-4">
          <div className="flex items-center gap-3 bg-ghost-surface/80 rounded-lg border border-ghost-border/30 px-5 py-3 min-w-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5865F2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
            <input
              className="text-[15px] font-bold text-white bg-transparent border-none outline-none hover:bg-ghost-surface-hover px-2 py-1 rounded-lg transition-colors min-w-[60px] flex-1"
              value={pack.name}
              onChange={(e) => onRenamePack(pack.id, e.target.value)}
            />
            <span className="text-[12px] text-ghost-text-muted shrink-0">{items.length} sample{items.length !== 1 ? 's' : ''}</span>
            {pack.updatedAt && (
              <>
                <div className="w-px h-4 bg-ghost-border shrink-0" />
                <span className="text-[12px] text-ghost-text-muted flex items-center gap-1.5 shrink-0 whitespace-nowrap">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-60"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                  <span className="text-ghost-green font-medium">
                    {new Date(pack.updatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
                  </span>
                </span>
              </>
            )}
            <div className="relative" ref={packMenuRef}>
              <button onClick={() => setShowPackMenu(!showPackMenu)} className="w-6 h-6 flex items-center justify-center rounded text-ghost-text-muted hover:text-white hover:bg-ghost-surface-hover transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
              </button>
              {showPackMenu && (
                <div className="absolute right-0 top-full mt-1 w-40 bg-[#111214] rounded-lg shadow-popup animate-popup z-50 border border-white/5 py-1">
                  <button onClick={() => { if (confirm('Delete this sample pack? This cannot be undone.')) onDeletePack(pack.id); setShowPackMenu(false); }} className="w-full px-3 py-1.5 text-[13px] text-left text-ghost-error-red hover:bg-ghost-error-red/10 transition-colors flex items-center gap-2">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                    Delete Pack
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Collaborators bar */}
        {(() => {
          const { user } = useAuthStore.getState();
          const displayMembers = members.length > 0 ? members : user ? [{ userId: user.id, displayName: user.displayName, role: 'owner', avatarUrl: user.avatarUrl }] : [];
          return displayMembers.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-4 bg-ghost-surface/80 rounded-lg border border-ghost-border/30 px-5 py-2.5">
                <div className="flex items-center -space-x-2.5">
                  {[...displayMembers].sort((a: any, b: any) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : 0)).map((m: any) => (
                    <div key={m.userId} className="relative group cursor-pointer transition-transform hover:scale-110 hover:z-10" title={m.displayName} style={{ border: '3px solid #0F0F18', borderRadius: '50%' }}>
                      <Avatar name={m.displayName || '?'} src={m.avatarUrl} size="md" colour={m.role === 'owner' ? '#F0B232' : '#23A559'} />
                      <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full" style={{ background: '#23A559', border: '2.5px solid #0F0F18' }} />
                    </div>
                  ))}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 flex-wrap">
                    {[...displayMembers].sort((a: any, b: any) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : 0)).map((m: any, i: number) => (
                      <span key={m.userId} className="flex items-center gap-1">
                        <span className={`text-[14px] ${m.role === 'owner' ? 'font-bold text-ghost-host-gold' : 'font-medium text-ghost-text-primary'}`}>{m.displayName}</span>
                        {m.role === 'owner' && <span className="text-[10px] font-bold uppercase tracking-wider text-ghost-host-gold/70 bg-ghost-host-gold/10 px-1.5 py-px rounded">host</span>}
                        {i < displayMembers.length - 1 && <span className="text-ghost-text-muted/40 mx-0.5">/</span>}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#23A559' }} />
                    <span className="text-[14px] text-ghost-text-muted">{displayMembers.length} collaborator{displayMembers.length !== 1 ? 's' : ''} online</span>
                  </div>
                </div>
                <motion.button onClick={onInvite} className="w-[120px] h-11 rounded-full text-white text-[14px] font-semibold flex items-center justify-center gap-2 transition-all shadow-[0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.15)] hover:shadow-[0_0_20px_rgba(124,58,237,0.4),0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.2)] shrink-0" style={{ background: 'linear-gradient(180deg, #7C3AED 0%, #581C87 100%)' }} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></svg>
                  Invite
                </motion.button>
              </div>
            </div>
          );
        })()}

        {/* Samples drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setPackDragOver(true); }}
          onDragLeave={() => setPackDragOver(false)}
          onDrop={handlePackDrop}
          className={`rounded-xl overflow-hidden transition-all ${packDragOver ? 'bg-ghost-green/[0.04] border border-ghost-green/30 shadow-glow-green' : 'glass-subtle'}`}
        >
          <div className="flex items-center gap-3 px-4 py-2.5">
            <button className="w-7 h-7 rounded-full bg-ghost-surface-hover/60 flex items-center justify-center text-ghost-text-muted hover:text-ghost-green transition-colors">
              <svg width="9" height="11" viewBox="0 0 10 12" fill="currentColor"><polygon points="0,0 10,6 0,12" /></svg>
            </button>
            <span className="text-[11px] font-semibold text-ghost-text-muted/80 uppercase tracking-[0.1em]">Samples</span>
            <div className="flex-1" />
          </div>
          <div className={`h-[72px] relative overflow-hidden transition-colors ${packDragOver ? 'bg-ghost-green/5' : 'bg-ghost-bg/50'}`}>
            <div className="absolute inset-0 opacity-10 pointer-events-none"><Waveform seed="samplepack-demo-placeholder" height={72} /></div>
            <div className="absolute inset-0 flex items-center gap-3 pl-8 pr-5">
              {packUploading ? (
                <span className="text-[13px] text-ghost-green animate-pulse">{packStatus}</span>
              ) : packStatus ? (
                <span className="text-[13px] text-ghost-green">{packStatus}</span>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={packDragOver ? '#00FFC8' : 'rgba(255,255,255,0.4)'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))' }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                  <span className={`text-[13px] font-bold uppercase tracking-wide ml-2 ${packDragOver ? 'text-ghost-green' : 'text-purple-300'}`} style={{ textShadow: '0 2px 6px rgba(0,0,0,0.6), 0 0px 2px rgba(0,0,0,0.4)' }}>Drag audio files here</span>
                  <div className="flex-1" />
                  <button onClick={handlePackBrowse} className="px-3 py-1.5 text-[11px] font-semibold bg-white/5 border border-white/10 rounded-lg text-ghost-text-secondary hover:text-white hover:bg-white/10 hover:border-white/20 transition-all shrink-0">+ Add File</button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Sample rows */}
        <div className="space-y-2 mt-2">
          {items.map((sample: any) => (
            <StemRow key={sample.id} trackId={sample.id} name={sample.name} type="audio" fileId={sample.fileId} projectId={pack.id} onDelete={() => onRemoveSample(pack.id, sample.id)} onRename={() => {}} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Layout ──

export default function PluginLayout() {
  const { user, logout } = useAuthStore();
  const { projects, currentProject, fetchProjects, fetchProject, createProject, updateProject, addTrack, updateTrack, deleteTrack, versions, fetchVersions } = useProjectStore();
  const { join, leave, onlineUsers } = useSessionStore();

  // Domain hooks
  const notifs = useNotifications();
  const samplePackState = useSamplePacks();

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showSocial, setShowSocial] = useState(false);
  const [showMarketplace, setShowMarketplace] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [videoGridHidden, setVideoGridHidden] = useState(false);
  const [shareStatus, setShareStatus] = useState('');
  const [showAllBars, setShowAllBars] = useState(false);
  const vizModes = ['bars', 'wave', 'radial', 'ghost'] as const;
  const [vizModeIdx, setVizModeIdx] = useState(0);
  const vizMode = vizModes[vizModeIdx];
  const [isBeatView, setIsBeatView] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [trackZoom, setTrackZoom] = useState<'full' | 'half'>('full');
  const [headerSpeaking, setHeaderSpeaking] = useState(false);
  const [onlineActivity, setOnlineActivity] = useState<Map<string, OnlineUser>>(new Map());
  const [showNotifs, setShowNotifs] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showFriendSearch, setShowFriendSearch] = useState(false);
  const [friendSearchQuery, setFriendSearchQuery] = useState('');
  const [friendSearchResults, setFriendSearchResults] = useState<any[]>([]);
  const friendSearchRef = useRef<HTMLDivElement>(null);
  const friendSearchInputRef = useRef<HTMLInputElement>(null);
  const [friends, setFriends] = useState<{ id: string; displayName: string; avatarUrl: string | null }[]>([]);
  const [editingField, setEditingField] = useState<'name' | 'tempo' | 'key' | 'genre' | 'timeSig' | null>(null);
  const [projectTimeSig, setProjectTimeSig] = useState('');
  const [editValue, setEditValue] = useState('');
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [reverting, setReverting] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const cursorContainerRef = useRef<HTMLDivElement>(null);
  const [projectName, setProjectName] = useState('');
  const projectNameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [projectBpm, setProjectBpm] = useState('');
  const [projectKey, setProjectKey] = useState('');
  const bpmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentProjectId = useSessionStore((s) => s.currentProjectId);
  useCursorTracking(cursorContainerRef, currentProjectId);

  const audioCleanup = useAudioStore((s) => s.cleanup);
  const members = currentProject?.members || [];

  // ── Effects ──

  useEffect(() => {
    const interval = setInterval(() => { setHeaderSpeaking(!!(window as any).__ghostSpeaking); }, 100);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    onGlobalOnlineUsers((users) => {
      const map = new Map<string, OnlineUser>();
      users.forEach(u => map.set(u.userId, u));
      setOnlineActivity(map);
    });
  }, []);

  useEffect(() => {
    fetchProjects();
    api.listUsers().then(setFriends).catch(() => {});
  }, []);

  // Polling fallback: refresh project data periodically in case
  // socket.io project-updated events are missed (e.g. plugin WebView)
  useEffect(() => {
    if (!selectedProjectId) return;
    const pollTimer = setInterval(() => {
      fetchProject(selectedProjectId);
    }, 5000);
    return () => clearInterval(pollTimer);
  }, [selectedProjectId]);

  useEffect(() => {
    if (currentProject) {
      setProjectName(currentProject.name);
      setProjectBpm(currentProject.tempo ? String(currentProject.tempo) : '');
      setProjectKey(currentProject.key || '');
      setProjectTimeSig(currentProject.timeSignature || '');
    }
  }, [currentProject?.id, currentProject?.name]);

  useEffect(() => {
    if (!friendSearchQuery.trim()) { setFriendSearchResults([]); return; }
    const q = friendSearchQuery.toLowerCase();
    const matches = friends.filter((f) => f.displayName.toLowerCase().includes(q) || (f as any).email?.toLowerCase().includes(q));
    if (matches.length > 0) { setFriendSearchResults(matches as any); return; }
    const timer = setTimeout(() => {
      api.listUsers().then((users) => { setFriendSearchResults(users.filter((u) => u.displayName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))); }).catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [friendSearchQuery, friends]);

  useEffect(() => {
    if (!selectedProjectId && projects.length > 0) selectProject(projects[0].id);
  }, [projects]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (projectMenuRef.current && !projectMenuRef.current.contains(target)) {
        const portalMenu = document.querySelector('[data-project-menu-portal]');
        if (portalMenu && portalMenu.contains(target)) return;
        setShowProjectMenu(false);
      }
    };
    if (showProjectMenu) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showProjectMenu]);

  // ── Handlers ──

  // Notification handlers delegate to hook + refresh projects on accept
  const acceptInvite = async (id: string) => { const projectId = await notifs.acceptInvite(id); await fetchProjects(); if (projectId) selectProject(projectId); setShowNotifs(false); };
  const declineInvite = notifs.declineInvite;

  const selectProject = async (id: string) => {
    if (selectedProjectId) { leave(); audioCleanup(); }
    if (id === '__beats__') {
      const p = await createProject({ name: 'Untitled', projectType: 'beat' } as any);
      await fetchProjects();
      setSelectedProjectId(p.id);
      samplePackState.setSelectedPackId(null);
      setShowSocial(false);
      setIsBeatView(true);
      fetchProject(p.id);
      return;
    }
    setSelectedProjectId(id);
    samplePackState.setSelectedPackId(null);
    setShowSocial(false);
    setShowMarketplace(false);
    const proj = projects.find((p: any) => p.id === id);
    setIsBeatView((proj as any)?.projectType === 'beat');
    fetchProject(id);
    fetchVersions(id);
    join(id);
  };

  const handleCreateBeat = async () => {
    try {
      const res = await fetch(`${API_BASE}/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('ghost_token')}` }, body: JSON.stringify({ name: 'Untitled', projectType: 'beat' }) });
      const d = await res.json();
      if (d.data) { await fetchProjects(); selectProject(d.data.id); }
    } catch {}
  };

  const handleCreate = async () => { const p = await createProject({ name: 'Untitled' }); await fetchProjects(); selectProject(p.id); };
  const handleRevert = async (versionId: string) => { if (!selectedProjectId || reverting) return; setReverting(true); try { await api.revertToVersion(selectedProjectId, versionId); await fetchProject(selectedProjectId); await fetchVersions(selectedProjectId); } catch (err: any) { console.error('Revert failed:', err); } finally { setReverting(false); } };

  const handleDeleteProject = async () => {
    if (!selectedProjectId) return;
    if (!confirm('Are you sure you want to delete this project? This cannot be undone.')) return;
    try { await api.deleteProject(selectedProjectId); leave(); audioCleanup(); setSelectedProjectId(null); setShowProjectMenu(false); fetchProjects(); } catch (err: any) { alert(err.message || 'Failed to delete project'); setShowProjectMenu(false); }
  };

  const handleLeaveProject = async () => {
    if (!selectedProjectId) return;
    if (!confirm('Leave this project? You will need a new invite to rejoin.')) return;
    try { await api.leaveProject(selectedProjectId); leave(); audioCleanup(); setSelectedProjectId(null); setShowProjectMenu(false); fetchProjects(); } catch (err: any) { alert(err.message || 'Failed to leave project'); setShowProjectMenu(false); }
  };

  const handleShareProject = async () => {
    if (!selectedProjectId || !currentProject) return;
    setShowProjectMenu(false);
    try { await fetch(`${API_BASE}/social/posts`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('ghost_token')}` }, body: JSON.stringify({ text: `Check out my project "${currentProject.name}" 🎵`, projectId: selectedProjectId }) }); setShareStatus('Shared to feed!'); setTimeout(() => setShareStatus(''), 3000); } catch { setShareStatus('Failed to share'); setTimeout(() => setShareStatus(''), 3000); }
  };

  const handleCreatePack = async () => { const pack = await samplePackState.createPack(); if (pack) setSelectedProjectId(null); };
  const handleSelectPack = (id: string) => { samplePackState.selectPack(id); setSelectedProjectId(null); if (selectedProjectId) { leave(); audioCleanup(); } };
  const handleRenamePack = samplePackState.renamePack;
  const handleDeletePack = samplePackState.deletePack;
  const handleRemoveSampleFromPack = samplePackState.removeSample;

  // ── Render ──

  return (
    <div className="flex h-screen w-screen overflow-hidden relative">
      {/* Presence dock — full height left edge */}
      <div className="flex flex-col items-center justify-start shrink-0 w-14 pl-2 pt-4 pb-2 z-20">
        <motion.svg onClick={() => setVizModeIdx((i) => (i + 1) % vizModes.length)} width="38" height="40" viewBox="0 0 20 22" fill="none" className="shrink-0 cursor-pointer mb-5"style={{ filter: 'drop-shadow(0 0 4px rgba(0,255,200,0.3))' }} animate={{ y: [0, -2, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}>
          <defs><linearGradient id="ghostGradNav" x1="0" y1="0" x2="20" y2="22" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#00FFC8" /><stop offset="100%" stopColor="#7C3AED" /></linearGradient></defs>
          <path d="M10 1C5.5 1 2 4.5 2 9v8l2-2 2 2 2-2 2 2 2-2 2 2 2-2 2 2V9c0-4.5-3.5-8-8-8z" fill="rgba(0,255,200,0.08)" stroke="url(#ghostGradNav)" strokeWidth="1.5" strokeLinejoin="round" />
          <ellipse cx="7.5" cy="9.5" rx="1.6" ry="1.8" fill="url(#ghostGradNav)" opacity="0.9" /><ellipse cx="12.5" cy="9.5" rx="1.6" ry="1.8" fill="url(#ghostGradNav)" opacity="0.9" />
          <ellipse cx="7.5" cy="9.2" rx="0.6" ry="0.7" fill="#0A0412" /><ellipse cx="12.5" cy="9.2" rx="0.6" ry="0.7" fill="#0A0412" />
        </motion.svg>
        <div className="relative mb-3 cursor-pointer" onClick={() => { setShowSettings(!showSettings); setShowNotifs(false); }} title={user?.displayName || 'Profile'}>
          <div className="rounded-full p-[2px]" style={{ background: 'linear-gradient(180deg, #7C3AED 0%, #581C87 100%)' }}>
            <Avatar name={user?.displayName || '?'} src={user?.avatarUrl} size="md" />
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full" style={{ background: '#23A559', border: '2.5px solid #0A0412', boxShadow: '0 0 6px rgba(35,165,89,0.5)' }} />
        </div>
        <div className="w-6 h-px bg-white/10 mb-5" />
        <motion.button onClick={() => { setShowFriendSearch(!showFriendSearch); setFriendSearchQuery(''); }} className="w-9 h-9 rounded-full text-white flex items-center justify-center transition-all mb-5 shadow-[0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.15)] hover:shadow-[0_0_16px_rgba(124,58,237,0.4),0_2px_8px_rgba(0,0,0,0.3)]" style={{ background: 'linear-gradient(180deg, #7C3AED 0%, #581C87 100%)' }} whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} title="Add Friend">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        </motion.button>
        <div className="w-6 h-px bg-white/10 mb-5" />
        <PresenceFriendsList friends={friends} onlineActivity={onlineActivity} selectProject={selectProject} />
      </div>

      {/* Main column */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
      {/* Top bar */}
      <div className="shrink-0 h-[46px] flex items-center px-5 relative" style={{ background: 'transparent' }}>
        {currentProject && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-0 shrink-0">
            <div className="flex items-center gap-1 px-3 shrink-0">
              <span className="text-[13px] text-white/60 uppercase tracking-wider font-medium">BPM</span>
              <input type="text" inputMode="numeric" maxLength={3} className="w-12 text-[16px] font-bold text-white/80 outline-none px-1.5 py-0.5 rounded-lg transition-all text-center cursor-text" style={{ fontFamily: "'Consolas', monospace", background: 'rgba(20,10,40,0.6)', border: '1px solid rgba(124,58,237,0.15)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)' }} value={projectBpm} placeholder="" onChange={(e) => { const val = e.target.value.replace(/\D/g, '').slice(0, 3); setProjectBpm(val); if (bpmTimer.current) clearTimeout(bpmTimer.current); bpmTimer.current = setTimeout(() => { if (val) updateProject(currentProject.id, { tempo: parseInt(val) }); }, 500); }} onBlur={() => { if (bpmTimer.current) clearTimeout(bpmTimer.current); if (projectBpm) updateProject(currentProject.id, { tempo: parseInt(projectBpm) }); }} />
            </div>
            <div className="w-px h-5 bg-white/10 shrink-0" />
            <div className="flex items-center gap-1 px-3 shrink-0">
              <span className="text-[13px] text-white/60 uppercase tracking-wider font-medium">Time</span>
              <select className="text-[16px] font-bold text-white/80 outline-none px-1.5 py-0.5 rounded-lg transition-all text-center cursor-pointer appearance-none" style={{ fontFamily: "'Consolas', monospace", backgroundImage: 'none', background: 'rgba(20,10,40,0.6)', border: '1px solid rgba(124,58,237,0.15)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)' }} value={projectTimeSig || ''} onChange={(e) => { setProjectTimeSig(e.target.value); updateProject(currentProject.id, { timeSignature: e.target.value } as any); }}>
                <option value="" style={{ background: '#1a0e2e', color: '#fff' }}></option>
                {['2/4','3/4','4/4','5/4','6/4','7/4','6/8','7/8','9/8','12/8'].map(ts => (<option key={ts} style={{ background: '#1a0e2e', color: '#fff' }} value={ts}>{ts}</option>))}
              </select>
            </div>
            <div className="w-px h-5 bg-white/10 shrink-0" />
            <div className="flex items-center gap-1 px-3 shrink-0">
              <span className="text-[13px] text-white/60 uppercase tracking-wider font-medium">Key</span>
              <input type="text" maxLength={3} className="w-12 text-[16px] font-bold text-white/80 outline-none px-1.5 py-0.5 rounded-lg transition-all text-center cursor-text" style={{ fontFamily: "'Consolas', monospace", background: 'rgba(20,10,40,0.6)', border: '1px solid rgba(124,58,237,0.15)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)' }} value={projectKey} placeholder="" onChange={(e) => { const val = e.target.value.slice(0, 3); setProjectKey(val); if (keyTimer.current) clearTimeout(keyTimer.current); keyTimer.current = setTimeout(() => { if (val) updateProject(currentProject.id, { key: val }); }, 500); }} onBlur={() => { if (keyTimer.current) clearTimeout(keyTimer.current); if (projectKey) updateProject(currentProject.id, { key: projectKey }); }} />
            </div>
          </div>
        )}

        <div className="flex-1" />
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => { setShowSocial(true); setSelectedProjectId(null); samplePackState.setSelectedPackId(null); setShowMarketplace(false); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-white/50 hover:text-white transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>Social
          </button>
          <button onClick={() => { setShowMarketplace(true); setShowSocial(false); setSelectedProjectId(null); samplePackState.setSelectedPackId(null); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-white/50 hover:text-white transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></svg>Marketplace
          </button>
          <button onClick={() => { setShowFriendSearch(!showFriendSearch); setFriendSearchQuery(''); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-white/50 hover:text-white transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>Search
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 p-2 gap-2" style={{ paddingBottom: selectedProjectId && currentProject ? '48px' : '8px' }}>
        {/* Sidebar */}
        <div className={`relative flex flex-col self-stretch ${sidebarCollapsed ? 'w-4 shrink-0' : 'w-[210px] shrink-0 glass glass-glow'}`}>
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-5 h-10 flex items-center justify-center rounded-full glass hover:bg-white/[0.08] transition-colors"
            title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          >
            <svg width="8" height="12" viewBox="0 0 8 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-ghost-text-muted">
              {sidebarCollapsed ? <polyline points="2,1 6,6 2,11" /> : <polyline points="6,1 2,6 6,11" />}
            </svg>
          </button>
          {!sidebarCollapsed && (
            <div className="flex-1 min-h-0 flex flex-col">
              <ProjectListSidebar projects={projects.filter((p: any) => p.projectType !== 'beat')} allProjects={projects} selectedId={selectedProjectId} onSelect={selectProject} onCreate={handleCreate} onCreateBeat={handleCreateBeat} samplePacks={samplePackState.packs} selectedPackId={samplePackState.selectedPackId} onSelectPack={handleSelectPack} onCreatePack={handleCreatePack} friends={friends} />
            </div>
          )}
        </div>

        {/* Main content */}
        <div ref={cursorContainerRef} className="relative flex-1 flex flex-col min-w-0 overflow-hidden">
          <RemoteCursors />
          {showSettings && (<><div className="fixed inset-0 z-40" onClick={() => setShowSettings(false)} /><SettingsPopup user={user} onSignOut={() => { setShowSettings(false); logout(); }} onDeleteAccount={async () => { setShowSettings(false); await useAuthStore.getState().deleteAccount(); }} onClose={() => setShowSettings(false)} onProfile={() => { setShowSocial(true); setSelectedProjectId(null); samplePackState.setSelectedPackId(null); }} /></>)}
          {showNotifs && (<><div className="fixed inset-0 z-40" onClick={() => setShowNotifs(false)} /><NotificationPopup invitations={notifs.invitations} onAccept={acceptInvite} onDecline={declineInvite} notifications={notifs.notifications} onMarkRead={notifs.markAllRead} /></>)}
          {showInvite && selectedProjectId && <InviteModal open={showInvite} onClose={() => setShowInvite(false)} projectId={selectedProjectId} />}
          {showInvite && samplePackState.selectedPackId && !selectedProjectId && <InviteModal open={showInvite} onClose={() => setShowInvite(false)} projectId={samplePackState.selectedPackId!} />}

          <div className="flex-1 flex min-h-0 gap-2">
            {selectedProjectId && currentProject ? (
              <>
                <div className="flex-1 flex flex-col min-w-0">
                  {/* Project info bar */}
                  <div className="flex items-center gap-3 shrink-0 rounded-2xl mb-1 pl-6 pr-3 min-w-0 h-[50px] glass glass-glow">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00FFC8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-60"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                    <input className="text-[15px] font-bold text-white bg-transparent border border-transparent hover:bg-white/[0.04] hover:border-white/[0.08] focus:bg-white/[0.04] focus:border-ghost-green/30 outline-none px-2 py-0 rounded-md transition-colors min-w-[60px] flex-1 cursor-text" value={projectName} onChange={(e) => { const val = e.target.value; setProjectName(val); if (projectNameTimer.current) clearTimeout(projectNameTimer.current); projectNameTimer.current = setTimeout(() => { if (val.trim()) updateProject(currentProject.id, { name: val }); }, 500); }} onBlur={() => { if (projectNameTimer.current) clearTimeout(projectNameTimer.current); if (projectName.trim() && projectName !== currentProject.name) updateProject(currentProject.id, { name: projectName }); }} />
                    {currentProject.updatedAt && (<><div className="w-px h-5 bg-white/10 shrink-0" /><span className="text-[14px] text-ghost-green font-medium shrink-0 whitespace-nowrap ml-2">{new Date(currentProject.updatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span></>)}
                    <div className="relative z-20" ref={projectMenuRef}>
                      <button onClick={(e) => { e.stopPropagation(); setShowProjectMenu(!showProjectMenu); }} className="w-9 h-9 flex items-center justify-center rounded-md text-ghost-text-muted hover:text-white hover:bg-white/[0.1] transition-colors cursor-pointer">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2.5" /><circle cx="12" cy="12" r="2.5" /><circle cx="12" cy="19" r="2.5" /></svg>
                      </button>
                      {showProjectMenu && projectMenuRef.current && createPortal(
                        <div data-project-menu-portal className="fixed w-40 glass rounded-lg shadow-popup animate-popup border border-white/10 py-1" style={{ zIndex: 9999, top: (projectMenuRef.current.getBoundingClientRect().bottom || 0) + 4, left: (projectMenuRef.current.getBoundingClientRect().right || 0) - 160 }}>
                          <button onClick={() => { setShowProjectMenu(false); setShowVersionHistory(!showVersionHistory); if (!showVersionHistory && selectedProjectId) fetchVersions(selectedProjectId); }} className="w-full px-3 py-1.5 text-[13px] text-left text-ghost-text-secondary hover:bg-white/[0.06] hover:text-white transition-colors flex items-center gap-2"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>History</button>
                          <button onClick={handleShareProject} className="w-full px-3 py-1.5 text-[13px] text-left text-ghost-text-secondary hover:bg-white/[0.06] hover:text-white transition-colors flex items-center gap-2"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" /></svg>Share to Feed</button>
                          <button onClick={() => { setShowProjectMenu(false); setShowInvite(true); }} className="w-full px-3 py-1.5 text-[13px] text-left text-ghost-text-secondary hover:bg-white/[0.06] hover:text-white transition-colors flex items-center gap-2"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></svg>Invite Collaborator</button>
                          <div className="h-px bg-white/5 mx-2 my-1" />
                          {currentProject.ownerId === user?.id ? (
                            <button onClick={handleDeleteProject} className="w-full px-3 py-1.5 text-[13px] text-left text-ghost-error-red hover:bg-ghost-error-red/10 transition-colors flex items-center gap-2"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>Delete Project</button>
                          ) : (
                            <button onClick={handleLeaveProject} className="w-full px-3 py-1.5 text-[13px] text-left text-ghost-error-red hover:bg-ghost-error-red/10 transition-colors flex items-center gap-2"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>Leave Project</button>
                          )}
                        </div>, document.body
                      )}
                    </div>
                  </div>
                  <div className="flex-1 flex flex-col min-w-0 glass glass-glow rounded-2xl overflow-hidden">
                  <div className="flex-1 flex flex-col min-h-0">
                  <div className="flex-1 overflow-y-auto p-4">
                    {shareStatus && <div className="mb-3 px-4 py-2 rounded-lg bg-purple-500/20 border border-purple-500/30 text-[13px] text-purple-300 font-medium text-center">{shareStatus}</div>}

                    {showVersionHistory && (
                      <div className="mb-4 glass-subtle overflow-hidden">
                        <div className="px-4 py-2 border-b border-ghost-border/30 flex items-center justify-between">
                          <span className="text-[13px] font-bold text-ghost-text-secondary uppercase tracking-wider">Version History</span>
                          <span className="text-[11px] text-ghost-text-muted">{versions.length} snapshot{versions.length !== 1 ? 's' : ''}</span>
                        </div>
                        <div className="max-h-48 overflow-y-auto">
                          {versions.length === 0 ? (
                            <div className="px-4 py-4 text-center text-[12px] text-ghost-text-muted italic">No snapshots yet — changes will be saved automatically</div>
                          ) : versions.map((v: any) => (
                            <div key={v.id} className="flex items-center gap-3 px-4 py-2 border-b border-ghost-border/20 hover:bg-ghost-surface-light/30 transition-colors group">
                              <div className="shrink-0"><Avatar name={v.createdByName || 'Unknown'} src={members.find((m: any) => m.userId === v.createdBy)?.avatarUrl || (v.createdBy === user?.id ? user?.avatarUrl : null)} size="sm" /></div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[13px] text-ghost-text-primary font-medium truncate">{v.name}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-[11px] text-ghost-text-muted">{v.createdByName || 'Unknown'}</span>
                                  <span className="text-[11px] text-ghost-green font-medium">{new Date(v.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}</span>
                                </div>
                              </div>
                              <span className="text-[11px] font-mono text-ghost-purple bg-ghost-purple/10 px-2 py-0.5 rounded shrink-0">V{v.versionNumber}</span>
                              {(v.snapshotJson || v.snapshot) && (
                                <button onClick={() => handleRevert(v.id)} disabled={reverting} className="opacity-0 group-hover:opacity-100 text-[11px] font-semibold px-2 py-1 bg-ghost-surface-light border border-ghost-border rounded text-ghost-text-secondary hover:text-white hover:border-ghost-purple transition-all shrink-0">{reverting ? '...' : 'Revert'}</button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Collaborators bar */}
                    <div className="mb-4">
                    <div className="flex items-center gap-4 glass-subtle px-5 h-[68px]">
                      <div className="flex items-center -space-x-2">
                        {[...members].sort((a: any, b: any) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : 0)).map((m: any) => {
                          const isOnline = onlineUsers.some((u) => u.userId === m.userId);
                          return (
                          <div key={m.userId} className="relative group cursor-pointer transition-transform hover:scale-105 hover:z-10" title={m.displayName} style={{ border: '2.5px solid #0A0A0F', borderRadius: '50%' }}><Avatar name={m.displayName || '?'} src={m.avatarUrl} size="lg" colour={m.role === 'owner' ? '#F0B232' : '#23A559'} />{isOnline && <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full" style={{ background: '#23A559', border: '2.5px solid #0A0A0F' }} />}</div>
                          );
                        })}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {[...members].filter((m: any) => m.role === 'owner').map((m: any) => (
                            <span key={m.userId} className="flex items-center gap-1.5"><span className="text-[15px] font-semibold text-ghost-text-primary">{m.displayName}</span><span className="text-[10px] font-bold uppercase tracking-wider text-white bg-[#5865F2] px-2 py-0.5 rounded-md">HOST</span></span>
                          ))}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">{onlineUsers.length > 0 && <motion.span className="w-2 h-2 rounded-full bg-[#23A559]" animate={{ boxShadow: ['0 0 0px rgba(35,165,89,0)', '0 0 8px rgba(35,165,89,0.6)', '0 0 0px rgba(35,165,89,0)'] }} transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }} />}<span className="text-[13px] text-ghost-text-muted">{onlineUsers.length} collaborator{onlineUsers.length !== 1 ? 's' : ''} online</span></div>
                      </div>
                      <motion.button onClick={() => setShowInvite(!showInvite)} className="w-[120px] h-11 rounded-full text-white text-[14px] font-semibold flex items-center justify-center gap-2 transition-all shadow-[0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.15)] hover:shadow-[0_0_20px_rgba(124,58,237,0.4),0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.2)] shrink-0" style={{ background: 'linear-gradient(180deg, #7C3AED 0%, #581C87 100%)' }} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></svg>Invite
                      </motion.button>
                    </div>
                    </div>

                    {/* Arrangement — scrollable 16-bar viewport or full view */}
                    <div className="flex items-center gap-1 mb-1">
                      <button
                        onClick={() => {
                          if (!currentProject?.tracks) return;
                          const items = currentProject.tracks
                            .filter((t: any) => t.fileId)
                            .map((t: any) => ({
                              url: api.getDirectDownloadUrl(selectedProjectId!, t.fileId),
                              name: (t.name || 'stem') + '.wav',
                            }));
                          if (items.length === 0) return;
                          // Set global variable for C++ timer to pick up
                          (window as any).__ghostPendingExport = JSON.stringify(items);
                          console.log('[DownloadStems] Set pending export:', items.length, 'items');
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors"
                        style={{ backgroundColor: '#00FFC8', color: '#000' }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        Download Stems
                      </button>
                      <div className="flex-1" />
                      <button onClick={() => setTrackZoom('half')} className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${trackZoom === 'half' ? 'text-ghost-green' : 'text-white/30 hover:text-white/60'}`} title="Compact">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
                      </button>
                      <button onClick={() => setTrackZoom('full')} className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${trackZoom === 'full' ? 'text-ghost-green' : 'text-white/30 hover:text-white/60'}`} title="Full Height">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
                      </button>
                      <div className="w-px h-4 bg-white/10" />
                      <button onClick={() => setShowAllBars(!showAllBars)} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${showAllBars ? 'text-ghost-green bg-ghost-green/10' : 'text-white/40 hover:text-white/60 bg-white/[0.03]'}`}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          {showAllBars ? <><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" /></> : <><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></>}
                        </svg>
                        {showAllBars ? '16 Bars' : 'Full View'}
                      </button>
                    </div>
                    <ArrangementDropZone projectId={selectedProjectId!} onFilesAdded={() => fetchProject(selectedProjectId!)}>
                      <ArrangementScrollView showAll={showAllBars}>
                      <BarRuler />
                      <FullMixDropZone projectId={selectedProjectId!} onFilesAdded={() => fetchProject(selectedProjectId!)} isBeat={isBeatView} compact={trackZoom === 'half'} />
                      <DraggableTrackList tracks={currentProject.tracks} selectedProjectId={selectedProjectId!} deleteTrack={deleteTrack} updateTrack={updateTrack} trackZoom={trackZoom} fetchProject={fetchProject} />
                      <ArrangementPlayhead />
                      </ArrangementScrollView>
                    </ArrangementDropZone>
                  </div>
                  </div>
                  </div>
                </div>

                {/* Right panel */}
                <div className={`relative flex flex-col min-h-0 h-full gap-1 ${chatCollapsed ? 'w-4 shrink-0' : 'overflow-hidden'}`}>
                  <button onClick={() => setChatCollapsed(!chatCollapsed)} className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-5 h-10 flex items-center justify-center rounded-full glass hover:bg-white/[0.08] transition-colors" title={chatCollapsed ? 'Show chat' : 'Hide chat'}>
                    <svg width="8" height="12" viewBox="0 0 8 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-ghost-text-muted">{chatCollapsed ? <polyline points="2,1 6,6 2,11" /> : <polyline points="6,1 2,6 6,11" />}</svg>
                  </button>
                  {!chatCollapsed && (
                    <>
                    <div className="w-[300px] shrink-0 flex items-center justify-evenly glass glass-glow rounded-2xl h-[50px]">
                      <button onClick={() => setVideoGridHidden(!videoGridHidden)} className={`transition-colors ${!videoGridHidden ? 'text-ghost-green' : 'text-white/40 hover:text-ghost-green'}`} title={videoGridHidden ? 'Show Video Grid' : 'Hide Video Grid'}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></svg></button>
                      <button onClick={() => { setShowNotifs(!showNotifs); setShowSettings(false); if (!showNotifs && notifs.notifications.length > 0) notifs.markAllRead(); }} className="text-white/40 hover:text-ghost-green transition-colors"><BellIcon count={notifs.totalCount} /></button>
                      <button className="text-white/40 hover:text-ghost-green transition-colors" title="Inbox"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></svg></button>
                      <button onClick={() => { setShowSettings(!showSettings); setShowNotifs(false); }} className="shrink-0 rounded-full outline-none focus:outline-none"><Avatar name={user?.displayName || '?'} src={user?.avatarUrl} size="sm" /></button>
                    </div>
                    {!videoGridHidden && <div className="w-[300px] shrink-0"><VideoGrid members={members} userId={user?.id} onAddFriend={() => { setShowFriendSearch(true); setFriendSearchQuery(''); setTimeout(() => { friendSearchInputRef.current?.focus(); }, 100); }} /></div>}
                    <div className="w-[300px] flex flex-col min-h-0 flex-1 overflow-hidden glass glass-glow rounded-2xl"><ChatPanel /></div>
                    </>
                  )}
                </div>
              </>
            ) : samplePackState.selectedPackId && samplePackState.selectedPack ? (
              <>
                <SamplePackContentView pack={samplePackState.selectedPack} onRenamePack={handleRenamePack} onDeletePack={handleDeletePack} onRemoveSample={handleRemoveSampleFromPack} onRefresh={samplePackState.fetchDetail} members={members} onInvite={() => setShowInvite(true)} />
                <div className={`relative flex flex-col min-h-0 h-full gap-2 ${chatCollapsed ? 'w-4 shrink-0' : 'overflow-hidden'}`}>
                  <button onClick={() => setChatCollapsed(!chatCollapsed)} className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-5 h-10 flex items-center justify-center rounded-full glass hover:bg-white/[0.08] transition-colors" title={chatCollapsed ? 'Show chat' : 'Hide chat'}>
                    <svg width="8" height="12" viewBox="0 0 8 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-ghost-text-muted">{chatCollapsed ? <polyline points="2,1 6,6 2,11" /> : <polyline points="6,1 2,6 6,11" />}</svg>
                  </button>
                  {!chatCollapsed && (
                    <>
                    <div className="w-[300px] shrink-0"><VideoGrid members={members} userId={user?.id} onAddFriend={() => { setShowFriendSearch(true); setFriendSearchQuery(''); setTimeout(() => { friendSearchInputRef.current?.focus(); }, 100); }} /></div>
                    <div className="w-[300px] flex flex-col min-h-0 flex-1 overflow-hidden glass glass-glow rounded-2xl"><ChatPanel /></div>
                    </>
                  )}
                </div>
              </>
            ) : showSocial ? (
              <SocialFeed user={user} friends={friends} />
            ) : showMarketplace ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-20 h-20 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-5"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></svg></div>
                  <h2 className="text-2xl font-bold text-white mb-2">Marketplace</h2>
                  <p className="text-[15px] text-white/40">Coming Soon</p>
                  <p className="text-[13px] text-white/25 mt-2 max-w-xs mx-auto">Buy and sell beats, samples, and presets with producers around the world.</p>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-ghost-text-muted text-sm italic">Select a project or create a new one</div>
            )}
          </div>
        </div>
      </div>

      </div>{/* close main column */}

      {/* Transport bar — full width bottom */}
      {selectedProjectId && currentProject && (
        <div className="absolute bottom-0 left-0 right-0 z-30">
          <TransportBar tracks={currentProject.tracks} projectId={selectedProjectId!} projectTempo={currentProject.tempo} onTempoChange={(bpm) => updateProject(selectedProjectId!, { tempo: bpm })} trackZoom={trackZoom} onZoomChange={setTrackZoom} vizMode={vizMode} />
        </div>
      )}
    </div>
  );
}

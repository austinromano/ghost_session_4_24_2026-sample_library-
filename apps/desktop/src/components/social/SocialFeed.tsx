import { useState, useRef, useEffect } from 'react';
import Avatar from '../common/Avatar';
import CommunityRooms from './CommunityRooms';
import { API_BASE } from '../../lib/constants';
import { devWarn } from '../../lib/log';

function SocialAudioPlayer({ audioFileId }: { audioFileId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [waveData, setWaveData] = useState<Float32Array | null>(null);

  useEffect(() => {
    let cancelled = false;
    const url = `${API_BASE}/social/audio/${audioFileId}`;
    const token = localStorage.getItem('ghost_token');
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then(buf => {
        const ctx = new AudioContext();
        return ctx.decodeAudioData(buf.slice(0)).then(decoded => { ctx.close(); return decoded; });
      })
      .then(decoded => {
        if (cancelled) return;
        bufferRef.current = decoded;
        setWaveData(decoded.getChannelData(0));
        setReady(true);
      })
      .catch((err) => devWarn('SocialFeed.loadAudio', err));
    return () => { cancelled = true; };
  }, [audioFileId]);

  // Draw waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !waveData) return;
    const draw = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      const ctx = canvas.getContext('2d')!;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, w, h);
      const mid = h / 2;
      const spp = waveData.length / w;
      for (let x = 0; x < w; x++) {
        const t = x / w;
        const r = Math.round(0x00 + (0x8B - 0x00) * t);
        const g = Math.round(0xFF + (0x5C - 0xFF) * t);
        const b = Math.round(0xC8 + (0xF6 - 0xC8) * t);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        let max = 0;
        const start = Math.floor(x * spp);
        const end = Math.min(Math.floor((x + 1) * spp), waveData.length);
        for (let j = start; j < end; j++) { const abs = Math.abs(waveData[j]); if (abs > max) max = abs; }
        const peakH = max * mid * 0.84;
        if (peakH > 0.5) ctx.fillRect(x, mid - peakH, 1, peakH * 2);
      }
    };
    draw();
    const obs = new ResizeObserver(draw);
    obs.observe(container);
    return () => obs.disconnect();
  }, [waveData]);

  const handlePlay = () => {
    if (isPlaying && sourceRef.current) {
      try { sourceRef.current.stop(); } catch {}
      sourceRef.current = null;
      setIsPlaying(false);
      return;
    }
    if (!bufferRef.current) return;
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    const ctx = ctxRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    const source = ctx.createBufferSource();
    source.buffer = bufferRef.current;
    source.connect(ctx.destination);
    source.onended = () => { setIsPlaying(false); sourceRef.current = null; };
    source.start(0);
    sourceRef.current = source;
    setIsPlaying(true);
  };

  return (
    <div className="rounded-xl border border-white/10 overflow-hidden flex items-center h-[60px] bg-[#0a0a14]">
      <button
        onClick={handlePlay}
        disabled={!ready}
        className={`w-12 h-full flex items-center justify-center shrink-0 border-r border-purple-500/20 transition-colors ${
          isPlaying ? 'bg-purple-500/20 text-purple-300' : ready ? 'hover:bg-purple-500/10 text-purple-400' : 'text-white/20'
        }`}
      >
        {isPlaying ? (
          <svg width="12" height="12" viewBox="0 0 12 14" fill="currentColor"><rect x="0" y="0" width="4" height="14" rx="1" /><rect x="8" y="0" width="4" height="14" rx="1" /></svg>
        ) : (
          <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor"><polygon points="0,0 10,6 0,12" /></svg>
        )}
      </button>
      <div ref={containerRef} className="flex-1 h-full overflow-hidden">
        <canvas ref={canvasRef} style={{ display: 'block' }} />
      </div>
    </div>
  );
}

function SocialFeed({ user, friends, initialProfileUserId, onProfileShown }: { user: any; friends: any[]; initialProfileUserId?: string | null; onProfileShown?: () => void }) {
  const [tab, setTab] = useState<'feed' | 'explore' | 'activity'>('feed');
  const [posts, setPosts] = useState<any[]>([]);
  const [newPost, setNewPost] = useState('');
  const [loading, setLoading] = useState(true);
  const [dropFile, setDropFile] = useState<File | null>(null);
  const [dropDragOver, setDropDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [exploreUsers, setExploreUsers] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [profileUser, setProfileUser] = useState<any>(null);
  // Tracks the "avatar-click from elsewhere" flow. Initialized true when the
  // feed mounts with a pending profile id so the tab content never flashes
  // before the fetched profile replaces it.
  const [isInitialProfileLoading, setIsInitialProfileLoading] = useState<boolean>(!!initialProfileUserId);
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  const [commentTexts, setCommentTexts] = useState<Record<string, string>>({});
  const [postComments, setPostComments] = useState<Record<string, any[]>>({});
  const authHeader = { Authorization: `Bearer ${localStorage.getItem('ghost_token')}` };
  const BASE = `${API_BASE}/social`;

  const loadFeed = () => { setLoading(true); fetch(`${BASE}/feed`, { headers: authHeader }).then(r => r.json()).then(d => { if (d.data) setPosts(d.data); }).catch((err) => devWarn('SocialFeed.loadFeed', err)).finally(() => setLoading(false)); };
  useEffect(() => { loadFeed(); }, []);

  // Load the profile when an id is passed in (e.g. an avatar click elsewhere
  // in the app routed here). Flip the loading flag on first so the loader
  // renders before the fetch resolves; clear it when setProfileUser fires.
  useEffect(() => {
    if (!initialProfileUserId) return;
    setIsInitialProfileLoading(true);
    setProfileUser(null);
    fetch(`${BASE}/profile/${initialProfileUserId}`, { headers: authHeader })
      .then((r) => r.json())
      .then((d) => {
        if (d.data) setProfileUser(d.data);
      })
      .catch((err) => devWarn('SocialFeed.loadProfile', err))
      .finally(() => setIsInitialProfileLoading(false));
    onProfileShown?.();
  }, [initialProfileUserId]);
  const loadExplore = () => { fetch(`${BASE}/explore`, { headers: authHeader }).then(r => r.json()).then(d => { if (d.data) setExploreUsers(d.data); }).catch((err) => devWarn('SocialFeed.loadExplore', err)); };
  const loadActivity = () => { fetch(`${BASE}/activity`, { headers: authHeader }).then(r => r.json()).then(d => { if (d.data) setActivities(d.data); }).catch((err) => devWarn('SocialFeed.loadActivity', err)); };
  const loadProfile = (userId: string) => { fetch(`${BASE}/profile/${userId}`, { headers: authHeader }).then(r => r.json()).then(d => { if (d.data) setProfileUser(d.data); }).catch((err) => devWarn('SocialFeed.loadProfile', err)); };

  const handlePost = async () => {
    if (!newPost.trim() && !dropFile) return;
    setUploading(true);
    try {
      let audioUrl = null;
      let fileName = null;
      if (dropFile) {
        // Upload the file to a temporary "shared" project
        const formData = new FormData();
        formData.append('file', dropFile);
        // Use a special shared uploads endpoint or reuse existing
        const uploadRes = await fetch(`${API_BASE}/social/upload`, {
          method: 'POST', headers: authHeader, body: formData,
        });
        const uploadData = await uploadRes.json();
        if (uploadData.data) {
          audioUrl = uploadData.data.fileId;
          fileName = dropFile.name;
        }
      }
      const text = newPost.trim() || (fileName ? `🎵 ${fileName.replace(/\.[^.]+$/, '')}` : '');
      const res = await fetch(`${BASE}/posts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ text, audioFileId: audioUrl }),
      });
      const d = await res.json();
      if (d.data) { if (fileName) d.data.audioFileName = fileName; setPosts(prev => [d.data, ...prev]); }
      setNewPost(''); setDropFile(null);
    } catch (err) { devWarn('SocialFeed.handlePost', err); }
    setUploading(false);
  };
  const toggleLike = async (postId: string) => {
    await fetch(`${BASE}/posts/${postId}/like`, { method: 'POST', headers: authHeader });
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, liked: !p.liked, likeCount: p.liked ? p.likeCount - 1 : p.likeCount + 1 } : p));
  };
  const addReaction = async (postId: string, emoji: string) => {
    const res = await fetch(`${BASE}/posts/${postId}/reactions`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader }, body: JSON.stringify({ emoji }) });
    const d = await res.json();
    if (d.data) setPosts(prev => prev.map(p => { if (p.id !== postId) return p; const rc = { ...p.reactionCounts }; const ur = [...(p.userReactions || [])]; if (d.data.reacted) { rc[emoji] = (rc[emoji] || 0) + 1; ur.push(emoji); } else { rc[emoji] = Math.max(0, (rc[emoji] || 0) - 1); if (!rc[emoji]) delete rc[emoji]; const i = ur.indexOf(emoji); if (i >= 0) ur.splice(i, 1); } return { ...p, reactionCounts: rc, userReactions: ur }; }));
  };
  const toggleFollow = async (userId: string) => {
    const res = await fetch(`${BASE}/follow/${userId}`, { method: 'POST', headers: authHeader }); const d = await res.json();
    if (d.data) { setExploreUsers(prev => prev.map(u => u.id === userId ? { ...u, isFollowing: d.data.following } : u)); if (profileUser?.id === userId) setProfileUser({ ...profileUser, isFollowing: d.data.following }); }
  };
  const toggleComments = async (postId: string) => {
    const next = new Set(expandedComments); if (next.has(postId)) { next.delete(postId); } else { next.add(postId); if (!postComments[postId]) { const res = await fetch(`${BASE}/posts/${postId}/comments`, { headers: authHeader }); const d = await res.json(); if (d.data) setPostComments(prev => ({ ...prev, [postId]: d.data })); } } setExpandedComments(next);
  };
  const submitComment = async (postId: string) => {
    const text = commentTexts[postId]?.trim(); if (!text) return;
    const res = await fetch(`${BASE}/posts/${postId}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader }, body: JSON.stringify({ text }) });
    const d = await res.json(); if (d.data) { setPostComments(prev => ({ ...prev, [postId]: [...(prev[postId] || []), d.data] })); setCommentTexts(prev => ({ ...prev, [postId]: '' })); setPosts(prev => prev.map(p => p.id === postId ? { ...p, commentCount: p.commentCount + 1 } : p)); }
  };

  const REACTIONS = ['❤️', '🔥'];

  const renderPost = (post: any) => (
    <div key={post.id} className="bg-[#1a1a2e]/80 rounded-2xl border border-white/5 p-4 hover:border-white/10 transition-all">
      {/* Author row */}
      <div className="flex items-center gap-3 mb-2">
        <div className="cursor-pointer hover:scale-105 transition-transform" onClick={() => { setProfileUser(null); loadProfile(post.userId); }}>
          <Avatar name={post.displayName || '?'} src={post.avatarUrl} size="md" />
        </div>
        <div className="flex-1">
          <span className="text-[15px] font-bold text-white cursor-pointer hover:text-purple-400 transition-colors" onClick={() => { setProfileUser(null); loadProfile(post.userId); }}>{post.displayName}</span>
          <p className="text-[12px] text-white/30">{new Date(post.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}</p>
        </div>
      </div>

      {/* Post text */}
      <p className="text-[15px] text-white/85 leading-relaxed whitespace-pre-wrap">{post.text}</p>

      {/* Audio waveform */}
      {post.audioFileId && (
        <div className="mt-4 rounded-xl overflow-hidden">
          <SocialAudioPlayer audioFileId={post.audioFileId} />
        </div>
      )}

      {/* Shared project card */}
      {post.projectName && (
        <div className="mt-4 bg-gradient-to-r from-purple-500/10 to-transparent rounded-xl border border-purple-500/20 p-4 flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-purple-500/20 flex items-center justify-center shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#B794F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-bold text-white truncate">{post.projectName}</p>
            <p className="text-[12px] text-purple-300/50">Shared project</p>
          </div>
        </div>
      )}

      {/* Action bar */}
      <div className="flex items-center gap-1 mt-3 pt-3 border-t border-white/5">
        <button onClick={() => toggleLike(post.id)} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all hover:bg-white/5 ${post.liked ? 'text-red-400' : 'text-white/40 hover:text-red-400'}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill={post.liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
          {post.likeCount > 0 ? post.likeCount : 'Like'}
        </button>
        <button onClick={() => addReaction(post.id, '🔥')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all hover:bg-white/5 ${post.userReactions?.includes('🔥') ? 'text-orange-400' : 'text-white/40 hover:text-orange-400'}`}>
          🔥 {(post.reactionCounts?.['🔥'] || 0) > 0 ? post.reactionCounts['🔥'] : ''}
        </button>
        <button onClick={() => toggleComments(post.id)} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all hover:bg-white/5 ${expandedComments.has(post.id) ? 'text-purple-400' : 'text-white/40 hover:text-purple-400'}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
          {post.commentCount > 0 ? post.commentCount : 'Comment'}
        </button>
      </div>

      {/* Comments section */}
      {expandedComments.has(post.id) && (
        <div className="mt-4 pt-4 border-t border-white/5 space-y-3">
          {(postComments[post.id] || []).map((c: any) => (
            <div key={c.id} className="flex gap-2.5">
              <Avatar name={c.displayName || '?'} src={c.avatarUrl} size="sm" />
              <div className="bg-white/5 rounded-xl px-3.5 py-2.5 flex-1">
                <span className="text-[12px] font-bold text-white">{c.displayName}</span>
                <p className="text-[13px] text-white/70 mt-0.5">{c.text}</p>
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <input value={commentTexts[post.id] || ''} onChange={(e) => setCommentTexts(prev => ({ ...prev, [post.id]: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') submitComment(post.id); }} placeholder="Write a comment..." className="flex-1 bg-white/5 rounded-xl px-4 py-2.5 text-[13px] text-white placeholder:text-white/25 outline-none border border-white/5 focus:border-purple-500/30 transition-colors" />
            <button onClick={() => submitComment(post.id)} className="px-4 py-2 rounded-xl text-[12px] font-bold bg-purple-500 text-white hover:bg-purple-400 transition-colors">Send</button>
          </div>
        </div>
      )}
    </div>
  );

  // While a profile is pending (avatar click from elsewhere in the app),
  // don't flash the feed/explore/activity tabs. Render a minimal loading
  // placeholder until the fetched profile replaces the view.
  if (isInitialProfileLoading && !profileUser) return (
    <div className="flex-1 flex flex-col min-h-0 items-center justify-center">
      <div className="text-[13px] text-white/40">Loading profile…</div>
    </div>
  );

  if (profileUser) return (
    <div className="flex-1 flex flex-col min-h-0"><div className="flex-1 overflow-y-auto px-6 pt-6 pb-4">
      <button onClick={() => setProfileUser(null)} className="text-[13px] text-purple-400 hover:text-purple-300 mb-4 flex items-center gap-1"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>Back</button>
      <div className="bg-ghost-surface rounded-xl border border-ghost-border/30 p-6 mb-6">
        <div className="flex items-center gap-4">
          <Avatar name={profileUser.displayName} src={profileUser.avatarUrl} size="lg" />
          <div className="flex-1"><h2 className="text-xl font-bold text-white">{profileUser.displayName}</h2><p className="text-[12px] text-white/40 mt-0.5">Joined {new Date(profileUser.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
            <div className="flex gap-4 mt-2 text-[13px]"><span className="text-white/60"><span className="font-bold text-white">{profileUser.followerCount}</span> followers</span><span className="text-white/60"><span className="font-bold text-white">{profileUser.followingCount}</span> following</span><span className="text-white/60"><span className="font-bold text-white">{profileUser.postCount}</span> posts</span></div>
          </div>
          {profileUser.id !== user?.id && <button onClick={() => toggleFollow(profileUser.id)} className={`px-4 py-2 rounded-lg text-[13px] font-semibold transition-colors ${profileUser.isFollowing ? 'bg-white/10 text-white hover:bg-red-500/20 hover:text-red-400' : 'bg-purple-500 text-white hover:bg-purple-600'}`}>{profileUser.isFollowing ? 'Unfollow' : 'Follow'}</button>}
        </div>
      </div>
      <h3 className="text-[14px] font-bold text-white/50 uppercase tracking-wider mb-3">Posts</h3>
      <div className="space-y-4">{(profileUser.posts || []).map(renderPost)}{(!profileUser.posts || profileUser.posts.length === 0) && <p className="text-[13px] text-white/30 italic text-center py-8">No posts yet</p>}</div>
    </div></div>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex gap-2 px-6 pt-3 pb-2">{(['feed', 'explore', 'activity'] as const).map(t => (
        <button key={t} onClick={() => { setTab(t); if (t === 'explore') loadExplore(); if (t === 'activity') loadActivity(); }}
          className={`px-5 py-2 rounded-xl text-[14px] font-bold transition-all capitalize ${tab === t ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30 shadow-[0_0_10px_rgba(139,92,246,0.1)]' : 'text-white/35 hover:text-white/60 hover:bg-white/5 border border-transparent'}`}>{t}</button>
      ))}</div>
      <div className="flex-1 overflow-y-auto px-5 pt-2 pb-3">
        {tab === 'feed' && (<>
          <div
            className={`bg-ghost-surface/60 rounded-xl border px-3 py-2 mb-3 transition-all ${dropDragOver ? 'border-purple-400/60 bg-purple-500/5' : 'border-white/[0.06]'}`}
            onDragOver={(e) => { e.preventDefault(); setDropDragOver(true); }}
            onDragLeave={() => setDropDragOver(false)}
            onDrop={(e) => {
              e.preventDefault(); setDropDragOver(false);
              const file = Array.from(e.dataTransfer.files).find(f => f.type.startsWith('audio/') || f.name.match(/\.(wav|mp3|flac|aiff|ogg|m4a)$/i));
              if (file) setDropFile(file);
            }}
          >
            <div className="flex items-center gap-2">
              <Avatar name={user?.displayName || '?'} src={user?.avatarUrl} size="sm" />
              <input
                value={newPost}
                onChange={(e) => setNewPost(e.target.value)}
                placeholder={dropFile ? 'Add a caption…' : "What are you working on? Drop a sample or beat to share"}
                className="flex-1 min-w-0 bg-transparent text-[13px] text-white placeholder:text-white/35 outline-none"
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePost(); } }}
              />
              <button
                onClick={handlePost}
                disabled={(!newPost.trim() && !dropFile) || uploading}
                className="shrink-0 h-7 px-3 rounded-full text-[12px] font-semibold bg-purple-500 text-white hover:bg-purple-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                {uploading ? '…' : 'Post'}
              </button>
            </div>
            {dropFile && (
              <div className="flex items-center gap-2 mt-2 px-2.5 py-1.5 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#B794F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                <span className="text-[12px] text-purple-300 flex-1 truncate">{dropFile.name}</span>
                <button onClick={() => setDropFile(null)} className="text-white/30 hover:text-white text-[11px]">×</button>
              </div>
            )}
          </div>
          <CommunityRooms />
          {loading ? <div className="text-center text-white/30 py-12">Loading...</div> : posts.length === 0 ? (
            <div className="text-center py-16"><div className="w-16 h-16 rounded-full bg-purple-500/10 flex items-center justify-center mx-auto mb-4"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#B794F6" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg></div><p className="text-[16px] text-white font-semibold">No posts yet</p><p className="text-[13px] text-white/40 mt-1">Share what you're working on</p></div>
          ) : <div className="space-y-3">{posts.map(renderPost)}</div>}
        </>)}
        {tab === 'explore' && (<div className="space-y-3"><p className="text-[13px] text-white/40 mb-4">Discover producers</p>{exploreUsers.map(u => (
          <div key={u.id} className="bg-ghost-surface rounded-xl border border-ghost-border/30 p-4 flex items-center gap-4">
            <div className="cursor-pointer" onClick={() => loadProfile(u.id)}><Avatar name={u.displayName} src={u.avatarUrl} size="md" /></div>
            <div className="flex-1 min-w-0"><span className="text-[14px] font-semibold text-white cursor-pointer hover:text-purple-400 transition-colors" onClick={() => loadProfile(u.id)}>{u.displayName}</span><p className="text-[12px] text-white/30">{u.followerCount} followers &middot; {u.postCount} posts</p></div>
            <button onClick={() => toggleFollow(u.id)} className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${u.isFollowing ? 'bg-white/10 text-white hover:bg-red-500/20 hover:text-red-400' : 'bg-purple-500 text-white hover:bg-purple-600'}`}>{u.isFollowing ? 'Following' : 'Follow'}</button>
          </div>
        ))}{exploreUsers.length === 0 && <p className="text-center text-white/30 py-12 italic">No users to discover</p>}</div>)}
        {tab === 'activity' && (<div className="space-y-2"><p className="text-[13px] text-white/40 mb-4">Recent activity</p>{activities.map((a, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3 bg-ghost-surface rounded-lg border border-ghost-border/30">
            <Avatar name={a.displayName || '?'} src={a.avatarUrl} size="sm" />
            <div className="flex-1 min-w-0"><p className="text-[13px] text-white/80"><span className="font-semibold text-white">{a.displayName}</span> {a.message}</p><p className="text-[11px] text-white/30">{new Date(a.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}</p></div>
            {a.type === 'upload' && <span className="text-[10px] font-bold text-ghost-green bg-ghost-green/10 px-2 py-0.5 rounded uppercase">Upload</span>}
          </div>
        ))}{activities.length === 0 && <p className="text-center text-white/30 py-12 italic">No recent activity</p>}</div>)}
      </div>
    </div>
  );
}

export default SocialFeed;

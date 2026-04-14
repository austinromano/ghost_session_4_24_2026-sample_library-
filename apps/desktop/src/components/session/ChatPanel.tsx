import { useState, useRef, useEffect, useCallback } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { useAuthStore } from '../../stores/authStore';
import Avatar from '../common/Avatar';
import {
  getSocket,
  sendWebRTCOffer,
  sendWebRTCAnswer,
  sendICECandidate,
  sendWebRTCLeave,
} from '../../lib/socket';
import type { StreamType } from '@ghost/protocol';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

interface PeerState {
  pc: RTCPeerConnection;
  stream: MediaStream | null;
  displayName: string;
}

// Use prefixed keys: "camera:userId" or "screen:userId"
function peerKey(userId: string, streamType: StreamType): string {
  return `${streamType}:${userId}`;
}

export default function ChatPanel() {
  const { chatMessages, sendMessage, deleteMessage, onlineUsers, currentProjectId } = useSessionStore();
  const userId = useAuthStore((s) => s.user?.id);
  const currentUser = useAuthStore((s) => s.user);
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const emojiRef = useRef<HTMLDivElement>(null);
  const [showGifs, setShowGifs] = useState(false);
  const [gifQuery, setGifQuery] = useState('');
  const [gifResults, setGifResults] = useState<{ id: string; url: string; preview: string }[]>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const gifSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const GIPHY_KEY = 'GlVGYHkr3WSBnllca54iNt0yFbjz7L65';
  const searchGifs = (q: string) => {
    if (gifSearchTimer.current) clearTimeout(gifSearchTimer.current);
    if (!q.trim()) {
      gifSearchTimer.current = setTimeout(async () => {
        setGifLoading(true);
        try {
          const res = await fetch(`https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_KEY}&limit=12&rating=pg-13`);
          const data = await res.json();
          setGifResults(data.data.map((g: any) => ({ id: g.id, url: g.images.fixed_height.url, preview: g.images.fixed_width_small.url })));
        } catch {}
        setGifLoading(false);
      }, 100);
      return;
    }
    gifSearchTimer.current = setTimeout(async () => {
      setGifLoading(true);
      try {
        const res = await fetch(`https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(q)}&limit=12&rating=pg-13`);
        const data = await res.json();
        setGifResults(data.data.map((g: any) => ({ id: g.id, url: g.images.fixed_height.url, preview: g.images.fixed_width_small.url })));
      } catch {}
      setGifLoading(false);
    }, 300);
  };

  const sendGif = (url: string) => {
    sendMessage(`[gif]${url}[/gif]`);
    setShowGifs(false);
    setGifQuery('');
    setGifResults([]);
  };

  // Camera state
  const [videoOn, setVideoOn] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);

  // Screen share state
  const [screenOn, setScreenOn] = useState(false);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const localScreenRef = useRef<HTMLVideoElement>(null);

  const bottomRef = useRef<HTMLDivElement>(null);

  // All peer connections (camera + screen) keyed by "camera:userId" or "screen:userId"
  const peersRef = useRef<Map<string, PeerState>>(new Map());
  const [peerStreams, setPeerStreams] = useState<Map<string, { stream: MediaStream; displayName: string; streamType: StreamType }>>(new Map());

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages.length]);

  // Close emoji picker on outside click
  useEffect(() => {
    if (!showEmoji) return;
    const handler = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) {
        setShowEmoji(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showEmoji]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      localStream?.getTracks().forEach((t) => { t.stop(); t.enabled = false; });
      screenStream?.getTracks().forEach((t) => { t.stop(); t.enabled = false; });
      peersRef.current.forEach((peer) => peer.pc.close());
    };
  }, []);

  const createPeerConnection = useCallback((remoteUserId: string, displayName: string, streamType: StreamType, sourceStream: MediaStream | null) => {
    const key = peerKey(remoteUserId, streamType);
    const existing = peersRef.current.get(key);
    if (existing) return existing.pc;

    const pc = new RTCPeerConnection(ICE_SERVERS);

    // Add local tracks from the appropriate stream
    if (sourceStream) {
      sourceStream.getTracks().forEach((track) => pc.addTrack(track, sourceStream));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate && currentProjectId) {
        sendICECandidate(currentProjectId, remoteUserId, e.candidate.toJSON(), streamType);
      }
    };

    pc.ontrack = (e) => {
      const [remoteStream] = e.streams;
      if (remoteStream) {
        setPeerStreams((prev) => {
          const next = new Map(prev);
          next.set(key, { stream: remoteStream, displayName, streamType });
          return next;
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        peersRef.current.delete(key);
        setPeerStreams((prev) => {
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
      }
    };

    peersRef.current.set(key, { pc, stream: null, displayName });
    return pc;
  }, [currentProjectId]);

  // Wire up signaling listeners
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleOffer = async ({ fromUserId, offer, streamType: st }: { fromUserId: string; offer: RTCSessionDescriptionInit; streamType?: StreamType }) => {
      if (!currentProjectId) return;
      const sType = st || 'camera';

      // For camera offers, we need localStream; for screen offers, receiver doesn't need a stream
      const sourceStream = sType === 'camera' ? localStream : null;

      const pc = createPeerConnection(fromUserId, '', sType, sourceStream);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendWebRTCAnswer(currentProjectId, fromUserId, answer, sType);
    };

    const handleAnswer = async ({ fromUserId, answer, streamType: st }: { fromUserId: string; answer: RTCSessionDescriptionInit; streamType?: StreamType }) => {
      const sType = st || 'camera';
      const key = peerKey(fromUserId, sType);
      const peer = peersRef.current.get(key);
      if (peer) {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    };

    const handleIceCandidate = async ({ fromUserId, candidate, streamType: st }: { fromUserId: string; candidate: RTCIceCandidateInit; streamType?: StreamType }) => {
      const sType = st || 'camera';
      const key = peerKey(fromUserId, sType);
      const peer = peersRef.current.get(key);
      if (peer) {
        await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    };

    const handleUserLeft = ({ userId: leftUserId, streamType: st }: { userId: string; streamType?: StreamType }) => {
      // If streamType specified, only clean up that type; otherwise clean up both
      const types: StreamType[] = st ? [st] : ['camera', 'screen'];
      for (const sType of types) {
        const key = peerKey(leftUserId, sType);
        const peer = peersRef.current.get(key);
        if (peer) {
          peer.pc.close();
          peersRef.current.delete(key);
          setPeerStreams((prev) => {
            const next = new Map(prev);
            next.delete(key);
            return next;
          });
        }
      }
    };

    socket.on('webrtc-offer', handleOffer);
    socket.on('webrtc-answer', handleAnswer);
    socket.on('webrtc-ice-candidate', handleIceCandidate);
    socket.on('webrtc-user-left', handleUserLeft);

    return () => {
      socket.off('webrtc-offer', handleOffer);
      socket.off('webrtc-answer', handleAnswer);
      socket.off('webrtc-ice-candidate', handleIceCandidate);
      socket.off('webrtc-user-left', handleUserLeft);
    };
  }, [localStream, screenStream, currentProjectId, createPeerConnection]);

  // Attach local camera to video element
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, videoOn]);

  // Attach local screen to video element
  useEffect(() => {
    if (localScreenRef.current && screenStream) {
      localScreenRef.current.srcObject = screenStream;
    }
  }, [screenStream, screenOn]);

  // ── Camera ──────────────────────────────────────────────────────────

  const startVideo = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);
      setVideoOn(true);

      if (currentProjectId) {
        for (const u of onlineUsers) {
          if (u.userId === userId) continue;
          const pc = createPeerConnection(u.userId, u.displayName, 'camera', stream);
          stream.getTracks().forEach((track) => {
            if (!pc.getSenders().find((s) => s.track === track)) {
              pc.addTrack(track, stream);
            }
          });
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendWebRTCOffer(currentProjectId, u.userId, offer, 'camera');
        }
      }
    } catch (err) {
      console.error('Failed to access camera:', err);
    }
  };

  const stopVideo = () => {
    if (localStream) {
      localStream.getTracks().forEach((t) => { t.stop(); t.enabled = false; });
      setLocalStream(null);
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    // Close camera peer connections
    peersRef.current.forEach((peer, key) => {
      if (key.startsWith('camera:')) {
        peer.pc.close();
        peersRef.current.delete(key);
      }
    });
    setPeerStreams((prev) => {
      const next = new Map(prev);
      for (const key of prev.keys()) {
        if (key.startsWith('camera:')) next.delete(key);
      }
      return next;
    });
    setVideoOn(false);
    if (currentProjectId) {
      sendWebRTCLeave(currentProjectId, 'camera');
    }
  };

  // ── Screen Share ────────────────────────────────────────────────────

  const startScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      setScreenStream(stream);
      setScreenOn(true);

      // When user clicks browser's "Stop sharing" button
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        stopScreenShare();
      });

      if (currentProjectId) {
        for (const u of onlineUsers) {
          if (u.userId === userId) continue;
          const pc = createPeerConnection(u.userId, u.displayName, 'screen', stream);
          stream.getTracks().forEach((track) => {
            if (!pc.getSenders().find((s) => s.track === track)) {
              pc.addTrack(track, stream);
            }
          });
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendWebRTCOffer(currentProjectId, u.userId, offer, 'screen');
        }
      }
    } catch (err) {
      console.error('Failed to share screen:', err);
    }
  };

  const stopScreenShare = () => {
    if (screenStream) {
      screenStream.getTracks().forEach((t) => { t.stop(); t.enabled = false; });
      setScreenStream(null);
    }
    if (localScreenRef.current) {
      localScreenRef.current.srcObject = null;
    }
    // Close screen peer connections
    peersRef.current.forEach((peer, key) => {
      if (key.startsWith('screen:')) {
        peer.pc.close();
        peersRef.current.delete(key);
      }
    });
    setPeerStreams((prev) => {
      const next = new Map(prev);
      for (const key of prev.keys()) {
        if (key.startsWith('screen:')) next.delete(key);
      }
      return next;
    });
    setScreenOn(false);
    if (currentProjectId) {
      sendWebRTCLeave(currentProjectId, 'screen');
    }
  };

  // ── Chat ────────────────────────────────────────────────────────────

  const handleSend = () => {
    if (!text.trim()) return;
    sendMessage(text.trim());
    setText('');
  };

  // Split peer streams into camera and screen
  const cameraStreams = new Map<string, { stream: MediaStream; displayName: string }>();
  const screenShareStreams = new Map<string, { stream: MediaStream; displayName: string }>();
  peerStreams.forEach(({ stream, displayName, streamType }, key) => {
    const uid = key.replace(/^(camera|screen):/, '');
    if (streamType === 'screen') {
      screenShareStreams.set(uid, { stream, displayName });
    } else {
      cameraStreams.set(uid, { stream, displayName });
    }
  });

  const showMediaArea = videoOn || screenOn || screenShareStreams.size > 0 || cameraStreams.size > 0;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">

      {/* Media area removed — video now handled by VideoGrid */}

      {/* Chat messages — newest at top, Discord-style spacing */}
      <div className="flex-1 overflow-y-auto px-4 pt-2 pb-2">
        {chatMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-5 gap-2 text-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-ghost-text-muted/30">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <p className="text-[15px] text-ghost-text-secondary font-semibold text-center">Start the conversation</p>
            <p className="text-[14px] text-ghost-text-muted text-center">Send a message to<br />your collaborators</p>
          </div>
        )}
        {(() => {
          const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
          return chatMessages.map((msg, origIndex) => {
            const isOwn = msg.userId === userId;
            const sender = onlineUsers.find((u) => u.userId === msg.userId);
            const isGif = msg.text.startsWith('[gif]') && msg.text.endsWith('[/gif]');
            // Determine if previous message was from same user (group messages)
            const prev = origIndex > 0 ? chatMessages[origIndex - 1] : null;
            const sameAsPrev = prev && prev.userId === msg.userId && msg.timestamp - prev.timestamp < 5 * 60 * 1000;

            return (
              <div key={origIndex} className={`group relative flex items-end gap-2 ${isOwn ? 'justify-end' : 'justify-start'} ${sameAsPrev ? 'mt-0.5' : 'mt-3'}`}>
                {!isOwn && (
                  <div className={`shrink-0 w-8 ${sameAsPrev ? 'invisible' : ''}`}>
                    <Avatar name={msg.displayName} src={sender?.avatarUrl || null} size="sm" />
                  </div>
                )}
                <div className={`flex flex-col max-w-[75%] ${isOwn ? 'items-end' : 'items-start'}`}>
                  {isGif ? (
                    <img src={msg.text.slice(5, -6)} alt="GIF" className="rounded-2xl max-w-[200px] max-h-[150px]" loading="lazy" />
                  ) : (
                    <div
                      className={`px-3 py-2 text-[13px] leading-[1.35] break-words ${
                        isOwn
                          ? 'text-white rounded-[18px] rounded-br-md'
                          : 'text-ghost-text-primary rounded-[18px] rounded-bl-md'
                      }`}
                      style={{ background: isOwn ? '#7C3AED' : 'rgba(255,255,255,0.08)' }}
                    >
                      {msg.text}
                    </div>
                  )}
                  {!sameAsPrev && (
                    <span className="text-[10px] text-white/30 mt-1 px-2">{fmtTime(msg.timestamp)}</span>
                  )}
                </div>
                {isOwn && (
                  <button
                    onClick={() => deleteMessage(origIndex)}
                    className="absolute top-0 right-1 opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-ghost-text-muted hover:text-ghost-error-red hover:bg-ghost-error-red/10 transition-all"
                    title="Delete message"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                )}
              </div>
            );
          });
        })()}
        <div ref={bottomRef} />
      </div>

      {/* Chat input — Discord style */}
      <div className="px-3 pb-3 pt-1 relative shrink-0">
        {/* Emoji picker */}
        {showEmoji && (
          <div
            ref={emojiRef}
            className="absolute bottom-14 right-2 w-[220px] bg-[#111214] border border-ghost-border rounded-lg shadow-popup animate-popup p-2 z-50"
          >
            <div className="text-[10px] font-semibold text-ghost-text-muted uppercase tracking-wider px-1 pb-1.5">Smileys</div>
            <div className="grid grid-cols-7 gap-0.5">
              {['😀','😂','😍','🥳','😎','🤩','🥰','😭','🔥','💀','👀','💯','🎵','🎶','🎤','🎧','🎸','🥁','🎹','👻','✨'].map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => { setText((prev) => prev + emoji); setShowEmoji(false); }}
                  className="w-7 h-7 flex items-center justify-center text-base hover:bg-ghost-surface-hover rounded transition-colors"
                >
                  {emoji}
                </button>
              ))}
            </div>
            <div className="text-[10px] font-semibold text-ghost-text-muted uppercase tracking-wider px-1 pt-2 pb-1.5">Hands</div>
            <div className="grid grid-cols-7 gap-0.5">
              {['👍','👎','👏','🙌','🤝','✌️','🤟','🤙','💪','🫶','👊','✊','🫡','🎉'].map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => { setText((prev) => prev + emoji); setShowEmoji(false); }}
                  className="w-7 h-7 flex items-center justify-center text-base hover:bg-ghost-surface-hover rounded transition-colors"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}
        {/* GIF picker */}
        {showGifs && (
          <div className="mb-2 bg-[#111214] rounded-lg border border-white/10 overflow-hidden">
            <input
              autoFocus
              className="w-full bg-transparent text-[13px] text-white placeholder:text-white/30 px-3 py-2 outline-none border-b border-white/5"
              placeholder="Search GIFs..."
              value={gifQuery}
              onChange={(e) => { setGifQuery(e.target.value); searchGifs(e.target.value); }}
            />
            <div className="grid grid-cols-3 gap-1 p-1 max-h-[200px] overflow-y-auto">
              {gifLoading && <div className="col-span-3 text-center text-[11px] text-white/30 py-4">Loading...</div>}
              {gifResults.map(g => (
                <button key={g.id} onClick={() => sendGif(g.url)} className="rounded overflow-hidden hover:ring-2 hover:ring-ghost-purple transition-all">
                  <img src={g.preview} alt="" className="w-full h-[70px] object-cover" loading="lazy" />
                </button>
              ))}
              {!gifLoading && gifResults.length === 0 && gifQuery && <div className="col-span-3 text-center text-[11px] text-white/30 py-4">No results</div>}
            </div>
            <div className="px-2 py-1 text-[8px] text-white/20 text-right">Powered by GIPHY</div>
          </div>
        )}
        <div className="flex items-center bg-white/[0.04] rounded-lg border border-white/[0.08]">
          <input
            className="flex-1 min-w-0 bg-transparent text-[14px] text-ghost-text-primary placeholder:text-ghost-text-muted pl-3 py-2.5 pr-2 outline-none"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Message..."
          />
          {/* GIF button */}
          <button
            onClick={() => { setShowGifs(v => { if (!v) searchGifs(''); return !v; }); setShowEmoji(false); }}
            className={`shrink-0 w-8 h-8 flex items-center justify-center transition-colors rounded text-[11px] font-bold ${showGifs ? 'text-ghost-green' : 'text-ghost-text-muted hover:text-ghost-text-primary'}`}
          >
            GIF
          </button>
          {/* Emoji button */}
          <button
            onClick={() => { setShowEmoji((v) => !v); setShowGifs(false); }}
            className={`shrink-0 w-8 h-8 flex items-center justify-center transition-colors rounded ${showEmoji ? 'text-ghost-green' : 'text-ghost-text-muted hover:text-ghost-text-primary'}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm-4-9a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0zm5 0a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0zm-5.5 3.5a.75.75 0 0 1 1.06.02A4.47 4.47 0 0 0 12 16a4.47 4.47 0 0 0 3.44-1.48.75.75 0 1 1 1.08 1.04A5.97 5.97 0 0 1 12 17.5a5.97 5.97 0 0 1-4.52-1.94.75.75 0 0 1 .02-1.06z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function RemoteVideo({ stream, displayName, isScreen }: { stream: MediaStream; displayName: string; isScreen?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="relative rounded overflow-hidden bg-black aspect-video">
      <video ref={ref} autoPlay playsInline className={`w-full h-full ${isScreen ? 'object-contain' : 'object-cover'}`} />
      <span className={`absolute bottom-1 left-1 text-[9px] font-bold text-white px-1.5 py-0.5 rounded flex items-center gap-1 ${isScreen ? 'bg-blue-500/80' : 'bg-black/60'}`}>
        {isScreen && (
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        )}
        {displayName}{isScreen ? "'s screen" : ''}
      </span>
    </div>
  );
}

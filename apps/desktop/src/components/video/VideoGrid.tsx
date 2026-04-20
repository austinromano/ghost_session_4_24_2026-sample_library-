import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import Avatar from '../common/Avatar';
import { useSessionStore } from '../../stores/sessionStore';

interface WebRtcHandles {
  remoteStreams: Map<string, MediaStream>;
  remoteScreenStreams: Map<string, MediaStream>;
  publishStream: (stream: MediaStream, userIds: string[]) => Promise<void>;
  replaceStream: (stream: MediaStream) => void;
  stopStream: () => void;
  publishScreen: (stream: MediaStream, userIds: string[]) => Promise<void>;
  stopScreen: () => void;
}

export default function VideoGrid({ members, userId, onAddFriend, variant = 'grid', webrtc }: { members: any[]; userId?: string; onAddFriend?: () => void; variant?: 'grid' | 'row'; webrtc: WebRtcHandles }) {
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showMicMenu, setShowMicMenu] = useState(false);
  const [showCamMenu, setShowCamMenu] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [selectedCamId, setSelectedCamId] = useState<string>('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number>(0);
  const micMenuRef = useRef<HTMLDivElement>(null);
  const camMenuRef = useRef<HTMLDivElement>(null);
  const camBtnRef = useRef<HTMLButtonElement>(null);
  const micBtnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number } | null>(null);

  const onlineUsers = useSessionStore((s) => s.onlineUsers);
  const { remoteStreams, publishStream, replaceStream, stopStream, publishScreen, stopScreen } = webrtc;
  const hasRemoteStreams = remoteStreams.size > 0;

  const handleToggleScreen = async () => {
    if (screenOn) {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => { try { t.stop(); } catch {} });
      }
      screenStreamRef.current = null;
      setScreenOn(false);
      stopScreen();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      screenStreamRef.current = stream;
      setScreenOn(true);
      // Auto-stop when the user clicks the browser's native "Stop sharing" button.
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        screenStreamRef.current = null;
        setScreenOn(false);
        stopScreen();
      });
      const others = onlineUsers.filter((u) => u.userId !== userId).map((u) => u.userId);
      if (others.length > 0) await publishScreen(stream, others);
    } catch (err) {
      if (import.meta.env.DEV) console.warn('[VideoGrid] screen share cancelled:', err);
    }
  };

  // Fetch audio + video input devices
  const fetchDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioDevices(devices.filter(d => d.kind === 'audioinput'));
      setVideoDevices(devices.filter(d => d.kind === 'videoinput'));
    } catch (err) {
      console.error('Device enumeration error:', err);
    }
  };

  // Set up audio analyser for speaking detection
  const setupAnalyser = (stream: MediaStream) => {
    if (audioCtxRef.current) audioCtxRef.current.close();
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.5;
    source.connect(analyser);
    analyserRef.current = analyser;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const checkLevel = () => {
      analyser.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((sum, v) => sum + v, 0) / dataArray.length;
      const speaking = avg > 5;
      setIsSpeaking(speaking);
      (window as any).__ghostSpeaking = speaking;
      animFrameRef.current = requestAnimationFrame(checkLevel);
    };
    checkLevel();
  };

  const startMic = async (deviceId?: string) => {
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach(t => t.stop());
    }

    const devicesToTry: (string | undefined)[] = [];
    if (deviceId) devicesToTry.push(deviceId);
    for (const d of audioDevices) {
      if (d.deviceId !== deviceId) devicesToTry.push(d.deviceId);
    }
    if (!deviceId) devicesToTry.unshift(undefined);

    for (const tryId of devicesToTry) {
      try {
        const constraints: MediaStreamConstraints = {
          audio: tryId
            ? { deviceId: { ideal: tryId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
            : { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);

        // Merge with existing video track if camera is on
        if (streamRef.current) {
          const videoTracks = streamRef.current.getVideoTracks();
          const newStream = new MediaStream([...videoTracks, ...stream.getAudioTracks()]);
          streamRef.current = newStream;
        } else {
          streamRef.current = stream;
        }

        setupAnalyser(streamRef.current);
        setMicOn(true);
        if (tryId) setSelectedDeviceId(tryId);
        fetchDevices();

        // Publish/update WebRTC stream
        if (peersActive()) {
          replaceStream(streamRef.current);
        }
        return;
      } catch (err: any) {
        console.warn('[Mic] Failed device:', tryId || 'default', err?.name, err?.message);
        continue;
      }
    }
    alert('Could not access any microphone. Make sure no other app is using it exclusively.');
  };

  const peersActive = () => remoteStreams.size > 0;

  const startCamera = async (deviceId?: string) => {
    if (streamRef.current) {
      streamRef.current.getVideoTracks().forEach(t => t.stop());
    }
    try {
      const videoConstraint = deviceId ? { deviceId: { exact: deviceId } } : true;
      const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraint });

      // Merge with existing audio tracks
      if (streamRef.current) {
        const audioTracks = streamRef.current.getAudioTracks();
        const newStream = new MediaStream([...stream.getVideoTracks(), ...audioTracks]);
        streamRef.current = newStream;
      } else {
        streamRef.current = stream;
      }

      if (videoRef.current) videoRef.current.srcObject = streamRef.current;
      setCameraOn(true);
      fetchDevices();

      // Publish to all room members via WebRTC
      const otherUserIds = onlineUsers.filter(u => u.userId !== userId).map(u => u.userId);
      if (otherUserIds.length > 0) {
        await publishStream(streamRef.current, otherUserIds);
      }
    } catch (err) {
      console.error('Camera error:', err);
    }
  };

  const toggleCamera = async () => {
    if (cameraOn) {
      if (streamRef.current) {
        streamRef.current.getVideoTracks().forEach(t => t.stop());
      }
      if (videoRef.current) videoRef.current.srcObject = null;
      setCameraOn(false);

      // If mic is still on, keep audio-only stream; otherwise stop everything
      if (!micOn) {
        stopStream();
      } else if (streamRef.current) {
        const audioOnly = new MediaStream(streamRef.current.getAudioTracks());
        streamRef.current = audioOnly;
        replaceStream(audioOnly);
      }
    } else {
      await startCamera(selectedCamId || undefined);
    }
  };

  const toggleMic = async () => {
    if (micOn) {
      if (streamRef.current) {
        streamRef.current.getAudioTracks().forEach(t => { t.enabled = false; t.stop(); });
      }
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (audioCtxRef.current) { audioCtxRef.current.close(); audioCtxRef.current = null; }
      setIsSpeaking(false);
      setMicOn(false);

      if (!cameraOn) {
        stopStream();
      } else if (streamRef.current) {
        const videoOnly = new MediaStream(streamRef.current.getVideoTracks());
        streamRef.current = videoOnly;
        replaceStream(videoOnly);
      }
    } else {
      await startMic(selectedDeviceId || undefined);
    }
  };

  const selectDevice = async (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setShowMicMenu(false);
    await startMic(deviceId);
  };

  const selectCam = async (deviceId: string) => {
    setSelectedCamId(deviceId);
    setShowCamMenu(false);
    if (cameraOn) {
      await startCamera(deviceId);
    }
  };

  const handleMicClick = async () => {
    setShowCamMenu(false);
    if (!micOn) {
      await startMic(selectedDeviceId || undefined);
      await fetchDevices();
      if (micBtnRef.current) {
        setMenuPos({ top: micBtnRef.current.getBoundingClientRect().bottom + 16 });
      }
      setShowMicMenu(true);
    } else {
      toggleMic();
      setShowMicMenu(false);
    }
  };

  const handleCamClick = async () => {
    setShowMicMenu(false);
    if (!cameraOn) {
      await startCamera(selectedCamId || undefined);
      if (!micOn) await startMic(selectedDeviceId || undefined);
      await fetchDevices();
      if (camBtnRef.current) {
        setMenuPos({ top: camBtnRef.current.getBoundingClientRect().bottom + 16 });
      }
      setShowCamMenu(true);
    } else {
      toggleCamera();
      setShowCamMenu(false);
    }
  };

  // Close menus on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (showMicMenu && micMenuRef.current && !micMenuRef.current.contains(target) && micBtnRef.current && !micBtnRef.current.contains(target)) {
        setShowMicMenu(false);
      }
      if (showCamMenu && camMenuRef.current && !camMenuRef.current.contains(target) && camBtnRef.current && !camBtnRef.current.contains(target)) {
        setShowCamMenu(false);
      }
    };
    if (showMicMenu || showCamMenu) {
      const timer = setTimeout(() => document.addEventListener('mousedown', handleClick), 0);
      return () => { clearTimeout(timer); document.removeEventListener('mousedown', handleClick); };
    }
    return () => {};
  }, [showMicMenu, showCamMenu]);

  // Attach stream to video element when camera turns on
  useEffect(() => {
    if (cameraOn && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraOn]);

  useEffect(() => {
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (audioCtxRef.current) audioCtxRef.current.close();
      stopStream();
    };
  }, []);

  // Load devices on mount
  useEffect(() => { fetchDevices(); }, []);

  return (
    <div className="mb-2">
      {/* Device dropdown menus — portaled to body */}
      {showCamMenu && menuPos && createPortal(
        <div ref={camMenuRef} className="fixed py-1.5 rounded-xl shadow-2xl animate-popup" onMouseLeave={() => setShowCamMenu(false)} style={{ zIndex: 9999, background: 'rgba(20,10,35,0.97)', border: '1px solid rgba(255,255,255,0.15)', backdropFilter: 'blur(20px)', top: menuPos.top, right: 6, width: 304 }}>
          <button onClick={async () => { if (cameraOn) { toggleCamera(); } else { await startCamera(selectedCamId || undefined); } setShowCamMenu(false); }}
            className={`w-full text-left px-3 py-2 text-[12px] hover:bg-white/10 transition-colors font-medium flex items-center gap-2 ${cameraOn ? 'text-red-400' : 'text-green-400'}`}
          >
            <span className={`w-2 h-2 rounded-full ${cameraOn ? 'bg-purple-500' : 'bg-red-500'}`} />
            {cameraOn ? 'Turn Off Camera' : 'Turn On Camera'}
          </button>
          <div className="h-px bg-white/10 mx-2 my-1" />
          <div className="px-3 py-1 text-white/40 font-semibold uppercase tracking-wider text-[10px]">Select Camera</div>
          <button onClick={async () => { selectCam(''); await startCamera(); setShowCamMenu(false); }}
            className={`w-full text-left px-3 py-2 text-[12px] hover:bg-white/10 transition-colors ${selectedCamId === '' ? 'text-purple-400' : 'text-white/70'}`}
          >Default</button>
          {videoDevices.map(d => (
            <button key={d.deviceId} onClick={async () => { selectCam(d.deviceId); await startCamera(d.deviceId); setShowCamMenu(false); }}
              className={`w-full text-left px-3 py-2 text-[12px] hover:bg-white/10 transition-colors truncate ${d.deviceId === selectedCamId ? 'text-purple-400' : 'text-white/70'}`}
            >
              {d.label || `Camera ${videoDevices.indexOf(d) + 1}`}
            </button>
          ))}
        </div>,
        document.body
      )}
      {showMicMenu && menuPos && createPortal(
        <div ref={micMenuRef} className="fixed py-1.5 rounded-xl shadow-2xl animate-popup" onMouseLeave={() => setShowMicMenu(false)} style={{ zIndex: 9999, background: 'rgba(20,10,35,0.97)', border: '1px solid rgba(255,255,255,0.15)', backdropFilter: 'blur(20px)', top: menuPos.top, right: 6, width: 304 }}>
          <button onClick={async () => { if (micOn) { toggleMic(); } else { await startMic(selectedDeviceId || undefined); } setShowMicMenu(false); }}
            className={`w-full text-left px-3 py-2 text-[12px] hover:bg-white/10 transition-colors font-medium flex items-center gap-2 ${micOn ? 'text-red-400' : 'text-green-400'}`}
          >
            <span className={`w-2 h-2 rounded-full ${micOn ? 'bg-green-500' : 'bg-red-500'}`} />
            {micOn ? 'Mute Microphone' : 'Unmute Microphone'}
          </button>
          <div className="h-px bg-white/10 mx-2 my-1" />
          <div className="px-3 py-1 text-white/40 font-semibold uppercase tracking-wider text-[10px]">Select Microphone</div>
          <button onClick={() => selectDevice('')}
            className={`w-full text-left px-3 py-2 text-[12px] hover:bg-white/10 transition-colors ${selectedDeviceId === '' ? 'text-green-400' : 'text-white/70'}`}
          >Default</button>
          {audioDevices.map(d => (
            <button key={d.deviceId} onClick={() => selectDevice(d.deviceId)}
              className={`w-full text-left px-3 py-2 text-[12px] hover:bg-white/10 transition-colors truncate ${d.deviceId === selectedDeviceId ? 'text-green-400' : 'text-white/70'}`}
            >
              {d.label || `Microphone ${audioDevices.indexOf(d) + 1}`}
            </button>
          ))}
        </div>,
        document.body
      )}
    <div className={variant === 'row' ? 'flex gap-1.5 overflow-x-auto' : 'grid grid-cols-2 gap-1.5'}>
      {Array.from({ length: 4 }).map((_, i) => {
        const myIndex = members.findIndex(m => m.userId === userId);
        const me = myIndex >= 0 ? members[myIndex] : null;
        const isMe = i === 0;
        const member = isMe ? me : (() => {
          const otherMembers = members.filter(m => m.userId !== userId);
          return otherMembers[i - 1] || null;
        })();

        if (isMe && !me) return null;

        // Get remote stream for this member
        const remoteStream = !isMe && member ? remoteStreams.get(member.userId) : null;
        const hasRemoteVideo = remoteStream && remoteStream.getVideoTracks().length > 0;

        return (
          <div key={i} className={variant === 'row' ? 'relative w-[120px] h-[120px] shrink-0' : 'relative aspect-square'}>
          <div className="relative w-full h-full rounded-xl overflow-hidden group/video" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 2px 8px rgba(0,0,0,0.15)' }}>
            {/* Local video (your camera) */}
            {isMe && cameraOn && (
              <video ref={videoRef} autoPlay muted playsInline className="absolute inset-0 w-full h-full object-cover" />
            )}
            {isMe && cameraOn && isSpeaking && micOn && (
              <motion.div
                className="absolute inset-0 rounded-xl pointer-events-none z-20"
                animate={{ borderColor: ['rgba(34,197,94,0.5)', 'rgba(34,197,94,0.15)', 'rgba(34,197,94,0.5)'] }}
                style={{ border: '2px solid rgba(34,197,94,0.5)' }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
              />
            )}
            {isMe && !cameraOn && (
              <div className="absolute inset-0 flex items-center justify-center pb-6">
                <div className="rounded-full relative">
                  {isSpeaking && micOn && (
                    <motion.div
                      className="absolute inset-[-10px] rounded-full pointer-events-none"
                      style={{ background: 'radial-gradient(circle, rgba(34,197,94,0.35) 30%, rgba(0,255,200,0.15) 60%, transparent 80%)' }}
                      animate={{ scale: [1, 1.2, 1], opacity: [0.8, 0.4, 0.8] }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  )}
                  <div className="relative z-10">
                    <Avatar name={me!.displayName || '?'} src={me!.avatarUrl} size="xl" />
                  </div>
                </div>
              </div>
            )}

            {/* Remote video (other user's camera) */}
            {!isMe && hasRemoteVideo && (
              <RemoteVideo stream={remoteStream!} />
            )}

            {/* Remote user avatar (no video) */}
            {!isMe && !hasRemoteVideo && (
              <div className="absolute inset-0 flex items-center justify-center">
                {member ? (
                  <Avatar name={member.displayName || '?'} src={member.avatarUrl} size="xl" />
                ) : (
                  <motion.button
                    onClick={() => { if (onAddFriend) onAddFriend(); }}
                    className="w-10 h-10 rounded-full flex items-center justify-center transition-all bg-white/[0.06] text-white/20 hover:bg-white/[0.1] hover:text-white/40"
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </motion.button>
                )}
              </div>
            )}

            {/* Name label for remote users with video */}
            {!isMe && member && hasRemoteVideo && (
              <div className="absolute bottom-2 left-2 z-10 bg-black/60 px-2 py-0.5 rounded text-[11px] text-white font-medium">
                {member.displayName}
              </div>
            )}

            {/* Controls on your tile */}
            {isMe && (
              <div className={`absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-3 transition-opacity duration-200 ${cameraOn ? 'opacity-0 group-hover/video:opacity-100' : ''}`}>
                  <motion.button ref={camBtnRef} onClick={handleCamClick} whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${cameraOn ? 'bg-purple-600 text-white' : 'bg-white/10 text-white/50 hover:bg-white/20'}`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
                  </motion.button>
                  <motion.button ref={micBtnRef} onClick={handleMicClick} whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${micOn ? 'bg-green-600 text-white' : 'bg-white/10 text-white/50 hover:bg-white/20'}`}
                  >
                    {micOn ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" /><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.35 2.17" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
                    )}
                  </motion.button>
                  <motion.button
                    onClick={handleToggleScreen}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${screenOn ? 'bg-blue-500 text-white' : 'bg-white/10 text-white/50 hover:bg-white/20'}`}
                    title={screenOn ? 'Stop sharing screen' : 'Share screen'}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                      <line x1="8" y1="21" x2="16" y2="21" />
                      <line x1="12" y1="17" x2="12" y2="21" />
                    </svg>
                  </motion.button>
              </div>
            )}
          </div>
          </div>
        );
      })}
    </div>
    </div>
  );
}

// Separate component for remote video to handle ref attachment
function RemoteVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <video ref={ref} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
  );
}


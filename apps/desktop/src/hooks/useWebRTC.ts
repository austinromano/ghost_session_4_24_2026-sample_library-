import { useEffect, useRef, useState, useCallback } from 'react';
import { getSocket } from '../lib/socket';
import { sendWebRTCOffer, sendWebRTCAnswer, sendICECandidate, sendWebRTCLeave } from '../lib/socket';
import { useWebrtcStore } from '../stores/webrtcStore';

type StreamKind = 'camera' | 'screen';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

interface SpeakingMonitor { ctx: AudioContext; raf: number }

function key(userId: string, kind: StreamKind) { return `${kind}:${userId}`; }

export function useWebRTC(projectId: string | null, userId: string | null) {
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [remoteScreenStreams, setRemoteScreenStreams] = useState<Map<string, MediaStream>>(new Map());
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);

  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());           // keyed by "camera:uid" | "screen:uid"
  const localStreamRef = useRef<MediaStream | null>(null);
  const localScreenRef = useRef<MediaStream | null>(null);
  const speakingMonitorsRef = useRef<Map<string, SpeakingMonitor>>(new Map());  // keyed by userId (camera audio only)
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  // ── Speaking monitor (camera audio only) ──────────────────────────────

  const attachSpeakingMonitor = useCallback((remoteUserId: string, stream: MediaStream) => {
    const prev = speakingMonitorsRef.current.get(remoteUserId);
    if (prev) {
      cancelAnimationFrame(prev.raf);
      try { prev.ctx.close(); } catch {}
      speakingMonitorsRef.current.delete(remoteUserId);
    }
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return;
    try {
      const ctx = new AudioContext();
      const audioOnly = new MediaStream(audioTracks);
      const source = ctx.createMediaStreamSource(audioOnly);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let lastSpeaking = false;
      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;
        const speaking = avg > 8;
        if (speaking !== lastSpeaking) {
          useWebrtcStore.getState().setSpeaking(remoteUserId, speaking);
          lastSpeaking = speaking;
        }
        const m = speakingMonitorsRef.current.get(remoteUserId);
        if (m) m.raf = requestAnimationFrame(tick);
      };
      const raf = requestAnimationFrame(tick);
      speakingMonitorsRef.current.set(remoteUserId, { ctx, raf });
    } catch (err) {
      if (import.meta.env.DEV) console.warn('[useWebRTC] speaking monitor failed:', err);
    }
  }, []);

  const detachSpeakingMonitor = useCallback((remoteUserId: string) => {
    const m = speakingMonitorsRef.current.get(remoteUserId);
    if (m) {
      cancelAnimationFrame(m.raf);
      try { m.ctx.close(); } catch {}
      speakingMonitorsRef.current.delete(remoteUserId);
    }
    useWebrtcStore.getState().setSpeaking(remoteUserId, false);
  }, []);

  // ── Peer lifecycle ────────────────────────────────────────────────────

  const closePeer = useCallback((peerKey: string) => {
    const pc = peersRef.current.get(peerKey);
    if (pc) { pc.close(); peersRef.current.delete(peerKey); }
    const [kind, uid] = peerKey.split(':') as [StreamKind, string];
    if (kind === 'camera') {
      detachSpeakingMonitor(uid);
      setRemoteStreams((prev) => { const n = new Map(prev); n.delete(uid); return n; });
    } else {
      setRemoteScreenStreams((prev) => { const n = new Map(prev); n.delete(uid); return n; });
    }
  }, [detachSpeakingMonitor]);

  const createPeer = useCallback((remoteUserId: string, kind: StreamKind) => {
    const k = key(remoteUserId, kind);
    if (peersRef.current.has(k)) closePeer(k);

    const pc = new RTCPeerConnection(ICE_SERVERS);
    peersRef.current.set(k, pc);

    const localForKind = kind === 'camera' ? localStreamRef.current : localScreenRef.current;
    if (localForKind) {
      for (const track of localForKind.getTracks()) pc.addTrack(track, localForKind);
    }

    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (kind === 'camera') {
        setRemoteStreams((prev) => { const n = new Map(prev); n.set(remoteUserId, stream); return n; });
        attachSpeakingMonitor(remoteUserId, stream);
      } else {
        setRemoteScreenStreams((prev) => { const n = new Map(prev); n.set(remoteUserId, stream); return n; });
      }
    };

    pc.onicecandidate = (e) => {
      if (e.candidate && projectIdRef.current) {
        sendICECandidate(projectIdRef.current, remoteUserId, e.candidate.toJSON(), kind);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') closePeer(k);
    };

    return pc;
  }, [closePeer, attachSpeakingMonitor]);

  const callUser = useCallback(async (remoteUserId: string, kind: StreamKind = 'camera') => {
    const pc = createPeer(remoteUserId, kind);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (projectIdRef.current) sendWebRTCOffer(projectIdRef.current, remoteUserId, offer, kind);
  }, [createPeer]);

  // ── Publish / replace / stop — CAMERA ─────────────────────────────────

  const publishStream = useCallback(async (stream: MediaStream, onlineUserIds: string[]) => {
    localStreamRef.current = stream;
    for (const uid of onlineUserIds) {
      if (uid !== userId) await callUser(uid, 'camera');
    }
  }, [callUser, userId]);

  const replaceStream = useCallback((stream: MediaStream) => {
    localStreamRef.current = stream;
    for (const [k, pc] of peersRef.current) {
      if (!k.startsWith('camera:')) continue;
      const senders = pc.getSenders();
      for (const track of stream.getTracks()) {
        const sender = senders.find((s) => s.track?.kind === track.kind);
        if (sender) sender.replaceTrack(track);
        else pc.addTrack(track, stream);
      }
    }
  }, []);

  const stopStream = useCallback(() => {
    if (projectIdRef.current) sendWebRTCLeave(projectIdRef.current, 'camera');
    for (const k of Array.from(peersRef.current.keys())) {
      if (k.startsWith('camera:')) closePeer(k);
    }
    localStreamRef.current = null;
  }, [closePeer]);

  // ── Publish / stop — SCREEN ───────────────────────────────────────────

  const publishScreen = useCallback(async (stream: MediaStream, onlineUserIds: string[]) => {
    localScreenRef.current = stream;
    setLocalScreenStream(stream);
    for (const uid of onlineUserIds) {
      if (uid !== userId) await callUser(uid, 'screen');
    }
  }, [callUser, userId]);

  const stopScreen = useCallback(() => {
    if (projectIdRef.current) sendWebRTCLeave(projectIdRef.current, 'screen');
    for (const k of Array.from(peersRef.current.keys())) {
      if (k.startsWith('screen:')) closePeer(k);
    }
    if (localScreenRef.current) {
      localScreenRef.current.getTracks().forEach((t) => { try { t.stop(); } catch {} });
    }
    localScreenRef.current = null;
    setLocalScreenStream(null);
  }, [closePeer]);

  // ── Signalling ────────────────────────────────────────────────────────

  useEffect(() => {
    const socket = getSocket();
    if (!socket || !projectId) return;

    const handleOffer = async ({ fromUserId, offer, streamType }: { fromUserId: string; offer: RTCSessionDescriptionInit; streamType?: StreamKind }) => {
      const kind: StreamKind = streamType === 'screen' ? 'screen' : 'camera';
      const pc = createPeer(fromUserId, kind);
      const localForKind = kind === 'camera' ? localStreamRef.current : null;
      if (localForKind) {
        for (const track of localForKind.getTracks()) pc.addTrack(track, localForKind);
      }
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendWebRTCAnswer(projectId, fromUserId, answer, kind);
    };

    const handleAnswer = async ({ fromUserId, answer, streamType }: { fromUserId: string; answer: RTCSessionDescriptionInit; streamType?: StreamKind }) => {
      const kind: StreamKind = streamType === 'screen' ? 'screen' : 'camera';
      const pc = peersRef.current.get(key(fromUserId, kind));
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
    };

    const handleIceCandidate = async ({ fromUserId, candidate, streamType }: { fromUserId: string; candidate: RTCIceCandidateInit; streamType?: StreamKind }) => {
      const kind: StreamKind = streamType === 'screen' ? 'screen' : 'camera';
      const pc = peersRef.current.get(key(fromUserId, kind));
      if (pc) await pc.addIceCandidate(new RTCIceCandidate(candidate));
    };

    const handleUserLeft = ({ userId: leftUserId, streamType }: { userId: string; streamType?: StreamKind }) => {
      if (streamType) {
        closePeer(key(leftUserId, streamType));
      } else {
        closePeer(key(leftUserId, 'camera'));
        closePeer(key(leftUserId, 'screen'));
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
  }, [projectId, createPeer, closePeer]);

  useEffect(() => {
    return () => {
      for (const k of Array.from(peersRef.current.keys())) closePeer(k);
    };
  }, [closePeer]);

  return {
    remoteStreams,
    remoteScreenStreams,
    localScreenStream,
    publishStream,
    replaceStream,
    stopStream,
    publishScreen,
    stopScreen,
    callUser,
  };
}

import type { SessionAction, PresenceInfo } from '@ghost/types';

export type StreamType = 'camera' | 'screen';

// ── Client → Server ──────────────────────────────────────────────────

export interface OnlineUser {
  userId: string;
  displayName: string;
  currentProjectId: string | null;
  currentProjectName: string | null;
}

export interface ChatMessagePayload {
  id?: string;
  userId: string;
  displayName: string;
  colour: string;
  text: string;
  timestamp: number;
  avatarUrl?: string | null;
}

export interface ClientToServerEvents {
  'join-project': (data: { projectId: string }) => void;
  'leave-project': (data: { projectId: string }) => void;
  'session-action': (data: {
    projectId: string;
    action: SessionAction;
  }) => void;
  'transport-sync': (data: {
    projectId: string;
    beatPosition: number;
  }) => void;
  'chat-message': (data: {
    projectId: string;
    text: string;
  }) => void;
  'delete-chat-message': (data: {
    projectId: string;
    timestamp: number;
    messageId?: string;
  }) => void;
  'webrtc-offer': (data: {
    projectId: string;
    targetUserId: string;
    offer: RTCSessionDescriptionInit;
    streamType?: StreamType;
  }) => void;
  'webrtc-answer': (data: {
    projectId: string;
    targetUserId: string;
    answer: RTCSessionDescriptionInit;
    streamType?: StreamType;
  }) => void;
  'webrtc-ice-candidate': (data: {
    projectId: string;
    targetUserId: string;
    candidate: RTCIceCandidateInit;
    streamType?: StreamType;
  }) => void;
  'webrtc-leave': (data: {
    projectId: string;
    streamType?: StreamType;
  }) => void;
  'cursor-move': (data: {
    projectId: string;
    x: number;
    y: number;
  }) => void;
}

// ── Server → Client ──────────────────────────────────────────────────

export interface ServerToClientEvents {
  'session-action': (data: {
    action: SessionAction;
  }) => void;
  'session-state-sync': (data: {
    projectId: string;
    state: Record<string, unknown>;
  }) => void;
  'transport-sync': (data: {
    beatPosition: number;
    serverTimestamp: number;
  }) => void;
  'presence-update': (data: {
    users: PresenceInfo[];
  }) => void;
  'chat-message': (data: ChatMessagePayload) => void;
  'delete-chat-message': (data: {
    timestamp: number;
    messageId?: string;
  }) => void;
  'global:online-users': (users: OnlineUser[]) => void;
  'user-joined': (data: {
    userId: string;
    displayName: string;
    colour: string;
    avatarUrl?: string | null;
  }) => void;
  'user-left': (data: {
    userId: string;
  }) => void;
  'webrtc-offer': (data: {
    fromUserId: string;
    offer: RTCSessionDescriptionInit;
    streamType?: StreamType;
  }) => void;
  'webrtc-answer': (data: {
    fromUserId: string;
    answer: RTCSessionDescriptionInit;
    streamType?: StreamType;
  }) => void;
  'webrtc-ice-candidate': (data: {
    fromUserId: string;
    candidate: RTCIceCandidateInit;
    streamType?: StreamType;
  }) => void;
  'webrtc-user-left': (data: {
    userId: string;
    streamType?: StreamType;
  }) => void;
  'project-updated': (data: {
    projectId: string;
    reason: 'track-added' | 'track-updated' | 'track-deleted' | 'version-created' | 'metadata-updated' | 'member-changed';
  }) => void;
  'dm-received': (data: {
    id: string;
    fromUserId: string;
    toUserId: string;
    text: string;
    audioFileId?: string | null;
    audioFileName?: string | null;
    read: boolean;
    createdAt: string;
  }) => void;
  'booking-updated': (data: {
    kind: 'created' | 'updated' | 'deleted';
    bookingId: string;
    booking?: unknown; // Full Booking object from API (with hydrated creator/invitee). Omitted on delete.
  }) => void;
  'cursor-move': (data: {
    userId: string;
    displayName: string;
    colour: string;
    x: number;
    y: number;
  }) => void;
  'error': (data: {
    message: string;
  }) => void;
}

// ── Socket data attached to each connection ──────────────────────────

export interface SocketData {
  userId: string;
  displayName: string;
  colour: string;
  avatarUrl: string | null;
}

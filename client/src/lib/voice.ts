/* Peer-to-peer voice chat for the table.
   Mesh WebRTC (≤6 players → ≤5 connections each) with SDP/ICE signalling carried over a
   Supabase Realtime channel (broadcast for messages, presence for who's currently in the call).
   Uses the "perfect negotiation" pattern so simultaneous offers never dead-lock. A tiny WebAudio
   meter drives per-player "speaking" rings. State lives in its own external store so the ~8fps
   speaking updates don't re-render the whole app. */
import { useSyncExternalStore } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { store } from './store';
import { myId } from './net';
import { sfx } from './sfx';
import { i18n, t } from '../i18n';
import { toast } from '@heroui/react';

// STUN is enough on open networks; a TURN relay is required when peers sit behind symmetric NAT
// (many mobile carriers / corporate wifi). Provide TURN in production via Netlify env vars:
//   VITE_TURN_URLS="turn:relay.example.com:3478,turns:relay.example.com:5349"
//   VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL
const TURN_URLS = (import.meta.env.VITE_TURN_URLS as string | undefined)?.split(',').map((u) => u.trim()).filter(Boolean);
const ICE: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ...(TURN_URLS && TURN_URLS.length
    ? [{ urls: TURN_URLS, username: import.meta.env.VITE_TURN_USERNAME as string | undefined, credential: import.meta.env.VITE_TURN_CREDENTIAL as string | undefined }]
    : []),
];
const SPEAK_ON = 0.045, SPEAK_OFF = 0.03; // RMS thresholds (hysteresis)

export interface PeerInfo { connected: boolean; speaking: boolean; muted: boolean }
export interface VoiceSnap {
  active: boolean;      // we've joined the call
  connecting: boolean;  // mic requested / channel subscribing
  muted: boolean;       // our mic is muted
  speaking: boolean;    // we are talking
  peers: Record<string, PeerInfo>;
  error: string | null;
}

let vsnap: VoiceSnap = { active: false, connecting: false, muted: false, speaking: false, peers: {}, error: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
function patch(p: Partial<VoiceSnap>) { vsnap = { ...vsnap, ...p }; emit(); }
function setPeer(id: string, p: Partial<PeerInfo>) {
  const cur = vsnap.peers[id] || { connected: false, speaking: false, muted: false };
  const next = { ...cur, ...p };
  if (cur.connected === next.connected && cur.speaking === next.speaking && cur.muted === next.muted) return;
  vsnap = { ...vsnap, peers: { ...vsnap.peers, [id]: next } }; emit();
}
function dropPeerState(id: string) {
  if (!(id in vsnap.peers)) return;
  const peers = { ...vsnap.peers }; delete peers[id];
  vsnap = { ...vsnap, peers }; emit();
}

export function useVoice(): VoiceSnap { return useSyncExternalStore(sub, () => vsnap, () => vsnap); }
function sub(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
/** Is a given player currently talking? (self or a remote peer) */
export function speakingOf(id: string): boolean {
  if (!vsnap.active) return false;
  if (id === myId()) return vsnap.speaking && !vsnap.muted;
  return !!vsnap.peers[id]?.speaking;
}
export function inCall(id: string): boolean { return vsnap.active && (id === myId() || id in vsnap.peers); }

interface Peer { pc: RTCPeerConnection; el: HTMLAudioElement; polite: boolean; makingOffer: boolean; meter?: Meter }
const peers = new Map<string, Peer>();
let ch: RealtimeChannel | null = null;
let stream: MediaStream | null = null;
let ac: AudioContext | null = null;
let selfMeter: Meter | null = null;
let meterTimer: any = null;
let selfId = '';

// ── public controls ──
export async function joinVoice() {
  const code = store.get().room?.code; const id = myId();
  if (!supabase || !code || !id || ch || vsnap.connecting || vsnap.active) return;
  patch({ connecting: true, error: null });
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e: any) {
    patch({ connecting: false, error: 'mic' });
    toast.danger(t('voice.denied'));
    return;
  }
  selfId = id;
  ac = new (window.AudioContext || (window as any).webkitAudioContext)();
  selfMeter = makeMeter(stream);
  ch = supabase.channel('voice-' + code, { config: { presence: { key: id }, broadcast: { self: false } } });
  ch.on('broadcast', { event: 'sig' }, ({ payload }) => onSignal(payload));
  ch.on('broadcast', { event: 'mute' }, ({ payload }) => { if (payload?.from) setPeer(payload.from, { muted: !!payload.muted }); });
  ch.on('presence', { event: 'sync' }, reconcile);
  ch.on('presence', { event: 'leave' }, ({ leftPresences }: any) => { for (const p of leftPresences || []) closePeer(p.key || p.id); });
  ch.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') { await ch!.track({ id, muted: false }); patch({ active: true, connecting: false }); sfx.play('click'); startMeterLoop(); }
    else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { patch({ error: 'net' }); leaveVoice(); }
  });
}

export function leaveVoice() {
  broadcast('bye', {});
  for (const id of [...peers.keys()]) closePeer(id);
  if (ch && supabase) { try { ch.untrack(); } catch { /* */ } supabase.removeChannel(ch); }
  ch = null;
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  if (selfMeter) { selfMeter.stop(); selfMeter = null; }
  if (meterTimer) { clearInterval(meterTimer); meterTimer = null; }
  if (ac) { ac.close().catch(() => {}); ac = null; }
  vsnap = { active: false, connecting: false, muted: false, speaking: false, peers: {}, error: vsnap.error };
  emit();
}

export function toggleMute() {
  if (!vsnap.active || !stream) return;
  const muted = !vsnap.muted;
  stream.getAudioTracks().forEach((tr) => (tr.enabled = !muted));
  patch({ muted, speaking: muted ? false : vsnap.speaking });
  broadcast('mute', { from: selfId, muted });
  if (ch) ch.track({ id: selfId, muted });
}

// ── signalling ──
function broadcast(kind: string, payload: any) { if (ch) ch.send({ type: 'broadcast', event: kind === 'mute' ? 'mute' : 'sig', payload: kind === 'mute' ? payload : { ...payload, kind } }); }
function send(to: string, msg: any) { if (ch) ch.send({ type: 'broadcast', event: 'sig', payload: { ...msg, from: selfId, to } }); }

function reconcile() {
  if (!ch) return;
  const state = ch.presenceState() as Record<string, any[]>;
  const present = new Map<string, boolean>(); // peerId → muted (from their latest presence meta)
  for (const [key, metas] of Object.entries(state)) {
    if (key === selfId) continue;
    const meta: any = metas[metas.length - 1] || {};
    present.set(key, !!meta.muted);
  }
  for (const [id, muted] of present) {
    if (!peers.has(id)) createPeer(id);
    setPeer(id, { muted }); // reflect their mic state even if they muted before we joined
  }
  for (const id of [...peers.keys()]) if (!present.has(id)) closePeer(id);
}

function createPeer(peerId: string): Peer {
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const el = new Audio(); el.autoplay = true; (el as any).playsInline = true;
  const polite = selfId > peerId; // higher id yields on glare; lower id makes the first offer
  const peer: Peer = { pc, el, polite, makingOffer: false };
  peers.set(peerId, peer);
  setPeer(peerId, { connected: false });
  if (stream) stream.getTracks().forEach((tr) => pc.addTrack(tr, stream!));
  pc.onicecandidate = (e) => { if (e.candidate) send(peerId, { candidate: e.candidate.toJSON() }); };
  pc.onnegotiationneeded = async () => {
    try { peer.makingOffer = true; await pc.setLocalDescription(); send(peerId, { desc: pc.localDescription }); }
    catch { /* */ } finally { peer.makingOffer = false; }
  };
  pc.ontrack = (e) => {
    el.srcObject = e.streams[0]; el.play().catch(() => {});
    if (ac) peer.meter = makeMeter(e.streams[0]);
    setPeer(peerId, { connected: true });
  };
  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    if (st === 'connected') setPeer(peerId, { connected: true });
    else if (st === 'failed') { try { pc.restartIce(); } catch { /* */ } }
    else if (st === 'closed') setPeer(peerId, { connected: false });
  };
  return peer;
}

async function onSignal(msg: any) {
  if (!msg || msg.to !== selfId || !msg.from) return;
  if (msg.kind === 'bye') { closePeer(msg.from); return; }
  let peer = peers.get(msg.from) || createPeer(msg.from);
  const pc = peer.pc;
  try {
    if (msg.desc) {
      const offerCollision = msg.desc.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
      if (!peer.polite && offerCollision) return; // impolite peer ignores the colliding offer
      await pc.setRemoteDescription(msg.desc);
      if (msg.desc.type === 'offer') { await pc.setLocalDescription(); send(msg.from, { desc: pc.localDescription }); }
    } else if (msg.candidate) {
      try { await pc.addIceCandidate(msg.candidate); } catch { /* ignore late candidates */ }
    }
  } catch { /* */ }
}

function closePeer(peerId: string) {
  const peer = peers.get(peerId);
  if (peer) {
    peer.meter?.stop();
    try { peer.pc.ontrack = null; peer.pc.onicecandidate = null; peer.pc.onnegotiationneeded = null; peer.pc.close(); } catch { /* */ }
    peer.el.srcObject = null;
    peers.delete(peerId);
  }
  dropPeerState(peerId);
}

// ── speaking meter ──
interface Meter { analyser: AnalyserNode; buf: Float32Array; src: MediaStreamAudioSourceNode; stop: () => void; on: boolean }
function makeMeter(ms: MediaStream): Meter {
  const src = ac!.createMediaStreamSource(ms);
  const analyser = ac!.createAnalyser(); analyser.fftSize = 512; analyser.smoothingTimeConstant = 0.5;
  src.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  return { analyser, buf, src, on: false, stop() { try { src.disconnect(); } catch { /* */ } } };
}
function rms(m: Meter): number {
  m.analyser.getFloatTimeDomainData(m.buf as any);
  let sum = 0; for (let i = 0; i < m.buf.length; i++) sum += m.buf[i] * m.buf[i];
  return Math.sqrt(sum / m.buf.length);
}
function level(m: Meter): boolean {
  const v = rms(m); m.on = m.on ? v > SPEAK_OFF : v > SPEAK_ON; return m.on;
}
function startMeterLoop() {
  clearInterval(meterTimer);
  meterTimer = setInterval(() => {
    if (selfMeter) { const s = !vsnap.muted && level(selfMeter); if (s !== vsnap.speaking) patch({ speaking: s }); }
    for (const [id, peer] of peers) if (peer.meter) setPeer(id, { speaking: level(peer.meter) });
  }, 120);
}

/** Leave the call automatically when the player leaves the room. */
export function voiceOnRoomGone() { if (vsnap.active || vsnap.connecting) leaveVoice(); }
export function voiceErrorText(): string { return vsnap.error === 'mic' ? t('voice.denied') : vsnap.error === 'net' ? i18n.err('offline') : ''; }

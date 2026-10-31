// Sound in and out. Nothing here touches the plan.

// The microphone as 24 kHz 16-bit PCM, about 85 ms a frame.
export function micFrames(stream, onFrame) {
  const ctx = new AudioContext({ sampleRate: 24000 });
  const node = ctx.createScriptProcessor(2048, 1, 1);
  node.onaudioprocess = (e) => {
    const pcm = e.inputBuffer.getChannelData(0);
    const out = new Int16Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) out[i] = Math.max(-1, Math.min(1, pcm[i])) * 0x7fff;
    onFrame(out.buffer);
  };
  ctx.createMediaStreamSource(stream).connect(node);
  node.connect(ctx.destination);
  ctx.resume();
  return () => { try { node.disconnect(); ctx.close(); } catch {} };
}

// A short tone: heard you, working on it.
export function beep() {
  try {
    const a = new AudioContext();
    const o = a.createOscillator();
    const g = a.createGain();
    g.gain.value = 0.06;
    o.frequency.value = 880;
    o.connect(g).connect(a.destination);
    o.start();
    o.stop(a.currentTime + 0.09);
    o.onended = () => a.close();
  } catch { /* a missing tone changes nothing */ }
}

export async function toWav(blob) {
  const ctx = new AudioContext({ sampleRate: 16000 });
  const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
  ctx.close();
  const pcm = audio.getChannelData(0);
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  pcm.forEach((s, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  return buf;
}

// Background music for the tutorial videos (Plan 11, PR 7a): original, made here from sine and triangle waves, so it has
// no license. A calm pop progression (I–V–vi–IV, then vi–IV–I–V) at 88 BPM: a soft pad, a light arpeggio that comes in
// after the intro, a round bass, and a quiet kick and shaker. It fades in and out, and stays under the video (record.mjs
// mixes it low). Each video gets its own variation from its id, so twelve videos do not sound the same.
import { writeFileSync } from 'node:fs';

const RATE = 44100;
const BPM = 88;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const freq = (name, octave) => 440 * 2 ** ((NOTE[name] + (octave - 4) * 12 - 9) / 12);
const CHORDS = {
  C: ['C', 'E', 'G'], G: ['G', 'B', 'D'], Am: ['A', 'C', 'E'], F: ['F', 'A', 'C'], Em: ['E', 'G', 'B'], Dm: ['D', 'F', 'A'],
};
const PROGRESSIONS = [
  ['C', 'G', 'Am', 'F', 'Am', 'F', 'C', 'G'],
  ['Am', 'F', 'C', 'G', 'F', 'G', 'Em', 'Am'],
  ['F', 'C', 'G', 'Am', 'Dm', 'G', 'C', 'C'],
];

/** A small seeded generator, so the same id always gives the same music. */
function random(seedText) {
  let seed = [...seedText].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 2166136261);
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const triangle = phase => 1 - 4 * Math.abs(Math.round(phase - 0.25) - (phase - 0.25));
const envelope = (t, attack, release, length) => Math.max(0, Math.min(1, t / attack, (length - t) / release));

/** Writes a 16-bit stereo WAV of `seconds` of music for the video `id`. */
export function writeMusic(file, seconds, id = 'anton') {
  const rand = random(id);
  const progression = PROGRESSIONS[Math.floor(rand() * PROGRESSIONS.length)];
  const transpose = [0, 2, -3, 5][Math.floor(rand() * 4)];
  const shift = semitones => 2 ** ((semitones + transpose) / 12);
  const length = Math.ceil(seconds * RATE);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const add = (start, samples, fn) => {
    const from = Math.max(0, Math.floor(start * RATE));
    const to = Math.min(length, from + samples);
    for (let index = from; index < to; index += 1) fn(index, (index - from) / RATE);
  };
  const bars = Math.ceil(seconds / BAR);
  const lastBars = Math.max(0, bars - 2);
  for (let bar = 0; bar < bars; bar += 1) {
    const chord = CHORDS[progression[bar % progression.length]];
    const start = bar * BAR;
    // Pad: the chord in octaves 3 and 4, two slightly detuned voices panned apart, slow in and out.
    chord.forEach((name, voice) => {
      const base = freq(name, voice === 0 ? 3 : 4) * shift(0);
      add(start, Math.ceil(BAR * RATE * 1.02), (index, t) => {
        const env = envelope(t, 0.7, 0.9, BAR * 1.02) * 0.075;
        const a = Math.sin(2 * Math.PI * base * 1.0015 * t) + 0.25 * Math.sin(4 * Math.PI * base * t);
        const b = Math.sin(2 * Math.PI * base * 0.9985 * t) + 0.25 * Math.sin(4 * Math.PI * base * t);
        left[index] += env * (0.65 * a + 0.35 * b);
        right[index] += env * (0.35 * a + 0.65 * b);
      });
    });
    // Bass: the root on beats 1 and 3, round and short.
    const root = freq(chord[0], 2) * shift(0);
    for (const beat of [0, 2]) {
      add(start + beat * BEAT, Math.ceil(BEAT * 1.6 * RATE), (index, t) => {
        const value = Math.sin(2 * Math.PI * root * t) * Math.exp(-t * 2.6) * Math.min(1, t / 0.01) * 0.2;
        left[index] += value; right[index] += value;
      });
    }
    if (bar < 2 || bar >= lastBars) continue;
    // Arpeggio: eighth notes over the chord in octave 5, alternating sides, each with its own small accent.
    const pattern = [0, 1, 2, 1, 0, 2, 1, 2];
    pattern.forEach((step, eighth) => {
      if (rand() < 0.12) return;
      const pitch = freq(chord[step], 5) * shift(0);
      const velocity = 0.045 + rand() * 0.025;
      const pan = eighth % 2 ? 0.35 : 0.65;
      add(start + eighth * BEAT / 2, Math.ceil(0.5 * RATE), (index, t) => {
        const value = triangle(pitch * t) * Math.exp(-t * 7) * Math.min(1, t / 0.004) * velocity;
        left[index] += value * (1 - pan); right[index] += value * pan;
      });
    });
    // Kick on 1 and 3, shaker on the off-beats: quiet, for movement only.
    for (const beat of [0, 2]) {
      add(start + beat * BEAT, Math.ceil(0.35 * RATE), (index, t) => {
        const pitch = 52 + 70 * Math.exp(-t * 28);
        const value = Math.sin(2 * Math.PI * pitch * t) * Math.exp(-t * 9) * 0.16;
        left[index] += value; right[index] += value;
      });
    }
    let previous = 0;
    for (let eighth = 1; eighth < 8; eighth += 2) {
      add(start + eighth * BEAT / 2, Math.ceil(0.06 * RATE), (index, t) => {
        const noise = rand() * 2 - 1;
        const high = noise - previous;
        previous = noise;
        const value = high * Math.exp(-t * 70) * 0.018;
        left[index] += value * 0.8; right[index] += value * 1.2;
      });
    }
  }
  // Fade in and out, a gentle limiter, and 16-bit samples.
  const data = Buffer.alloc(44 + length * 4);
  for (let index = 0; index < length; index += 1) {
    const t = index / RATE;
    const fade = Math.min(1, t / 1.5, (seconds - t) / 2.5);
    const l = Math.tanh(left[index] * 1.3) * Math.max(0, fade);
    const r = Math.tanh(right[index] * 1.3) * Math.max(0, fade);
    data.writeInt16LE(Math.round(l * 32767 * 0.85), 44 + index * 4);
    data.writeInt16LE(Math.round(r * 32767 * 0.85), 46 + index * 4);
  }
  data.write('RIFF', 0); data.writeUInt32LE(36 + length * 4, 4); data.write('WAVE', 8); data.write('fmt ', 12);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22); data.writeUInt32LE(RATE, 24);
  data.writeUInt32LE(RATE * 4, 28); data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(length * 4, 40);
  writeFileSync(file, data);
}

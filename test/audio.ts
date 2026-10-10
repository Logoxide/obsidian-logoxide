// A small Bible package with a recording, for trying the player: John 1:1-5 and 3:16-18 (KJV),
// read by espeak-ng (a tone per verse without it), its WebVTT timings, and the recording listed
// with `bx media add`. The recording is written where it's served from, never into the package.
//
//   node test/audio.ts <package dir> <serve dir> <base URL>
//   node test/audio.ts test-vault/Biblix/imports/audiotest "$SCRATCH/serve" http://127.0.0.1:8766
//   (cd "$SCRATCH/serve" && python -m http.server 8766)

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const VERSES: [number, number, string][] = [
  [1, 1, "In the beginning was the Word, and the Word was with God, and the Word was God."],
  [1, 2, "The same was in the beginning with God."],
  [1, 3, "All things were made by him; and without him was not any thing made that was made."],
  [1, 4, "In him was life; and the life was the light of men."],
  [1, 5, "And the light shineth in darkness; and the darkness comprehended it not."],
  [3, 16, "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life."],
  [3, 17, "For God sent not his Son into the world to condemn the world; but that the world through him might be saved."],
  [3, 18, "He that believeth on him is not condemned: but he that believeth not is condemned already, because he hath not believed in the name of the only begotten Son of God."],
];

const [dir, serve, base] = process.argv.slice(2);
if (!dir || !serve || !base) {
  console.error("usage: node test/audio.ts <package dir> <serve dir> <base URL>");
  process.exit(1);
}
const work = mkdtempSync(join(tmpdir(), "topos-audio-"));
mkdirSync(join(dir, "usx"), { recursive: true });
mkdirSync(join(dir, "timings"), { recursive: true });
mkdirSync(serve, { recursive: true });

const has = (command: string) => {
  try {
    execFileSync(command, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const speak = has("espeak-ng");

/** Seconds of a WAV file (16-bit PCM, as espeak-ng and ffmpeg write it) */
function seconds(path: string): number {
  const wav = readFileSync(path);
  const rate = wav.readUInt32LE(24);
  const bytesPerSecond = wav.readUInt32LE(28);
  const data = wav.indexOf("data", 12);
  return rate > 0 ? wav.readUInt32LE(data + 4) / bytesPerSecond : 0;
}

// An introduction first (a cue no verse names, which players skip), then each verse
const parts: { path: string; cue: string | null; text: string }[] = [];
const intro = join(work, "intro.wav");
if (speak) execFileSync("espeak-ng", ["-w", intro, "The Gospel according to John"]);
else execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=330:duration=1.5", "-ar", "22050", "-ac", "1", intro]);
parts.push({ path: intro, cue: null, text: "The Gospel according to John" });
for (const [i, [chapter, verse, text]] of VERSES.entries()) {
  const path = join(work, `${i}.wav`);
  if (speak) execFileSync("espeak-ng", ["-w", path, `Verse ${verse}. ${text}`]);
  else execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `sine=frequency=${440 + 40 * i}:duration=3`, "-ar", "22050", "-ac", "1", path]);
  parts.push({ path, cue: `JHN ${chapter}:${verse}`, text });
}

const clock = (t: number) => {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
};
let at = 0;
const cues: string[] = ["WEBVTT", ""];
for (const part of parts) {
  const length = seconds(part.path);
  cues.push(...(part.cue ? [part.cue] : ["intro"]), `${clock(at)} --> ${clock(at + length)}`, part.text, "");
  at += length;
}
writeFileSync(join(dir, "timings", "JHN.vtt"), cues.join("\n"));

const list = join(work, "list.txt");
writeFileSync(list, parts.map((p) => `file '${p.path}'`).join("\n"));
const mp3 = join(serve, "JHN.mp3");
execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-ac", "1", "-b:a", "48k", mp3]);

const para = (chapter: number) =>
  `<chapter number="${chapter}" style="c"/><para style="p">${VERSES.filter((v) => v[0] === chapter)
    .map(([, verse, text]) => `<verse number="${verse}" style="v" sid="JHN ${chapter}:${verse}"/>${text}<verse eid="JHN ${chapter}:${verse}"/>`)
    .join("")}</para>`;
writeFileSync(join(dir, "usx", "JHN.usx"), `<usx version="3.0"><book code="JHN" style="id"/><para style="h">John</para>${para(1)}${para(3)}</usx>\n`);
writeFileSync(
  join(dir, "biblix.toml"),
  `[package]\nid = "audiotest"\nname = "Audio Test"\nabbreviation = "AUD"\nversion = "1.0.0"\nlanguage = "en"\n\n[formats]\nusx = { path = "usx/" }\n`,
);
execFileSync("bx", ["media", "add", mp3, "--url", `${base.replace(/\/$/, "")}/JHN.mp3`, "--book", "JHN", "--package", resolve(dir)], { stdio: "inherit" });
// Where the timings are (bx media add lists the file, not them)
const manifest = join(dir, "biblix.toml");
writeFileSync(manifest, readFileSync(manifest, "utf8").replace("[media]\n", '[media]\ntimings = "timings/"\n'));
execFileSync("bx", ["media", "check", "--offline"], { cwd: dir, stdio: "inherit" });
rmSync(work, { recursive: true });
console.log(`${dir}: John 1:1-5 and 3:16-18, ${at.toFixed(1)} s read (${speak ? "espeak-ng" : "tones"}); serve ${serve} at ${base}`);

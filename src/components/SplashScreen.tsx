import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import changeTheWorldAudioUrl from "../assets/change-the-world.mp3";
import ndVoiceAudioUrl from "../assets/n-d-robot-voice.mp3";

interface SplashScreenProps {
  /** From Settings > splash animation. "off" skips straight through. */
  mode: "full" | "short" | "off";
  onComplete: () => void;
}

// ---------------------------------------------------------------------
// Tunables -- see the doc comment on SplashScreen below for what each
// section controls.
// ---------------------------------------------------------------------

/** Dark -> bright terminal palette. White / gray / cyan / muted blue. */
const PALETTE = ["#1c2430", "#3a5f8f", "#5f8fd9", "#4fd6e8", "#b9f1ff", "#f2fbff"];
const NOISE_COLOR = "#3a5f8f";
const BOOT_COLOR = "#7fd6e8";

const PHRASE = "CHANGE THE WORLD.";

const BOOT_LINES = [
  "NZYSELLE DATABASE // LOCAL RUNTIME",
  "mounting workspace volume .......... OK",
  "loading capability registry ........ OK",
  "establishing adapter registry ...... OK",
  "scanning media pipeline ............ OK",
  "decrypting credential vault ........ OK",
  "linking scheduler daemon ........... OK",
];

const NOISE_FRAGMENTS = [
  "0x7F3A2C1D",
  "0xA40E991B",
  "SCAN::sector_09",
  "PKT 244/900",
  "[142.883, 44.021]",
  "[009.114, -71.402]",
  "CHKSUM OK",
  "buffer::realloc",
  "trace_id=8f21",
  "sync -> node_04",
  "render_pass::ok",
  "stream 92%",
];

/** Character pool for the digital-rain effect -- weighted toward 0/1 for a
 * binary feel, with code-symbols and a handful of hex-ish letters mixed in
 * so columns read as "falling code" rather than random noise. */
const RAIN_CHARS = Array.from(
  "01010101010101010101{}[]()<>/\\|=+-*#@%$&^~010101010101ABCDEFHJKLMNPQRSTUVWXYZ0101",
);

/** 5x7 block-glyph font, uppercase only -- deliberately not a real font,
 * per spec ("must not look like ordinary text"). Only the glyphs the
 * PHRASE constant above actually needs are defined; add more 5-row
 * strings here (1=filled, 0=empty) if you change PHRASE to use other
 * letters. */
const GLYPH_5X7: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  G: ["01110", "10001", "10000", "10011", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  N: ["10001", "11001", "10101", "10101", "10011", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  " ": ["000", "000", "000", "000", "000", "000", "000"],
  ".": ["00", "00", "00", "00", "00", "00", "11"],
};
const GLYPH_FILL = "█"; // █

function buildPhraseGrid(phrase: string): { cols: number; rows: number; chars: string[][] } {
  const letters = phrase.split("").map((ch) => GLYPH_5X7[ch] ?? GLYPH_5X7[" "]);
  const rows = 7;
  const chars: string[][] = Array.from({ length: rows }, () => []);
  letters.forEach((glyph, gi) => {
    for (let r = 0; r < rows; r++) {
      const rowBits = glyph[r];
      for (let c = 0; c < rowBits.length; c++) {
        chars[r].push(rowBits[c] === "1" ? GLYPH_FILL : " ");
      }
      if (gi < letters.length - 1) chars[r].push(" "); // inter-glyph gap
    }
  });
  return { cols: chars[0].length, rows, chars };
}

/** Renders one frame of the cols x rows character grid, grouping
 * consecutive same-color cells into a single <span> so a grid doesn't mean
 * one DOM node per cell. Used for the phrase reveal -- the rain itself is
 * drawn on canvas below. */
function GridRows({ cols, rows, getCell }: { cols: number; rows: number; getCell: (i: number) => [char: string, color: string] }) {
  const lines: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    const spans: React.ReactNode[] = [];
    let runChar = "";
    let runColor = "";
    let start = r * cols;
    const flush = (endCol: number, text: string, color: string) => {
      if (!text) return;
      spans.push(
        <span key={`${r}-${endCol}`} style={{ color }}>
          {text}
        </span>,
      );
    };
    for (let c = 0; c < cols; c++) {
      const [ch, color] = getCell(start + c);
      if (color !== runColor) {
        flush(c, runChar, runColor);
        runChar = "";
        runColor = color;
      }
      runChar += ch;
    }
    flush(cols, runChar, runColor);
    lines.push(<div key={r}>{spans}</div>);
  }
  return <>{lines}</>;
}

function devSkipRequested(): boolean {
  if (!import.meta.env.DEV) return false;
  if (import.meta.env.VITE_SKIP_INTRO === "1") return true;
  try {
    return typeof window !== "undefined" && window.localStorage.getItem("nzyselle:skipIntro") === "1";
  } catch {
    return false;
  }
}

type Phase = "boot" | "rain" | "collapse" | "cut" | "phrase-in" | "phrase-hold" | "phrase-out" | "done";

/**
 * Full-screen terminal-style startup intro. Plays once per launch:
 *   boot log -> canvas digital-rain effect (falling code columns), with a
 *   synthesized robotic voice slowly saying "N... D..." partway through ->
 *   a brief bright "sync" pulse -> CRT power-off squash -> hard cut to
 *   black, held briefly -> "CHANGE THE WORLD." built from block glyphs,
 *   typed on (while src/assets/change-the-world.mp3 plays) then swept
 *   away -> done.
 *
 * Adjust here:
 *   - Colors: PALETTE / NOISE_COLOR / BOOT_COLOR constants above (all hex,
 *     independent of the app's own violet/pink brand palette in
 *     tokens.css on purpose -- this intro has its own terminal palette).
 *   - Boot/system messages: BOOT_LINES.
 *   - Coordinate/hex/status fragments in the margins: NOISE_FRAGMENTS.
 *   - Rain character set: RAIN_CHARS. Rain speed/density/trail length: the
 *     CELL/speed constants inside the rain drawing effect.
 *   - Rain duration: RAIN_MS (currently a fixed 5s in full mode).
 *   - The black pause between the cut and the phrase: BLACK_HOLD_MS.
 *   - The "N D" voice: src/assets/n-d-robot-voice.mp3, played by the
 *     ndAudioRef effect below. NOT a live browser SpeechSynthesisUtterance
 *     (that sounded like plain OS text-to-speech) and NOT a real recording
 *     of anyone's voice -- it's a locally-synthesized SAPI "N... D..."
 *     clip run through an offline ffmpeg effects chain (pitch-shift,
 *     flanger, tremolo, chorus, bitcrush) to give it a distinct synthetic/
 *     robotic character. Swap the file (keep the same name) to change it,
 *     or delete the ndAudioRef effects below to remove the voice entirely.
 *   - Film grain: the grain overlay's `opacity` in the render below.
 *   - The phrase: PHRASE (only A,C,D,E,G,H,L,N,O,R,T,W,space,period have
 *     glyphs defined in GLYPH_5X7 -- add more rows there for other letters).
 *   - Timing per phase: the *_MS constants inside the component. PHRASE_IN_MS
 *     + PHRASE_HOLD_MS should stay >= the audio clip's duration so the wipe
 *     never starts mid-clip.
 *   - Audio: change-the-world.mp3 import above; swap the file (keep the
 *     same name) to change the clip, or delete the "Play the ... clip"
 *     effect below to remove audio entirely.
 *   - Sync-pulse flash: the effect scheduled near the end of "rain"
 *     (revealFlash state) -- fires once, ~250ms before the collapse begins.
 *   - CRT power-off collapse: the "collapse" phase (COLLAPSE_MS) between
 *     rain and cut -- the motion.div wrapping the canvas squashes scaleY
 *     then scaleX to a point. Set COLLAPSE_MS to 0 to skip it.
 *   - Ambient hum: the oscillator/gain effects right after the click-sound
 *     context setup -- swells through boot+rain, cuts hard at collapse.
 *   - Typing clicks: playTypeClick() (synthesized via Web Audio, no asset)
 *     called from the phrase-in stepped-reveal effect.
 *   - Exit effect: the "phrase-out" rendering branch (currently a sweeping
 *     erase cursor).
 *   - Skip-for-testing: devSkipRequested() above (VITE_SKIP_INTRO=1 in a
 *     local .env, or `localStorage.setItem("nzyselle:skipIntro","1")`
 *     from devtools -- both inert outside dev builds).
 */
export function SplashScreen({ mode, onComplete }: SplashScreenProps) {
  const prefersReducedMotion = useReducedMotion();
  const skipEntirely = mode === "off" || devSkipRequested();

  const [phase, setPhase] = useState<Phase>("boot");
  const [bootLineIdx, setBootLineIdx] = useState(0);
  const [topNoise, setTopNoise] = useState(NOISE_FRAGMENTS[0]);
  const [bottomNoise, setBottomNoise] = useState(NOISE_FRAGMENTS[1]);
  const [phraseReveal, setPhraseReveal] = useState(0); // 0..1 columns revealed
  const [phraseWipe, setPhraseWipe] = useState(0); // 0..1 columns erased
  const [revealFlash, setRevealFlash] = useState(false); // brief "sync" pulse near the end of the rain
  const completedRef = useRef(false);
  const revealFlashedRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ndAudioRef = useRef<HTMLAudioElement | null>(null);
  const sfxCtxRef = useRef<AudioContext | null>(null);
  const humOscRef = useRef<OscillatorNode | null>(null);
  const humGainRef = useRef<GainNode | null>(null);
  const humStoppedRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const phaseRef = useRef<Phase>("boot");

  const scale = mode === "short" ? 0.15 : 1;
  const BOOT_MS = prefersReducedMotion ? 500 : Math.round(900 * scale);
  const RAIN_MS = prefersReducedMotion ? 400 : Math.round(5000 * scale);
  // Brief CRT-style power-off squash between the rain and the black cut.
  const COLLAPSE_MS = prefersReducedMotion ? 0 : Math.round(220 * scale);
  // Plain black pause after the cut, before "Change The World." appears.
  const BLACK_HOLD_MS = prefersReducedMotion ? 400 : Math.round(1000 * scale);
  // "Change the world." typed reveal + hold is slowed to comfortably cover
  // the ~2.688s Stephen Hawking clip (src/assets/change-the-world.mp3) --
  // the audio starts the instant phrase-in begins, so in+hold together
  // must run at least as long as the clip.
  const PHRASE_IN_MS = Math.round((prefersReducedMotion ? 700 : 1600) * scale);
  const PHRASE_HOLD_MS = Math.round((prefersReducedMotion ? 600 : 1700) * scale);
  const PHRASE_OUT_MS = prefersReducedMotion ? Math.round(400 * scale) : Math.round(700 * scale);

  const phraseGrid = useMemo(() => buildPhraseGrid(PHRASE), []);
  const noiseRngRef = useRef(1);
  const noiseRng = () => {
    noiseRngRef.current = (noiseRngRef.current * 1103515245 + 12345) & 0x7fffffff;
    return (noiseRngRef.current % 10000) / 10000;
  };

  const completeOnce = () => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete();
  };

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // ---- phase sequencing (all real setTimeout/rAF-driven, nothing blocks
  // the main thread or delays app init beyond this deliberate sequence) ----
  useEffect(() => {
    if (skipEntirely) {
      completeOnce();
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipEntirely]);

  useEffect(() => {
    if (skipEntirely || phase !== "boot") return;
    if (BOOT_LINES.length === 0 || BOOT_MS <= 0) {
      setPhase("rain");
      return;
    }
    const perLine = BOOT_MS / BOOT_LINES.length;
    if (bootLineIdx >= BOOT_LINES.length) {
      setPhase("rain");
      return;
    }
    const t = setTimeout(() => setBootLineIdx((i) => i + 1), perLine);
    return () => clearTimeout(t);
  }, [phase, bootLineIdx, skipEntirely, BOOT_MS]);

  // Margin status-line churn during boot + rain.
  useEffect(() => {
    if (skipEntirely || prefersReducedMotion || (phase !== "boot" && phase !== "rain")) return;
    const id = setInterval(() => {
      setTopNoise(NOISE_FRAGMENTS[Math.floor(noiseRng() * NOISE_FRAGMENTS.length)]);
      setBottomNoise(NOISE_FRAGMENTS[Math.floor(noiseRng() * NOISE_FRAGMENTS.length)]);
    }, 180);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, skipEntirely, prefersReducedMotion]);

  useEffect(() => {
    if (skipEntirely || phase !== "rain") return;
    const t = setTimeout(() => setPhase(COLLAPSE_MS > 0 ? "collapse" : "cut"), RAIN_MS);
    return () => clearTimeout(t);
  }, [phase, skipEntirely, RAIN_MS, COLLAPSE_MS]);

  // A synthesized robotic voice saying "N... D..." partway through the
  // rain -- a baked audio clip (src/assets/n-d-robot-voice.mp3), not a
  // live browser SpeechSynthesisUtterance call (that sounded like plain
  // OS text-to-speech). Created once up front rather than inside the
  // "rain"-scoped effect below, for the same reason as audioRef above:
  // scoping creation to the phase would tie its cleanup to that phase
  // too, risking a cutoff if timing ever changes.
  useEffect(() => {
    if (skipEntirely || mode === "short") return;
    try {
      ndAudioRef.current = new Audio(ndVoiceAudioUrl);
      ndAudioRef.current.volume = 0.8;
    } catch {
      // ignore -- purely additive, never blocks the visual sequence
    }
    return () => {
      ndAudioRef.current?.pause();
      ndAudioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipEntirely, mode]);

  useEffect(() => {
    if (skipEntirely || mode === "short" || phase !== "rain") return;
    const t = setTimeout(() => {
      void ndAudioRef.current?.play().catch(() => {});
    }, 700);
    return () => clearTimeout(t);
  }, [phase, skipEntirely, mode]);

  // A brief "sync" pulse shortly before the rain collapses -- punctuates
  // the transition instead of an abrupt cut with no warning. Fires once.
  useEffect(() => {
    if (skipEntirely || prefersReducedMotion || phase !== "rain" || revealFlashedRef.current) return;
    const delay = Math.max(150, RAIN_MS - 250);
    const t = setTimeout(() => {
      revealFlashedRef.current = true;
      setRevealFlash(true);
      setTimeout(() => setRevealFlash(false), 160);
    }, delay);
    return () => clearTimeout(t);
  }, [phase, skipEntirely, prefersReducedMotion, RAIN_MS]);

  // CRT power-off: the rain squashes to a thin bright line then pinches to
  // a point before the hard cut to black (see the motion.div wrapping the
  // canvas in the render below).
  useEffect(() => {
    if (skipEntirely || phase !== "collapse") return;
    const t = setTimeout(() => setPhase("cut"), COLLAPSE_MS);
    return () => clearTimeout(t);
  }, [phase, skipEntirely, COLLAPSE_MS]);

  // Plain black hold -- no static/glitch content, just the screen at rest
  // for a beat before "Change The World." appears.
  useEffect(() => {
    if (skipEntirely || phase !== "cut") return;
    const t = setTimeout(() => setPhase("phrase-in"), BLACK_HOLD_MS);
    return () => clearTimeout(t);
  }, [phase, skipEntirely, BLACK_HOLD_MS]);

  // Stepped in a FIXED number of increments (not one step per grid column)
  // -- a text "typing" reveal doesn't need 60fps interpolation, and
  // fixing the step count keeps total duration close to PHRASE_IN_MS/
  // PHRASE_OUT_MS regardless of how many columns the phrase happens to
  // span (a per-column timer with a sane minimum delay would instead
  // balloon well past the target once the phrase gets long).
  const PHRASE_STEPS = 24;
  useEffect(() => {
    if (skipEntirely || phase !== "phrase-in") return;
    const perStep = Math.max(8, PHRASE_IN_MS / PHRASE_STEPS);
    if (phraseReveal >= 1) {
      setPhase("phrase-hold");
      return;
    }
    const t = setTimeout(() => {
      setPhraseReveal((p) => Math.min(1, p + 1 / PHRASE_STEPS));
      playTypeClick();
    }, perStep);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, phraseReveal, skipEntirely, PHRASE_IN_MS]);

  // Shared synthesized-audio context for both the typing clicks below and
  // the ambient hum. Created once; silently a no-op wherever Web Audio
  // isn't available (jsdom in tests) or autoplay is blocked.
  useEffect(() => {
    if (skipEntirely || mode === "short") return;
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) sfxCtxRef.current = new Ctx();
    } catch {
      // ignore -- purely additive
    }
    return () => {
      sfxCtxRef.current?.close().catch(() => {});
      sfxCtxRef.current = null;
    };
  }, [skipEntirely, mode]);

  // A soft low tone that swells through boot + rain, scheduled directly on
  // the audio clock (not React state) so the ramp is sample-smooth, then
  // cuts hard the instant "collapse"/"cut" begins for a bit of tension
  // release. Synthesized, no asset. Skipped for reduced motion -- it's tied
  // to the same escalation the visuals skip in that mode.
  useEffect(() => {
    if (skipEntirely || mode === "short" || prefersReducedMotion) return;
    const ctx = sfxCtxRef.current;
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 72;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      const swellSeconds = Math.max(0.2, (BOOT_MS + RAIN_MS) / 1000);
      gain.gain.linearRampToValueAtTime(0.035, ctx.currentTime + swellSeconds);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      humOscRef.current = osc;
      humGainRef.current = gain;
    } catch {
      // ignore -- purely additive
    }
    return () => {
      try {
        humOscRef.current?.stop();
      } catch {
        // already stopped
      }
      humOscRef.current = null;
      humGainRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipEntirely, mode, prefersReducedMotion]);

  useEffect(() => {
    if (skipEntirely || prefersReducedMotion || humStoppedRef.current) return;
    if (phase !== "collapse" && phase !== "cut") return;
    const ctx = sfxCtxRef.current;
    const gain = humGainRef.current;
    const osc = humOscRef.current;
    if (!ctx || !gain || !osc) return;
    humStoppedRef.current = true;
    try {
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.05);
      osc.stop(ctx.currentTime + 0.06);
    } catch {
      // ignore -- purely additive
    }
  }, [phase, skipEntirely, prefersReducedMotion]);

  function playTypeClick() {
    const ctx = sfxCtxRef.current;
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 2200 + Math.random() * 400;
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.02);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.03);
    } catch {
      // ignore -- purely additive
    }
  }

  // Created once, up front -- NOT inside the phrase-in effect below. An
  // effect scoped to `phase === "phrase-in"` would run its cleanup (pausing
  // the audio) the moment phase moves on to "phrase-hold", cutting the clip
  // off after only PHRASE_IN_MS instead of letting it finish. This effect's
  // cleanup only fires on real unmount (dev-skip mid-sequence, or the splash
  // itself being torn down), never on every phase transition.
  useEffect(() => {
    if (skipEntirely || mode === "short") return;
    try {
      audioRef.current = new Audio(changeTheWorldAudioUrl);
      audioRef.current.volume = 0.55;
    } catch {
      // ignore -- purely additive, never blocks the visual sequence
    }
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipEntirely, mode]);

  // Start playback the instant the phrase begins appearing, and then leave
  // it alone -- it plays to completion on its own schedule, independent of
  // the visual phase timers.
  useEffect(() => {
    if (skipEntirely || mode === "short" || phase !== "phrase-in") return;
    void audioRef.current?.play().catch(() => {});
  }, [phase, skipEntirely, mode]);

  useEffect(() => {
    if (skipEntirely || phase !== "phrase-hold") return;
    const t = setTimeout(() => setPhase("phrase-out"), PHRASE_HOLD_MS);
    return () => clearTimeout(t);
  }, [phase, skipEntirely, PHRASE_HOLD_MS]);

  useEffect(() => {
    if (skipEntirely || phase !== "phrase-out") return;
    const perStep = Math.max(8, PHRASE_OUT_MS / PHRASE_STEPS);
    if (phraseWipe >= 1) {
      setPhase("done");
      completeOnce();
      return;
    }
    const t = setTimeout(() => setPhraseWipe((p) => Math.min(1, p + 1 / PHRASE_STEPS)), perStep);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, phraseWipe, skipEntirely, PHRASE_OUT_MS]);

  // ---- digital rain: drawn on canvas (rAF-driven), not React state --
  // continuous falling-code columns are far cheaper and smoother this way
  // than re-rendering a DOM character grid every frame. Runs once for the
  // component's lifetime and reads the current phase via phaseRef so it
  // doesn't reset when boot -> rain -> collapse transitions happen; it just
  // stops scheduling new frames once the rain's visual window has passed.
  useEffect(() => {
    if (skipEntirely || mode === "short" || prefersReducedMotion) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const CELL = 18;
    let cols = 0;
    let drops: Float32Array = new Float32Array(0);
    let speeds: Float32Array = new Float32Array(0);
    let chars: string[] = [];
    let rngState = 7;
    const rng = () => {
      rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
      return (rngState % 10000) / 10000;
    };

    function resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas!.width = Math.round(w * dpr);
      canvas!.height = Math.round(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / CELL);
      const rows = h / CELL;
      drops = new Float32Array(cols);
      speeds = new Float32Array(cols);
      chars = new Array(cols);
      for (let i = 0; i < cols; i++) {
        drops[i] = -rng() * rows * 1.4;
        speeds[i] = 0.12 + rng() * 0.26;
        chars[i] = RAIN_CHARS[Math.floor(rng() * RAIN_CHARS.length)];
      }
    }
    resize();
    // Debounced -- a drag-resize fires dozens of "resize" events per
    // second, and each call reallocates every column's arrays. Without
    // this, dragging the window edge visibly stutters the rain.
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    function onResize() {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 120);
    }
    window.addEventListener("resize", onResize);

    let raf = 0;
    function frame() {
      const p = phaseRef.current;
      if (p !== "boot" && p !== "rain" && p !== "collapse") return; // stop scheduling; canvas fades via CSS
      const w = window.innerWidth;
      const h = window.innerHeight;

      const collapsing = p === "collapse";
      ctx!.fillStyle = collapsing ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0.13)";
      ctx!.fillRect(0, 0, w, h);

      ctx!.font = `${CELL - 4}px 'Cascadia Code','Consolas','Courier New',monospace`;
      ctx!.textBaseline = "top";
      const speedMul = collapsing ? 2.4 : 1;
      for (let i = 0; i < cols; i++) {
        const y = drops[i];
        const px = i * CELL;
        const py = y * CELL;
        if (py > -CELL && py < h + CELL) {
          if (rng() < 0.05) chars[i] = RAIN_CHARS[Math.floor(rng() * RAIN_CHARS.length)];
          ctx!.fillStyle = PALETTE[5];
          ctx!.fillText(chars[i], px, py);
          ctx!.fillStyle = "rgba(79,214,232,0.32)";
          ctx!.fillText(chars[i], px, py - CELL);
        }
        drops[i] += speeds[i] * speedMul;
        if (drops[i] * CELL > h + CELL * 2) {
          drops[i] = -rng() * 12;
          speeds[i] = 0.12 + rng() * 0.26;
        }
      }

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => {
      window.removeEventListener("resize", onResize);
      if (resizeTimer) clearTimeout(resizeTimer);
      cancelAnimationFrame(raf);
    };
  }, [skipEntirely, mode, prefersReducedMotion]);

  if (skipEntirely || phase === "done") return null;

  return (
    <div
      role="status"
      aria-label="Loading Nzyselle Database"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "#000",
        color: PALETTE[3],
        fontFamily: "'Cascadia Code', 'Consolas', 'Courier New', monospace",
        overflow: "hidden",
        cursor: "none",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* subtle scanlines + flicker texture, always-on but low contrast */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          backgroundImage: "repeating-linear-gradient(0deg, rgba(255,255,255,0.035) 0px, rgba(255,255,255,0.035) 1px, transparent 1px, transparent 3px)",
          mixBlendMode: "overlay",
          opacity: phase === "cut" ? 0 : 1,
        }}
      />

      {/* faint film grain */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          opacity: phase === "cut" ? 0 : 0.05,
          mixBlendMode: "overlay",
        }}
      />

      {(phase === "boot" || phase === "rain" || phase === "collapse") && !prefersReducedMotion && (
        <div style={{ padding: "10px 18px", fontSize: 11, color: BOOT_COLOR, opacity: 0.85, whiteSpace: "nowrap", overflow: "hidden" }}>
          {topNoise}
        </div>
      )}

      {phase === "boot" && (
        <div style={{ flex: 1, padding: "0 24px", fontSize: 13, lineHeight: 1.7, color: BOOT_COLOR }}>
          {BOOT_LINES.slice(0, bootLineIdx).map((line, i) => (
            <div key={i}>{line}</div>
          ))}
          {bootLineIdx < BOOT_LINES.length && <span style={{ opacity: 0.6 }}>▌</span>}
        </div>
      )}

      {(phase === "boot" || phase === "rain" || phase === "collapse") && (
        <div style={{ flex: 1, position: "relative" }}>
          {prefersReducedMotion ? (
            // Simplified reduced-motion path: a short, static block of
            // terminal text -- no continuous rain, no flashing.
            phase === "rain" && (
              <div style={{ position: "absolute", inset: 0, padding: "0 24px", fontSize: 12, lineHeight: 1.8, color: NOISE_COLOR, overflow: "hidden" }}>
                {BOOT_LINES.map((line, i) => (
                  <div key={i} style={{ opacity: 0.7 }}>
                    {line}
                  </div>
                ))}
              </div>
            )
          ) : (
            <motion.div
              style={{ position: "absolute", inset: 0 }}
              animate={
                phase === "collapse"
                  ? { scaleY: [1, 0.015, 0.015, 0.015], scaleX: [1, 1, 1, 0], opacity: [1, 1, 1, 0] }
                  : { scaleY: 1, scaleX: 1, opacity: phase === "boot" ? 0 : 1 }
              }
              transition={phase === "collapse" ? { duration: COLLAPSE_MS / 1000, times: [0, 0.45, 0.75, 1], ease: "easeIn" } : { duration: 0.4 }}
            >
              <canvas ref={canvasRef} aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
            </motion.div>
          )}
          <AnimatePresence>
            {revealFlash && (
              <motion.div
                aria-hidden
                initial={{ opacity: 0.5 }}
                animate={{ opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                style={{ position: "absolute", inset: 0, background: PALETTE[5], pointerEvents: "none" }}
              />
            )}
          </AnimatePresence>
        </div>
      )}

      {(phase === "boot" || phase === "rain" || phase === "collapse") && !prefersReducedMotion && (
        <div style={{ padding: "10px 18px", fontSize: 11, color: NOISE_COLOR, opacity: 0.85, whiteSpace: "nowrap", overflow: "hidden", textAlign: "right" }}>
          {bottomNoise}
        </div>
      )}

      {(phase === "phrase-in" || phase === "phrase-hold" || phase === "phrase-out") && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              fontSize: "min(1.6vw, 2.6vh)",
              lineHeight: 1,
              fontFamily: "'Cascadia Code', 'Consolas', 'Courier New', monospace",
              whiteSpace: "pre",
            }}
          >
            <GridRows
              cols={phraseGrid.cols}
              rows={phraseGrid.rows}
              getCell={(i) => {
                const c = i % phraseGrid.cols;
                const r = Math.floor(i / phraseGrid.cols);
                const ch = phraseGrid.chars[r][c];
                const revealedCols = Math.floor(phraseReveal * phraseGrid.cols);
                const wipedCols = Math.floor(phraseWipe * phraseGrid.cols);
                const isVisible = c < revealedCols && c >= wipedCols;
                const isLeadingEdge = c === revealedCols - 1 && phase === "phrase-in";
                return [ch, isVisible ? (isLeadingEdge ? PALETTE[5] : PALETTE[4]) : "transparent"];
              }}
            />
          </div>
          {phase === "phrase-out" && (
            <div
              aria-hidden
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: `${phraseWipe * 100}%`,
                width: 3,
                background: PALETTE[5],
                boxShadow: `0 0 12px ${PALETTE[3]}`,
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

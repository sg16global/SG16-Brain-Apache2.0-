// Universal language autodetect — script level, Unicode-generic.
//
// No language is special-cased: the detector walks Unicode script ranges and
// reports the dominant script by letter count. It works identically for
// Bengali, Urdu, Arabic, English, Chinese, Thai, Amharic — every writing
// system the user may type. It never routes or gates anything; it only
// (a) tells the model which script the user wrote in, and (b) logs
// observability. The reply language itself comes from the same-language rule
// in the system prompt.

interface ScriptRange {
  script: string;
  lo: number;
  hi: number;
}

const RANGES: readonly ScriptRange[] = [
  { script: "latin", lo: 0x0041, hi: 0x024f },
  { script: "greek", lo: 0x0370, hi: 0x03ff },
  { script: "cyrillic", lo: 0x0400, hi: 0x04ff },
  { script: "hebrew", lo: 0x0590, hi: 0x05ff },
  { script: "arabic", lo: 0x0600, hi: 0x06ff },
  { script: "syriac", lo: 0x0700, hi: 0x074f },
  { script: "thaana", lo: 0x0780, hi: 0x07bf },
  { script: "devanagari", lo: 0x0900, hi: 0x097f },
  { script: "bengali", lo: 0x0980, hi: 0x09ff },
  { script: "gurmukhi", lo: 0x0a00, hi: 0x0a7f },
  { script: "gujarati", lo: 0x0a80, hi: 0x0aff },
  { script: "oriya", lo: 0x0b00, hi: 0x0b7f },
  { script: "tamil", lo: 0x0b80, hi: 0x0bff },
  { script: "telugu", lo: 0x0c00, hi: 0x0c7f },
  { script: "kannada", lo: 0x0c80, hi: 0x0cff },
  { script: "malayalam", lo: 0x0d00, hi: 0x0d7f },
  { script: "sinhala", lo: 0x0d80, hi: 0x0dff },
  { script: "thai", lo: 0x0e00, hi: 0x0e7f },
  { script: "lao", lo: 0x0e80, hi: 0x0eff },
  { script: "tibetan", lo: 0x0f00, hi: 0x0fff },
  { script: "myanmar", lo: 0x1000, hi: 0x109f },
  { script: "georgian", lo: 0x10a0, hi: 0x10ff },
  { script: "ethiopic", lo: 0x1200, hi: 0x137f },
  { script: "cherokee", lo: 0x13a0, hi: 0x13ff },
  { script: "khmer", lo: 0x1780, hi: 0x17ff },
  { script: "han", lo: 0x3400, hi: 0x9fff },   // CJK ideographs incl. ext-A and URO
  { script: "hangul", lo: 0xac00, hi: 0xd7af },
  { script: "hiragana", lo: 0x3040, hi: 0x309f },
  { script: "katakana", lo: 0x30a0, hi: 0x30ff },
  { script: "bopomofo", lo: 0x3100, hi: 0x312f },
  { script: "coptic", lo: 0x2c80, hi: 0x2cff },
  { script: "deseret", lo: 0x10400, hi: 0x1044f },
];

function scriptOfCodePoint(cp: number): string | null {
  for (const r of RANGES) if (cp >= r.lo && cp <= r.hi) return r.script;
  return null;
}

export interface DetectResult {
  script: string | null;     // dominant script name, null if undecidable
  confidence: number;        // dominant letters / total letters, 0..1
  totalLetters: number;
}

export function detectScript(text: string): DetectResult {
  const counts = new Map<string, number>();
  let total = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const script = scriptOfCodePoint(cp);
    if (!script) continue;
    counts.set(script, (counts.get(script) ?? 0) + 1);
    total += 1;
  }
  if (total === 0) return { script: null, confidence: 0, totalLetters: 0 };
  let best: string | null = null;
  let bestCount = 0;
  for (const [script, count] of counts) {
    if (count > bestCount) { best = script; bestCount = count; }
  }
  return { script: best, confidence: bestCount / total, totalLetters: total };
}

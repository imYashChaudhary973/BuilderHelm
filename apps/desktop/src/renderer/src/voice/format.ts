const ONES: Readonly<Record<string, number>> = {
  zero: 0,
  oh: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
};

const TEENS: Readonly<Record<string, number>> = {
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS: Readonly<Record<string, number>> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const HOURS: Readonly<Record<string, number>> = {
  ...ONES,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

const PUNCT: Readonly<Record<string, string>> = {
  period: '.',
  'full stop': '.',
  comma: ',',
  'question mark': '?',
  exclamation: '!',
  'exclamation mark': '!',
  'exclamation point': '!',
  colon: ':',
  semicolon: ';',
  hyphen: '-',
  dash: '-',
  'new line': '\n',
  newline: '\n',
  'new paragraph': '\n\n',
};

const MERIDIEM = String.raw`(?:a\.?m\.?|p\.?m\.?)`;
const TIME_SPAN = String.raw`(?:\d{1,2}(?::\d{2})?(?:\s*${MERIDIEM})?|\d+(?:\.\d+)?|[A-Za-z]+(?:\s+(?:${MERIDIEM}|o'?clock))?)`;
const INTERREGNUM = String.raw`(?:no(?:\s*,)?\s*actually|actually|i\s+mean|no\s+wait|wait\s+no)`;

export function formatDictation(text: string): string {
  let value = text.replace(/\s+/g, ' ').trim();
  if (value.length === 0) return value;
  value = applyCorrections(value);
  value = applyTimesAndNumbers(value);
  value = applyPunctuation(value);
  value = glueMeridiem(value);
  value = value.replace(/[ \t]+([,.!?;:])/g, '$1');
  value = value.replace(/\s+\n/g, '\n').replace(/\n[ \t]+/g, '\n');
  value = value.replace(/[ \t]{2,}/g, ' ').trim();
  return capitalizeSentences(value);
}

export function alreadyPunctuated(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, '').length;
  const marks = (text.match(/[.?!]/g) ?? []).length;
  return letters > 0 && marks / Math.max(1, text.split(/\s+/).length) >= 0.08;
}

export function joinUtterances(parts: readonly string[]): string {
  return parts
    .map((part) => part.trim().replace(/[.?!]+$/g, ''))
    .filter((part) => part.length > 0)
    .map((part, index, all) => (index === all.length - 1 ? part : `${part}.`))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function applyCorrections(text: string): string {
  let value = text.replace(/[^.!?\n]*\bscratch that\b\s*/gi, '');
  const marker = new RegExp(
    String.raw`(${TIME_SPAN})\s*(?:\.{2,}|…|,)?\s*\b${INTERREGNUM}\b(?:\s*,)?\s+`,
    'gi',
  );
  value = value.replace(marker, '');
  return value.replace(/\s+/g, ' ').trim();
}

function applyTimesAndNumbers(text: string): string {
  let value = text.replace(
    /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+o['’]?clock\b/gi,
    (_match, hour: string) => {
      const n = HOURS[hour.toLowerCase()] ?? Number(hour);
      return `${Number.isFinite(n) ? n : hour}:00`;
    },
  );
  value = value.replace(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(\d{2})\s+(a\.?m\.?|p\.?m\.?)\b/gi,
    (_match, hour: string, minutes: string, mer: string) =>
      `${HOURS[hour.toLowerCase()] ?? hour}:${minutes}${compactMeridiem(mer)}`,
  );
  const tokens = value.split(/(\s+)/);
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i] ?? '';
    if (/^\s+$/.test(token)) {
      out.push(token);
      i += 1;
      continue;
    }
    const parsed = takeNumber(tokens, i);
    if (parsed !== null) {
      out.push(parsed.value);
      i = parsed.next;
      continue;
    }
    out.push(token);
    i += 1;
  }
  return out.join('');
}

function takeNumber(
  tokens: string[],
  start: number,
): { value: string; next: number } | null {
  const first = parseUnit(tokens[start] ?? '');
  if (first === null) return null;
  let consumed = start + 1;
  let look = nextWord(tokens, consumed);
  let value = first;

  const ones = parseUnit(tokens[look] ?? '');
  if (ones !== null && value >= 20 && value % 10 === 0 && ones < 10) {
    value += ones;
    consumed = look + 1;
    look = nextWord(tokens, consumed);
  }

  if ((tokens[look] ?? '').toLowerCase() === 'point') {
    const fracAt = nextWord(tokens, look + 1);
    const frac = parseUnit(tokens[fracAt] ?? '');
    if (frac !== null) {
      return { value: `${value}.${frac}`, next: fracAt + 1 };
    }
  }

  return { value: String(value), next: consumed };
}

function nextWord(tokens: string[], index: number): number {
  if (/^\s+$/.test(tokens[index] ?? '')) return index + 1;
  return index;
}

function parseUnit(raw: string): number | null {
  const word = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (word.length === 0) return null;
  if (word in ONES) return ONES[word] ?? null;
  if (word in TEENS) return TEENS[word] ?? null;
  if (word in TENS) return TENS[word] ?? null;
  return null;
}

function applyPunctuation(text: string): string {
  let value = text;
  const keys = Object.keys(PUNCT).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const glyph = PUNCT[key];
    if (glyph === undefined) continue;
    const pattern = new RegExp(`\\b${key.replace(/ /g, '\\s+')}\\b`, 'gi');
    value = value.replace(pattern, glyph);
  }
  return value;
}

function glueMeridiem(text: string): string {
  return text.replace(
    /\b(\d{1,2}(?::\d{2})?)\s+(a\.?m\.?|p\.?m\.?)\b/gi,
    (_match, hour: string, mer: string) => `${hour}${compactMeridiem(mer)}`,
  );
}

function compactMeridiem(raw: string): string {
  return raw.replace(/\./g, '').toLowerCase();
}

function capitalizeSentences(text: string): string {
  return text.replace(
    /(^|[.!?]\s+|\n+)([a-z])/g,
    (_match, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`,
  );
}

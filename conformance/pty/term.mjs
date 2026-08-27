import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, 'vendor/@xterm/headless/package.json'));
const { Terminal } = require('./lib-headless/xterm-headless.js');

export const TERM = 'xterm-256color';
export const COLS = 120;
export const ROWS = 30;
export const SCROLLBACK = 1000;

export function createTerm(cols = COLS, rows = ROWS) {
  return new Terminal({
    cols,
    rows,
    scrollback: SCROLLBACK,
    allowProposedApi: true,
    convertEol: false,
  });
}

export function writeTerm(term, data) {
  return new Promise((resolve) => {
    term.write(data, resolve);
  });
}

export function snapshot(term) {
  const buf = term.buffer.active;
  const lines = [];
  const fg = [];
  const width = [];
  for (let y = 0; y < buf.length; y++) {
    const line = buf.getLine(y);
    if (line === undefined) {
      lines.push('');
      continue;
    }
    lines.push(line.translateToString(false));
    if (y < buf.viewportY || y >= buf.viewportY + term.rows) continue;
    const fgRow = [];
    const widthRow = [];
    for (let x = 0; x < term.cols; x++) {
      const cell = line.getCell(x);
      fgRow.push(cell === undefined ? 0 : cell.getFgColor());
      widthRow.push(cell === undefined ? 1 : cell.getWidth());
    }
    fg.push(fgRow);
    width.push(widthRow);
  }
  return {
    cols: term.cols,
    rows: term.rows,
    cursor: { x: buf.cursorX, y: buf.cursorY },
    viewportY: buf.viewportY,
    length: buf.length,
    lines,
    fg,
    width,
  };
}

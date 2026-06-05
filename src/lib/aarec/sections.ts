/**
 * Tokenizer for Armagetron `.aarec` recordings.
 *
 * An `.aarec` is a newline-delimited text stream of sections written by
 * `tRecorder` (see `src/tools/tRecorder.cpp`). Each section starts at column 0
 * with its name, followed by space-separated values. `L`-prefixed values are
 * "line strings" (newlines escaped as `\n`), so a plain newline split is safe.
 *
 * We only surface the sections we need:
 *  - `VERSION` : recording format version.
 *  - `CONFIG`  : key/value config items (metadata).
 *  - `T`       : playback timestamps (wall-clock ordering).
 *  - `READ`    : inbound UDP datagrams. `READ <len> L<addr>` on one line, then
 *               `len` signed-byte ints on the following line (see
 *               `nSocket.cpp` `ReadArchiver`). `READ -1` means no data.
 */

export type AarecRecord =
  | { kind: "version"; value: string }
  | { kind: "config"; key: string; value: string }
  | { kind: "time"; time: number }
  | { kind: "read"; addr: string; bytes: Uint8Array };

function stripL(token: string): string {
  return token.startsWith("L") ? token.slice(1) : token;
}

export function* iterateAarec(text: string): Generator<AarecRecord> {
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Data/continuation lines start with whitespace; headers start at column 0.
    if (line.length === 0 || line.charCodeAt(0) === 32 /* space */) {
      continue;
    }

    const space = line.indexOf(" ");
    const name = space === -1 ? line : line.slice(0, space);

    switch (name) {
      case "READ": {
        const rest = line.slice(space + 1);
        const sp2 = rest.indexOf(" ");
        const lenStr = sp2 === -1 ? rest : rest.slice(0, sp2);
        const len = Number.parseInt(lenStr, 10);
        if (!Number.isFinite(len) || len < 0) {
          break; // READ -1: nothing was received.
        }
        const addr = sp2 === -1 ? "" : stripL(rest.slice(sp2 + 1));
        // Bytes live on the next line.
        const dataLine = lines[++i] ?? "";
        const bytes = parseBytes(dataLine, len);
        yield { kind: "read", addr, bytes };
        break;
      }
      case "T": {
        const time = Number.parseFloat(line.slice(space + 1));
        if (Number.isFinite(time)) {
          yield { kind: "time", time };
        }
        break;
      }
      case "CONFIG": {
        const rest = line.slice(space + 1);
        const sp2 = rest.indexOf(" ");
        if (sp2 === -1) break;
        const key = stripL(rest.slice(0, sp2));
        const value = stripL(rest.slice(sp2 + 1));
        yield { kind: "config", key, value };
        break;
      }
      case "VERSION": {
        if (space !== -1) {
          yield { kind: "version", value: stripL(line.slice(space + 1)) };
        }
        break;
      }
      default:
        break;
    }
  }
}

function parseBytes(line: string, len: number): Uint8Array {
  const out = new Uint8Array(len);
  if (len === 0) return out;

  let idx = 0;
  let i = 0;
  const n = line.length;
  while (i < n && idx < len) {
    // Skip whitespace.
    while (i < n && line.charCodeAt(i) === 32) i++;
    if (i >= n) break;
    // Read an integer token (optionally negative).
    let neg = false;
    if (line.charCodeAt(i) === 45 /* - */) {
      neg = true;
      i++;
    }
    let value = 0;
    while (i < n) {
      const c = line.charCodeAt(i);
      if (c < 48 || c > 57) break;
      value = value * 10 + (c - 48);
      i++;
    }
    out[idx++] = (neg ? -value : value) & 0xff;
  }
  return out;
}

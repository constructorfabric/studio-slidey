#!/usr/bin/env node
// Pull the first balanced top-level JSON object out of arbitrary model output
// (handles ``` fences and prose preambles/postambles). Reads stdin, writes the
// extracted object to stdout, exits 1 if none found. Used by qa-inspect.sh so a
// chatty model reply doesn't sink the whole review.
'use strict';
let s = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => (s += d));
// Try each '{' as a candidate object start, returning the first balanced span
// that also JSON.parses. Trying successive starts (not just the first '{') is
// what lets us skip a brace that appears inside prose — e.g. a "{{host}}"
// template string the model quoted in a preamble before the real JSON.
process.stdin.on('end', () => {
  for (let start = s.indexOf('{'); start !== -1; start = s.indexOf('{', start + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          const candidate = s.slice(start, i + 1);
          try { JSON.parse(candidate); process.stdout.write(candidate); process.exit(0); }
          catch { break; }   // balanced span isn't valid JSON; advance to next '{'
        }
      }
    }
  }
  process.exit(1);
});

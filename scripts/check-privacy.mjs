// Fails the build if anything that ships could carry a network address.
//
// The point is not that there is no address in here today — a grep can tell
// you that once. The point is that adding one has to be a deliberate act that
// trips a check, rather than something that arrives quietly in a debug line
// somebody meant to take out.
//
// Scanned: every file git tracks (which is exactly what a `git archive` build
// contains) plus dist/ when it has been built.
//
// Run on its own with `npm run check:privacy`; `npm run build` runs it too.

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

// Addresses that identify nobody: the wildcard bind, loopback, and the
// documentation ranges. Everything else is a finding.
const HARMLESS_V4 = /^(0\.0\.0\.0|127\.\d+\.\d+\.\d+|255\.255\.255\.255|192\.0\.2\.\d+|198\.51\.100\.\d+|203\.0\.113\.\d+)$/;

const RULES = [
  {
    name: 'IPv4 address',
    // Four dotted octets, not part of a longer dotted run — that last part is
    // what keeps semantic version numbers like 1.48.0 out of the results.
    re: /(?<![\w.])((?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\w.])/g,
    ok: (m) => HARMLESS_V4.test(m)
  },
  {
    name: 'IPv6 address',
    re: /(?<![\w:])(?:[0-9a-fA-F]{1,4}:){4,7}[0-9a-fA-F]{1,4}(?![\w:])/g,
    ok: (m) => /^(::1|0:0:0:0:0:0:0:1)$/.test(m)
  },
  {
    name: 'WebRTC (hands out local and public addresses without asking)',
    re: /RTCPeerConnection|createDataChannel|\bstun:|\bturn:/g
  },
  {
    name: "reading a peer's address",
    re: /remoteAddress|remoteFamily|networkInterfaces|x-forwarded-for/gi
  }
];

const TEXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.json', '.html', '.css', '.md', '.yml', '.yaml', '.txt', '.sh']);
const SELF = 'scripts/check-privacy.mjs';

function tracked() {
  return execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = [...tracked(), ...(existsSync('dist') ? walk('dist') : [])]
  .filter((f) => f !== SELF && TEXT.has(extname(f)));

const findings = [];
for (const f of files) {
  let src;
  try {
    if (statSync(f).size > 8 * 1024 * 1024) continue;
    src = readFileSync(f, 'utf8');
  } catch { continue; }
  const lines = src.split('\n');
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(src))) {
      if (rule.ok && rule.ok(m[0])) continue;
      const line = src.slice(0, m.index).split('\n').length;
      findings.push({ f, line, rule: rule.name, text: lines[line - 1].trim().slice(0, 110) });
    }
  }
}

console.log(`privacy check: ${files.length} shipped files scanned`);
if (!findings.length) {
  console.log('  no network addresses, no WebRTC, nothing reading a peer\'s address');
  process.exit(0);
}
for (const x of findings) console.error(`  ${x.f}:${x.line}  ${x.rule}\n      ${x.text}`);
console.error(`\n${findings.length} finding(s). An address must not ship in this build.`);
process.exit(1);

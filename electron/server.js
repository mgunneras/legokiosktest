// Tiny static file server — used by both `npm run dev` and the Electron shell.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json' };

export function serve(port = 5173, host = '0.0.0.0') {
  const server = http.createServer(async (req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const file = join(ROOT, normalize(url === '/' ? '/index.html' : url));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
                           'Cache-Control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404).end('not found'); }
  });
  return new Promise(ok => server.listen(port, host, () => ok(`http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`)));
}

export function lanAddresses() {
  return Object.values(networkInterfaces()).flat()
    .filter(i => i.family === 'IPv4' && !i.internal).map(i => i.address);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 5173;
  serve(port, process.env.HOST || '0.0.0.0').then(() => {
    console.log(`brick kiosk\n  local   http://127.0.0.1:${port}`);
    for (const ip of lanAddresses()) console.log(`  lan     http://${ip}:${port}`);
  });
}

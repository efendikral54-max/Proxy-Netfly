const express = require('express');
const { Readable } = require('stream');
const app = express();
const port = process.env.PORT || 8080;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges'
};

app.use((req, res, next) => {
  res.set(CORS);
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.get('/', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).json({ error: 'url parameter missing' });
  }

  try {
    const workerBase = `${req.protocol}://${req.get('host')}`;
    const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);

    const reqHeaders = {};
    if (req.headers.range) reqHeaders['range'] = req.headers.range;

    if (targetUrl.includes('pixeldrain.com')) {
      reqHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    } else {
      reqHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
      reqHeaders['Accept'] = '*/*';
      reqHeaders['Referer'] = 'https://vidmody.com/';
      reqHeaders['Origin'] = 'https://vidmody.com';
    }

    const response = await fetch(targetUrl, { headers: reqHeaders, redirect: 'follow' });
    const contentType = response.headers.get('content-type') || '';
    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);

    // Header für Video-Streaming weiterleiten (Wichtig für Vor-/Zurückspulen)
    if (response.headers.has('content-range')) res.set('Content-Range', response.headers.get('content-range'));
    if (response.headers.has('accept-ranges')) res.set('Accept-Ranges', response.headers.get('accept-ranges'));

    // Pixeldrain / Große Dateien direkt streamen (RAM-Schonend)
    if (contentLength > 5000000 || targetUrl.includes('pixeldrain.com')) {
      res.status(response.status);
      res.set('Content-Type', contentType || 'application/octet-stream');
      if (response.headers.has('content-length')) res.set('Content-Length', response.headers.get('content-length'));
      
      Readable.fromWeb(response.body).pipe(res);
      return;
    }

    // Vidmody M3U8 Playlist umschreiben
    const buffer = await response.arrayBuffer();
    const nodeBuffer = Buffer.from(buffer);
    const textCheck = nodeBuffer.slice(0, 100).toString('utf-8');
    const isM3U8 = textCheck.includes('#EXTM3U') || textCheck.includes('#EXT-X-');

    if (isM3U8) {
      const text = nodeBuffer.toString('utf-8');
      const processed = text.split('\n').map(line => {
        const t = line.trim();
        if (!t) return '';
        if (t.startsWith('#')) {
          if (t.includes('URI="')) {
            return t.replace(/URI="([^"]+)"/g, (_m, uri) => {
              const abs = uri.startsWith('http') ? uri : baseUrl + uri;
              return `URI="${workerBase}?url=${encodeURIComponent(abs)}&mode=segment"`;
            });
          }
          return t;
        }
        const abs = t.startsWith('http') ? t : baseUrl + t;
        const lo = abs.toLowerCase();
        if (lo.includes('.m3u8') || (lo.includes('/vs/') && !lo.includes('.jpg'))) {
          return `${workerBase}?url=${encodeURIComponent(abs)}&mode=manifest`;
        }
        return `${workerBase}?url=${encodeURIComponent(abs)}&mode=segment`;
      }).join('\n');

      res.set('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      return res.send(processed);
    }

    res.set('Content-Type', contentType || 'application/octet-stream');
    res.set('Cache-Control', 'public, max-age=3600');
    return res.send(nodeBuffer);

  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.listen(port, () => console.log(`Proxy läuft auf Port ${port}`));

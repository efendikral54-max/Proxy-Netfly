exports.handler = async function(event, context) {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const targetUrl = event.queryStringParameters.url;

  if (!targetUrl) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'url parameter missing' })
    };
  }

  try {
    const workerBase = 'https://' + event.headers.host + '/.netlify/functions/proxy';
    const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);

    const reqHeaders = new Headers();
    if (event.headers.range) reqHeaders.set('range', event.headers.range);

    if (targetUrl.includes('pixeldrain.com')) {
      reqHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    } else {
      reqHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      reqHeaders.set('Accept', '*/*');
      reqHeaders.set('Referer', 'https://vidmody.com/');
      reqHeaders.set('Origin', 'https://vidmody.com');
    }

    const res = await fetch(targetUrl, {
      headers: reqHeaders,
      redirect: 'follow',
    });

    const contentType = res.headers.get('content-type') || '';
    const contentLength = parseInt(res.headers.get('content-length') || '0', 10);

    // Pixeldrain / Große Dateien direkt streamen (als ArrayBuffer)
    if (contentLength > 5000000 || targetUrl.includes('pixeldrain.com')) {
      const buffer = await res.arrayBuffer();
      const base64Body = Buffer.from(buffer).toString('base64');
      
      const resHeaders = { ...CORS, 'Content-Type': contentType || 'application/octet-stream' };
      if (res.headers.has('content-length')) resHeaders['Content-Length'] = res.headers.get('content-length');
      if (res.headers.has('content-range')) resHeaders['Content-Range'] = res.headers.get('content-range');
      if (res.headers.has('accept-ranges')) resHeaders['Accept-Ranges'] = res.headers.get('accept-ranges');

      return {
        statusCode: res.status,
        headers: resHeaders,
        body: base64Body,
        isBase64Encoded: true
      };
    }

    // Vidmody M3U8 Playlist Umschreiben
    const textCheckBuffer = await res.clone().arrayBuffer();
    const textCheck = new TextDecoder().decode(textCheckBuffer.slice(0, 100));
    const isM3U8 = textCheck.includes('#EXTM3U') || textCheck.includes('#EXT-X-');

    if (isM3U8) {
      const text = await res.text();
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

      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8' },
        body: processed
      };
    }

    // Fallback für Segmente (TS Dateien)
    const buffer = await res.arrayBuffer();
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': contentType || 'application/octet-stream', 'Cache-Control': 'public, max-age=3600' },
      body: Buffer.from(buffer).toString('base64'),
      isBase64Encoded: true
    };

  } catch (e) {
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: e.message })
    };
  }
};

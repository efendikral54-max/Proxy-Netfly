export const config = {
  runtime: 'edge', // Aktiviert die ultraschnelle Edge-Infrastruktur
};

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges'
};

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }

  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url');

  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'url parameter missing' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
    const workerBase = url.origin + '/api'; // Vercel leitet über /api/ index weiter

    const reqHeaders = new Headers();
    const range = request.headers.get('range');
    if (range) reqHeaders.set('range', range);

    if (targetUrl.includes('pixeldrain.com')) {
      reqHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    } else {
      reqHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
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

    // Pixeldrain / Große Dateien direkt streamen
    if (contentLength > 5000000 || targetUrl.includes('pixeldrain.com')) {
      const resHeaders = new Headers(CORS);
      resHeaders.set('Content-Type', contentType || 'application/octet-stream');
      if (res.headers.has('content-length')) resHeaders.set('Content-Length', res.headers.get('content-length'));
      if (res.headers.has('content-range')) resHeaders.set('Content-Range', res.headers.get('content-range'));
      if (res.headers.has('accept-ranges')) resHeaders.set('Accept-Ranges', res.headers.get('accept-ranges'));

      return new Response(res.body, { status: res.status, headers: resHeaders });
    }

    // Vidmody M3U8 Playlist Umschreiben
    const buffer = await res.arrayBuffer();
    const textCheck = new TextDecoder().decode(buffer.slice(0, 100));
    const isM3U8 = textCheck.includes('#EXTM3U') || textCheck.includes('#EXT-X-');

    if (isM3U8) {
      const text = new TextDecoder().decode(buffer);
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

      return new Response(processed, {
        headers: { ...CORS, 'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8' },
      });
    }

    return new Response(buffer, {
      headers: {
        ...CORS,
        'Content-Type': contentType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=3600',
      },
    });

  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
}

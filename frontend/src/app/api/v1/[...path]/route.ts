export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getBackendOrigin() {
  return process.env.BACKEND_ORIGIN || 'http://localhost:8000';
}

function shouldDropHeader(key: string) {
  const k = key.toLowerCase();
  return k === 'host' || k === 'connection' || k === 'content-length';
}

async function getParams(ctx: any): Promise<{ path: string[] }> {
  // Next 15 typed helpers sometimes model params as Promise.
  // Route handlers may receive plain objects; this normalizes both.
  const p = await Promise.resolve(ctx?.params);
  return p || { path: [] };
}

async function proxy(request: Request, ctx: any) {
  const { path } = await getParams(ctx);
  const incomingUrl = new URL(request.url);

  const targetBase = getBackendOrigin();
  const encodedPath = (path || []).map((s) => encodeURIComponent(String(s))).join('/');
  const hasTrailingSlash = incomingUrl.pathname.endsWith('/');
  const targetPath = `/api/v1/${encodedPath}${hasTrailingSlash ? '/' : ''}`;
  const targetUrl = new URL(targetBase + targetPath);
  targetUrl.search = incomingUrl.search;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!shouldDropHeader(key)) headers.set(key, value);
  });

  // Make server-side proxying simpler/more predictable.
  headers.delete('accept-encoding');

  const method = request.method.toUpperCase();
  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer();

  async function doFetch(url: URL) {
    return fetch(url, {
      method,
      headers,
      body: body as any,
      redirect: 'manual',
      cache: 'no-store',
    });
  }

  let res = await doFetch(targetUrl);

  // Django/DRF often issues 301 to append trailing slashes.
  // If we pass that redirect to the browser, it can loop with Next's routing.
  // Instead, follow one "append slash" redirect server-side while preserving method/body.
  if ((res.status === 301 || res.status === 308) && res.headers.get('location')) {
    const loc = res.headers.get('location') || '';
    const resolved = new URL(loc, targetUrl);

    const sameOrigin = resolved.origin === targetUrl.origin;
    const sameQuery = resolved.search === targetUrl.search;
    const isAppendSlash =
      sameOrigin &&
      sameQuery &&
      !targetUrl.pathname.endsWith('/') &&
      resolved.pathname === `${targetUrl.pathname}/`;

    if (isAppendSlash) {
      res = await doFetch(resolved);
    }
  }

  const outHeaders = new Headers(res.headers);
  outHeaders.delete('content-encoding');
  outHeaders.delete('content-length');

  return new Response(res.body, {
    status: res.status,
    headers: outHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;

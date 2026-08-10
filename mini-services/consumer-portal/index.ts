// SnakZap Consumer Portal — standalone service on port 3006
// Proxies to Next.js (port 3000) with /consumer path prefix for pages,
// and direct proxy for /api/* and /_next/* (static assets).

const PORT = 3006
const NEXTJS_URL = 'http://localhost:3000'
const PORTAL_PATH = '/consumer'

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname

    // Static assets — proxy directly (no path prefix)
    if (path.startsWith('/_next/') || path.startsWith('/favicon') || path.startsWith('/logo') || path.startsWith('/robots') || path.startsWith('/images/')) {
      return await proxy(req, `${NEXTJS_URL}${path}${url.search}`)
    }

    // API calls — proxy directly (no path prefix)
    if (path.startsWith('/api/')) {
      return await proxy(req, `${NEXTJS_URL}${path}${url.search}`)
    }

    // Root path → serve the consumer portal page
    if (path === '/' || path === '') {
      return await proxy(req, `${NEXTJS_URL}${PORTAL_PATH}${url.search}`)
    }

    // Consumer-specific routes (e.g. /menu, /orders, /tracking)
    // These are client-side routes — serve the consumer page
    return await proxy(req, `${NEXTJS_URL}${PORTAL_PATH}${url.search}`)
  },
})

async function proxy(req: Request, targetUrl: string): Promise<Response> {
  const headers = new Headers(req.headers)
  headers.set('host', 'localhost:3000')

  const fetchOpts: RequestInit = {
    method: req.method,
    headers,
    redirect: 'manual',
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    fetchOpts.body = await req.text()
  }

  const res = await fetch(targetUrl, fetchOpts)

  // Pass through response with headers (including cookies)
  const responseHeaders = new Headers(res.headers)
  // Rewrite asset paths if needed (for HTML responses)
  if (res.headers.get('content-type')?.includes('text/html')) {
    const body = await res.text()
    return new Response(body, {
      status: res.status,
      headers: responseHeaders,
    })
  }

  return new Response(res.body, {
    status: res.status,
    headers: responseHeaders,
  })
}

console.log(`[snakzap-consumer-portal] listening on port ${PORT}`)
console.log(`[snakzap-consumer-portal] proxying to ${NEXTJS_URL}${PORTAL_PATH}`)

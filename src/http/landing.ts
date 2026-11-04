import type { Context } from 'hono';

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export function landingPage(c: Context): Response {
  const origin = escapeHtml(new URL(c.req.url).origin);
  return c.html(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hearth &amp; Tap Booking API</title>
<style>
  :root { --ink:#1d2321; --muted:#5b6461; --copper:#b4572e; --paper:#f7f3ee; --line:#e2dbd2; }
  @media (prefers-color-scheme: dark) { :root { --ink:#ece7e1; --muted:#a39d96; --copper:#e08a5c; --paper:#161a19; --line:#2c3230; } }
  body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width:44rem; margin:0 auto; padding:3rem 1rem 4rem; }
  .demo { border:1px solid var(--copper); color:var(--copper); padding:.6rem .9rem; border-radius:6px; font-size:.9rem; }
  h1 { font-size:2rem; margin:1.5rem 0 .25rem; letter-spacing:-.01em; }
  p.lede { color:var(--muted); margin-top:0; }
  table { width:100%; border-collapse:collapse; margin-top:1.5rem; font-size:.95rem; }
  td { padding:.55rem 0; border-top:1px solid var(--line); vertical-align:top; }
  td:first-child { width:9rem; color:var(--muted); }
  code { font:.9em ui-monospace, SFMono-Regular, Menlo, monospace; word-break:break-all; }
  a { color:var(--copper); }
</style>
</head>
<body>
<main>
  <p class="demo"><strong>Demo business.</strong> Hearth &amp; Tap is invented for an Agentplace engineering test task. No engineer will visit and no payment is taken.</p>
  <h1>Hearth &amp; Tap Booking API</h1>
  <p class="lede">Service area, quotes, availability and bookings for a London plumbing &amp; heating company. It is the external capability behind the Hearth &amp; Tap Agentplace agent.</p>
  <table>
    <tr><td>MCP server</td><td><code>${origin}/mcp</code> (Streamable HTTP, stateless)</td></tr>
    <tr><td>REST docs</td><td><a href="/docs">/docs</a> (Swagger UI)</td></tr>
    <tr><td>OpenAPI</td><td><a href="/openapi.json">/openapi.json</a></td></tr>
    <tr><td>Health</td><td><a href="/health">/health</a></td></tr>
  </table>
</main>
</body>
</html>`);
}

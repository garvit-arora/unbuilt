/** Public liveness probe for Render and external uptime monitors. It exposes no credentials or dependency details. */
export function GET() {
  return Response.json(
    { status: "ok", service: "unbuilt", uptimeSeconds: Math.floor(process.uptime()) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

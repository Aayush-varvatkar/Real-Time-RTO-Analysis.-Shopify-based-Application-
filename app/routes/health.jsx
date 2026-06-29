// Lightweight health-check endpoint for UptimeRobot / uptime monitoring.
// Does NOT require Shopify auth — just returns 200 OK instantly.
// Ping URL: https://rto-predictor.onrender.com/health

export const loader = () => {
  return new Response(JSON.stringify({ status: "ok", ts: Date.now() }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

import { checkPublicRateLimit } from "../utils/rateLimiter";

// Lightweight health-check endpoint for UptimeRobot / uptime monitoring.
// Does NOT require Shopify auth — returns 200 OK or 429 if limit exceeded.
// Ping URL: https://rto-predictor.onrender.com/health

export const loader = ({ request }) => {
  const rateLimitRes = checkPublicRateLimit(request);
  if (rateLimitRes) return rateLimitRes;

  return new Response(JSON.stringify({ status: "ok" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

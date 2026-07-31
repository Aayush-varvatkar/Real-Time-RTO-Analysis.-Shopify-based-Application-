import { rateLimitConfig } from "../config/rateLimit.js";

// Sliding window in-memory store
const store = new Map();

// Periodic cleanup every 5 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of store.entries()) {
    if (record.expiresAt && record.expiresAt < now) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Extracts client IP address from standard proxy & CDN request headers.
 */
export function getClientIp(request) {
  const headers = request.headers;
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return (
    headers.get("cf-connecting-ip") ||
    headers.get("x-real-ip") ||
    headers.get("x-client-ip") ||
    "127.0.0.1"
  );
}

/**
 * Helper to build standard Rate Limit Response (HTTP 429)
 */
function build429Response({ message, retryAfterSec, limit, remaining, resetSec }) {
  return new Response(
    JSON.stringify({
      error: "Too Many Requests",
      message,
      retryAfter: retryAfterSec,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSec),
        "X-RateLimit-Limit": String(limit),
        "X-RateLimit-Remaining": String(Math.max(0, remaining)),
        "X-RateLimit-Reset": String(resetSec),
      },
    }
  );
}

/**
 * TIER 1: AUTHENTICATION ROUTES
 * Uses per-IP and per-account tracking with exponential backoff.
 */
export function checkAuthRateLimit(request, shop = "") {
  const cfg = rateLimitConfig.auth;
  const now = Date.now();
  const ip = getClientIp(request);
  const cleanShop = (shop || "").toLowerCase().trim();

  const ipKey = `auth:ip:${ip}`;
  const shopKey = cleanShop ? `auth:shop:${cleanShop}` : null;

  const checkRecord = (key) => {
    if (!key) return null;
    let rec = store.get(key);
    if (!rec || rec.expiresAt < now) {
      rec = { attempts: 0, lastAttempt: now, expiresAt: now + cfg.windowMs };
    }
    return rec;
  };

  const ipRec = checkRecord(ipKey);
  const shopRec = checkRecord(shopKey);

  const maxAttempts = Math.max(ipRec?.attempts || 0, shopRec?.attempts || 0);

  // Check exponential backoff threshold
  if (maxAttempts >= cfg.maxAttempts) {
    const excessAttempts = maxAttempts - cfg.maxAttempts + 1;
    const backoffMs = Math.min(
      cfg.maxBackoffMs,
      cfg.baseBackoffMs * Math.pow(2, excessAttempts - 1)
    );
    const lastAttemptTime = Math.max(ipRec?.lastAttempt || 0, shopRec?.lastAttempt || 0);
    const nextAllowedTime = lastAttemptTime + backoffMs;

    if (now < nextAllowedTime) {
      const retryAfterSec = Math.ceil((nextAllowedTime - now) / 1000);
      const resetSec = Math.ceil(cfg.windowMs / 1000);
      return build429Response({
        message: `Too many authentication attempts. Exponential backoff active. Retry in ${retryAfterSec} seconds.`,
        retryAfterSec,
        limit: cfg.maxAttempts,
        remaining: 0,
        resetSec,
      });
    }
  }

  // Record attempt
  const updateRecord = (key, rec) => {
    if (!key) return;
    rec.attempts += 1;
    rec.lastAttempt = now;
    rec.expiresAt = now + cfg.windowMs;
    store.set(key, rec);
  };

  updateRecord(ipKey, ipRec);
  if (shopKey && shopRec) updateRecord(shopKey, shopRec);

  return null; // Allowed
}

/**
 * TIER 2: PUBLIC ENDPOINTS (/health, /webhooks/*)
 * Per-IP moderate rate limiting.
 */
export function checkPublicRateLimit(request) {
  const cfg = rateLimitConfig.public;
  const now = Date.now();
  const ip = getClientIp(request);
  const key = `public:ip:${ip}`;

  let rec = store.get(key);
  if (!rec || rec.expiresAt < now) {
    rec = { count: 0, expiresAt: now + cfg.windowMs };
  }

  rec.count += 1;
  store.set(key, rec);

  if (rec.count > cfg.maxRequests) {
    const retryAfterSec = Math.ceil((rec.expiresAt - now) / 1000);
    return build429Response({
      message: "Rate limit exceeded for public endpoint. Please slow down.",
      retryAfterSec,
      limit: cfg.maxRequests,
      remaining: 0,
      resetSec: retryAfterSec,
    });
  }

  return null; // Allowed
}

/**
 * TIER 3: AUTHENTICATED USER ACTIONS (/app, /app/orders)
 * Per-shop or per-IP looser rate limiting.
 */
export function checkAuthenticatedRateLimit(request, shop = "") {
  const cfg = rateLimitConfig.authenticated;
  const now = Date.now();
  const ip = getClientIp(request);
  const cleanShop = (shop || "").toLowerCase().trim();
  const key = cleanShop ? `app:shop:${cleanShop}` : `app:ip:${ip}`;

  let rec = store.get(key);
  if (!rec || rec.expiresAt < now) {
    rec = { count: 0, expiresAt: now + cfg.windowMs };
  }

  rec.count += 1;
  store.set(key, rec);

  if (rec.count > cfg.maxRequests) {
    const retryAfterSec = Math.ceil((rec.expiresAt - now) / 1000);
    return build429Response({
      message: "Rate limit exceeded for authenticated actions.",
      retryAfterSec,
      limit: cfg.maxRequests,
      remaining: 0,
      resetSec: retryAfterSec,
    });
  }

  return null; // Allowed
}

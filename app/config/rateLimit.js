/**
 * Configuration schema for rate limiting across all endpoint tiers.
 * All values are configurable via environment variables with sensible defaults.
 */

export const rateLimitConfig = {
  // Tier 1: Authentication Routes (/auth/login, /auth/*)
  auth: {
    windowMs: Number(process.env.RATE_LIMIT_AUTH_WINDOW_MS || 15 * 60 * 1000), // 15 minutes
    maxAttempts: Number(process.env.RATE_LIMIT_AUTH_MAX_ATTEMPTS || 5),       // Free attempts before exponential backoff
    baseBackoffMs: Number(process.env.RATE_LIMIT_AUTH_BASE_BACKOFF_MS || 1000), // Initial 1-second delay
    maxBackoffMs: Number(process.env.RATE_LIMIT_AUTH_MAX_BACKOFF_MS || 60000), // Maximum 60-second cap
  },

  // Tier 2: Public Endpoints (/health, /webhooks/*)
  public: {
    windowMs: Number(process.env.RATE_LIMIT_PUBLIC_WINDOW_MS || 60 * 1000),    // 1 minute
    maxRequests: Number(process.env.RATE_LIMIT_PUBLIC_MAX_REQUESTS || 60),    // 60 req/min
  },

  // Tier 3: Authenticated User Actions (/app, /app/orders)
  authenticated: {
    windowMs: Number(process.env.RATE_LIMIT_AUTHENTICATED_WINDOW_MS || 60 * 1000), // 1 minute
    maxRequests: Number(process.env.RATE_LIMIT_AUTHENTICATED_MAX_REQUESTS || 240), // 240 req/min
  },
};

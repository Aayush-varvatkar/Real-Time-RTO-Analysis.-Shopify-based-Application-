/**
 * Strict Input Schema Validation Utility.
 * Enforces Type, Length Bounds, and Regex Format Patterns.
 * Rejects non-conforming inputs immediately with HTTP 400 Bad Request.
 */

const SHOPIFY_DOMAIN_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/;
const TOPIC_REGEX = /^[a-zA-Z0-9_\-\/]{3,100}$/;
const BASE64_HMAC_REGEX = /^[A-Za-z0-9+/=]{32,88}$/;

/**
 * Builds a standard HTTP 400 Bad Request JSON response.
 */
function buildValidationError(field, reason) {
  return new Response(
    JSON.stringify({
      error: "Bad Request",
      message: `Invalid input for '${field}': ${reason}`,
    }),
    {
      status: 400,
      headers: { "Content-Type": "application/json" },
    }
  );
}

/**
 * Strict Schema Validation for Shopify Shop Domains.
 * - Type: String
 * - Length: 3 to 100 characters
 * - Format: [a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com
 */
export function validateShopDomain(shop) {
  if (!shop) return null; // Optional parameter check — caller enforces presence if required

  if (typeof shop !== "string") {
    return buildValidationError("shop", "must be a string");
  }

  const trimmed = shop.trim();
  if (trimmed.length < 3 || trimmed.length > 100) {
    return buildValidationError("shop", "length must be between 3 and 100 characters");
  }

  const customDomain = process.env.SHOP_CUSTOM_DOMAIN;
  if (customDomain && trimmed.toLowerCase() === customDomain.toLowerCase()) {
    return null; // Valid custom domain match
  }

  if (!SHOPIFY_DOMAIN_REGEX.test(trimmed)) {
    return buildValidationError("shop", "must match format 'example.myshopify.com'");
  }

  return null; // Valid
}

/**
 * Strict Schema Validation for Shopify Webhook Headers.
 */
export function validateWebhookHeaders(request) {
  const headers = request.headers;
  const topic = headers.get("x-shopify-topic");
  const hmac = headers.get("x-shopify-hmac-sha256");
  const shop = headers.get("x-shopify-shop-domain");

  if (!topic || typeof topic !== "string" || !TOPIC_REGEX.test(topic)) {
    return buildValidationError("x-shopify-topic", "missing or invalid webhook topic format");
  }

  if (!hmac || typeof hmac !== "string" || !BASE64_HMAC_REGEX.test(hmac)) {
    return buildValidationError("x-shopify-hmac-sha256", "missing or invalid base64 HMAC signature");
  }

  if (shop) {
    const shopErr = validateShopDomain(shop);
    if (shopErr) return shopErr;
  }

  return null; // Valid
}

/**
 * Strict Schema Validation for ISO Date Strings (YYYY-MM-DD).
 */
export function validateDateFormat(dateStr, fieldName = "date") {
  if (!dateStr) return null;

  if (typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return buildValidationError(fieldName, "must match format YYYY-MM-DD");
  }

  const timestamp = Date.parse(dateStr);
  if (isNaN(timestamp)) {
    return buildValidationError(fieldName, "must be a valid calendar date");
  }

  return null;
}

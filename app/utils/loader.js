import { normalizeDeliveryStatus, enrichConnectorOrderDetails } from "./orders.js";

const MAX_PRODUCT_PAGES = 2; // Up to 500 active products (was 5 — most stores have < 500)
const MAX_ORDER_PAGES = 3;   // Up to 750 orders (was 8 — reduced to prevent SSR timeout)

// ── Product cache (per shop, 15-min TTL) ──
const _productCache = new Map();
const PRODUCT_TTL_MS = 15 * 60 * 1000; // 15 minutes (was 5 — products rarely change mid-session)

// ── Order cache (per shop, 2-min TTL) ──
// Prevents re-fetching the same orders when navigating between dashboard ↔ orders page.
const _orderCache = new Map();
const ORDER_TTL_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Fetches active product titles, deduplicated and sorted.
 * Results are cached per shop — product lists change infrequently.
 */
export async function fetchProducts(admin, shop) {
  try {
    const cached = shop && _productCache.get(shop);
    if (cached && cached.expiresAt > Date.now()) {
      console.log(`[perf] Products cache HIT for ${shop}`);
      return cached.titles;
    }
    console.log(`[perf] Products cache MISS for ${shop}`);

    const start = Date.now();
    let allTitles = [];
    let hasNextPage = true;
    let cursor = null;
    let page = 0;

    while (hasNextPage && page < MAX_PRODUCT_PAGES) {
      page++;
      const res = await admin.graphql(
        `#graphql
        query getProducts($cursor: String) {
          products(first: 250, after: $cursor, query: "status:active") {
            pageInfo { hasNextPage endCursor }
            edges { node { title } }
          }
        }`,
        { variables: { cursor } }
      );
      const json = await res.json();
      if (!json.data?.products) {
        console.error('[loader fetchProducts Error]:', (json.errors || []).map(e => e.message).join('; ') || 'Invalid response');
        break;
      }
      allTitles.push(...json.data.products.edges.map(e => e.node.title));
      hasNextPage = json.data.products.pageInfo.hasNextPage;
      cursor = json.data.products.pageInfo.endCursor;
    }

    const titles = [...new Set(allTitles)].sort();
    if (shop) _productCache.set(shop, { titles, expiresAt: Date.now() + PRODUCT_TTL_MS });
    console.log(`[perf] Products fetched: ${titles.length} titles, ${page} pages, ${Date.now() - start}ms`);
    return titles;
  } catch (err) {
    console.error('[loader fetchProducts Exception]:', err?.stack || err?.message || err);
    return [];
  }
}

/**
 * Paginated orders fetch with per-shop caching.
 * Cache key includes the query hash so dashboard and orders page queries are cached separately.
 */
export async function fetchAllOrdersPages(admin, gqlQuery, sinceISO, shop) {
  try {
    // Build cache key from shop + query hash (first 50 chars of query as identifier)
    const queryKey = shop ? `${shop}:${gqlQuery.slice(0, 50)}` : null;
    if (queryKey) {
      const cached = _orderCache.get(queryKey);
      if (cached && cached.expiresAt > Date.now()) {
        console.log(`[perf] Orders cache HIT for ${shop} (${cached.orders.length} orders)`);
        return cached.orders;
      }
      console.log(`[perf] Orders cache MISS for ${shop}`);
    }

    const start = Date.now();
    let all = [];
    let hasNextPage = true;
    let cursor = null;
    let page = 0;

    while (hasNextPage && page < MAX_ORDER_PAGES) {
      page++;
      const res = await admin.graphql(gqlQuery, {
        variables: { cursor, query: `created_at:>=${sinceISO}` }
      });
      const json = await res.json();
      if (!json.data?.orders) {
        console.error('[loader fetchAllOrdersPages Error]:', (json.errors || []).map(e => e.message).join('; ') || 'Unknown');
        break;
      }
      all.push(...json.data.orders.edges.map(e => e.node));
      hasNextPage = json.data.orders.pageInfo.hasNextPage;
      cursor = json.data.orders.pageInfo.endCursor;
    }

    if (queryKey) {
      _orderCache.set(queryKey, { orders: all, expiresAt: Date.now() + ORDER_TTL_MS });
    }
    console.log(`[perf] Orders fetched: ${all.length} orders, ${page} pages, ${Date.now() - start}ms`);
    return all;
  } catch (err) {
    console.error('[loader fetchAllOrdersPages Exception]:', err?.stack || err?.message || err);
    return [];
  }
}

/**
 * Enhances raw Shopify order nodes with normalised delivery status,
 * address fields, and connector details.
 */
export function enhanceOrders(rawOrders) {
  return rawOrders.map(order => {
    let orderDeliveryStatus = 'unknown';
    const shippingCity    = (order.shippingAddress?.city     || '').trim();
    const shippingState   = (order.shippingAddress?.province || '').trim();
    const shippingPincode = (order.shippingAddress?.zip      || '').trim();
    const connectorDetails = enrichConnectorOrderDetails(order);

    if (order.fulfillments?.length > 0) {
      const enrichedFulfillments = order.fulfillments.map(fulfillment => {
        let trackingInfo = fulfillment.trackingInfo;
        const normalizedStatus = normalizeDeliveryStatus(
          fulfillment.displayStatus || fulfillment.status || ''
        );

        if (trackingInfo?.length > 0) {
          trackingInfo = trackingInfo.map(t => {
            orderDeliveryStatus = normalizedStatus;
            return { ...t, courierDeliveryStatus: normalizedStatus };
          });
        } else {
          orderDeliveryStatus = normalizedStatus;
        }
        return { ...fulfillment, trackingInfo };
      });
      return { ...order, fulfillments: enrichedFulfillments, orderDeliveryStatus, shippingCity, shippingState, shippingPincode, ...connectorDetails };
    }

    return { ...order, orderDeliveryStatus, shippingCity, shippingState, shippingPincode, ...connectorDetails };
  });
}

/**
 * Returns a YYYY-MM-DD date string 30 days ago for initial fast order fetching.
 */
export function since30DaysISO() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().split('T')[0];
}

/**
 * Returns a YYYY-MM-DD date string 90 days ago for full historical orders query.
 */
export function since90DaysISO() {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return d.toISOString().split('T')[0];
}

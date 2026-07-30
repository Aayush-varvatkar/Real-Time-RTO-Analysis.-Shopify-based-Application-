import { normalizeDeliveryStatus, enrichConnectorOrderDetails } from "./orders.js";

const MAX_PRODUCT_PAGES = 5; // Up to 1,250 active products
const MAX_ORDER_PAGES = 8;   // Up to 2,000 orders in last 90 days (prevents SSR 25s timeout)

// ── Product cache (per shop, 5-min TTL, lives on the server worker process) ──
// Eliminates duplicate products API calls between dashboard and orders page loads.
const _productCache = new Map(); // Map<shop, { titles: string[], expiresAt: number }>
const PRODUCT_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches active product titles, deduplicated and sorted.
 * Results are cached per shop for 5 minutes — product lists change infrequently
 * and the filter dropdowns tolerate a short lag.
 */
export async function fetchProducts(admin, shop) {
  const cached = shop && _productCache.get(shop);
  if (cached && cached.expiresAt > Date.now()) return cached.titles;

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
    const { products } = (await res.json()).data;
    allTitles.push(...products.edges.map(e => e.node.title));
    hasNextPage = products.pageInfo.hasNextPage;
    cursor = products.pageInfo.endCursor;
  }

  const titles = [...new Set(allTitles)].sort();
  if (shop) _productCache.set(shop, { titles, expiresAt: Date.now() + PRODUCT_TTL_MS });
  return titles;
}

/**
 * Paginated orders fetch — reusable cursor loop with error guard.
 * Each route passes its own GraphQL query string (field sets differ per page).
 * Designed to be called via Promise.all alongside fetchProducts.
 */
export async function fetchAllOrdersPages(admin, gqlQuery, sinceISO) {
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
      console.error('[loader] Orders query error:', (json.errors || []).map(e => e.message).join('; ') || 'Unknown');
      break;
    }
    all.push(...json.data.orders.edges.map(e => e.node));
    hasNextPage = json.data.orders.pageInfo.hasNextPage;
    cursor = json.data.orders.pageInfo.endCursor;
  }

  return all;
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
 * Returns a YYYY-MM-DD date string 90 days ago for the Shopify orders query filter.
 */
export function since90DaysISO() {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return d.toISOString().split('T')[0];
}

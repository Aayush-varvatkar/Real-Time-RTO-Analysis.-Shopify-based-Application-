import { normalizeDeliveryStatus, enrichConnectorOrderDetails } from "./orders.js";

const MAX_PAGES = 40; // Hard cap: 40 × 250 = 10,000 records max (prevents DoS / timeout)

/**
 * Fetches active product titles (paginated, deduplicated, sorted).
 * Shared by both route loaders.
 */
export async function fetchProducts(admin) {
  let allTitles = [];
  let hasNextPage = true;
  let cursor = null;
  let page = 0;

  while (hasNextPage && page < MAX_PAGES) {
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

  return [...new Set(allTitles)].sort();
}

/**
 * Enhances raw Shopify order nodes with normalised delivery status,
 * address fields, and connector details.
 * Shared by both route loaders.
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
 * 90-day ISO date string for the Shopify orders query filter.
 */
export function since90DaysISO() {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return d.toISOString().split('T')[0];
}

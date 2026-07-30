/**
 * Normalise a raw Shopify fulfillment / tracking status string into one of
 * four canonical delivery-status values used throughout the app:
 *
 *   'rto_failed'        – RTO / return / failure / cancellation
 *   'delivered'         – explicitly delivered
 *   'out_for_delivery'  – out for delivery
 *   'in_transit'        – fulfilled, pending, in transit, or anything else
 */
export function normalizeDeliveryStatus(fulfillmentStatus) {
  const statusLower = (fulfillmentStatus || '').toLowerCase();

  // Explicitly catch failure states first
  if (
    statusLower.includes('rto') ||
    statusLower.includes('return') ||
    statusLower.includes('fail') ||
    statusLower.includes('error') ||
    statusLower.includes('canceled') ||
    statusLower.includes('not_delivered')
  ) {
    return 'rto_failed';
  } else if (statusLower === 'delivered') {
    // Explicit 'delivered' check — no wildcards
    return 'delivered';
  } else if (statusLower.includes('out') && statusLower.includes('delivery')) {
    return 'out_for_delivery';
  }

  return 'in_transit'; // Covers 'fulfilled', 'in_transit', 'pending', etc.
}

/**
 * Strict whitelist of known third-party ecommerce marketplace platforms
 * connected via multi-channel connectors (e.g. CedCommerce, Codisto, Linnworks).
 *
 * Returns the display name for the platform if matched, or null.
 */
const ECOMMERCE_PLATFORMS = [
  ['amazon',      'Amazon'],
  ['ebay',        'eBay'],
  ['walmart',     'Walmart'],
  ['etsy',        'Etsy'],
  ['flipkart',    'Flipkart'],
  ['meesho',      'Meesho'],
  ['myntra',      'Myntra'],
  ['nykaa',       'Nykaa'],
  ['ajio',        'Ajio'],
  ['jiomart',     'JioMart'],   // was misspelled 'jiomar' in app._index.jsx
  ['snapdeal',    'Snapdeal'],
  ['tatacliq',    'TataCliq'],
  ['glowroad',    'GlowRoad'],
  ['shopclues',   'ShopClues'],
  ['paytmmall',   'Paytm Mall'],
  ['shopee',      'Shopee'],
  ['lazada',      'Lazada'],
  ['tokopedia',   'Tokopedia'],
  ['tiktokshop',  'TikTok Shop'],
  ['tiktok shop', 'TikTok Shop'],
  ['aliexpress',  'AliExpress'],
  ['alibaba',     'Alibaba'],
  ['noon',        'Noon'],
  ['woocommerce', 'WooCommerce'],
  ['magento',     'Magento'],
  ['bigcommerce', 'BigCommerce'],
  ['prestashop',  'PrestaShop'],
  ['opencart',    'OpenCart'],
];

export function getThirdPartyConnectorName(order) {
  const source = (order.sourceName || '').toLowerCase().trim();
  const tags = (order.tags || []).map(t => t.toLowerCase().trim());

  // Check source name against whitelist (exact or substring match)
  for (const [keyword, displayName] of ECOMMERCE_PLATFORMS) {
    if (source.includes(keyword)) {
      return displayName;
    }
  }

  // Check tags against whitelist
  for (const tag of tags) {
    for (const [keyword, displayName] of ECOMMERCE_PLATFORMS) {
      if (tag.includes(keyword)) {
        return displayName;
      }
    }
  }

  return null;
}

export function getIsConnectorNoTracking(order, connName = null) {
  const nameMatch = connName ? order.connectorName === connName : !!order.connectorName;
  const status = order.orderDeliveryStatus;
  return !!nameMatch && (status !== 'delivered' && status !== 'fulfilled' && status !== 'rto_failed');
}

export function enrichConnectorOrderDetails(order) {
  const connectorName = getThirdPartyConnectorName(order);
  let connectorLatestDeliveryDate = null;
  let connectorEarliestDeliveryDate = null;
  if (connectorName && Array.isArray(order.customAttributes)) {
    for (const attr of order.customAttributes) {
      const keyLower = (attr.key || '').toLowerCase();
      // Prefer "latest delivery date" over "earliest"
      if (keyLower.includes('latest') && keyLower.includes('delivery')) {
        connectorLatestDeliveryDate = attr.value || null;
      } else if (!connectorLatestDeliveryDate && keyLower.includes('delivery') && (keyLower.includes('date') || keyLower.includes('earliest'))) {
        connectorEarliestDeliveryDate = attr.value || null;
      }
    }
    // Fall back to earliest if no latest found
    if (!connectorLatestDeliveryDate && connectorEarliestDeliveryDate) {
      connectorLatestDeliveryDate = connectorEarliestDeliveryDate;
    }
  }

  // Detect return for connector orders
  const returnStatusVal = (order.returnStatus || '').toUpperCase();
  const hasReturnStatus = returnStatusVal !== '' && returnStatusVal !== 'NO_RETURN';
  const connectorReturnClosed = connectorName
    ? hasReturnStatus ||
      (order.tags || []).some(tag => {
        const t = tag.toLowerCase().replace(/[_\s]/g, '-');
        return t === 'return-closed' || t === 'returned' || t === 'return-complete' || t === 'refund-complete';
      })
    : false;

  return {
    connectorName,
    connectorLatestDeliveryDate,
    connectorReturnClosed,
  };
}

/**
 * Filter orders based on standard dashboard/orders filter criteria.
 * Shared by app._index.jsx and app.orders.jsx.
 */
export function filterOrders(orders, {
  selectedDates,
  productFilter = "All Product Types",
  deliveryStatusFilter = "All Statuses",
  stateFilter = "All States",
  cityFilter = "All Cities",
  pincodeFilter = "All Pincodes",
  courierFilter = "All Couriers",
  failedLabel = "Failed"
} = {}) {
  let startMs = null;
  let endMs = null;
  if (selectedDates?.start && selectedDates?.end) {
    const s = new Date(selectedDates.start);
    s.setHours(0, 0, 0, 0);
    startMs = s.getTime();
    const e = new Date(selectedDates.end);
    e.setHours(23, 59, 59, 999);
    endMs = e.getTime();
  }

  return orders.filter(order => {
    // 1. Date Filter
    if (startMs !== null && endMs !== null) {
      const orderMs = new Date(order.createdAt).getTime();
      if (orderMs < startMs || orderMs > endMs) return false;
    }

    // 2. Product Filter
    if (productFilter && productFilter !== "All Product Types") {
      const hasProduct = order.lineItems?.edges?.some(
        item => item.node.title?.trim() === productFilter
      );
      if (!hasProduct) return false;
    }

    // 3. Delivery Status Filter
    if (deliveryStatusFilter !== "All Statuses") {
      const status = order.orderDeliveryStatus;
      let statusMatches = false;
      if (deliveryStatusFilter === "Delivered") {
        statusMatches = (status === 'delivered' || status === 'fulfilled');
      } else if (deliveryStatusFilter === "In-Transit") {
        const isConnectorNoTracking = getIsConnectorNoTracking(order);
        statusMatches = !isConnectorNoTracking && (status === 'in_transit' || status === 'out_for_delivery');
      } else if (deliveryStatusFilter === failedLabel || deliveryStatusFilter === "Failed" || deliveryStatusFilter === "RTO") {
        statusMatches = (status === 'rto_failed');
      } else if (deliveryStatusFilter.startsWith("Dispatched by ")) {
        const connName = deliveryStatusFilter.replace("Dispatched by ", "");
        statusMatches = getIsConnectorNoTracking(order, connName);
      }
      if (!statusMatches) return false;
    }

    // 4. State Filter
    if (stateFilter !== "All States" && order.shippingState !== stateFilter) return false;

    // 5. City Filter
    if (cityFilter !== "All Cities" && order.shippingCity !== cityFilter) return false;

    // 6. Pincode Filter
    if (pincodeFilter !== "All Pincodes" && order.shippingPincode !== pincodeFilter) return false;

    // 7. Courier Filter
    if (courierFilter !== "All Couriers") {
      const orderCourier = order.fulfillments?.[0]?.trackingInfo?.[0]?.company?.trim();
      if (orderCourier !== courierFilter) return false;
    }

    return true;
  });
}


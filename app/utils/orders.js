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

import { useState, useMemo, useCallback } from "react";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";

import {
  AppProvider,
  Page,
  Box,
  BlockStack,
  InlineStack,
  Popover,
  Button,
  DatePicker,
  ActionList,
  Text,
  Divider,
  Select,
} from '@shopify/polaris';
import { CalendarIcon, FilterIcon } from '@shopify/polaris-icons';
import '@shopify/polaris/build/esm/styles.css';
import enTranslations from '@shopify/polaris/locales/en.json';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';

function normalizeDeliveryStatus(fulfillmentStatus) {
  const statusLower = (fulfillmentStatus || '').toLowerCase();

  // Explicitly catch failure states first
  if (statusLower.includes('rto') || statusLower.includes('return') || statusLower.includes('fail') || statusLower.includes('error') || statusLower.includes('canceled') || statusLower.includes('not_delivered')) {
    return 'rto_failed';
  } else if (statusLower === 'delivered') { // Explicit 'delivered' check without wildcards or fulfilled
    return 'delivered';
  } else if (statusLower.includes('out') && statusLower.includes('delivery')) {
    return 'out_for_delivery';
  }

  return 'in_transit'; // Covers 'fulfilled', 'in_transit', 'pending', etc.
}

function getThirdPartyConnectorName(order) {
  const source = (order.sourceName || '').toLowerCase().trim();
  const tags = (order.tags || []).map(t => t.toLowerCase().trim());

  // Strict whitelist: only known ecommerce marketplace platforms
  // connected via third-party multi-channel connectors (e.g. CedCommerce, Codisto, Linnworks)
  // Each entry: [keyword_to_match, display_name]
  const ECOMMERCE_PLATFORMS = [
    ['amazon', 'Amazon'],
    ['ebay', 'eBay'],
    ['walmart', 'Walmart'],
    ['etsy', 'Etsy'],
    ['flipkart', 'Flipkart'],
    ['meesho', 'Meesho'],
    ['myntra', 'Myntra'],
    ['nykaa', 'Nykaa'],
    ['ajio', 'Ajio'],
    ['jiomar', 'JioMart'],
    ['snapdeal', 'Snapdeal'],
    ['tatacliq', 'TataCliq'],
    ['glowroad', 'GlowRoad'],
    ['shopclues', 'ShopClues'],
    ['paytmmall', 'Paytm Mall'],
    ['shopee', 'Shopee'],
    ['lazada', 'Lazada'],
    ['tokopedia', 'Tokopedia'],
    ['tiktokshop', 'TikTok Shop'],
    ['tiktok shop', 'TikTok Shop'],
    ['aliexpress', 'AliExpress'],
    ['alibaba', 'Alibaba'],
    ['noon', 'Noon'],
    ['woocommerce', 'WooCommerce'],
    ['magento', 'Magento'],
    ['bigcommerce', 'BigCommerce'],
    ['prestashop', 'PrestaShop'],
    ['opencart', 'OpenCart'],
  ];

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

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // ── 1. Fetch all store products (paginated) ──────────────────────────────
  let allStoreProducts = [];
  let productHasNextPage = true;
  let productCursor = null;

  while (productHasNextPage) {
    const productResponse = await admin.graphql(
      `#graphql
      query getProducts($cursor: String) {
        products(first: 250, after: $cursor, query: "status:active") {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              title
            }
          }
        }
      }`,
      { variables: { cursor: productCursor } }
    );
    const productJson = await productResponse.json();
    const productsPage = productJson.data.products;
    allStoreProducts.push(...productsPage.edges.map((e) => e.node.title));
    productHasNextPage = productsPage.pageInfo.hasNextPage;
    productCursor = productsPage.pageInfo.endCursor;
  }

  // Sort & deduplicate product titles
  const storeProducts = [...new Set(allStoreProducts)].sort();

  // ── 2. Fetch all orders (paginated) ─────────────────────────────────────
  let allRawOrders = [];
  let hasNextPage = true;
  let cursor = null;

  while (hasNextPage) {
    const response = await admin.graphql(
      `#graphql
      query getOrdersWithTrackingForAnalytics($cursor: String) {
        orders(first: 250, sortKey: CREATED_AT, reverse: true, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              name
              createdAt
              displayFulfillmentStatus
              totalPriceSet {
                shopMoney {
                  amount
                }
              }
              sourceName
              tags
              shippingAddress {
                city
                province
                zip
              }
              lineItems(first: 10) {
                edges {
                  node {
                    title
                    product {
                      id
                      productType
                    }
                  }
                }
              }
              fulfillments {
                id
                status
                displayStatus
                trackingInfo {
                  number
                  company
                }
              }
              customAttributes {
                key
                value
              }
              returnStatus
            }
          }
        }
      }`,
      { variables: { cursor } }
    );

    const json = await response.json();

    // Guard: if Shopify returns errors (e.g. missing scope), stop and return what we have
    if (!json.data || !json.data.orders) {
      console.error('[RTO-Predictor] Orders query error:', JSON.stringify(json.errors || json));
      break;
    }

    const ordersPage = json.data.orders;

    allRawOrders.push(...ordersPage.edges.map((edge) => edge.node));
    hasNextPage = ordersPage.pageInfo.hasNextPage;
    cursor = ordersPage.pageInfo.endCursor;
  }

  const enhancedOrders = allRawOrders.map((order) => {
    let orderDeliveryStatus = 'unknown';

    // Normalize address fields
    const shippingCity = (order.shippingAddress?.city || '').trim();
    const shippingState = (order.shippingAddress?.province || '').trim();
    const shippingPincode = (order.shippingAddress?.zip || '').trim();

    const connectorName = getThirdPartyConnectorName(order);

    // ── Extract connector delivery date from customAttributes ──
    // Marketplace Connect writes these as order custom attributes visible in
    // "Additional details" on the Shopify order page, e.g.:
    //   "Amazon Latest Delivery Date" = "2026-06-10T18:29:59.000Z"
    //   "Amazon Earliest Delivery Date" = "2026-06-09T18:30:00.000Z"
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

    // ── Detect return for connector orders ──
    // Any non-empty returnStatus other than NO_RETURN means the order has an active/closed return.
    // This catches INSPECTION_COMPLETE (Return closed badge), IN_PROGRESS, RETURN_REQUESTED, RETURN_FAILED.
    // Also falls back to tags written by some connector apps.
    const returnStatusVal = (order.returnStatus || '').toUpperCase();
    const hasReturnStatus = returnStatusVal !== '' && returnStatusVal !== 'NO_RETURN';
    const connectorReturnClosed = connectorName
      ? hasReturnStatus ||
        (order.tags || []).some(tag => {
          const t = tag.toLowerCase().replace(/[_\s]/g, '-');
          return t === 'return-closed' || t === 'returned' || t === 'return-complete' || t === 'refund-complete';
        })
      : false;

    if (order.fulfillments && order.fulfillments.length > 0) {
      const enrichedFulfillments = order.fulfillments.map((fulfillment) => {
        let trackingInfo = fulfillment.trackingInfo;
        const actualStatus = fulfillment.displayStatus || fulfillment.status || '';
        const normalizedStatus = normalizeDeliveryStatus(actualStatus);

        if (trackingInfo && trackingInfo.length > 0) {
          trackingInfo = trackingInfo.map((tracking) => {
            orderDeliveryStatus = normalizedStatus;
            return { ...tracking, courierDeliveryStatus: normalizedStatus };
          });
        } else {
          orderDeliveryStatus = normalizedStatus;
        }
        return { ...fulfillment, trackingInfo };
      });
      return { ...order, fulfillments: enrichedFulfillments, orderDeliveryStatus, shippingCity, shippingState, shippingPincode, connectorName, connectorLatestDeliveryDate, connectorReturnClosed };
    }
    return { ...order, orderDeliveryStatus, shippingCity, shippingState, shippingPincode, connectorName, connectorLatestDeliveryDate, connectorReturnClosed };
  });

  return { orders: enhancedOrders, storeProducts };
};

// ─── Connector Status Card ────────────────────────────────────────────────────
function ConnectorStatusCard({ orders }) {
  const now = new Date();

  // Include ALL connector orders
  const connectorOrders = orders.filter(o => !!o.connectorName);

  const getConnectorStatus = (order) => {
    // Any return activity on connector order → RTO / Failed
    if (order.connectorReturnClosed) return 'RTO / Failed';

    const latestDelivery = order.connectorLatestDeliveryDate
      ? new Date(order.connectorLatestDeliveryDate)
      : null;
    const isFulfilled = (order.displayFulfillmentStatus || '').toLowerCase() === 'fulfilled';

    if (latestDelivery) {
      if (now >= latestDelivery) {
        // Past latest delivery date
        return isFulfilled ? 'Delivered' : 'Unfulfilled';
      } else {
        return 'In Transit';
      }
    }

    // No delivery date — use fulfillment status
    return isFulfilled ? 'Delivered' : 'Unfulfilled';
  };

  // Aggregate counts — 4 categories only
  const counts = { 'In Transit': 0, 'Delivered': 0, 'Unfulfilled': 0, 'RTO / Failed': 0 };
  const byPlatform = {};

  connectorOrders.forEach(order => {
    const status = getConnectorStatus(order);
    counts[status] = (counts[status] || 0) + 1;
    const p = order.connectorName;
    if (!byPlatform[p]) byPlatform[p] = { 'In Transit': 0, 'Delivered': 0, 'Unfulfilled': 0, 'RTO / Failed': 0, total: 0 };
    byPlatform[p][status] = (byPlatform[p][status] || 0) + 1;
    byPlatform[p].total++;
  });

  const pieData = [
    { name: 'In Transit',   value: counts['In Transit'],   color: '#3b82f6' },
    { name: 'Delivered',    value: counts['Delivered'],    color: '#10b981' },
    { name: 'Unfulfilled',  value: counts['Unfulfilled'],  color: '#f59e0b' },
    { name: 'RTO / Failed', value: counts['RTO / Failed'], color: '#ef4444' },
  ].filter(d => d.value > 0);

  const platforms = Object.entries(byPlatform);

  if (connectorOrders.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: '13px' }}>
        No connector orders in selected period
      </div>
    );
  }

  return (
    <div style={{ flex: 1 }}>
      {/* Pie chart */}
      <div style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              cx="50%" cy="50%"
              outerRadius={100}
              isAnimationActive={false}
              labelLine={{ stroke: '#9ca3af', strokeWidth: 1 }}
              label={({ name, value, x, y, textAnchor }) => (
                <text x={x} y={y} fill="#111827" fontSize="12" fontWeight="600" textAnchor={textAnchor} dominantBaseline="central">
                  {name}: {value}
                </text>
              )}
            >
              {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
            </Pie>
            <Tooltip
              formatter={(value, name) => [value, name]}
              contentStyle={{ fontSize: '12px', borderRadius: '6px', border: '1px solid #e5e7eb' }}
              wrapperStyle={{ outline: 'none' }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Per-platform breakdown table */}
      <div style={{ overflowX: 'auto', marginTop: '12px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr style={{ backgroundColor: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280', fontWeight: '600' }}>Platform</th>
              <th style={{ padding: '8px 8px', textAlign: 'center', color: '#3b82f6', fontWeight: '600' }}>In Transit</th>
              <th style={{ padding: '8px 8px', textAlign: 'center', color: '#10b981', fontWeight: '600' }}>Delivered</th>
              <th style={{ padding: '8px 8px', textAlign: 'center', color: '#f59e0b', fontWeight: '600' }}>Unfulfilled</th>
              <th style={{ padding: '8px 8px', textAlign: 'center', color: '#ef4444', fontWeight: '600' }}>RTO</th>
              <th style={{ padding: '8px 8px', textAlign: 'center', color: '#374151', fontWeight: '600' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {platforms.map(([platform, data]) => (
              <tr key={platform} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '8px 12px', fontWeight: '600', color: '#111827' }}>{platform}</td>
                <td style={{ padding: '8px 8px', textAlign: 'center', color: '#3b82f6', fontWeight: '600' }}>{data['In Transit'] || 0}</td>
                <td style={{ padding: '8px 8px', textAlign: 'center', color: '#10b981', fontWeight: '600' }}>{data['Delivered'] || 0}</td>
                <td style={{ padding: '8px 8px', textAlign: 'center', color: '#f59e0b', fontWeight: '600' }}>{data['Unfulfilled'] || 0}</td>
                <td style={{ padding: '8px 8px', textAlign: 'center', color: '#ef4444', fontWeight: '600' }}>{data['RTO / Failed'] || 0}</td>
                <td style={{ padding: '8px 8px', textAlign: 'center', color: '#374151', fontWeight: '700' }}>{data.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const CustomTooltip = ({ active, payload, total }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const percent = total > 0 ? ((data.value / total) * 100).toFixed(1) : 0;

    return (
      <div style={{ backgroundColor: '#fff', border: `1px solid ${data.color || '#e5e7eb'}`, padding: '8px 12px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)', borderRadius: '4px' }}>
        <p style={{ margin: 0, fontSize: '13px', fontWeight: '600', color: '#111827' }}>{data.name}</p>
        <p style={{ margin: 0, fontSize: '12px', color: '#4b5563', marginTop: '4px' }}>Tracking Status: {percent}%</p>
      </div>
    );
  }
  return null;
};

const CustomBarTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const dataMap = {};
    payload.forEach(item => {
      dataMap[item.dataKey] = {
        value: item.value,
        color: item.color || item.fill
      };
    });

    const orderedKeys = [
      { key: "Total Orders", label: "Total Orders", defaultColor: "#008f34ff" },
      { key: "Unfulfilled", label: "Unfulfilled", defaultColor: "#ffd351ff" },
      { key: "Fulfilled", label: "Fulfilled", defaultColor: "#319e9a" },
      { key: "Delivered", label: "Delivered", defaultColor: "#31ff7dc3" },
      { key: "In-Transit", label: "In-Transit", defaultColor: "#5052526a" },
      { key: "Failed", label: "Failed", defaultColor: "#ef4444" }
    ];

    return (
      <div style={{
        backgroundColor: '#fff',
        border: '1px solid #e5e7eb',
        padding: '12px 14px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        borderRadius: '8px',
        fontSize: '13px',
        fontFamily: 'inherit',
        color: '#1f2937',
        minWidth: '180px'
      }}>
        <p style={{ margin: '0 0 8px 0', fontWeight: '700', color: '#111827', fontSize: '14px', borderBottom: '1px solid #f3f4f6', paddingBottom: '4px' }}>
          {label}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {orderedKeys.map(item => {
            const data = dataMap[item.key];
            const value = data ? data.value : 0;
            const color = data ? data.color : item.defaultColor;
            return (
              <div key={item.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '500', color: '#4b5563' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: color, display: 'inline-block' }} />
                  {item.label}
                </span>
                <span style={{ fontWeight: '700', color: '#111827' }}>
                  {value}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  return null;
};

const renderCustomLegend = (props) => {
  const orderedLegend = [
    { value: "Total Orders", color: "#15803d" },
    { value: "Unfulfilled", color: "#ffd351ff" },
    { value: "Fulfilled", color: "#319e9a" },
    { value: "Delivered", color: "#31ff7da0" },
    { value: "In-Transit", color: "#5052526a" },
    { value: "Failed", color: "#ef4444" }
  ];

  return (
    <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '20px', paddingTop: '24px', paddingBottom: '10px' }}>
      {orderedLegend.map((item, index) => (
        <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#4b5563', fontWeight: '500' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: item.color, display: 'inline-block' }} />
          <span>{item.value}</span>
        </div>
      ))}
    </div>
  );
};

// 5-color palette shared between card pie charts and table row dots
const RTO_COLORS = ['#ef4444', '#f97316', '#eab308', '#8b5cf6', '#06b6d4'];

const CARD_DEFAULT = 5;
const CARD_PAGE = 20;

function RtoCard({ title, label, data, fullWidth = false, showInTransit = false }) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  const [sortField, setSortField] = useState('rtoPct'); // Default RTO %
  const [sortDir, setSortDir] = useState('desc');   // Default descending

  // Sort the full dataset based on active sort options
  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => {
      const valA = a[sortField] ?? 0;
      const valB = b[sortField] ?? 0;
      if (sortDir === 'desc') {
        return valB - valA;
      } else {
        return valA - valB;
      }
    });
  }, [data, sortField, sortDir]);

  // Rows to display: either top-5 or current page of full list
  const visibleRows = expanded
    ? sortedData.slice(page * CARD_PAGE, (page + 1) * CARD_PAGE)
    : sortedData.slice(0, CARD_DEFAULT);

  const totalPages = Math.ceil(sortedData.length / CARD_PAGE);
  const showPagination = expanded && sortedData.length > CARD_PAGE;

  const handleToggle = () => { setExpanded(e => !e); setPage(0); };

  // Sort handler that toggles direction if active, or sets new field to desc
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(prev => prev === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
    setPage(0);
  };

  // Helper to render sortable column header with single arrow
  const renderSortHeader = (field, displayName) => {
    const isActive = sortField === field;
    const arrow = isActive ? (sortDir === 'desc' ? '⮝' : '⮟') : '⮝';
    return (
      <th
        style={{
          padding: pad,
          textAlign: 'center',
          color: '#6b7280',
          fontWeight: '600',
          cursor: 'pointer',
          userSelect: 'none',
          transition: 'color 0.15s ease'
        }}
        onClick={() => handleSort(field)}
        onMouseEnter={(e) => e.currentTarget.style.color = '#111827'}
        onMouseLeave={(e) => e.currentTarget.style.color = '#6b7280'}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
          {displayName}
          <span
            style={{
              fontWeight: '800',
              fontSize: '11px',
              color: isActive ? '#6366f1' : '#d1d5db',
              display: 'inline-block',
              transition: 'transform 0.15s ease'
            }}
          >
            {arrow}
          </span>
        </span>
      </th>
    );
  };

  // Pie always shows top-5 by current sorted order for clarity
  const pieData = sortedData.slice(0, 5);
  const pieW = fullWidth ? 200 : 170;
  const innerR = fullWidth ? 50 : 42;
  const outerR = fullWidth ? 80 : 68;
  const pad = fullWidth ? '10px 16px' : '10px 10px';

  return (
    <div style={{ backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid #f3f4f6', backgroundColor: '#fafafa', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <span style={{ fontSize: '15px', fontWeight: '700', color: '#111827' }}>{title}</span>
        {data.length > CARD_DEFAULT && (
          <button
            onClick={handleToggle}
            style={{ fontSize: '12px', fontWeight: '600', color: '#6366f1', background: '#eef2ff', border: 'none', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', transition: 'background 0.15s' }}
          >
            {expanded ? 'View Less ↑' : `View All (${data.length}) ↓`}
          </button>
        )}
      </div>

      {data.length === 0 ? (
        <div style={{ padding: '32px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>No RTO orders in selected period</div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'stretch', flex: 1 }}>
          {/* Table side */}
          <div style={{ flex: 1, overflowX: 'auto', display: 'flex', flexDirection: 'column' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f9fafb' }}>
                  <th style={{ padding: pad, textAlign: 'center', color: '#6b7280', fontWeight: '600', width: '32px' }}>#</th>
                  <th style={{ padding: pad, textAlign: 'left', color: '#6b7280', fontWeight: '600' }}>{label}</th>
                  {renderSortHeader('total', 'Total')}
                  {renderSortHeader('rtoPct', 'RTO %')}
                  {renderSortHeader('delivered', 'Delivered')}
                  {showInTransit && renderSortHeader('inTransit', 'In Transit')}
                  {renderSortHeader('rto', 'RTO')}
                </tr>
              </thead>
              <tbody style={{ transition: 'opacity 0.15s ease' }}>
                {visibleRows.map((row, i) => {
                  const globalIdx = expanded ? page * CARD_PAGE + i : i;
                  const dot = RTO_COLORS[Math.min(globalIdx, RTO_COLORS.length - 1)];
                  return (
                    <tr key={row.name} style={{ borderTop: '1px solid #f3f4f6', backgroundColor: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                      <td style={{ padding: pad, textAlign: 'center', fontWeight: '700', fontSize: '13px', color: globalIdx < 5 ? RTO_COLORS[globalIdx] : '#9ca3af' }}>
                        {globalIdx + 1}
                      </td>
                      <td style={{ padding: pad, color: '#111827', fontWeight: '500', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</td>
                      <td style={{ padding: pad, textAlign: 'center', color: '#374151', fontWeight: '600' }}>{row.total}</td>
                      <td style={{ padding: pad, textAlign: 'center' }}>
                        <span style={{ backgroundColor: row.rtoPct >= 50 ? '#fee2e2' : row.rtoPct >= 25 ? '#fef3c7' : '#d1fae5', color: row.rtoPct >= 50 ? '#991b1b' : row.rtoPct >= 25 ? '#92400e' : '#065f46', padding: '2px 7px', borderRadius: '99px', fontWeight: '700', fontSize: '11px' }}>
                          {row.rtoPct}%
                        </span>
                      </td>
                      <td style={{ padding: pad, textAlign: 'center', color: '#059669', fontWeight: '600' }}>{row.delivered}</td>
                      {showInTransit && <td style={{ padding: pad, textAlign: 'center', color: '#3b82f6', fontWeight: '600' }}>{row.inTransit ?? 0}</td>}
                      <td style={{ padding: pad, textAlign: 'center', color: '#ef4444', fontWeight: '700' }}>{row.rto}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Pagination bar */}
            {showPagination && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderTop: '1px solid #f3f4f6', backgroundColor: '#fafafa', marginTop: 'auto' }}>
                <span style={{ fontSize: '12px', color: '#6b7280' }}>
                  {page * CARD_PAGE + 1}–{Math.min((page + 1) * CARD_PAGE, data.length)} of {data.length}
                </span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                    style={{ fontSize: '12px', fontWeight: '600', padding: '4px 10px', borderRadius: '6px', border: '1px solid #e5e7eb', background: page === 0 ? '#f9fafb' : '#fff', color: page === 0 ? '#9ca3af' : '#374151', cursor: page === 0 ? 'default' : 'pointer', transition: 'all 0.15s' }}>
                    ← Prev
                  </button>
                  <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                    style={{ fontSize: '12px', fontWeight: '600', padding: '4px 10px', borderRadius: '6px', border: '1px solid #e5e7eb', background: page >= totalPages - 1 ? '#f9fafb' : '#fff', color: page >= totalPages - 1 ? '#9ca3af' : '#374151', cursor: page >= totalPages - 1 ? 'default' : 'pointer', transition: 'all 0.15s' }}>
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Pie chart side — always top-5 */}
          <div style={{ width: fullWidth ? '220px' : '180px', flexShrink: 0, borderLeft: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 0' }}>
            <ResponsiveContainer width={pieW} height={pieW}>
              <PieChart>
                <Pie
                  data={pieData.map(r => ({ name: r.name, value: r.rto }))}
                  dataKey="value" nameKey="name"
                  cx="50%" cy="50%" innerRadius={innerR} outerRadius={outerR} isAnimationActive={false}>
                  {pieData.map((_, i) => <Cell key={i} fill={RTO_COLORS[i]} />)}
                </Pie>
                <Tooltip formatter={(value, name) => [`${value} RTO`, name]}
                  contentStyle={{ fontSize: '11px', borderRadius: '6px', border: '1px solid #e5e7eb' }}
                  wrapperStyle={{ outline: 'none' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Index() {
  const { orders = [], storeProducts = [] } = useLoaderData() || {};



  // Date Picker State
  const [datePopoverActive, setDatePopoverActive] = useState(false);
  const toggleDatePopover = useCallback(() => setDatePopoverActive((active) => !active), []);

  const [selectedDates, setSelectedDates] = useState(() => {
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setDate(end.getDate() - 29);
    return { start, end };
  });

  const [{ month, year }, setDate] = useState(() => ({
    month: new Date().getMonth(),
    year: new Date().getFullYear(),
  }));

  const [presetFilter, setPresetFilter] = useState('last30');

  const presetOptions = [
    { label: 'Today', value: 'today' },
    { label: 'Yesterday', value: 'yesterday' },
    { label: 'Last 7 days', value: 'last7' },
    { label: 'Last 30 days', value: 'last30' },
    { label: 'Last 90 days', value: 'last90' },
    { label: 'Last month', value: 'lastMonth' },
    { label: 'Custom', value: 'custom' },
  ];

  const handlePresetChange = useCallback((value) => {
    setPresetFilter(value);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    let start, end;
    switch (value) {
      case 'today':
        start = today;
        end = today;
        break;
      case 'yesterday':
        start = new Date(today);
        start.setDate(today.getDate() - 1);
        end = new Date(today);
        end.setDate(today.getDate() - 1);
        break;
      case 'last7':
        start = new Date(today);
        start.setDate(today.getDate() - 6);
        end = today;
        break;
      case 'last30':
        start = new Date(today);
        start.setDate(today.getDate() - 29);
        end = today;
        break;
      case 'last90':
        start = new Date(today);
        start.setDate(today.getDate() - 89);
        end = today;
        break;
      case 'lastMonth':
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        end = new Date(now.getFullYear(), now.getMonth(), 0);
        break;
      case 'custom':
        return;
      default:
        return;
    }

    setSelectedDates({ start, end });
    setDate({ month: end.getMonth(), year: end.getFullYear() });
  }, []);

  // Product Filter State
  const [productPopoverActive, setProductPopoverActive] = useState(false);
  const toggleProductPopover = useCallback(() => setProductPopoverActive((active) => !active), []);
  const [productFilter, setProductFilter] = useState("All Product Types");

  // Delivery Status Filter State
  const [deliveryStatusPopoverActive, setDeliveryStatusPopoverActive] = useState(false);
  const toggleDeliveryStatusPopover = useCallback(() => setDeliveryStatusPopoverActive((active) => !active), []);
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState("All Statuses");

  // State / City / Pincode Filter State
  const [statePopoverActive, setStatePopoverActive] = useState(false);
  const toggleStatePopover = useCallback(() => setStatePopoverActive((a) => !a), []);
  const [stateFilter, setStateFilter] = useState("All States");

  const [cityPopoverActive, setCityPopoverActive] = useState(false);
  const toggleCityPopover = useCallback(() => setCityPopoverActive((a) => !a), []);
  const [cityFilter, setCityFilter] = useState("All Cities");

  const [pincodePopoverActive, setPincodePopoverActive] = useState(false);
  const togglePincodePopover = useCallback(() => setPincodePopoverActive((a) => !a), []);
  const [pincodeFilter, setPincodeFilter] = useState("All Pincodes");

  // Use store products directly (from loader) — only real catalog products appear here
  const uniqueProducts = useMemo(() => storeProducts, [storeProducts]);

  // Extract unique states, cities, pincodes from ALL orders (unfiltered)
  const uniqueStates = useMemo(() => {
    const vals = new Set();
    orders.forEach(o => { if (o.shippingState) vals.add(o.shippingState); });
    return Array.from(vals).sort();
  }, [orders]);

  const uniqueCities = useMemo(() => {
    const vals = new Set();
    orders.forEach(o => {
      // Only show cities belonging to the selected state (or all if no state selected)
      if (stateFilter === "All States" || o.shippingState === stateFilter) {
        if (o.shippingCity) vals.add(o.shippingCity);
      }
    });
    return Array.from(vals).sort();
  }, [orders, stateFilter]);

  const uniquePincodes = useMemo(() => {
    const vals = new Set();
    orders.forEach(o => {
      // Only show pincodes for selected state + city combination
      const stateMatch = stateFilter === "All States" || o.shippingState === stateFilter;
      const cityMatch = cityFilter === "All Cities" || o.shippingCity === cityFilter;
      if (stateMatch && cityMatch && o.shippingPincode) vals.add(o.shippingPincode);
    });
    return Array.from(vals).sort();
  }, [orders, stateFilter, cityFilter]);

  // Filter logic
  const filteredOrders = useMemo(() => {
    return orders.filter(order => {
      // 1. Date Filter
      const orderDate = new Date(order.createdAt);
      if (selectedDates && selectedDates.start && selectedDates.end) {
        const start = new Date(selectedDates.start);
        start.setHours(0, 0, 0, 0);
        const end = new Date(selectedDates.end);
        end.setHours(23, 59, 59, 999);

        if (orderDate < start || orderDate > end) {
          return false;
        }
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
        let statusMatches = false;
        if (deliveryStatusFilter === "Delivered") {
          statusMatches = (order.orderDeliveryStatus === 'delivered' || order.orderDeliveryStatus === 'fulfilled');
        } else if (deliveryStatusFilter === "In-Transit") {
          const isConnectorNoTracking = order.connectorName && (order.orderDeliveryStatus !== 'delivered' && order.orderDeliveryStatus !== 'fulfilled' && order.orderDeliveryStatus !== 'rto_failed');
          statusMatches = !isConnectorNoTracking && (order.orderDeliveryStatus === 'in_transit' || order.orderDeliveryStatus === 'out_for_delivery');
        } else if (deliveryStatusFilter === "Failed") {
          statusMatches = (order.orderDeliveryStatus === 'rto_failed');
        } else if (deliveryStatusFilter.startsWith("Dispatched by ")) {
          const connName = deliveryStatusFilter.replace("Dispatched by ", "");
          const isConnectorNoTracking = order.connectorName === connName && (order.orderDeliveryStatus !== 'delivered' && order.orderDeliveryStatus !== 'fulfilled' && order.orderDeliveryStatus !== 'rto_failed');
          statusMatches = isConnectorNoTracking;
        }
        if (!statusMatches) return false;
      }

      // 4. State Filter
      if (stateFilter !== "All States") {
        if (order.shippingState !== stateFilter) return false;
      }

      // 5. City Filter
      if (cityFilter !== "All Cities") {
        if (order.shippingCity !== cityFilter) return false;
      }

      // 6. Pincode Filter
      if (pincodeFilter !== "All Pincodes") {
        if (order.shippingPincode !== pincodeFilter) return false;
      }

      return true;
    });
  }, [orders, selectedDates, productFilter, deliveryStatusFilter, stateFilter, cityFilter, pincodeFilter]);

  // Compute Metrics
  const metrics = useMemo(() => {
    let pending = 0;
    let shipped = 0;
    let fulfilled = 0;
    let failed = 0;
    let unfulfilled = 0;
    const connectorCounts = {};

    filteredOrders.forEach(order => {
      const status = (order.displayFulfillmentStatus || '').toLowerCase();
      if (status !== 'fulfilled') unfulfilled++;

      const isConnectorNoTracking = order.connectorName && (order.orderDeliveryStatus !== 'delivered' && order.orderDeliveryStatus !== 'fulfilled' && order.orderDeliveryStatus !== 'rto_failed');

      if (isConnectorNoTracking) {
        connectorCounts[order.connectorName] = (connectorCounts[order.connectorName] || 0) + 1;
      } else {
        if (order.orderDeliveryStatus === 'delivered' || order.orderDeliveryStatus === 'fulfilled') {
          fulfilled++;
        } else if (order.orderDeliveryStatus === 'in_transit' || order.orderDeliveryStatus === 'out_for_delivery') {
          shipped++;
        } else if (order.orderDeliveryStatus === 'rto_failed') {
          failed++;
        } else {
          pending++; // If unknown or anything else, consider pending
        }
      }
    });

    return {
      totalOrders: filteredOrders.length,
      pending,
      shipped,
      fulfilled,
      failed,
      unfulfilled,
      connectorCounts
    };
  }, [filteredOrders]);

  // Compute Chart Data
  const chartData = useMemo(() => {
    if (!selectedDates || !selectedDates.start || !selectedDates.end) return [];

    const dataMap = {};
    const startObj = new Date(selectedDates.start);
    startObj.setHours(0, 0, 0, 0);
    const endObj = new Date(selectedDates.end);
    endObj.setHours(23, 59, 59, 999);

    // Generate all dates in range
    const current = new Date(startObj);
    while (current <= endObj) {
      const dateStr = `${String(current.getDate()).padStart(2, '0')}/${String(current.getMonth() + 1).padStart(2, '0')}/${String(current.getFullYear()).slice(-2)}`;
      dataMap[dateStr] = {
        date: dateStr,
        "Total Orders": 0,
        "Unfulfilled": 0,
        "Fulfilled": 0,
        "Delivered": 0,
        "In-Transit": 0,
        "Failed": 0
      };
      current.setDate(current.getDate() + 1);
    }

    // Populate data from orders
    filteredOrders.forEach(order => {
      const isConnectorNoTracking = order.connectorName && (order.orderDeliveryStatus !== 'delivered' && order.orderDeliveryStatus !== 'fulfilled' && order.orderDeliveryStatus !== 'rto_failed');
      if (isConnectorNoTracking) {
        return; // Exclude from charts/graphs
      }

      const orderDate = new Date(order.createdAt);
      const dateStr = `${String(orderDate.getDate()).padStart(2, '0')}/${String(orderDate.getMonth() + 1).padStart(2, '0')}/${String(orderDate.getFullYear()).slice(-2)}`;

      if (dataMap[dateStr]) {
        dataMap[dateStr]["Total Orders"]++;

        // Fulfillment status checks
        const status = (order.displayFulfillmentStatus || '').toLowerCase();
        if (status === 'fulfilled') {
          dataMap[dateStr]["Fulfilled"]++;
        } else {
          dataMap[dateStr]["Unfulfilled"]++;
        }

        // Logistics delivery status checks
        const deliveryStatus = order.orderDeliveryStatus;
        if (deliveryStatus === 'delivered' || deliveryStatus === 'fulfilled') {
          dataMap[dateStr]["Delivered"]++;
        } else if (deliveryStatus === 'in_transit' || deliveryStatus === 'out_for_delivery') {
          dataMap[dateStr]["In-Transit"]++;
        } else if (deliveryStatus === 'rto_failed') {
          dataMap[dateStr]["Failed"]++;
        }
      }
    });

    return Object.values(dataMap);
  }, [filteredOrders, selectedDates]);

  // Compute Tracking Status Data
  const trackingStatusData = useMemo(() => {
    let delivered = 0;
    let rto = 0;
    let inTransit = 0;

    filteredOrders.forEach(order => {
      const isConnectorNoTracking = order.connectorName && (order.orderDeliveryStatus !== 'delivered' && order.orderDeliveryStatus !== 'fulfilled' && order.orderDeliveryStatus !== 'rto_failed');
      if (isConnectorNoTracking) {
        return; // Exclude from charts/graphs
      }

      const deliveryStatus = order.orderDeliveryStatus;

      if (deliveryStatus === 'delivered' || deliveryStatus === 'fulfilled') {
        delivered++;
      } else if (deliveryStatus === 'rto_failed') {
        rto++;
      } else if (deliveryStatus === 'in_transit' || deliveryStatus === 'out_for_delivery') {
        inTransit++;
      }
    });

    return [
      { name: 'Delivered', value: delivered, color: '#059669' },
      { name: 'RTO', value: rto, color: '#ef4444' },
      { name: 'In-Transit', value: inTransit, color: '#00a896' },
    ].filter(d => d.value > 0);
  }, [filteredOrders]);

  // Memoized pie total — stable reference prevents Tooltip from remounting on every hover
  const pieTotal = useMemo(() => trackingStatusData.reduce((sum, item) => sum + item.value, 0), [trackingStatusData]);

  // ── RTO Analysis (date + product filters already applied via filteredOrders) ──
  const rtoAnalysis = useMemo(() => {
    const groupBy = (keyFn) => {
      const map = {};
      filteredOrders.forEach(order => {
        const isConnectorNoTracking = order.connectorName && (order.orderDeliveryStatus !== 'delivered' && order.orderDeliveryStatus !== 'fulfilled' && order.orderDeliveryStatus !== 'rto_failed');
        if (isConnectorNoTracking) {
          return; // Exclude from charts/graphs
        }

        const key = keyFn(order);
        if (!key) return;
        if (!map[key]) map[key] = { delivered: 0, rto: 0, inTransit: 0, total: 0 };
        map[key].total++;
        if (order.orderDeliveryStatus === 'rto_failed') {
          map[key].rto++;
        } else if (order.orderDeliveryStatus === 'delivered' || order.orderDeliveryStatus === 'fulfilled') {
          map[key].delivered++;
        } else if (order.orderDeliveryStatus === 'in_transit' || order.orderDeliveryStatus === 'out_for_delivery') {
          map[key].inTransit++;
        }
      });
      return Object.entries(map)
        .map(([name, d]) => ({
          name,
          delivered: d.delivered,
          rto: d.rto,
          inTransit: d.inTransit,
          total: d.total,
          rtoPct: d.total > 0 ? +((d.rto / d.total) * 100).toFixed(1) : 0,
        }))
        .sort((a, b) => b.rtoPct - a.rtoPct || b.rto - a.rto);
    };

    return {
      states: groupBy(o => o.shippingState || null),
      cities: groupBy(o => o.shippingCity || null),
      pincodes: groupBy(o => o.shippingPincode || null),
      couriers: groupBy(o => o.fulfillments?.[0]?.trackingInfo?.[0]?.company || null),
    };
  }, [filteredOrders]);

  const handleDateSelection = useCallback(
    (value) => {
      setSelectedDates(value);
      setPresetFilter('custom');
    },
    [],
  );

  const formatDateForComparison = (start, end) => {
    const startStr = start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const endStr = end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${startStr} - ${endStr}`;
  };

  const formatDateForInput = (date) => {
    return `${date.getDate()}-${date.getMonth() + 1}-${date.getFullYear()}`;
  };

  const dateButton = (
    <Button onClick={toggleDatePopover} icon={CalendarIcon}>
      {presetOptions.find(o => o.value === presetFilter)?.label || 'Custom'}
    </Button>
  );

  const productActivator = (
    <Button onClick={toggleProductPopover} icon={FilterIcon}>
      {productFilter}
    </Button>
  );

  const productOptions = [
    { content: "All Product Types", onAction: () => { setProductFilter("All Product Types"); toggleProductPopover(); } },
    ...uniqueProducts.map(fp => ({
      content: fp,
      onAction: () => { setProductFilter(fp); toggleProductPopover(); }
    }))
  ];

  const deliveryStatusActivator = (
    <Button onClick={toggleDeliveryStatusPopover} icon={FilterIcon}>
      {deliveryStatusFilter}
    </Button>
  );

  const uniqueConnectors = useMemo(() => {
    const names = new Set();
    orders.forEach(o => {
      const name = getThirdPartyConnectorName(o);
      if (name) names.add(name);
    });
    return Array.from(names).sort();
  }, [orders]);

  const deliveryStatusOptions = useMemo(() => {
    const options = [
      { content: "All Statuses", onAction: () => { setDeliveryStatusFilter("All Statuses"); toggleDeliveryStatusPopover(); } },
      { content: "In-Transit", onAction: () => { setDeliveryStatusFilter("In-Transit"); toggleDeliveryStatusPopover(); } },
      { content: "Delivered", onAction: () => { setDeliveryStatusFilter("Delivered"); toggleDeliveryStatusPopover(); } },
      { content: "Failed", onAction: () => { setDeliveryStatusFilter("Failed"); toggleDeliveryStatusPopover(); } }
    ];

    uniqueConnectors.forEach(conn => {
      options.push({
        content: `Dispatched by ${conn}`,
        onAction: () => {
          setDeliveryStatusFilter(`Dispatched by ${conn}`);
          toggleDeliveryStatusPopover();
        }
      });
    });

    return options;
  }, [uniqueConnectors]);

  // State / City / Pincode action lists
  const stateOptions = [
    { content: "All States", onAction: () => { setStateFilter("All States"); setCityFilter("All Cities"); setPincodeFilter("All Pincodes"); toggleStatePopover(); } },
    ...uniqueStates.map(s => ({
      content: s,
      onAction: () => { setStateFilter(s); setCityFilter("All Cities"); setPincodeFilter("All Pincodes"); toggleStatePopover(); }
    }))
  ];

  const cityOptions = [
    { content: "All Cities", onAction: () => { setCityFilter("All Cities"); setPincodeFilter("All Pincodes"); toggleCityPopover(); } },
    ...uniqueCities.map(c => ({
      content: c,
      onAction: () => { setCityFilter(c); setPincodeFilter("All Pincodes"); toggleCityPopover(); }
    }))
  ];

  const pincodeOptions = [
    { content: "All Pincodes", onAction: () => { setPincodeFilter("All Pincodes"); togglePincodePopover(); } },
    ...uniquePincodes.map(p => ({
      content: p,
      onAction: () => { setPincodeFilter(p); togglePincodePopover(); }
    }))
  ];

  const styles = {
    grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px", marginTop: "32px", marginBottom: "32px" },
    card: {
      backgroundColor: "#ffffff", padding: "20px 24px", borderRadius: "8px",
      boxShadow: "0 1px 3px rgba(0, 0, 0, 0.08)",
      border: "1px solid #e5e7eb",
      display: "flex", flexDirection: "column"
    },
    cardTitleOuter: {
      borderBottom: "1px dotted #9ca3af",
      display: "inline-block",
      alignSelf: "flex-start",
      paddingBottom: "6px",
      marginBottom: "20px"
    },
    cardTitle: { fontSize: "15px", fontWeight: "500", color: "#111827", margin: 0 },
    cardValue: { fontSize: "36px", fontWeight: "700", color: "#059669", margin: 0, lineHeight: 1 },
    section: { backgroundColor: "#fff", borderRadius: "12px", padding: "24px", boxShadow: "0 2px 4px rgba(0,0,0,0.04)", border: "1px solid #f0f0f0" },
    sectionTitle: { fontSize: "18px", fontWeight: "600", marginBottom: "16px", color: "#1a1a1a" },
    table: { width: "100%", borderCollapse: "collapse" },
    th: { textAlign: "left", padding: "12px", borderBottom: "2px solid #eee", color: "#666", fontSize: "14px", fontWeight: "600" },
    td: { padding: "12px", borderBottom: "1px solid #eee", fontSize: "14px", color: "#333" },
    empty: { textAlign: "center", padding: "40px", color: "#888", fontStyle: "italic" }
  };

  return (
    <AppProvider i18n={enTranslations}>
      <div style={{ padding: "2rem" }}>
        <Page title="Dashboard" fullWidth>
          <BlockStack gap="400">
            <InlineStack gap="400" blockAlign="center">
              {/* Date Picker Popover */}
              <Popover
                active={datePopoverActive}
                activator={dateButton}
                autofocusTarget="none"
                onClose={toggleDatePopover}
                fluidContent
              >
                <Box padding="400" width="650px">
                  <BlockStack gap="400">
                    <div style={{ marginBottom: "4px" }}>
                      <Select
                        options={presetOptions}
                        value={presetFilter}
                        onChange={handlePresetChange}
                        label="Date range"
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: '500', color: '#1a1a1a', marginBottom: '6px' }}>Starting</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #c9cccf', borderRadius: '8px', padding: '8px 12px', background: '#fff' }}>
                          <svg width="14" height="14" viewBox="0 0 20 20" fill="#5c5f62"><path d="M7 2a1 1 0 0 0-1 1v1H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V3a1 1 0 0 0-2 0v1H8V3a1 1 0 0 0-1-1ZM4 8h12v9H4V8Z" /></svg>
                          <span style={{ fontSize: '14px', color: '#1a1a1a' }}>{formatDateForInput(selectedDates.start)}</span>
                        </div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: '500', color: '#1a1a1a', marginBottom: '6px' }}>Ending</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #c9cccf', borderRadius: '8px', padding: '8px 12px', background: '#fff' }}>
                          <svg width="14" height="14" viewBox="0 0 20 20" fill="#5c5f62"><path d="M7 2a1 1 0 0 0-1 1v1H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V3a1 1 0 0 0-2 0v1H8V3a1 1 0 0 0-1-1ZM4 8h12v9H4V8Z" /></svg>
                          <span style={{ fontSize: '14px', color: '#1a1a1a' }}>{formatDateForInput(selectedDates.end)}</span>
                        </div>
                      </div>
                    </div>
                    <DatePicker
                      month={month}
                      year={year}
                      onChange={handleDateSelection}
                      onMonthChange={(month, year) => setDate({ month, year })}
                      selected={selectedDates}
                      multiMonth
                      allowRange
                    />
                    <Divider />
                    <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '4px' }}>
                      <Button onClick={toggleDatePopover}>Cancel</Button>
                      <Button onClick={toggleDatePopover} variant="primary" tone="success">Apply</Button>
                    </div>
                  </BlockStack>
                </Box>
              </Popover>

              <Text as="span" tone="subdued">Compared to {formatDateForComparison(selectedDates.start, selectedDates.end)}</Text>

              <Popover
                active={productPopoverActive}
                activator={productActivator}
                onClose={toggleProductPopover}
              >
                <div style={{ minWidth: "200px" }}>
                  <ActionList items={productOptions} />
                </div>
              </Popover>

              <Popover
                active={deliveryStatusPopoverActive}
                activator={deliveryStatusActivator}
                onClose={toggleDeliveryStatusPopover}
              >
                <div style={{ minWidth: "150px" }}>
                  <ActionList items={deliveryStatusOptions} />
                </div>
              </Popover>

              {/* State Filter */}
              <Popover
                active={statePopoverActive}
                activator={
                  <Button onClick={toggleStatePopover} icon={FilterIcon}>
                    {stateFilter}
                  </Button>
                }
                onClose={toggleStatePopover}
              >
                <div style={{ minWidth: "180px", maxHeight: "260px", overflowY: "auto" }}>
                  <ActionList items={stateOptions} />
                </div>
              </Popover>

              {/* City Filter */}
              <Popover
                active={cityPopoverActive}
                activator={
                  <Button onClick={toggleCityPopover} icon={FilterIcon}>
                    {cityFilter}
                  </Button>
                }
                onClose={toggleCityPopover}
              >
                <div style={{ minWidth: "180px", maxHeight: "260px", overflowY: "auto" }}>
                  <ActionList items={cityOptions} />
                </div>
              </Popover>

              {/* Pincode Filter */}
              <Popover
                active={pincodePopoverActive}
                activator={
                  <Button onClick={togglePincodePopover} icon={FilterIcon}>
                    {pincodeFilter}
                  </Button>
                }
                onClose={togglePincodePopover}
              >
                <div style={{ minWidth: "160px", maxHeight: "260px", overflowY: "auto" }}>
                  <ActionList items={pincodeOptions} />
                </div>
              </Popover>
            </InlineStack>

            <div style={styles.grid}>
              <div style={styles.card}>
                <div style={styles.cardTitleOuter}>
                  <h3 style={styles.cardTitle}>Total Orders</h3>
                </div>
                <p style={styles.cardValue}>{metrics.totalOrders}</p>
              </div>
              <div style={styles.card}>
                <div style={styles.cardTitleOuter}>
                  <h3 style={styles.cardTitle}>In-Transit</h3>
                </div>
                <p style={styles.cardValue}>{metrics.shipped}</p>
              </div>
              <div style={styles.card}>
                <div style={styles.cardTitleOuter}>
                  <h3 style={styles.cardTitle}>Delivered</h3>
                </div>
                <p style={styles.cardValue}>{metrics.fulfilled}</p>
              </div>
              <div style={styles.card}>
                <div style={styles.cardTitleOuter}>
                  <h3 style={styles.cardTitle}>Failed</h3>
                </div>
                <p style={styles.cardValue}>{metrics.failed}</p>
              </div>
              <div style={styles.card}>
                <div style={styles.cardTitleOuter}>
                  <h3 style={styles.cardTitle}>Unfulfilled</h3>
                </div>
                <p style={styles.cardValue}>{metrics.unfulfilled}</p>
              </div>
              {Object.entries(metrics.connectorCounts).map(([connectorName, count]) => (
                <div key={connectorName} style={styles.card}>
                  <div style={styles.cardTitleOuter}>
                    <h3 style={styles.cardTitle}>Dispatched by {connectorName}</h3>
                  </div>
                  <p style={{ ...styles.cardValue, color: "#2563eb" }}>{count}</p>
                </div>
              ))}
            </div>

            <div style={styles.section}>
              <div style={styles.cardTitleOuter}>
                <h3 style={styles.cardTitle}>Order History</h3>
              </div>
              <div style={{ width: '100%', height: 400, marginTop: '20px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartData}
                    margin={{ top: 20, right: 30, left: 0, bottom: 40 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={true} horizontal={true} stroke="#f0f0f0" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: '#666' }}
                      tickMargin={10}
                      angle={-45}
                      textAnchor="end"
                      axisLine={{ stroke: '#e5e7eb' }}
                      tickLine={false}
                      height={70}
                    />
                    <YAxis
                      tick={{ fontSize: 12, fill: '#666' }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                      content={<CustomBarTooltip />}
                    />
                    <Legend
                      content={renderCustomLegend}
                    />
                    <Bar dataKey="Total Orders" stackId="total" fill="#15803d" barSize={6} />
                    <Bar dataKey="Unfulfilled" stackId="unfulfilled" fill="#ffd351ff" barSize={6} />
                    <Bar dataKey="Fulfilled" stackId="fulfilled" fill="#319e9a" barSize={6} />
                    <Bar dataKey="Delivered" stackId="logistics" fill="#31ff7da7" barSize={6} />
                    <Bar dataKey="In-Transit" stackId="logistics" fill="#5052526a" barSize={6} />
                    <Bar dataKey="Failed" stackId="logistics" fill="#ef4444" barSize={6} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div style={styles.section}>
              <div style={{ display: 'flex', gap: '32px', flexWrap: 'wrap' }}>

                {/* ── Left: Shopify Tracking-Status History ── */}
                <div style={{ flex: '1 1 380px', minWidth: '320px' }}>
                  <div style={styles.cardTitleOuter}>
                    <h3 style={styles.cardTitle}>Tracking-Status History</h3>
                  </div>
                  <div style={{ width: '100%', height: 380, marginTop: '12px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={trackingStatusData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={120}
                          isAnimationActive={false}
                          labelLine={{ stroke: '#9ca3af', strokeWidth: 1 }}
                          label={({ name, value, x, y, textAnchor }) => (
                            <text x={x} y={y} fill="#111827" fontSize="13" fontWeight="600" textAnchor={textAnchor} dominantBaseline="central">
                              {name} : {value}
                            </text>
                          )}
                        >
                          {trackingStatusData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          content={<CustomTooltip total={pieTotal} />}
                          wrapperStyle={{ outline: 'none' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* ── Divider ── */}
                <div style={{ width: '1px', backgroundColor: '#e5e7eb', flexShrink: 0 }} />

                {/* ── Right: Connector Orders – Delivery Status ── */}
                <div style={{ flex: '1 1 380px', minWidth: '320px' }}>
                  <div style={styles.cardTitleOuter}>
                    <h3 style={styles.cardTitle}>Connector Orders – Delivery Status</h3>
                  </div>
                  <div style={{ marginBottom: '6px', fontSize: '11px', color: '#9ca3af' }}>
                    Based on Latest Delivery Date from order details (Amazon / other platform)
                  </div>
                  <ConnectorStatusCard orders={filteredOrders} />
                </div>

              </div>
            </div>

            {/* ── RTO Analysis Cards ── */}
            <div style={{ marginTop: '8px' }}>
              <div style={{ fontSize: '20px', fontWeight: '700', color: '#111827', marginBottom: '20px', letterSpacing: '-0.3px' }}>RTO Analysis</div>

              {/* 2-column grid — align-items:start keeps cards independent heights */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px', alignItems: 'start' }}>
                <RtoCard title="🏙️ Top RTO States" label="State" data={rtoAnalysis.states} />
                <RtoCard title="🌆 Top RTO Cities" label="City" data={rtoAnalysis.cities} />
                <RtoCard title="📮 Top RTO Pincodes" label="Pincode" data={rtoAnalysis.pincodes} />
                <RtoCard title="🚚 Top RTO Couriers" label="Courier" data={rtoAnalysis.couriers} showInTransit />
              </div>
            </div>

          </BlockStack>
        </Page>
      </div>
    </AppProvider>
  );
}

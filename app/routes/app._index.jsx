import { useState, useMemo, useCallback } from "react";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { normalizeDeliveryStatus, getThirdPartyConnectorName } from "../utils/orders";
import { indiaMapData } from "./indiaMapData";
import OrderFilters from "../components/OrderFilters";

import {
  AppProvider,
  Page,
  BlockStack,
} from '@shopify/polaris';
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

// normalizeDeliveryStatus and getThirdPartyConnectorName are imported from app/utils/orders.js

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

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
                    quantity
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
    { name: 'In Transit', value: counts['In Transit'], color: '#3b82f6' },
    { name: 'Delivered', value: counts['Delivered'], color: '#10b981' },
    { name: 'Unfulfilled', value: counts['Unfulfilled'], color: '#f59e0b' },
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

// ─── Product RTO Card ─────────────────────────────────────────────────────────
function ProductRtoCard({ data }) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  const [sortField, setSortField] = useState('total'); // default: highest total orders
  const [sortDir, setSortDir] = useState('desc');

  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => {
      const valA = a[sortField] ?? 0;
      const valB = b[sortField] ?? 0;
      return sortDir === 'desc' ? valB - valA : valA - valB;
    });
  }, [data, sortField, sortDir]);

  const totals = useMemo(() => {
    let totalOrders = 0;
    let totalDelivered = 0;
    let totalRto = 0;
    let totalInTransit = 0;
    data.forEach(row => {
      totalOrders += row.total ?? 0;
      totalDelivered += row.delivered ?? 0;
      totalRto += row.rto ?? 0;
      totalInTransit += row.inTransit ?? 0;
    });
    const rtoPct = totalOrders > 0 ? +((totalRto / totalOrders) * 100).toFixed(1) : 0;
    return {
      total: totalOrders,
      delivered: totalDelivered,
      rto: totalRto,
      inTransit: totalInTransit,
      rtoPct
    };
  }, [data]);

  const visibleRows = expanded
    ? sortedData.slice(page * CARD_PAGE, (page + 1) * CARD_PAGE)
    : sortedData.slice(0, CARD_DEFAULT);

  const totalPages = Math.ceil(sortedData.length / CARD_PAGE);
  const showPagination = expanded && sortedData.length > CARD_PAGE;

  const handleToggle = () => { setExpanded(e => !e); setPage(0); };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(prev => prev === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
    setPage(0);
  };

  const renderSortHeader = (field, displayName, align = 'center') => {
    const isActive = sortField === field;
    const arrow = isActive ? (sortDir === 'desc' ? '⮝' : '⮟') : '⮝';
    return (
      <th
        style={{
          padding: '10px 12px',
          textAlign: align,
          color: '#6b7280',
          fontWeight: '600',
          cursor: 'pointer',
          userSelect: 'none',
          transition: 'color 0.15s ease',
          whiteSpace: 'nowrap',
        }}
        onClick={() => handleSort(field)}
        onMouseEnter={(e) => e.currentTarget.style.color = '#111827'}
        onMouseLeave={(e) => e.currentTarget.style.color = '#6b7280'}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
          {displayName}
          <span style={{ fontWeight: '800', fontSize: '11px', color: isActive ? '#6366f1' : '#d1d5db' }}>
            {arrow}
          </span>
        </span>
      </th>
    );
  };

  return (
    <div style={{ backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: '20px' }}>
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid #f3f4f6', backgroundColor: '#fafafa', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '15px', fontWeight: '700', color: '#111827' }}>📦 Product RTO</span>
        {data.length > CARD_DEFAULT && (
          <button
            onClick={handleToggle}
            style={{ fontSize: '12px', fontWeight: '600', color: '#6366f1', background: '#eef2ff', border: 'none', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer' }}
          >
            {expanded ? 'View Less ↑' : `View All (${data.length}) ↓`}
          </button>
        )}
      </div>

      {data.length === 0 ? (
        <div style={{ padding: '32px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>No product data in selected period</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f9fafb' }}>
                  <th style={{ padding: '10px 12px', textAlign: 'center', color: '#6b7280', fontWeight: '600', width: '36px' }}>#</th>
                  {renderSortHeader('name', 'Product', 'left')}
                  {renderSortHeader('total', 'Total Orders')}
                  {renderSortHeader('delivered', 'Delivered')}
                  {renderSortHeader('rto', 'RTO')}
                  {renderSortHeader('inTransit', 'In Transit')}
                  {renderSortHeader('rtoPct', 'RTO %')}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, i) => {
                  const globalIdx = expanded ? page * CARD_PAGE + i : i;
                  return (
                    <tr key={row.name} style={{ borderTop: '1px solid #f3f4f6', backgroundColor: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                      <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: '700', fontSize: '13px', color: globalIdx < 5 ? RTO_COLORS[globalIdx] : '#9ca3af' }}>
                        {globalIdx + 1}
                      </td>
                      <td title={row.name} style={{ padding: '10px 12px', color: '#111827', fontWeight: '500', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'default' }}>
                        {row.name}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', color: '#374151', fontWeight: '600' }}>{row.total}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', color: '#059669', fontWeight: '600' }}>{row.delivered}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', color: '#ef4444', fontWeight: '700' }}>{row.rto}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', color: '#3b82f6', fontWeight: '600' }}>{row.inTransit}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <span style={{
                          backgroundColor: row.rtoPct >= 50 ? '#fee2e2' : row.rtoPct >= 25 ? '#fef3c7' : '#d1fae5',
                          color: row.rtoPct >= 50 ? '#991b1b' : row.rtoPct >= 25 ? '#92400e' : '#065f46',
                          padding: '2px 8px', borderRadius: '99px', fontWeight: '700', fontSize: '11px'
                        }}>
                          {row.rtoPct}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {expanded && (
                <tfoot>
                  <tr style={{ borderTop: '2px solid #9ca3af', borderBottom: '2px solid #9ca3af', backgroundColor: '#f9fafb', fontWeight: '700' }}>
                    <td style={{ padding: '10px 12px', textAlign: 'center', color: '#9ca3af', fontWeight: '700' }}>-</td>
                    <td style={{ padding: '10px 12px', color: '#111827', fontWeight: '700' }}>Total</td>
                    <td style={{ padding: '10px 12px', textAlign: 'center', color: '#374151', fontWeight: '700' }}>{totals.total}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'center', color: '#059669', fontWeight: '700' }}>{totals.delivered}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'center', color: '#ef4444', fontWeight: '800' }}>{totals.rto}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'center', color: '#3b82f6', fontWeight: '700' }}>{totals.inTransit}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      <span style={{
                        backgroundColor: totals.rtoPct >= 50 ? '#fee2e2' : totals.rtoPct >= 25 ? '#fef3c7' : '#d1fae5',
                        color: totals.rtoPct >= 50 ? '#991b1b' : totals.rtoPct >= 25 ? '#92400e' : '#065f46',
                        padding: '2px 8px', borderRadius: '99px', fontWeight: '700', fontSize: '11px'
                      }}>
                        {totals.rtoPct}%
                      </span>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Pagination */}
          {showPagination && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderTop: '1px solid #f3f4f6', backgroundColor: '#fafafa' }}>
              <span style={{ fontSize: '12px', color: '#6b7280' }}>
                {page * CARD_PAGE + 1}–{Math.min((page + 1) * CARD_PAGE, data.length)} of {data.length}
              </span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                  style={{ fontSize: '12px', fontWeight: '600', padding: '4px 10px', borderRadius: '6px', border: '1px solid #e5e7eb', background: page === 0 ? '#f9fafb' : '#fff', color: page === 0 ? '#9ca3af' : '#374151', cursor: page === 0 ? 'default' : 'pointer' }}>
                  ← Prev
                </button>
                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                  style={{ fontSize: '12px', fontWeight: '600', padding: '4px 10px', borderRadius: '6px', border: '1px solid #e5e7eb', background: page >= totalPages - 1 ? '#f9fafb' : '#fff', color: page >= totalPages - 1 ? '#9ca3af' : '#374151', cursor: page >= totalPages - 1 ? 'default' : 'pointer' }}>
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RtoCard({ title, label, data, fullWidth = false, showInTransit = false }) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  const [sortField, setSortField] = useState('rtoPct'); // Default RTO %
  const [sortDir, setSortDir] = useState('desc');   // Default descending

  // Layout constants — declared early so renderSortHeader can reference `pad`
  const pad = fullWidth ? '10px 16px' : '10px 10px';
  const pieW = fullWidth ? 200 : 170;
  const innerR = fullWidth ? 50 : 42;
  const outerR = fullWidth ? 80 : 68;

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
                      <td title={row.name} style={{ padding: pad, color: '#111827', fontWeight: '500', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'default' }}>{row.name}</td>
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

// ─── India Heat Map Component ──────────────────────────────────────────────────
function IndiaHeatMap({ statesData }) {
  const [hoveredState, setHoveredState] = useState(null);

  // Normalize mapping for quick lookup
  const statsMap = useMemo(() => {
    const map = {};
    if (!statesData) return map;
    statesData.forEach(state => {
      const norm = normalizeStateName(state.name);
      map[norm] = state;
    });
    return map;
  }, [statesData]);

  // Normalize state helper
  function normalizeStateName(name) {
    if (!name) return '';
    const clean = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const mapping = {
      'mh': 'maharashtra',
      'ka': 'karnataka',
      'dl': 'delhi',
      'up': 'uttarpradesh',
      'mp': 'madhyapradesh',
      'gj': 'gujarat',
      'hr': 'haryana',
      'pb': 'punjab',
      'rj': 'rajasthan',
      'tn': 'tamilnadu',
      'ap': 'andhrapradesh',
      'tg': 'telangana', 'ts': 'telangana',
      'kl': 'kerala',
      'wb': 'westbengal',
      'br': 'bihar',
      'or': 'odisha', 'od': 'odisha', 'orissa': 'odisha',
      'ct': 'chhattisgarh', 'cg': 'chhattisgarh',
      'jh': 'jharkhand',
      'uk': 'uttarakhand', 'ua': 'uttarakhand',
      'hp': 'himachalpradesh',
      'jk': 'jammuandkashmir', 'jammukashmir': 'jammuandkashmir', 'jammu': 'jammuandkashmir', 'kashmir': 'jammuandkashmir', 'ladakh': 'jammuandkashmir',
      'as': 'assam',
      'ml': 'meghalaya',
      'mn': 'manipur',
      'mz': 'mizoram',
      'nl': 'nagaland',
      'sk': 'sikkim',
      'tr': 'tripura',
      'py': 'puducherry', 'pondicherry': 'puducherry',
      'ga': 'goa',
      'ch': 'chandigarh',
      'an': 'andamanandnicobarislands', 'andaman': 'andamanandnicobarislands', 'nicobar': 'andamanandnicobarislands',
      'ld': 'lakshadweep',
      'dn': 'dadraandnagarhaveli',
      'dd': 'damananddiu',
      'dnhdd': 'dadraandnagarhaveli'
    };
    return mapping[clean] || clean;
  }

  // Get color for RTO %
  function getColorForRto(rtoPct, totalOrders) {
    if (!totalOrders || totalOrders === 0) return '#e5e7eb'; // no data
    if (rtoPct < 5) return '#00b480'; // <5%
    if (rtoPct < 10) return '#2ec175'; // 5-10%
    if (rtoPct < 15) return '#84cc16'; // 10-15%
    if (rtoPct < 20) return '#eab308'; // 15-20%
    if (rtoPct < 25) return '#f97316'; // 20-25%
    return '#ef4444'; // >25%
  }

  return (
    <div style={{
      backgroundColor: '#ffffff',
      borderRadius: '12px',
      padding: '24px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      border: '1px solid #e5e7eb',
      marginTop: '20px',
      position: 'relative'
    }}>
      {/* Title */}
      <div style={{
        borderBottom: '1px dotted #9ca3af',
        display: 'inline-flex',
        alignItems: 'center',
        paddingBottom: '6px',
        marginBottom: '24px'
      }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}>
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
        <h3 style={{ fontSize: '15px', fontWeight: '700', color: '#111827', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          RTO Heatmap — India
        </h3>
      </div>

      {/* Map Content */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
        <div style={{ width: '100%', maxWidth: '600px', display: 'flex', justifyContent: 'center' }}>
          <svg
            viewBox={indiaMapData.viewBox}
            width="100%"
            height="100%"
            style={{
              filter: 'drop-shadow(0px 8px 16px rgba(0,0,0,0.04))',
              overflow: 'visible'
            }}
          >
            {indiaMapData.locations.map(loc => {
              const normName = normalizeStateName(loc.name);
              const stateInfo = statsMap[normName] || { total: 0, rto: 0, delivered: 0, rtoPct: 0 };
              const fill = getColorForRto(stateInfo.rtoPct, stateInfo.total);
              const isHovered = hoveredState && hoveredState.id === loc.id;

              return (
                <path
                  key={loc.id}
                  id={loc.id}
                  d={loc.path}
                  fill={fill}
                  stroke={isHovered ? '#111827' : '#ffffff'}
                  strokeWidth={isHovered ? 2.5 : 1.2}
                  style={{
                    cursor: 'pointer',
                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                  onMouseMove={(e) => {
                    setHoveredState({
                      id: loc.id,
                      name: loc.name,
                      total: stateInfo.total,
                      rto: stateInfo.rto,
                      delivered: stateInfo.delivered,
                      rtoPct: stateInfo.rtoPct,
                      x: e.clientX,
                      y: e.clientY
                    });
                  }}
                  onMouseLeave={() => {
                    setHoveredState(null);
                  }}
                />
              );
            })}
          </svg>
        </div>

        {/* Legend */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          flexWrap: 'wrap',
          gap: '16px',
          marginTop: '24px',
          fontSize: '12px',
          color: '#6b7280',
          fontWeight: '500'
        }}>
          {[
            { label: '<5%', color: '#00f1adff' },
            { label: '5-10%', color: '#339765ff' },
            { label: '10-15%', color: '#84cc16' },
            { label: '15-20%', color: '#eab308' },
            { label: '20-25%', color: '#f97316' },
            { label: '>25%', color: '#ef4444' },
            { label: 'no data', color: '#e5e7eb' }
          ].map((item, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                backgroundColor: item.color,
                display: 'inline-block',
                boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
              }} />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Tooltip */}
      {hoveredState && (
        <div style={{
          position: 'fixed',
          left: hoveredState.x + 15,
          top: hoveredState.y + 15,
          backgroundColor: '#ffffff',
          border: '1px solid #e5e7eb',
          padding: '10px 14px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          borderRadius: '8px',
          fontSize: '13px',
          pointerEvents: 'none',
          zIndex: 9999,
          fontFamily: 'inherit',
          color: '#1f2937',
          minWidth: '160px'
        }}>
          <p style={{ margin: '0 0 6px 0', fontWeight: '700', color: '#111827', fontSize: '14px', borderBottom: '1px solid #f3f4f6', paddingBottom: '4px' }}>
            {hoveredState.name}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#6b7280' }}>Total Orders:</span>
              <span style={{ fontWeight: '600' }}>{hoveredState.total}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#6b7280' }}>Delivered:</span>
              <span style={{ fontWeight: '600', color: '#059669' }}>{hoveredState.delivered}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#6b7280' }}>RTO:</span>
              <span style={{ fontWeight: '600', color: '#ef4444' }}>{hoveredState.rto}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', paddingTop: '4px', borderTop: '1px dotted #f3f4f6' }}>
              <span style={{ color: '#111827', fontWeight: '600' }}>RTO Rate:</span>
              <span style={{
                backgroundColor: hoveredState.total === 0 ? '#e5e7eb' : hoveredState.rtoPct >= 25 ? '#fee2e2' : hoveredState.rtoPct >= 15 ? '#fee2e2' : hoveredState.rtoPct >= 10 ? '#fef3c7' : '#d1fae5',
                color: hoveredState.total === 0 ? '#4b5563' : hoveredState.rtoPct >= 25 ? '#991b1b' : hoveredState.rtoPct >= 15 ? '#b45309' : hoveredState.rtoPct >= 10 ? '#92400e' : '#065f46',
                padding: '1px 6px',
                borderRadius: '4px',
                fontWeight: '700'
              }}>
                {hoveredState.total === 0 ? 'N/A' : `${hoveredState.rtoPct}%`}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Index() {
  const { orders = [], storeProducts = [] } = useLoaderData() || {};



  const [selectedDates, setSelectedDates] = useState(() => {
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setDate(end.getDate() - 29);
    return { start, end };
  });

  const [productFilter, setProductFilter] = useState("All Product Types");
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState("All Statuses");
  const [stateFilter, setStateFilter] = useState("All States");
  const [cityFilter, setCityFilter] = useState("All Cities");
  const [pincodeFilter, setPincodeFilter] = useState("All Pincodes");
  const [courierFilter, setCourierFilter] = useState("All Couriers");

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

      // 7. Courier Filter
      if (courierFilter !== "All Couriers") {
        const orderCourier = order.fulfillments?.[0]?.trackingInfo?.[0]?.company?.trim();
        if (orderCourier !== courierFilter) return false;
      }

      return true;
    });
  }, [orders, selectedDates, productFilter, deliveryStatusFilter, stateFilter, cityFilter, pincodeFilter, courierFilter]);

  // Compute Metrics
  // Each order falls into EXACTLY ONE bucket so all cards always sum to Total Orders:
  //   Delivered | In-Transit | Failed | Dispatched-by-X (connector) | Unfulfilled (no tracking)
  const metrics = useMemo(() => {
    let unfulfilled = 0; // orders with no delivery tracking and not a connector order
    let shipped = 0;     // in_transit / out_for_delivery
    let fulfilled = 0;   // delivered
    let failed = 0;      // rto_failed
    const connectorCounts = {};

    filteredOrders.forEach(order => {
      // Connector order with no resolved delivery status → its own bucket
      const isConnectorNoTracking = order.connectorName && (
        order.orderDeliveryStatus !== 'delivered' &&
        order.orderDeliveryStatus !== 'fulfilled' &&
        order.orderDeliveryStatus !== 'rto_failed'
      );

      if (isConnectorNoTracking) {
        connectorCounts[order.connectorName] = (connectorCounts[order.connectorName] || 0) + 1;
      } else if (order.orderDeliveryStatus === 'delivered' || order.orderDeliveryStatus === 'fulfilled') {
        fulfilled++;
      } else if (order.orderDeliveryStatus === 'in_transit' || order.orderDeliveryStatus === 'out_for_delivery') {
        shipped++;
      } else if (order.orderDeliveryStatus === 'rto_failed') {
        failed++;
      } else {
        // No tracking info at all — shown as "Unfulfilled"
        unfulfilled++;
      }
    });

    return {
      totalOrders: filteredOrders.length,
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

    // ── Product groupBy (filtered to active store products only) ──
    const activeProductSet = new Set(storeProducts); // storeProducts = active catalog titles from loader
    const productMap = {};
    filteredOrders.forEach(order => {
      const isConnectorNoTracking = order.connectorName && (order.orderDeliveryStatus !== 'delivered' && order.orderDeliveryStatus !== 'fulfilled' && order.orderDeliveryStatus !== 'rto_failed');
      if (isConnectorNoTracking) return;
      (order.lineItems?.edges || []).forEach(e => {
        const productTitle = e.node?.title;
        if (!productTitle || !activeProductSet.has(productTitle)) return;
        const qty = e.node.quantity || 1;

        if (!productMap[productTitle]) {
          productMap[productTitle] = { delivered: 0, rto: 0, inTransit: 0, total: 0 };
        }
        productMap[productTitle].total += qty;
        if (order.orderDeliveryStatus === 'rto_failed') {
          productMap[productTitle].rto += qty;
        } else if (order.orderDeliveryStatus === 'delivered' || order.orderDeliveryStatus === 'fulfilled') {
          productMap[productTitle].delivered += qty;
        } else if (order.orderDeliveryStatus === 'in_transit' || order.orderDeliveryStatus === 'out_for_delivery') {
          productMap[productTitle].inTransit += qty;
        }
      });
    });
    const products = Object.entries(productMap)
      .map(([name, d]) => ({
        name,
        delivered: d.delivered,
        rto: d.rto,
        inTransit: d.inTransit,
        total: d.total,
        rtoPct: d.total > 0 ? +((d.rto / d.total) * 100).toFixed(1) : 0,
      }))
      .sort((a, b) => b.total - a.total);

    return {
      states: groupBy(o => o.shippingState || null),
      cities: groupBy(o => o.shippingCity || null),
      pincodes: groupBy(o => o.shippingPincode || null),
      couriers: groupBy(o => o.fulfillments?.[0]?.trackingInfo?.[0]?.company || null),
      products,
    };
  }, [filteredOrders, storeProducts]);



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
            <OrderFilters
              orders={orders}
              storeProducts={storeProducts}
              selectedDates={selectedDates}
              setSelectedDates={setSelectedDates}
              productFilter={productFilter}
              setProductFilter={setProductFilter}
              deliveryStatusFilter={deliveryStatusFilter}
              setDeliveryStatusFilter={setDeliveryStatusFilter}
              stateFilter={stateFilter}
              setStateFilter={setStateFilter}
              cityFilter={cityFilter}
              setCityFilter={setCityFilter}
              pincodeFilter={pincodeFilter}
              setPincodeFilter={setPincodeFilter}
              courierFilter={courierFilter}
              setCourierFilter={setCourierFilter}
            />

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

            {/* ── Product RTO Card ── */}
            <div style={{ marginTop: '8px' }}>
              <div style={{ fontSize: '20px', fontWeight: '700', color: '#111827', marginBottom: '16px', letterSpacing: '-0.3px' }}>Product RTO</div>
              <ProductRtoCard data={rtoAnalysis.products} />
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

            {/* ── India Heat Map ── */}
            <IndiaHeatMap statesData={rtoAnalysis.states} />

          </BlockStack>
        </Page>
      </div>
    </AppProvider>
  );
}

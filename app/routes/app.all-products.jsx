import { useState, useMemo } from "react";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { normalizeDeliveryStatus, getThirdPartyConnectorName } from "../utils/orders";

import {
  AppProvider,
  Page,
  Box,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Divider,
} from '@shopify/polaris';
import '@shopify/polaris/build/esm/styles.css';
import enTranslations from '@shopify/polaris/locales/en.json';

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  // 1. Fetch all active products
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

  const storeProducts = [...new Set(allStoreProducts)].sort();

  // 2. Fetch all orders
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
              sourceName
              tags
              lineItems(first: 10) {
                edges {
                  node {
                    title
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

    if (!json.data || !json.data.orders) {
      console.error('[AllProducts] Orders query error:', JSON.stringify(json.errors || json));
      break;
    }

    const ordersPage = json.data.orders;
    allRawOrders.push(...ordersPage.edges.map((edge) => edge.node));
    hasNextPage = ordersPage.pageInfo.hasNextPage;
    cursor = ordersPage.pageInfo.endCursor;
  }

  const enhancedOrders = allRawOrders.map((order) => {
    let orderDeliveryStatus = 'unknown';

    const connectorName = getThirdPartyConnectorName(order);

    let connectorLatestDeliveryDate = null;
    let connectorEarliestDeliveryDate = null;
    if (connectorName && Array.isArray(order.customAttributes)) {
      for (const attr of order.customAttributes) {
        const keyLower = (attr.key || '').toLowerCase();
        if (keyLower.includes('latest') && keyLower.includes('delivery')) {
          connectorLatestDeliveryDate = attr.value || null;
        } else if (!connectorLatestDeliveryDate && keyLower.includes('delivery') && (keyLower.includes('date') || keyLower.includes('earliest'))) {
          connectorEarliestDeliveryDate = attr.value || null;
        }
      }
      if (!connectorLatestDeliveryDate && connectorEarliestDeliveryDate) {
        connectorLatestDeliveryDate = connectorEarliestDeliveryDate;
      }
    }

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
      return { ...order, fulfillments: enrichedFulfillments, orderDeliveryStatus, connectorName, connectorLatestDeliveryDate, connectorReturnClosed };
    }
    return { ...order, orderDeliveryStatus, connectorName, connectorLatestDeliveryDate, connectorReturnClosed };
  });

  return { orders: enhancedOrders, storeProducts };
};

const RTO_COLORS = ['#ef4444', '#f97316', '#eab308', '#8b5cf6', '#06b6d4'];
const PAGE_SIZE = 20;

export default function AllProductsPage() {
  const { orders, storeProducts } = useLoaderData();
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(0);
  const [sortField, setSortField] = useState("total"); // Default to highest total orders
  const [sortDir, setSortDir] = useState("desc");

  // Metrics
  const totalOrders = orders.length;
  const shopifyOrders = orders.filter(o => !o.connectorName).length;
  const connectorOrders = orders.filter(o => !!o.connectorName).length;

  // Build metrics per product
  const productsData = useMemo(() => {
    const productMap = {};

    // Initialize all active store products
    storeProducts.forEach(title => {
      productMap[title] = { delivered: 0, rto: 0, inTransit: 0, total: 0 };
    });

    // Process all orders
    orders.forEach(order => {
      const orderProducts = new Set((order.lineItems?.edges || []).map(e => e.node.title).filter(Boolean));
      orderProducts.forEach(productTitle => {
        if (productMap[productTitle]) {
          productMap[productTitle].total++;
          if (order.orderDeliveryStatus === 'rto_failed') {
            productMap[productTitle].rto++;
          } else if (order.orderDeliveryStatus === 'delivered' || order.orderDeliveryStatus === 'fulfilled') {
            productMap[productTitle].delivered++;
          } else if (order.orderDeliveryStatus === 'in_transit' || order.orderDeliveryStatus === 'out_for_delivery') {
            productMap[productTitle].inTransit++;
          }
        }
      });
    });

    return Object.entries(productMap).map(([name, d]) => ({
      name,
      delivered: d.delivered,
      rto: d.rto,
      inTransit: d.inTransit,
      total: d.total,
      rtoPct: d.total > 0 ? +((d.rto / d.total) * 100).toFixed(1) : 0,
    }));
  }, [orders, storeProducts]);

  // Filter products by search
  const filteredProducts = useMemo(() => {
    if (!searchQuery) return productsData;
    const query = searchQuery.toLowerCase().trim();
    return productsData.filter(p => p.name.toLowerCase().includes(query));
  }, [productsData, searchQuery]);

  // Sort products
  const sortedProducts = useMemo(() => {
    return [...filteredProducts].sort((a, b) => {
      const valA = a[sortField] ?? 0;
      const valB = b[sortField] ?? 0;
      if (typeof valA === "string") {
        return sortDir === "desc"
          ? valB.localeCompare(valA)
          : valA.localeCompare(valB);
      }
      return sortDir === "desc" ? valB - valA : valA - valB;
    });
  }, [filteredProducts, sortField, sortDir]);

  // Page slice
  const visibleProducts = useMemo(() => {
    return sortedProducts.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  }, [sortedProducts, page]);

  const totalPages = Math.ceil(sortedProducts.length / PAGE_SIZE);

  // Totals calculations
  const totals = useMemo(() => {
    let total = 0;
    let delivered = 0;
    let rto = 0;
    let inTransit = 0;
    filteredProducts.forEach(p => {
      total += p.total;
      delivered += p.delivered;
      rto += p.rto;
      inTransit += p.inTransit;
    });
    const rtoPct = total > 0 ? +((rto / total) * 100).toFixed(1) : 0;
    return { total, delivered, rto, inTransit, rtoPct };
  }, [filteredProducts]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(dir => dir === "desc" ? "asc" : "desc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
    setPage(0);
  };

  const renderSortHeader = (field, displayName, align = 'center') => {
    const isActive = sortField === field;
    const arrow = isActive ? (sortDir === 'desc' ? '⮝' : '⮟') : '⮝';
    return (
      <th
        style={{
          padding: '12px 14px',
          textAlign: align,
          color: '#4b5563',
          fontWeight: '600',
          cursor: 'pointer',
          userSelect: 'none',
          transition: 'color 0.15s ease',
          whiteSpace: 'nowrap',
        }}
        onClick={() => handleSort(field)}
        onMouseEnter={(e) => e.currentTarget.style.color = '#111827'}
        onMouseLeave={(e) => e.currentTarget.style.color = '#4b5563'}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: align === 'left' ? 'flex-start' : 'center', gap: '4px' }}>
          {displayName}
          <span style={{ fontWeight: '800', fontSize: '11px', color: isActive ? '#6366f1' : '#d1d5db' }}>
            {arrow}
          </span>
        </span>
      </th>
    );
  };

  const styles = {
    grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "20px", marginTop: "16px", marginBottom: "28px" },
    card: {
      backgroundColor: "#ffffff", padding: "20px 24px", borderRadius: "10px",
      boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0,0,0,0.02)",
      border: "1px solid #e5e7eb",
      display: "flex", flexDirection: "column"
    },
    cardTitleOuter: {
      borderBottom: "1px dotted #9ca3af",
      display: "inline-block",
      alignSelf: "flex-start",
      paddingBottom: "4px",
      marginBottom: "16px"
    },
    cardTitle: { fontSize: "14px", fontWeight: "600", color: "#4b5563", margin: 0 },
    cardValue: { fontSize: "36px", fontWeight: "700", color: "#111827", margin: 0, lineHeight: 1.1 },
  };

  return (
    <AppProvider i18n={enTranslations}>
      <div style={{ backgroundColor: "#f6f6f7", minHeight: "100vh", paddingBottom: "40px" }}>
        <Page title="All Products Catalog & Unfiltered Analytics">
          <BlockStack gap="500">
            {/* KPI Cards Grid */}
            <div style={styles.grid}>
              <div style={styles.card}>
                <div style={styles.cardTitleOuter}>
                  <h3 style={styles.cardTitle}>Total Orders (Unfiltered)</h3>
                </div>
                <p style={{ ...styles.cardValue, color: "#4f46e5" }}>{totalOrders}</p>
                <span style={{ fontSize: "12px", color: "#9ca3af", marginTop: "6px" }}>Irrespective of status and connector</span>
              </div>
              <div style={styles.card}>
                <div style={styles.cardTitleOuter}>
                  <h3 style={styles.cardTitle}>Shopify Native Orders</h3>
                </div>
                <p style={{ ...styles.cardValue, color: "#059669" }}>{shopifyOrders}</p>
                <span style={{ fontSize: "12px", color: "#9ca3af", marginTop: "6px" }}>Standard Shopify web checkout</span>
              </div>
              <div style={styles.card}>
                <div style={styles.cardTitleOuter}>
                  <h3 style={styles.cardTitle}>Marketplace Connector Orders</h3>
                </div>
                <p style={{ ...styles.cardValue, color: "#2563eb" }}>{connectorOrders}</p>
                <span style={{ fontSize: "12px", color: "#9ca3af", marginTop: "6px" }}>Amazon / eBay / Etsy connector apps</span>
              </div>
            </div>

            {/* Products Table Card */}
            <div style={{ backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f3f4f6', backgroundColor: '#fafafa', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                <span style={{ fontSize: '15px', fontWeight: '700', color: '#111827' }}>📦 All Active Products ({filteredProducts.length})</span>
                <div style={{ width: '280px' }}>
                  <TextField
                    placeholder="Search product title..."
                    value={searchQuery}
                    onChange={(val) => { setSearchQuery(val); setPage(0); }}
                    clearButton
                    onClearButtonClick={() => setSearchQuery("")}
                    autoComplete="off"
                  />
                </div>
              </div>

              {filteredProducts.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>
                  No matching active products found
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                          <th style={{ padding: '12px 14px', textAlign: 'center', color: '#4b5563', fontWeight: '600', width: '48px' }}>#</th>
                          {renderSortHeader('name', 'Product', 'left')}
                          {renderSortHeader('total', 'Total Orders')}
                          {renderSortHeader('delivered', 'Delivered')}
                          {renderSortHeader('rto', 'RTO')}
                          {renderSortHeader('inTransit', 'In Transit')}
                          {renderSortHeader('rtoPct', 'RTO %')}
                        </tr>
                      </thead>
                      <tbody>
                        {visibleProducts.map((row, i) => {
                          const globalIdx = page * PAGE_SIZE + i;
                          return (
                            <tr key={row.name} style={{ borderBottom: '1px solid #f3f4f6', backgroundColor: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                              <td style={{ padding: '12px 14px', textAlign: 'center', fontWeight: '700', fontSize: '13px', color: globalIdx < 5 ? RTO_COLORS[globalIdx] : '#9ca3af' }}>
                                {globalIdx + 1}
                              </td>
                              <td title={row.name} style={{ padding: '12px 14px', color: '#111827', fontWeight: '500', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {row.name}
                              </td>
                              <td style={{ padding: '12px 14px', textAlign: 'center', color: '#374151', fontWeight: '600' }}>{row.total}</td>
                              <td style={{ padding: '12px 14px', textAlign: 'center', color: '#059669', fontWeight: '600' }}>{row.delivered}</td>
                              <td style={{ padding: '12px 14px', textAlign: 'center', color: '#ef4444', fontWeight: '700' }}>{row.rto}</td>
                              <td style={{ padding: '12px 14px', textAlign: 'center', color: '#3b82f6', fontWeight: '600' }}>{row.inTransit}</td>
                              <td style={{ padding: '12px 14px', textAlign: 'center' }}>
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
                      <tfoot>
                        <tr style={{ borderTop: '2px solid #e5e7eb', backgroundColor: '#f9fafb', fontWeight: '700' }}>
                          <td style={{ padding: '12px 14px', textAlign: 'center', color: '#9ca3af', fontWeight: '700' }}>-</td>
                          <td style={{ padding: '12px 14px', color: '#111827', fontWeight: '700' }}>Total (filtered)</td>
                          <td style={{ padding: '12px 14px', textAlign: 'center', color: '#374151', fontWeight: '700' }}>{totals.total}</td>
                          <td style={{ padding: '12px 14px', textAlign: 'center', color: '#059669', fontWeight: '700' }}>{totals.delivered}</td>
                          <td style={{ padding: '12px 14px', textAlign: 'center', color: '#ef4444', fontWeight: '800' }}>{totals.rto}</td>
                          <td style={{ padding: '12px 14px', textAlign: 'center', color: '#3b82f6', fontWeight: '700' }}>{totals.inTransit}</td>
                          <td style={{ padding: '12px 14px', textAlign: 'center' }}>
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
                    </table>
                  </div>

                  {/* Pagination footer */}
                  {totalPages > 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderTop: '1px solid #f3f4f6', backgroundColor: '#fafafa' }}>
                      <span style={{ fontSize: '12px', color: '#6b7280' }}>
                        Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sortedProducts.length)} of {sortedProducts.length} products
                      </span>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                          style={{ fontSize: '12px', fontWeight: '600', padding: '5px 12px', borderRadius: '6px', border: '1px solid #e5e7eb', background: page === 0 ? '#f9fafb' : '#fff', color: page === 0 ? '#9ca3af' : '#374151', cursor: page === 0 ? 'default' : 'pointer' }}>
                          ← Prev
                        </button>
                        <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                          style={{ fontSize: '12px', fontWeight: '600', padding: '5px 12px', borderRadius: '6px', border: '1px solid #e5e7eb', background: page >= totalPages - 1 ? '#f9fafb' : '#fff', color: page >= totalPages - 1 ? '#9ca3af' : '#374151', cursor: page >= totalPages - 1 ? 'default' : 'pointer' }}>
                          Next →
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </BlockStack>
        </Page>
      </div>
    </AppProvider>
  );
}

import { useState, useMemo } from "react";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { normalizeDeliveryStatus, enrichConnectorOrderDetails, getIsConnectorNoTracking } from "../utils/orders";
import ProductRTO from "../components/ProductRTO";
import RTOAnalysis from "../components/RTOAnalysis";
import IndiaHeatMap from "../components/IndiaHeatMap";
import Filters from "../components/Filters";
import ConnectorStatusCard from "../components/ConnectorStatusCard";
import RevenueCards from "../components/RevenueCards";

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
    const connectorDetails = enrichConnectorOrderDetails(order);

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
      return { ...order, fulfillments: enrichedFulfillments, orderDeliveryStatus, shippingCity, shippingState, shippingPincode, ...connectorDetails };
    }
    return { ...order, orderDeliveryStatus, shippingCity, shippingState, shippingPincode, ...connectorDetails };
  });

  return { orders: enhancedOrders, storeProducts };
};



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
          const isConnectorNoTracking = getIsConnectorNoTracking(order);
          statusMatches = !isConnectorNoTracking && (order.orderDeliveryStatus === 'in_transit' || order.orderDeliveryStatus === 'out_for_delivery');
        } else if (deliveryStatusFilter === "Failed") {
          statusMatches = (order.orderDeliveryStatus === 'rto_failed');
        } else if (deliveryStatusFilter.startsWith("Dispatched by ")) {
          const connName = deliveryStatusFilter.replace("Dispatched by ", "");
          const isConnectorNoTracking = getIsConnectorNoTracking(order, connName);
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
      const isConnectorNoTracking = getIsConnectorNoTracking(order);

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
      const isConnectorNoTracking = getIsConnectorNoTracking(order);
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
      const isConnectorNoTracking = getIsConnectorNoTracking(order);
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
        const isConnectorNoTracking = getIsConnectorNoTracking(order);
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
      const isConnectorNoTracking = getIsConnectorNoTracking(order);
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
            <Filters
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

            <RevenueCards orders={filteredOrders} />

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
              <ProductRTO data={rtoAnalysis.products} />
            </div>

            {/* ── RTO Analysis Cards ── */}
            <div style={{ marginTop: '8px' }}>
              <div style={{ fontSize: '20px', fontWeight: '700', color: '#111827', marginBottom: '20px', letterSpacing: '-0.3px' }}>RTO Analysis</div>


              {/* 2-column grid — align-items:start keeps cards independent heights */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px', alignItems: 'start' }}>
                <RTOAnalysis title="🏙️ Top RTO States" label="State" data={rtoAnalysis.states} />
                <RTOAnalysis title="🌆 Top RTO Cities" label="City" data={rtoAnalysis.cities} />
                <RTOAnalysis title="📮 Top RTO Pincodes" label="Pincode" data={rtoAnalysis.pincodes} />
                <RTOAnalysis title="🚚 Top RTO Couriers" label="Courier" data={rtoAnalysis.couriers} showInTransit />
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

import { useState, useMemo, useRef, useEffect } from "react";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { normalizeDeliveryStatus, enrichConnectorOrderDetails, getIsConnectorNoTracking } from "../utils/orders";
import ProductRTO from "../components/ProductRTO";
import RTOAnalysis from "../components/RTOAnalysis";
import IndiaHeatMap from "../components/IndiaHeatMap";
import Filters from "../components/Filters";
import ConnectorStatusCard from "../components/ConnectorStatusCard";
import RevenueCards from "../components/RevenueCards";
import ProductRevenue from "../components/ProductRevenue";
import OrderBarChart from "../components/OrderBarChart";
import OrderHistoryChart from "../components/OrderHistoryChart";
import TrackingStatusHistory from "../components/TrackingStatusHistory";
import OrderCards from "../components/OrderCards";

import {
  AppProvider,
  Page,
  BlockStack,
} from '@shopify/polaris';
import '@shopify/polaris/build/esm/styles.css';
import enTranslations from '@shopify/polaris/locales/en.json';

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
                    originalUnitPriceSet {
                      shopMoney {
                        amount
                      }
                    }
                    discountAllocations {
                      allocatedAmountSet {
                        shopMoney {
                          amount
                        }
                      }
                    }
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







export default function Index() {
  const { orders = [], storeProducts = [] } = useLoaderData() || {};

  const [activeOrderCardTitle, setActiveOrderCardTitle] = useState(null);
  const orderChartRef = useRef(null);

  useEffect(() => {
    if (activeOrderCardTitle) {
      const timer = setTimeout(() => {
        orderChartRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [activeOrderCardTitle]);



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
      { name: 'Delivered', value: delivered, color: '#10b981' },
      { name: 'RTO', value: rto, color: '#ef4444' },
      { name: 'In-Transit', value: inTransit, color: '#3b82f6' },
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

    // ── Product groupBy ──
    const productMap = {};
    filteredOrders.forEach(order => {
      const isConnectorNoTracking = getIsConnectorNoTracking(order);
      if (isConnectorNoTracking) return;
      (order.lineItems?.edges || []).forEach(e => {
        const productTitle = e.node?.title;
        if (!productTitle) return;
        const matchesProductFilter = !productFilter || productFilter === "All Product Types" || productTitle?.trim() === productFilter;
        if (!matchesProductFilter) return;
        const qty = e.node.quantity || 1;

        if (!productMap[productTitle]) {
          productMap[productTitle] = { delivered: 0, rto: 0, inTransit: 0, unfulfilled: 0, total: 0 };
        }
        productMap[productTitle].total += qty;
        if (order.orderDeliveryStatus === 'rto_failed') {
          productMap[productTitle].rto += qty;
        } else if (order.orderDeliveryStatus === 'delivered' || order.orderDeliveryStatus === 'fulfilled') {
          productMap[productTitle].delivered += qty;
        } else if (order.orderDeliveryStatus === 'in_transit' || order.orderDeliveryStatus === 'out_for_delivery') {
          productMap[productTitle].inTransit += qty;
        } else {
          productMap[productTitle].unfulfilled += qty;
        }
      });
    });
    const products = Object.entries(productMap)
      .map(([name, d]) => ({
        name,
        delivered: d.delivered,
        rto: d.rto,
        inTransit: d.inTransit,
        unfulfilled: d.unfulfilled,
        total: d.total,
        rtoPct: d.total > 0 ? +((d.rto / d.total) * 100).toFixed(1) : 0,
      }))
      .sort((a, b) => b.total - a.total);

    // ── Product Revenue Aggregation ──
    const productRevenueMap = {};
    filteredOrders.forEach(order => {
      const isConnector = !!order.connectorName;
      if (isConnector) return;

      (order.lineItems?.edges || []).forEach(e => {
        const productTitle = e.node?.title;
        if (!productTitle) return;
        const matchesProductFilter = !productFilter || productFilter === "All Product Types" || productTitle?.trim() === productFilter;
        if (!matchesProductFilter) return;
        const qty = e.node.quantity || 1;
        const originalUnitPrice = Number(e.node.originalUnitPriceSet?.shopMoney?.amount || 0);
        const originalTotal = qty * originalUnitPrice;
        const totalDiscount = (e.node.discountAllocations || []).reduce((sum, da) => {
          return sum + Number(da.allocatedAmountSet?.shopMoney?.amount || 0);
        }, 0);
        const itemRevenue = originalTotal - totalDiscount;

        if (!productRevenueMap[productTitle]) {
          productRevenueMap[productTitle] = {
            name: productTitle,
            expected: 0,
            delivered: 0,
            inTransit: 0,
            unfulfilled: 0,
            lost: 0
          };
        }

        productRevenueMap[productTitle].expected += itemRevenue;

        if (order.orderDeliveryStatus === 'delivered' || order.orderDeliveryStatus === 'fulfilled') {
          productRevenueMap[productTitle].delivered += itemRevenue;
        } else if (order.orderDeliveryStatus === 'in_transit' || order.orderDeliveryStatus === 'out_for_delivery') {
          productRevenueMap[productTitle].inTransit += itemRevenue;
        } else if (order.orderDeliveryStatus === 'rto_failed') {
          productRevenueMap[productTitle].lost += itemRevenue;
        } else {
          productRevenueMap[productTitle].unfulfilled += itemRevenue;
        }
      });
    });
    const productRevenues = Object.values(productRevenueMap).sort((a, b) => b.expected - a.expected);

    return {
      states: groupBy(o => o.shippingState || null),
      cities: groupBy(o => o.shippingCity || null),
      pincodes: groupBy(o => o.shippingPincode || null),
      couriers: groupBy(o => o.fulfillments?.[0]?.trackingInfo?.[0]?.company || null),
      products,
      productRevenues,
    };
  }, [filteredOrders, productFilter]);



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

            <OrderCards metrics={metrics} activeOrderCardTitle={activeOrderCardTitle} setActiveOrderCardTitle={setActiveOrderCardTitle} />

            {activeOrderCardTitle && (
              <div ref={orderChartRef}>
                <OrderBarChart
                  activeCard={activeOrderCardTitle}
                  products={rtoAnalysis.products}
                  onClose={() => setActiveOrderCardTitle(null)}
                />
              </div>
            )}

            <RevenueCards orders={filteredOrders} productFilter={productFilter} productRevenues={rtoAnalysis.productRevenues} />

            <OrderHistoryChart chartData={chartData} />

            <div style={styles.section}>
              <div style={{ display: 'flex', gap: '32px', flexWrap: 'wrap' }}>

                {/* ── Left: Shopify Tracking-Status History ── */}
                <div style={{ flex: '1 1 380px', minWidth: '320px' }}>
                  <TrackingStatusHistory trackingStatusData={trackingStatusData} pieTotal={pieTotal} />
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

            {/* ── Product Revenue Card ── */}
            <div style={{ marginTop: '8px' }}>
              <div style={{ fontSize: '20px', fontWeight: '700', color: '#111827', marginBottom: '16px', letterSpacing: '-0.3px' }}>Product Revenue</div>
              <ProductRevenue data={rtoAnalysis.productRevenues} />
            </div>

            {/* ── RTO Analysis Cards ── */}
            <div style={{ marginTop: '8px' }}>
              <div style={{ fontSize: '20px', fontWeight: '700', color: '#111827', marginBottom: '20px', letterSpacing: '-0.3px' }}>RTO Analysis</div>


              {/* 2-column grid — align-items:start keeps cards independent heights */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px', alignItems: 'start' }}>
                <RTOAnalysis title="🚚 Top RTO Couriers" label="Courier" data={rtoAnalysis.couriers} showInTransit />
                <RTOAnalysis title="🏙️ Top RTO States" label="State" data={rtoAnalysis.states} />
                <RTOAnalysis title="🌆 Top RTO Cities" label="City" data={rtoAnalysis.cities} />
                <RTOAnalysis title="📮 Top RTO Pincodes" label="Pincode" data={rtoAnalysis.pincodes} />
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

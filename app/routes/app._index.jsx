import { useState, useMemo, useRef, useEffect, Suspense, lazy } from "react";
import { useLoaderData, Await } from "react-router";
import { authenticate } from "../shopify.server";
import { getIsConnectorNoTracking, filterOrders } from "../utils/orders";
import { fetchProducts, enhanceOrders, since30DaysISO, fetchAllOrdersPages } from "../utils/loader";
import { checkAuthenticatedRateLimit } from "../utils/rateLimiter";
import { SkeletonDashboard } from "../components/SkeletonDashboard";
import Filters from "../components/Filters";
import ConnectorStatusCard from "../components/ConnectorStatusCard";
import OrderBarChart from "../components/OrderBarChart";
import OrderHistoryChart from "../components/OrderHistoryChart";
import TrackingStatusHistory from "../components/TrackingStatusHistory";
import OrderCards from "../components/OrderCards";
import RevenueCards from "../components/RevenueCards";
// Lazy-load heavy below-the-fold components (~245KB total savings from initial bundle)
const ProductRTO = lazy(() => import("../components/ProductRTO"));
const RTOAnalysis = lazy(() => import("../components/RTOAnalysis"));
const IndiaHeatMap = lazy(() => import("../components/IndiaHeatMap"));
const ProductRevenue = lazy(() => import("../components/ProductRevenue"));

import {
  Page,
  BlockStack,
} from '@shopify/polaris';

// GraphQL query for the dashboard — includes pricing, discounts, connector fields.
// Defined at module level so it's not recreated on every request.
const DASHBOARD_ORDERS_QUERY = `#graphql
  query getOrdersWithTrackingForAnalytics($cursor: String, $query: String) {
    orders(first: 250, sortKey: CREATED_AT, reverse: true, after: $cursor, query: $query) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id name createdAt displayFulfillmentStatus
          totalPriceSet { shopMoney { amount } }
          sourceName tags
          shippingAddress { city province zip }
          lineItems(first: 10) {
            edges {
              node {
                title quantity
                originalUnitPriceSet { shopMoney { amount } }
                discountAllocations { allocatedAmountSet { shopMoney { amount } } }
                product { id productType }
              }
            }
          }
          fulfillments { id status displayStatus trackingInfo { number company } }
          customAttributes { key value }
          returnStatus
        }
      }
    }
  }`;

export const loader = async ({ request }) => {
  try {
    const { admin, session } = await authenticate.admin(request);
    const rateLimitRes = checkAuthenticatedRateLimit(request, session.shop);
    if (rateLimitRes) return rateLimitRes;

    const sinceISO = since30DaysISO();

    // Fetch products immediately (fast, cached), defer orders (slow, paginated)
    const storeProducts = await fetchProducts(admin, session.shop);

    // Deferred: orders load in background while the page shell renders immediately
    const ordersPromise = fetchAllOrdersPages(admin, DASHBOARD_ORDERS_QUERY, sinceISO, session.shop)
      .then(raw => enhanceOrders(raw));

    return { ordersPromise, storeProducts };
  } catch (err) {
    console.error('[app._index loader Exception]:', err?.stack || err?.message || err);
    return { ordersPromise: Promise.resolve([]), storeProducts: [] };
  }
};

export default function Index() {
  const { ordersPromise, storeProducts = [] } = useLoaderData() || {};
  const [activeOrderCardTitle, setActiveOrderCardTitle] = useState(null);
  const orderChartRef = useRef(null);
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const { exportDashboardToPPT } = await import("../utils/exportPPT");
      await exportDashboardToPPT();
    } catch (err) {
      console.error("[Index] Failed to export PPT:", err);
    } finally {
      setIsExporting(false);
    }
  };

  useEffect(() => {
    if (activeOrderCardTitle) {
      const timer = setTimeout(() => {
        orderChartRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [activeOrderCardTitle]);

  return (
      <div style={{ padding: "2rem" }}>
        <Page
          title="Dashboard"
          fullWidth
          primaryAction={{
            content: "Export to PPT",
            onAction: handleExport,
            loading: isExporting,
          }}
        >
          <BlockStack gap="400">
            <Suspense fallback={<SkeletonDashboard />}>
              <Await resolve={ordersPromise} errorElement={<div style={{ padding: '2rem', textAlign: 'center', color: '#d72c0d' }}>Failed to load order data. Please refresh.</div>}>
                {(orders) => (
                  <DashboardContent
                    orders={orders || []}
                    storeProducts={storeProducts}
                    activeOrderCardTitle={activeOrderCardTitle}
                    setActiveOrderCardTitle={setActiveOrderCardTitle}
                    orderChartRef={orderChartRef}
                  />
                )}
              </Await>
            </Suspense>
          </BlockStack>
        </Page>
      </div>
  );
}

/**
 * Inner component that receives resolved orders data.
 * Separated so all order-dependent useMemo hooks live inside the Await boundary.
 */
function DashboardContent({ orders, storeProducts, activeOrderCardTitle, setActiveOrderCardTitle, orderChartRef }) {
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
    return filterOrders(orders, {
      selectedDates,
      productFilter,
      deliveryStatusFilter,
      stateFilter,
      cityFilter,
      pincodeFilter,
      courierFilter,
      failedLabel: "Failed"
    });
  }, [orders, selectedDates, productFilter, deliveryStatusFilter, stateFilter, cityFilter, pincodeFilter, courierFilter]);

  // Compute Metrics
  const metrics = useMemo(() => {
    let unfulfilled = 0;
    let shipped = 0;
    let fulfilled = 0;
    let failed = 0;
    const connectorCounts = {};

    filteredOrders.forEach(order => {
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

    filteredOrders.forEach(order => {
      const isConnectorNoTracking = getIsConnectorNoTracking(order);
      if (isConnectorNoTracking) return;

      const orderDate = new Date(order.createdAt);
      const dateStr = `${String(orderDate.getDate()).padStart(2, '0')}/${String(orderDate.getMonth() + 1).padStart(2, '0')}/${String(orderDate.getFullYear()).slice(-2)}`;

      if (dataMap[dateStr]) {
        dataMap[dateStr]["Total Orders"]++;

        const status = (order.displayFulfillmentStatus || '').toLowerCase();
        if (status === 'fulfilled') {
          dataMap[dateStr]["Fulfilled"]++;
        } else {
          dataMap[dateStr]["Unfulfilled"]++;
        }

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
      if (isConnectorNoTracking) return;

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

  const pieTotal = useMemo(() => trackingStatusData.reduce((sum, item) => sum + item.value, 0), [trackingStatusData]);

  // ── RTO Analysis ──
  const rtoAnalysis = useMemo(() => {
    const groupBy = (keyFn) => {
      const map = {};
      filteredOrders.forEach(order => {
        const isConnectorNoTracking = getIsConnectorNoTracking(order);
        if (isConnectorNoTracking) return;

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

    const productMap = {};
    filteredOrders.forEach(order => {
      const isConnectorNoTracking = getIsConnectorNoTracking(order);
      const isConnector = !!order.connectorName;
      if (isConnectorNoTracking && isConnector) return;

      (order.lineItems?.edges || []).forEach(e => {
        const productTitle = e.node?.title;
        if (!productTitle) return;
        const matchesFilter = !productFilter || productFilter === "All Product Types" || productTitle.trim() === productFilter;
        if (!matchesFilter) return;
        const qty = e.node.quantity || 1;
        const status = order.orderDeliveryStatus;

        if (!productMap[productTitle]) {
          productMap[productTitle] = { delivered: 0, rto: 0, inTransit: 0, unfulfilled: 0, total: 0, expected: 0, revDelivered: 0, revInTransit: 0, revUnfulfilled: 0, revLost: 0 };
        }
        const p = productMap[productTitle];

        if (!isConnectorNoTracking) {
          p.total += qty;
          if (status === 'rto_failed') p.rto += qty;
          else if (status === 'delivered' || status === 'fulfilled') p.delivered += qty;
          else if (status === 'in_transit' || status === 'out_for_delivery') p.inTransit += qty;
          else p.unfulfilled += qty;
        }

        if (!isConnector) {
          const unitPrice = Number(e.node.originalUnitPriceSet?.shopMoney?.amount || 0);
          const discount = (e.node.discountAllocations || []).reduce((s, da) => s + Number(da.allocatedAmountSet?.shopMoney?.amount || 0), 0);
          const rev = qty * unitPrice - discount;
          p.expected += rev;
          if (status === 'delivered' || status === 'fulfilled') p.revDelivered += rev;
          else if (status === 'in_transit' || status === 'out_for_delivery') p.revInTransit += rev;
          else if (status === 'rto_failed') p.revLost += rev;
          else p.revUnfulfilled += rev;
        }
      });
    });

    const products = Object.entries(productMap).map(([name, d]) => {
      const totalSent = d.delivered + d.rto + d.inTransit;
      return { name, delivered: d.delivered, rto: d.rto, inTransit: d.inTransit, unfulfilled: d.unfulfilled, total: d.total, totalSent, rtoPct: totalSent > 0 ? +((d.rto / totalSent) * 100).toFixed(1) : 0 };
    }).sort((a, b) => b.total - a.total);

    const productRevenues = Object.entries(productMap).map(([name, d]) => ({
      name, expected: d.expected, delivered: d.revDelivered, inTransit: d.revInTransit, unfulfilled: d.revUnfulfilled, lost: d.revLost,
    })).filter(d => d.expected > 0).sort((a, b) => b.expected - a.expected);

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
    cardTitleOuter: { borderBottom: "1px dotted #9ca3af", display: "inline-block", alignSelf: "flex-start", paddingBottom: "6px", marginBottom: "20px" },
    cardTitle: { fontSize: "15px", fontWeight: "500", color: "#111827", margin: 0 },
    section: { backgroundColor: "#fff", borderRadius: "12px", padding: "24px", boxShadow: "0 2px 4px rgba(0,0,0,0.04)", border: "1px solid #f0f0f0" },
  };

  return (
    <>
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

      {/* ── Key Metrics & Revenue Overview ── */}
      <div id="dashboard-overview" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
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
      </div>

      {/* ── Order History Chart ── */}
      <div id="dashboard-history">
        <OrderHistoryChart chartData={chartData} />
      </div>

      {/* ── Tracking status & Connector Orders ── */}
      <div id="dashboard-tracking" style={styles.section}>
        <div style={{ display: 'flex', gap: '32px', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 380px', minWidth: '320px' }}>
            <TrackingStatusHistory trackingStatusData={trackingStatusData} pieTotal={pieTotal} />
          </div>
          <div style={{ width: '1px', backgroundColor: '#e5e7eb', flexShrink: 0 }} />
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

      {/* ── Lazy-loaded below-the-fold sections ── */}
      <Suspense fallback={<div style={{ padding: '20px', textAlign: 'center', color: '#9ca3af' }}>Loading analytics...</div>}>
        {/* ── Product RTO Card ── */}
        <div id="dashboard-product-rto" style={{ marginTop: '8px' }}>
          <div style={{ fontSize: '20px', fontWeight: '700', color: '#111827', marginBottom: '16px', letterSpacing: '-0.3px' }}>Product RTO</div>
          <ProductRTO data={rtoAnalysis.products} />
        </div>

        {/* ── Product Revenue Card ── */}
        <div id="dashboard-product-revenue" style={{ marginTop: '8px' }}>
          <div style={{ fontSize: '20px', fontWeight: '700', color: '#111827', marginBottom: '16px', letterSpacing: '-0.3px' }}>Product Revenue</div>
          <ProductRevenue data={rtoAnalysis.productRevenues} />
        </div>

        {/* ── RTO Analysis Cards ── */}
        <div id="dashboard-rto-breakdown" style={{ marginTop: '8px' }}>
          <div style={{ fontSize: '20px', fontWeight: '700', color: '#111827', marginBottom: '20px', letterSpacing: '-0.3px' }}>RTO Analysis</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px', alignItems: 'start' }}>
            <RTOAnalysis title="🚚 Top RTO Couriers" label="Courier" data={rtoAnalysis.couriers} showInTransit />
            <RTOAnalysis title="🏙️ Top RTO States" label="State" data={rtoAnalysis.states} />
            <RTOAnalysis title="🌆 Top RTO Cities" label="City" data={rtoAnalysis.cities} />
            <RTOAnalysis title="📮 Top RTO Pincodes" label="Pincode" data={rtoAnalysis.pincodes} />
          </div>
        </div>

        {/* ── India Heat Map ── */}
        <div id="dashboard-india-map">
          <IndiaHeatMap statesData={rtoAnalysis.states} />
        </div>
      </Suspense>
    </>
  );
}


import { useState, useMemo, useCallback, useEffect, Suspense } from "react";
import { useLoaderData, Await } from "react-router";
import { authenticate } from "../shopify.server";
import { getIsConnectorNoTracking, filterOrders, normalizeDeliveryStatus } from "../utils/orders";
import { fetchProducts, enhanceOrders, since30DaysISO, fetchAllOrdersPages } from "../utils/loader";
import { checkAuthenticatedRateLimit } from "../utils/rateLimiter";
import { SkeletonOrdersTable } from "../components/SkeletonDashboard";
import Filters from "../components/Filters";

import {
  Page,
  BlockStack,
  Button,
} from '@shopify/polaris';
import { ExportIcon } from '@shopify/polaris-icons';

// GraphQL query for the orders page — includes customer name, financial status, tracking URL.
const ORDERS_PAGE_QUERY = `#graphql
  query getOrdersWithTracking($cursor: String, $query: String) {
    orders(first: 250, sortKey: CREATED_AT, reverse: true, after: $cursor, query: $query) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id name createdAt
          customer { firstName lastName }
          displayFinancialStatus displayFulfillmentStatus
          totalPriceSet { shopMoney { amount currencyCode } }
          sourceName tags
          shippingAddress { city province zip }
          lineItems(first: 5) {
            edges { node { title quantity product { id productType } } }
          }
          fulfillments { id status displayStatus trackingInfo { number url company } }
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
    const storeProducts = await fetchProducts(admin, session.shop);

    const ordersPromise = fetchAllOrdersPages(admin, ORDERS_PAGE_QUERY, sinceISO, session.shop)
      .then(raw => enhanceOrders(raw));

    return { ordersPromise, storeProducts };
  } catch (err) {
    console.error('[app.orders loader Exception]:', err?.stack || err?.message || err);
    return { ordersPromise: Promise.resolve([]), storeProducts: [] };
  }
};

export default function Orders() {
  const { ordersPromise, storeProducts = [] } = useLoaderData() || {};

  return (
    <div style={{ padding: "2rem" }}>
      <Page title="Orders" fullWidth>
        <BlockStack gap="400">
          <Suspense fallback={<SkeletonOrdersTable />}>
            <Await resolve={ordersPromise} errorElement={<div style={{ padding: '2rem', textAlign: 'center', color: '#d72c0d' }}>Failed to load orders. Please refresh.</div>}>
              {(orders) => (
                <OrdersContent orders={orders || []} storeProducts={storeProducts} />
              )}
            </Await>
          </Suspense>
        </BlockStack>
      </Page>
    </div>
  );
}

function OrdersContent({ orders, storeProducts }) {
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

  const filteredOrders = useMemo(() => {
    return filterOrders(orders, {
      selectedDates,
      productFilter,
      deliveryStatusFilter,
      stateFilter,
      cityFilter,
      pincodeFilter,
      courierFilter,
      failedLabel: "RTO"
    });
  }, [orders, selectedDates, productFilter, deliveryStatusFilter, stateFilter, cityFilter, pincodeFilter, courierFilter]);

  const [page, setPage] = useState(0);
  const PAGE_SIZE = 100;

  // Reset page to 0 when filters change
  useEffect(() => {
    setPage(0);
  }, [selectedDates, productFilter, deliveryStatusFilter, stateFilter, cityFilter, pincodeFilter, courierFilter]);

  const totalPages = Math.ceil(filteredOrders.length / PAGE_SIZE);
  const activePage = Math.min(page, Math.max(0, totalPages - 1));

  const paginatedOrders = useMemo(() => {
    return filteredOrders.slice(activePage * PAGE_SIZE, (activePage + 1) * PAGE_SIZE);
  }, [filteredOrders, activePage]);

  const handleExportCSV = useCallback(() => {
    const headers = ['Order', 'Order Date', 'Customer', 'Items', 'Tracking Status', 'Fulfillment Status', 'Amount (Rs.)', 'Payment Status', 'State', 'City', 'Pincode'];
    const rows = filteredOrders.map(order => {
      const customerName = order.customer ? `${order.customer.firstName || ''} ${order.customer.lastName || ''}`.trim() || 'No Customer' : 'No Customer';
      const items = order.lineItems?.edges?.map(e => `${e.node.title} x${e.node.quantity}`).join(' | ') || '';
      let trackingStatus = 'N/A';
      const isConnectorNoTracking = getIsConnectorNoTracking(order);
      if (isConnectorNoTracking) {
        trackingStatus = `Dispatched by ${order.connectorName}`;
      } else if (order.fulfillments && order.fulfillments.length > 0) {
        const f = order.fulfillments[0];
        if (f.trackingInfo && f.trackingInfo.length > 0) {
          trackingStatus = f.trackingInfo[0].courierDeliveryStatus || 'in_transit';
        } else {
          trackingStatus = normalizeDeliveryStatus(f.displayStatus || f.status);
        }
      }
      
      let displayTracking = trackingStatus;
      if (trackingStatus === 'rto_failed') displayTracking = 'RTO';
      else if (trackingStatus === 'in_transit') displayTracking = 'In Transit';
      else if (trackingStatus === 'out_for_delivery') displayTracking = 'Out for Delivery';
      else if (trackingStatus === 'delivered') displayTracking = 'Delivered';
      else if (trackingStatus.startsWith('dispatched_by_')) {
        displayTracking = `Dispatched by ${trackingStatus.replace('dispatched_by_', '').toUpperCase()}`;
      }

      const orderDate = new Date(order.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      const escape = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;
      return [escape(order.name), escape(orderDate), escape(customerName), escape(items), escape(displayTracking), escape(order.displayFulfillmentStatus || 'UNFULFILLED'), escape(order.totalPriceSet?.shopMoney?.amount || '0.00'), escape(order.displayFinancialStatus || 'N/A'), escape(order.shippingState || ''), escape(order.shippingCity || ''), escape(order.shippingPincode || '')].join(',');
    });
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.setAttribute('download', `orders_export_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [filteredOrders]);

  const getStatusBadge = (status) => {
    let bgColor = "#f3f4f6", textColor = "#374151";
    let text = status.replace(/_/g, " ");
    if (status === "delivered") { bgColor = "#dcfce7"; textColor = "#166534"; }
    else if (status === "in_transit") { bgColor = "#dbeafe"; textColor = "#1e40af"; }
    else if (status === "out_for_delivery") { bgColor = "#fef08a"; textColor = "#854d0e"; }
    else if (status === "rto_failed") { bgColor = "#fee2e2"; textColor = "#991b1b"; text = "RTO"; }
    else if (status.startsWith("dispatched_by_")) { bgColor = "#e0f2fe"; textColor = "#0369a1"; text = `Dispatched by ${status.replace("dispatched_by_", "").toUpperCase()}`; }
    return <span style={{ backgroundColor: bgColor, color: textColor, padding: "4px 12px", borderRadius: "16px", fontSize: "12px", fontWeight: "600", whiteSpace: "nowrap" }}>{text}</span>;
  };

  const getFulfillmentBadge = (status) => {
    const s = (status || "").toLowerCase();
    const isFulfilled = s === "fulfilled";
    return <span style={{ backgroundColor: isFulfilled ? "#dcfce7" : "#fef08a", color: isFulfilled ? "#166534" : "#854d0e", padding: "4px 12px", borderRadius: "16px", fontSize: "12px", fontWeight: "600", whiteSpace: "nowrap" }}>{status || "UNFULFILLED"}</span>;
  };

  const getPaymentBadge = (status) => {
    const s = (status || "").toLowerCase();
    const isPaid = s === "paid";
    return <span style={{ backgroundColor: isPaid ? "#dcfce7" : "#dbeafe", color: isPaid ? "#166534" : "#1e40af", padding: "4px 12px", borderRadius: "16px", fontSize: "12px", fontWeight: "600", whiteSpace: "nowrap" }}>{status || "N/A"}</span>;
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
        <Button icon={ExportIcon} variant="primary" onClick={handleExportCSV} disabled={filteredOrders.length === 0}>Export CSV ({filteredOrders.length})</Button>
      </div>
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
        variant="orders"
      />

      <div style={{ backgroundColor: "#fff", borderRadius: "8px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", overflow: "hidden", marginTop: "16px" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: "1280px", borderCollapse: "collapse", textAlign: "left", tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "100px" }} />
              <col style={{ width: "120px" }} />
              <col style={{ width: "150px" }} />
              <col style={{ width: "250px" }} />
              <col style={{ width: "190px" }} />
              <col style={{ width: "120px" }} />
              <col style={{ width: "130px" }} />
              <col style={{ width: "110px" }} />
              <col style={{ width: "120px" }} />
              <col style={{ width: "90px" }} />
            </colgroup>
            <thead style={{ backgroundColor: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
              <tr>
                <th style={{ padding: "16px", fontSize: "14px", fontWeight: "600", color: "#374151" }}>Order</th>
                <th style={{ padding: "16px", fontSize: "14px", fontWeight: "600", color: "#374151" }}>Order Date</th>
                <th style={{ padding: "16px", fontSize: "14px", fontWeight: "600", color: "#374151" }}>Customer</th>
                <th style={{ padding: "16px", fontSize: "14px", fontWeight: "600", color: "#374151" }}>Item</th>
                <th style={{ padding: "16px", fontSize: "14px", fontWeight: "600", color: "#374151" }}>Tracking Status</th>
                <th style={{ padding: "16px", fontSize: "14px", fontWeight: "600", color: "#374151" }}>Fulfillment</th>
                <th style={{ padding: "16px", fontSize: "14px", fontWeight: "600", color: "#374151", textAlign: "center" }}>Payment ( Rs. )</th>
                <th style={{ padding: "16px", fontSize: "14px", fontWeight: "600", color: "#374151" }}>State</th>
                <th style={{ padding: "16px", fontSize: "14px", fontWeight: "600", color: "#374151" }}>City</th>
                <th style={{ padding: "16px", fontSize: "14px", fontWeight: "600", color: "#374151" }}>Pincode</th>
              </tr>
            </thead>
            <tbody>
              {paginatedOrders.length === 0 ? (
                <tr><td colSpan="10" style={{ padding: "24px", textAlign: "center", color: "#6b7280" }}>No orders found matching filters</td></tr>
              ) : (
                paginatedOrders.map((order, index) => {
                  const customerName = order.customer
                    ? `${order.customer.firstName || ""} ${order.customer.lastName || ""}`.trim() || "No Customer"
                    : "No Customer";

                  let trackingStatus = "N/A";
                  const isConnectorNoTracking = getIsConnectorNoTracking(order);
                  if (isConnectorNoTracking) {
                    trackingStatus = `dispatched_by_${order.connectorName.toLowerCase()}`;
                  } else if (order.fulfillments && order.fulfillments.length > 0) {
                    const f = order.fulfillments[0];
                    if (f.trackingInfo && f.trackingInfo.length > 0) {
                      trackingStatus = f.trackingInfo[0].courierDeliveryStatus || "in_transit";
                    } else {
                      trackingStatus = normalizeDeliveryStatus(f.displayStatus || f.status);
                    }
                  }

                  const orderDate = new Date(order.createdAt).toLocaleDateString('en-GB', {
                    day: 'numeric', month: 'short', year: 'numeric',
                  });

                  return (
                    <tr key={order.id} style={{ borderBottom: "1px solid #f3f4f6", backgroundColor: index % 2 === 0 ? "#ffffff" : "#f9fafb" }}>
                      <td style={{ padding: "16px", fontSize: "14px", color: "#111827", fontWeight: "500", whiteSpace: "nowrap" }}>{order.name}</td>
                      <td style={{ padding: "16px", fontSize: "14px", color: "#4b5563", whiteSpace: "nowrap" }}>{orderDate}</td>
                      <td style={{ padding: "16px", fontSize: "14px", color: "#4b5563" }}>{customerName}</td>
                      <td style={{ padding: "16px", fontSize: "13px", color: "#4b5563" }}>
                        {order.lineItems?.edges?.map((edge, idx) => (
                          <div key={idx} style={{ marginBottom: "4px" }}>
                            {edge.node.title} <strong>x {edge.node.quantity}</strong>
                          </div>
                        ))}
                      </td>
                      <td style={{ padding: "16px" }}>{trackingStatus !== "N/A" ? getStatusBadge(trackingStatus) : <span style={{ color: "#9ca3af", fontSize: "14px" }}>-</span>}</td>
                      <td style={{ padding: "16px" }}>{getFulfillmentBadge(order.displayFulfillmentStatus)}</td>
                      <td style={{ padding: "16px", textAlign: "center" }}>
                        <div style={{ marginBottom: "6px", fontSize: "14px", fontWeight: "500", color: "#111827" }}>
                          {order.totalPriceSet?.shopMoney?.amount || '0.00'}
                        </div>
                        {getPaymentBadge(order.displayFinancialStatus)}
                      </td>
                      <td style={{ padding: "16px", fontSize: "14px", color: "#4b5563" }}>{order.shippingState || '-'}</td>
                      <td style={{ padding: "16px", fontSize: "14px", color: "#4b5563" }}>{order.shippingCity || '-'}</td>
                      <td style={{ padding: "16px", fontSize: "14px", color: "#4b5563" }}>{order.shippingPincode || '-'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination footer */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderTop: '1px solid #f3f4f6', backgroundColor: '#fafafa' }}>
            <span style={{ fontSize: '13px', color: '#6b7280' }}>
              Showing {activePage * PAGE_SIZE + 1}–{Math.min((activePage + 1) * PAGE_SIZE, filteredOrders.length)} of {filteredOrders.length} orders
            </span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={activePage === 0}
                style={{ fontSize: '13px', fontWeight: '600', padding: '6px 12px', borderRadius: '6px', border: '1px solid #e5e7eb', background: activePage === 0 ? '#f9fafb' : '#fff', color: activePage === 0 ? '#9ca3af' : '#374151', cursor: activePage === 0 ? 'default' : 'pointer', transition: 'all 0.15s' }}>
                ← Prev
              </button>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={activePage >= totalPages - 1}
                style={{ fontSize: '13px', fontWeight: '600', padding: '6px 12px', borderRadius: '6px', border: '1px solid #e5e7eb', background: activePage >= totalPages - 1 ? '#f9fafb' : '#fff', color: activePage >= totalPages - 1 ? '#9ca3af' : '#374151', cursor: activePage >= totalPages - 1 ? 'default' : 'pointer', transition: 'all 0.15s' }}>
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

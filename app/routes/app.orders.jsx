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

function normalizeDeliveryStatus(fulfillmentStatus) {
  const statusLower = (fulfillmentStatus || '').toLowerCase();
  
  // Explicitly catch failure states first
  if (statusLower.includes('rto') || statusLower.includes('return') || statusLower.includes('fail') || statusLower.includes('error') || statusLower.includes('canceled') || statusLower.includes('not_delivered')) {
    return 'RTO';
  } else if (statusLower === 'delivered') { // Explicit tracking 'delivered' status
    return 'delivered';
  } else if (statusLower.includes('out') && statusLower.includes('delivery')) {
    return 'out_for_delivery';
  }
  
  return 'in_transit'; // Covers 'fulfilled', 'in_transit', 'pending', etc.
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;



  const response = await admin.graphql(`
    #graphql
    query getOrdersWithTracking {
      orders(first: 250, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            name
            createdAt
            customer {
              firstName
              lastName
            }
            displayFinancialStatus
            displayFulfillmentStatus
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
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
                url
                company
              }
            }
          }
        }
      }
    }
  `);

  const responseJson = await response.json();
  let rawOrders = responseJson.data.orders.edges.map((edge) => edge.node);



  const enhancedOrders = rawOrders.map((order) => {
    let orderDeliveryStatus = 'unknown';

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
      return { ...order, fulfillments: enrichedFulfillments, orderDeliveryStatus };
    }
    return { ...order, orderDeliveryStatus };
  });



  return enhancedOrders;
};

export default function Orders() {
  const orders = useLoaderData();

  const [datePopoverActive, setDatePopoverActive] = useState(false);
  const toggleDatePopover = useCallback(() => setDatePopoverActive((active) => !active), []);

  const [selectedDates, setSelectedDates] = useState({
    start: new Date(new Date().setDate(new Date().getDate() - 30)),
    end: new Date(),
  });

  const [{ month, year }, setDate] = useState({
    month: selectedDates.end.getMonth(),
    year: selectedDates.end.getFullYear(),
  });

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

  const [productPopoverActive, setProductPopoverActive] = useState(false);
  const toggleProductPopover = useCallback(() => setProductPopoverActive((active) => !active), []);
  const [productFilter, setProductFilter] = useState("All Product Types");

  const [deliveryStatusPopoverActive, setDeliveryStatusPopoverActive] = useState(false);
  const toggleDeliveryStatusPopover = useCallback(() => setDeliveryStatusPopoverActive((active) => !active), []);
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState("All Statuses");

  const uniqueProducts = useMemo(() => {
    const titles = new Set();
    orders.forEach(order => {
      order.lineItems?.edges?.forEach(item => {
        const title = item.node.title;
        if (title && title.trim() !== '') {
          titles.add(title.trim());
        }
      });
    });
    return Array.from(titles).sort();
  }, [orders]);

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
        const orderStatus = order.orderDeliveryStatus;
        let statusMatches = false;
        if (deliveryStatusFilter === "Delivered") {
          statusMatches = (orderStatus === 'delivered' || orderStatus === 'fulfilled');
        } else if (deliveryStatusFilter === "In-Transit") {
          statusMatches = (orderStatus === 'in_transit' || orderStatus === 'out_for_delivery');
        } else if (deliveryStatusFilter === "Failed") {
          statusMatches = (orderStatus === 'RTO' || orderStatus === 'rto_failed');
        }
        if (!statusMatches) return false;
      }

      return true;
    });
  }, [orders, selectedDates, productFilter, deliveryStatusFilter]);

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

  const deliveryStatusOptions = [
    { content: "All Statuses", onAction: () => { setDeliveryStatusFilter("All Statuses"); toggleDeliveryStatusPopover(); } },
    { content: "In-Transit", onAction: () => { setDeliveryStatusFilter("In-Transit"); toggleDeliveryStatusPopover(); } },
    { content: "Delivered", onAction: () => { setDeliveryStatusFilter("Delivered"); toggleDeliveryStatusPopover(); } },
    { content: "Failed", onAction: () => { setDeliveryStatusFilter("Failed"); toggleDeliveryStatusPopover(); } }
  ];

  const getStatusBadge = (status) => {
    let bgColor = "#f3f4f6";
    let textColor = "#374151";
    
    if (status === "delivered") { bgColor = "#dcfce7"; textColor = "#166534"; }
    else if (status === "in_transit") { bgColor = "#dbeafe"; textColor = "#1e40af"; }
    else if (status === "out_for_delivery") { bgColor = "#fef08a"; textColor = "#854d0e"; }
    else if (status === "RTO" || status === "failed" || status === "rto_failed") { bgColor = "#fee2e2"; textColor = "#991b1b"; }

    return (
      <span style={{ backgroundColor: bgColor, color: textColor, padding: "4px 12px", borderRadius: "16px", fontSize: "12px", fontWeight: "600", textTransform: "capitalize", whiteSpace: "nowrap" }}>
        {status.replace(/_/g, " ")}
      </span>
    );
  };

  const getFulfillmentBadge = (status) => {
    let bgColor = "#fef08a"; // yellow for unfulfilled
    let textColor = "#854d0e";
    const s = (status || "").toLowerCase();
    if (s === "fulfilled") { bgColor = "#dcfce7"; textColor = "#166534"; } // green for fulfilled
    
    return (
      <span style={{ backgroundColor: bgColor, color: textColor, padding: "4px 12px", borderRadius: "16px", fontSize: "12px", fontWeight: "600", whiteSpace: "nowrap" }}>
        {status || "UNFULFILLED"}
      </span>
    );
  };

  const getPaymentBadge = (status) => {
    let bgColor = "#dbeafe";
    let textColor = "#1e40af";
    const s = (status || "").toLowerCase();
    if (s === "paid") { bgColor = "#dcfce7"; textColor = "#166534"; }
    
    return (
      <span style={{ backgroundColor: bgColor, color: textColor, padding: "4px 12px", borderRadius: "16px", fontSize: "12px", fontWeight: "600", whiteSpace: "nowrap" }}>
        {status || "N/A"}
      </span>
    );
  };

  return (
    <AppProvider i18n={enTranslations}>
      <div style={{ padding: "2rem" }}>
        <Page title="Orders" fullWidth>
          <BlockStack gap="400">
            <InlineStack gap="400" blockAlign="center" wrap={false}>
              <Popover active={datePopoverActive} activator={dateButton} autofocusTarget="none" onClose={toggleDatePopover} fluidContent>
                <Box padding="400" width="650px">
                  <BlockStack gap="400">
                    <div style={{ marginBottom: "4px" }}>
                      <Select options={presetOptions} value={presetFilter} onChange={handlePresetChange} label="Date range" />
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
                    <DatePicker month={month} year={year} onChange={handleDateSelection} onMonthChange={(month, year) => setDate({ month, year })} selected={selectedDates} multiMonth allowRange />
                    <Divider />
                    <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '4px' }}>
                      <Button onClick={toggleDatePopover}>Cancel</Button>
                      <Button onClick={toggleDatePopover} variant="primary" tone="success">Apply</Button>
                    </div>
                  </BlockStack>
                </Box>
              </Popover>

              <Text as="span" tone="subdued">Compared to {formatDateForComparison(selectedDates.start, selectedDates.end)}</Text>

              <Popover active={productPopoverActive} activator={productActivator} onClose={toggleProductPopover}>
                <div style={{ minWidth: "200px" }}><ActionList items={productOptions} /></div>
              </Popover>

              <Popover active={deliveryStatusPopoverActive} activator={deliveryStatusActivator} onClose={toggleDeliveryStatusPopover}>
                <div style={{ minWidth: "150px" }}><ActionList items={deliveryStatusOptions} /></div>
              </Popover>
            </InlineStack>

            <div style={{ backgroundColor: "#fff", borderRadius: "8px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", overflow: "hidden", marginTop: "16px" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                  <thead style={{ backgroundColor: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                    <tr>
                      <th style={{ padding: "16px", fontSize: "14px", fontWeight: "600", color: "#374151" }}>Order Name</th>
                      <th style={{ padding: "16px", fontSize: "14px", fontWeight: "600", color: "#374151" }}>Customer</th>
                      <th style={{ padding: "16px", fontSize: "14px", fontWeight: "600", color: "#374151" }}>Item</th>
                      <th style={{ padding: "16px", fontSize: "14px", fontWeight: "600", color: "#374151" }}>Tracking Status</th>
                      <th style={{ padding: "16px", fontSize: "14px", fontWeight: "600", color: "#374151" }}>Fulfillment</th>
                      <th style={{ padding: "16px", fontSize: "14px", fontWeight: "600", color: "#374151" }}>Payment ( Rs. )</th>
                      <th style={{ padding: "16px", fontSize: "14px", fontWeight: "600", color: "#374151" }}>Order Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.length === 0 ? (
                      <tr><td colSpan="7" style={{ padding: "24px", textAlign: "center", color: "#6b7280" }}>No orders found matching filters</td></tr>
                    ) : (
                      filteredOrders.map((order, index) => {
                        const customerName = order.customer ? `${order.customer.firstName || ""} ${order.customer.lastName || ""}`.trim() || "No Customer" : "No Customer";
                        
                        let trackingStatus = "N/A";
                        if (order.fulfillments && order.fulfillments.length > 0) {
                          const f = order.fulfillments[0];
                          if (f.trackingInfo && f.trackingInfo.length > 0) {
                            trackingStatus = f.trackingInfo[0].courierDeliveryStatus || "in_transit";
                          } else {
                            trackingStatus = normalizeDeliveryStatus(f.displayStatus || f.status);
                          }
                        }

                        return (
                          <tr key={order.id} style={{ borderBottom: "1px solid #f3f4f6", backgroundColor: index % 2 === 0 ? "#ffffff" : "#f9fafb" }}>
                            <td style={{ padding: "16px", fontSize: "14px", color: "#111827", fontWeight: "500", whiteSpace: "nowrap" }}>{order.name}</td>
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
                            <td style={{ padding: "16px" }}>
                              <div style={{ marginBottom: "6px", fontSize: "14px", fontWeight: "500", color: "#111827" }}>
                                {order.totalPriceSet?.shopMoney?.amount || '0.00'}
                              </div>
                              {getPaymentBadge(order.displayFinancialStatus)}
                            </td>
                            <td style={{ padding: "16px", fontSize: "14px", color: "#4b5563", whiteSpace: "nowrap" }}>{new Date(order.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute:'2-digit' })}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </BlockStack>
        </Page>
      </div>
    </AppProvider>
  );
}

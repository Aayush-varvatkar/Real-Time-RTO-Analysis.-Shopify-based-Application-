import { useState, useMemo, useCallback } from "react";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { normalizeDeliveryStatus, getThirdPartyConnectorName } from "../utils/orders";

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
import { CalendarIcon, FilterIcon, ExportIcon } from '@shopify/polaris-icons';
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
      query getOrdersWithTracking($cursor: String) {
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
                  url
                  company
                }
              }
            }
          }
        }
      }`,
      { variables: { cursor } }
    );

    const json = await response.json();

    // Guard: if Shopify returns errors (e.g. missing scope), stop and return what we have
    if (!json.data || !json.data.orders) {
      console.error('[Orders] Orders query error:', JSON.stringify(json.errors || json));
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
      return { ...order, fulfillments: enrichedFulfillments, orderDeliveryStatus, shippingCity, shippingState, shippingPincode, connectorName };
    }
    return { ...order, orderDeliveryStatus, shippingCity, shippingState, shippingPincode, connectorName };
  });

  return { orders: enhancedOrders, storeProducts };
};

export default function Orders() {
  const { orders, storeProducts } = useLoaderData();

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

  const [productPopoverActive, setProductPopoverActive] = useState(false);
  const toggleProductPopover = useCallback(() => setProductPopoverActive((active) => !active), []);
  const [productFilter, setProductFilter] = useState("All Product Types");

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

  // Courier Filter State
  const [courierPopoverActive, setCourierPopoverActive] = useState(false);
  const toggleCourierPopover = useCallback(() => setCourierPopoverActive((a) => !a), []);
  const [courierFilter, setCourierFilter] = useState("All Couriers");

  // Use store products directly (from loader) — only real catalog products appear here
  const uniqueProducts = useMemo(() => storeProducts, [storeProducts]);

  // Unique states, cities, pincodes (cascading)
  const uniqueStates = useMemo(() => {
    const vals = new Set();
    orders.forEach(o => { if (o.shippingState) vals.add(o.shippingState); });
    return Array.from(vals).sort();
  }, [orders]);

  const uniqueCities = useMemo(() => {
    const vals = new Set();
    orders.forEach(o => {
      if (stateFilter === "All States" || o.shippingState === stateFilter) {
        if (o.shippingCity) vals.add(o.shippingCity);
      }
    });
    return Array.from(vals).sort();
  }, [orders, stateFilter]);

  const uniquePincodes = useMemo(() => {
    const vals = new Set();
    orders.forEach(o => {
      const stateMatch = stateFilter === "All States" || o.shippingState === stateFilter;
      const cityMatch = cityFilter === "All Cities" || o.shippingCity === cityFilter;
      if (stateMatch && cityMatch && o.shippingPincode) vals.add(o.shippingPincode);
    });
    return Array.from(vals).sort();
  }, [orders, stateFilter, cityFilter]);

  // Extract unique couriers from ALL orders (from fulfillment tracking info)
  const uniqueCouriers = useMemo(() => {
    const vals = new Set();
    orders.forEach(o => {
      const company = o.fulfillments?.[0]?.trackingInfo?.[0]?.company;
      if (company && company.trim()) vals.add(company.trim());
    });
    return Array.from(vals).sort();
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
          const isConnectorNoTracking = order.connectorName && (orderStatus !== 'delivered' && orderStatus !== 'fulfilled' && orderStatus !== 'rto_failed');
          statusMatches = !isConnectorNoTracking && (orderStatus === 'in_transit' || orderStatus === 'out_for_delivery');
        } else if (deliveryStatusFilter === "Failed") {
          statusMatches = (orderStatus === 'rto_failed');
        } else if (deliveryStatusFilter.startsWith("Dispatched by ")) {
          const connName = deliveryStatusFilter.replace("Dispatched by ", "");
          const isConnectorNoTracking = order.connectorName === connName && (orderStatus !== 'delivered' && orderStatus !== 'fulfilled' && orderStatus !== 'rto_failed');
          statusMatches = isConnectorNoTracking;
        }
        if (!statusMatches) return false;
      }

      if (stateFilter !== "All States" && order.shippingState !== stateFilter) return false;
      if (cityFilter !== "All Cities" && order.shippingCity !== cityFilter) return false;
      if (pincodeFilter !== "All Pincodes" && order.shippingPincode !== pincodeFilter) return false;
      if (courierFilter !== "All Couriers" && order.fulfillments?.[0]?.trackingInfo?.[0]?.company?.trim() !== courierFilter) return false;

      return true;
    });
  }, [orders, selectedDates, productFilter, deliveryStatusFilter, stateFilter, cityFilter, pincodeFilter, courierFilter]);

  const handleExportCSV = useCallback(() => {
    const headers = ['Order', 'Order Date', 'Customer', 'Items', 'Tracking Status', 'Fulfillment Status', 'Amount (Rs.)', 'Payment Status', 'State', 'City', 'Pincode'];
    const rows = filteredOrders.map(order => {
      const customerName = order.customer ? `${order.customer.firstName || ''} ${order.customer.lastName || ''}`.trim() || 'No Customer' : 'No Customer';
      const items = order.lineItems?.edges?.map(e => `${e.node.title} x${e.node.quantity}`).join(' | ') || '';
      let trackingStatus = 'N/A';
      const isConnectorNoTracking = order.connectorName && (order.orderDeliveryStatus !== 'delivered' && order.orderDeliveryStatus !== 'fulfilled' && order.orderDeliveryStatus !== 'rto_failed');
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
      const orderDate = new Date(order.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      const escape = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;
      return [escape(order.name), escape(orderDate), escape(customerName), escape(items), escape(trackingStatus), escape(order.displayFulfillmentStatus || 'UNFULFILLED'), escape(order.totalPriceSet?.shopMoney?.amount || '0.00'), escape(order.displayFinancialStatus || 'N/A'), escape(order.shippingState || ''), escape(order.shippingCity || ''), escape(order.shippingPincode || '')].join(',');
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

  const handleDateSelection = useCallback((value) => { setSelectedDates(value); setPresetFilter('custom'); }, []);
  const formatDateForComparison = (start, end) => `${start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} - ${end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const formatDateForInput = (date) => `${date.getDate()}-${date.getMonth() + 1}-${date.getFullYear()}`;
  
  const productOptions = [{ content: "All Product Types", onAction: () => { setProductFilter("All Product Types"); toggleProductPopover(); } }, ...uniqueProducts.map(fp => ({ content: fp, onAction: () => { setProductFilter(fp); toggleProductPopover(); } }))];
  
  const uniqueConnectors = useMemo(() => {
    const names = new Set();
    orders?.forEach(o => {
      const name = getThirdPartyConnectorName(o);
      if (name) names.add(name);
    });
    return Array.from(names).sort();
  }, [orders]);

  const deliveryStatusOptions = useMemo(() => {
    const options = [{ content: "All Statuses", onAction: () => { setDeliveryStatusFilter("All Statuses"); toggleDeliveryStatusPopover(); } }, { content: "In-Transit", onAction: () => { setDeliveryStatusFilter("In-Transit"); toggleDeliveryStatusPopover(); } }, { content: "Delivered", onAction: () => { setDeliveryStatusFilter("Delivered"); toggleDeliveryStatusPopover(); } }, { content: "Failed", onAction: () => { setDeliveryStatusFilter("Failed"); toggleDeliveryStatusPopover(); } }];
    uniqueConnectors.forEach(conn => options.push({ content: `Dispatched by ${conn}`, onAction: () => { setDeliveryStatusFilter(`Dispatched by ${conn}`); toggleDeliveryStatusPopover(); } }));
    return options;
  }, [uniqueConnectors]);

  const stateOptions = [{ content: "All States", onAction: () => { setStateFilter("All States"); setCityFilter("All Cities"); setPincodeFilter("All Pincodes"); toggleStatePopover(); } }, ...uniqueStates.map(s => ({ content: s, onAction: () => { setStateFilter(s); setCityFilter("All Cities"); setPincodeFilter("All Pincodes"); toggleStatePopover(); } }))];
  const cityOptions = [{ content: "All Cities", onAction: () => { setCityFilter("All Cities"); setPincodeFilter("All Pincodes"); toggleCityPopover(); } }, ...uniqueCities.map(c => ({ content: c, onAction: () => { setCityFilter(c); setPincodeFilter("All Pincodes"); toggleCityPopover(); } }))];
  const pincodeOptions = [{ content: "All Pincodes", onAction: () => { setPincodeFilter("All Pincodes"); togglePincodePopover(); } }, ...uniquePincodes.map(p => ({ content: p, onAction: () => { setPincodeFilter(p); togglePincodePopover(); } }))];
  const courierOptions = [{ content: "All Couriers", onAction: () => { setCourierFilter("All Couriers"); toggleCourierPopover(); } }, ...uniqueCouriers.map(c => ({ content: c, onAction: () => { setCourierFilter(c); toggleCourierPopover(); } }))];

  const getStatusBadge = (status) => {
    let bgColor = "#f3f4f6", textColor = "#374151";
    if (status === "delivered") { bgColor = "#dcfce7"; textColor = "#166534"; }
    else if (status === "in_transit") { bgColor = "#dbeafe"; textColor = "#1e40af"; }
    else if (status === "out_for_delivery") { bgColor = "#fef08a"; textColor = "#854d0e"; }
    else if (status === "rto_failed") { bgColor = "#fee2e2"; textColor = "#991b1b"; }
    else if (status.startsWith("dispatched_by_")) { bgColor = "#e0f2fe"; textColor = "#0369a1"; }
    return <span style={{ backgroundColor: bgColor, color: textColor, padding: "4px 12px", borderRadius: "16px", fontSize: "12px", fontWeight: "600", whiteSpace: "nowrap" }}>{status.startsWith("dispatched_by_") ? `Dispatched by ${status.replace("dispatched_by_", "").toUpperCase()}` : status.replace(/_/g, " ")}</span>;
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
    <AppProvider i18n={enTranslations}>
      <div style={{ padding: "2rem" }}>
        <Page title="Orders" fullWidth primaryAction={<Button icon={ExportIcon} variant="primary" onClick={handleExportCSV} disabled={filteredOrders.length === 0}>Export CSV ({filteredOrders.length})</Button>}>
          <BlockStack gap="400">
            <InlineStack gap="400" blockAlign="center" wrap={false}>
              <Popover active={datePopoverActive} activator={<Button onClick={toggleDatePopover} icon={CalendarIcon}>{presetOptions.find(o => o.value === presetFilter)?.label || 'Custom'}</Button>} autofocusTarget="none" onClose={toggleDatePopover} fluidContent>
                <Box padding="400" width="650px">
                  <BlockStack gap="400">
                    <Select options={presetOptions} value={presetFilter} onChange={handlePresetChange} label="Date range" />
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <div style={{ flex: 1 }}><div style={{ fontSize: '13px', fontWeight: '500', marginBottom: '6px' }}>Starting</div><div style={{ border: '1px solid #c9cccf', borderRadius: '8px', padding: '8px 12px' }}>{formatDateForInput(selectedDates.start)}</div></div>
                      <div style={{ flex: 1 }}><div style={{ fontSize: '13px', fontWeight: '500', marginBottom: '6px' }}>Ending</div><div style={{ border: '1px solid #c9cccf', borderRadius: '8px', padding: '8px 12px' }}>{formatDateForInput(selectedDates.end)}</div></div>
                    </div>
                    <DatePicker month={month} year={year} onChange={handleDateSelection} onMonthChange={(month, year) => setDate({ month, year })} selected={selectedDates} multiMonth allowRange />
                    <Divider />
                    <Button onClick={toggleDatePopover} variant="primary" tone="success">Apply</Button>
                  </BlockStack>
                </Box>
              </Popover>
              <Text as="span" tone="subdued">Compared to {formatDateForComparison(selectedDates.start, selectedDates.end)}</Text>
              <Popover active={productPopoverActive} activator={<Button onClick={toggleProductPopover} icon={FilterIcon}>{productFilter}</Button>} onClose={toggleProductPopover}><div style={{ minWidth: "200px" }}><ActionList items={productOptions} /></div></Popover>
              <Popover active={deliveryStatusPopoverActive} activator={<Button onClick={toggleDeliveryStatusPopover} icon={FilterIcon}>{deliveryStatusFilter}</Button>} onClose={toggleDeliveryStatusPopover}><div style={{ minWidth: "150px" }}><ActionList items={deliveryStatusOptions} /></div></Popover>
              <Popover active={statePopoverActive} activator={<Button onClick={toggleStatePopover} icon={FilterIcon}>{stateFilter}</Button>} onClose={toggleStatePopover}><div style={{ minWidth: "180px", maxHeight: "260px", overflowY: "auto" }}><ActionList items={stateOptions} /></div></Popover>
              <Popover active={cityPopoverActive} activator={<Button onClick={toggleCityPopover} icon={FilterIcon}>{cityFilter}</Button>} onClose={toggleCityPopover}><div style={{ minWidth: "180px", maxHeight: "260px", overflowY: "auto" }}><ActionList items={cityOptions} /></div></Popover>
              <Popover active={pincodePopoverActive} activator={<Button onClick={togglePincodePopover} icon={FilterIcon}>{pincodeFilter}</Button>} onClose={togglePincodePopover}><div style={{ minWidth: "160px", maxHeight: "260px", overflowY: "auto" }}><ActionList items={pincodeOptions} /></div></Popover>
              <Popover active={courierPopoverActive} activator={<Button onClick={toggleCourierPopover} icon={FilterIcon}>{courierFilter}</Button>} onClose={toggleCourierPopover}><div style={{ minWidth: "180px", maxHeight: "260px", overflowY: "auto" }}><ActionList items={courierOptions} /></div></Popover>
            </InlineStack>

            <div style={{ backgroundColor: "#fff", borderRadius: "8px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", overflow: "hidden", marginTop: "16px" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", tableLayout: "fixed" }}>
                  <colgroup>
                    <col style={{ width: "100px" }} />
                    <col style={{ width: "110px" }} />
                    <col style={{ width: "150px" }} />
                    <col style={{ width: "260px" }} />
                    <col style={{ width: "130px" }} />
                    <col style={{ width: "120px" }} />
                    <col style={{ width: "150px" }} />
                    <col style={{ width: "110px" }} />
                    <col style={{ width: "150px" }} />
                    <col style={{ width: "100px" }} />
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
                    {filteredOrders.length === 0 ? (
                      <tr><td colSpan="10" style={{ padding: "24px", textAlign: "center", color: "#6b7280" }}>No orders found matching filters</td></tr>
                    ) : (
                      filteredOrders.map((order, index) => {
                        const customerName = order.customer
                          ? `${order.customer.firstName || ""} ${order.customer.lastName || ""}`.trim() || "No Customer"
                          : "No Customer";

                        let trackingStatus = "N/A";
                        const isConnectorNoTracking = order.connectorName && (
                          order.orderDeliveryStatus !== 'delivered' &&
                          order.orderDeliveryStatus !== 'fulfilled' &&
                          order.orderDeliveryStatus !== 'rto_failed'
                        );
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
            </div>
          </BlockStack>
        </Page>
      </div>
    </AppProvider>
  );
}

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

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;


  const response = await admin.graphql(`
    #graphql
    query getOrdersWithTrackingForAnalytics {
      orders(first: 250, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            name
            createdAt
            totalPriceSet {
              shopMoney {
                amount
              }
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

export default function Index() {
  const orders = useLoaderData() || [];

  // Pie Chart Hover State
  const [pieActiveIndex, setPieActiveIndex] = useState(null);
  const onPieEnter = useCallback((_, index) => setPieActiveIndex(index), []);
  const onPieLeave = useCallback(() => setPieActiveIndex(null), []);

  // Date Picker State
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

  // Product Filter State
  const [productPopoverActive, setProductPopoverActive] = useState(false);
  const toggleProductPopover = useCallback(() => setProductPopoverActive((active) => !active), []);
  const [productFilter, setProductFilter] = useState("All Product Types");

  // Delivery Status Filter State
  const [deliveryStatusPopoverActive, setDeliveryStatusPopoverActive] = useState(false);
  const toggleDeliveryStatusPopover = useCallback(() => setDeliveryStatusPopoverActive((active) => !active), []);
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState("All Statuses");

  // Extract unique product titles
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
          statusMatches = (order.orderDeliveryStatus === 'in_transit' || order.orderDeliveryStatus === 'out_for_delivery');
        } else if (deliveryStatusFilter === "Failed") {
          statusMatches = (order.orderDeliveryStatus === 'rto_failed');
        }
        if (!statusMatches) return false;
      }

      return true;
    });
  }, [orders, selectedDates, productFilter, deliveryStatusFilter]);

  // Compute Metrics
  const metrics = useMemo(() => {
    let pending = 0;
    let shipped = 0;
    let fulfilled = 0;
    let failed = 0;

    filteredOrders.forEach(order => {
      if (order.orderDeliveryStatus === 'delivered' || order.orderDeliveryStatus === 'fulfilled') {
        fulfilled++;
      } else if (order.orderDeliveryStatus === 'in_transit' || order.orderDeliveryStatus === 'out_for_delivery') {
        shipped++;
      } else if (order.orderDeliveryStatus === 'rto_failed') {
        failed++;
      } else {
        pending++; // If unknown or anything else, consider pending
      }
    });

    return {
      totalOrders: filteredOrders.length,
      pending,
      shipped,
      fulfilled,
      failed
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
      dataMap[dateStr] = { date: dateStr, Total: 0, Pending: 0, Fulfilled: 0, Shipped: 0 };
      current.setDate(current.getDate() + 1);
    }

    // Populate data from orders
    filteredOrders.forEach(order => {
      const orderDate = new Date(order.createdAt);
      const dateStr = `${String(orderDate.getDate()).padStart(2, '0')}/${String(orderDate.getMonth() + 1).padStart(2, '0')}/${String(orderDate.getFullYear()).slice(-2)}`;

      if (dataMap[dateStr]) {
        dataMap[dateStr].Total++;

        if (order.orderDeliveryStatus === 'delivered' || order.orderDeliveryStatus === 'fulfilled') {
          dataMap[dateStr].Fulfilled++;
        } else if (order.orderDeliveryStatus === 'in_transit' || order.orderDeliveryStatus === 'out_for_delivery') {
          dataMap[dateStr].Shipped++;
        } else {
          dataMap[dateStr].Pending++;
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
    let outForDelivery = 0;

    filteredOrders.forEach(order => {
      const status = order.orderDeliveryStatus;
      if (status === 'delivered') delivered++;
      else if (status === 'rto_failed') rto++;
      else if (status === 'out_for_delivery') outForDelivery++;
      else if (status === 'in_transit') inTransit++;
      else if (status === 'fulfilled') delivered++;
    });

    const data = [];
    if (delivered > 0) data.push({ name: 'Delivered', value: delivered, color: '#d5f5e3' });
    if (outForDelivery > 0) data.push({ name: 'NDR', value: outForDelivery, color: '#8ed4ce' });
    if (inTransit > 0) data.push({ name: 'Manifested', value: inTransit, color: '#00a896' });
    if (rto > 0) data.push({ name: 'RTO', value: rto, color: '#059669' });

    return data;
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

  const deliveryStatusOptions = [
    { content: "All Statuses", onAction: () => { setDeliveryStatusFilter("All Statuses"); toggleDeliveryStatusPopover(); } },
    { content: "In-Transit", onAction: () => { setDeliveryStatusFilter("In-Transit"); toggleDeliveryStatusPopover(); } },
    { content: "Delivered", onAction: () => { setDeliveryStatusFilter("Delivered"); toggleDeliveryStatusPopover(); } },
    { content: "Failed", onAction: () => { setDeliveryStatusFilter("Failed"); toggleDeliveryStatusPopover(); } }
  ];

  const styles = {
    grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "20px", marginTop: "32px", marginBottom: "32px" },
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
                      contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}
                    />
                    <Legend
                      iconType="circle"
                      wrapperStyle={{ paddingTop: '30px', paddingBottom: '10px' }}
                    />
                    <Bar dataKey="Total" fill="#00a896" barSize={6} />
                    <Bar dataKey="Pending" fill="#9ca3af" barSize={6} />
                    <Bar dataKey="Fulfilled" fill="#059669" barSize={6} />
                    <Bar dataKey="Shipped" fill="#8ed4ce" barSize={6} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div style={styles.section}>
              <div style={styles.cardTitleOuter}>
                <h3 style={styles.cardTitle}>Tracking-Status History</h3>
              </div>
              <div style={{ width: '100%', height: 400, marginTop: '20px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart onMouseLeave={onPieLeave}>
                    <Pie
                      data={trackingStatusData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={140}
                      labelLine={{ stroke: '#9ca3af', strokeWidth: 1 }}
                      label={({ name, value, x, y, textAnchor }) => (
                        <text x={x} y={y} fill="#111827" fontSize="13" fontWeight="600" textAnchor={textAnchor} dominantBaseline="central">
                          {name} : {value}
                        </text>
                      )}
                      onMouseEnter={onPieEnter}
                    >
                      {trackingStatusData.map((entry, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={entry.color} 
                          opacity={pieActiveIndex === null || pieActiveIndex === index ? 1 : 0.3}
                          style={{ transition: 'opacity 0.2s ease-in-out' }}
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip total={trackingStatusData.reduce((sum, item) => sum + item.value, 0)} />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </BlockStack>
        </Page>
      </div>
    </AppProvider>
  );
}

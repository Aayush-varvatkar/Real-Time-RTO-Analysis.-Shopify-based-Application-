import { useState, useMemo, useCallback } from "react";
import {
  Popover,
  Button,
  DatePicker,
  ActionList,
  Text,
  Divider,
  Select,
  Box,
  BlockStack,
  InlineStack,
} from '@shopify/polaris';
import { CalendarIcon, FilterIcon } from '@shopify/polaris-icons';
import { getThirdPartyConnectorName } from "../utils/orders";

export default function Filters({
  // Orders and products catalog data
  orders = [],
  storeProducts = [],

  // Date filter state
  selectedDates,
  setSelectedDates,

  // Product filter state
  productFilter,
  setProductFilter,

  // Delivery status state
  deliveryStatusFilter,
  setDeliveryStatusFilter,

  // Location filter states
  stateFilter,
  setStateFilter,
  cityFilter,
  setCityFilter,
  pincodeFilter,
  setPincodeFilter,

  // Courier filter state
  courierFilter,
  setCourierFilter,

  // Customizations for pages
  variant = "dashboard",
  failedLabel,
}) {
  // Popover visibility states
  const [datePopoverActive, setDatePopoverActive] = useState(false);
  const toggleDatePopover = useCallback(() => setDatePopoverActive((active) => !active), []);

  const [productPopoverActive, setProductPopoverActive] = useState(false);
  const toggleProductPopover = useCallback(() => setProductPopoverActive((active) => !active), []);

  const [deliveryStatusPopoverActive, setDeliveryStatusPopoverActive] = useState(false);
  const toggleDeliveryStatusPopover = useCallback(() => setDeliveryStatusPopoverActive((active) => !active), []);

  const [statePopoverActive, setStatePopoverActive] = useState(false);
  const toggleStatePopover = useCallback(() => setStatePopoverActive((a) => !a), []);

  const [cityPopoverActive, setCityPopoverActive] = useState(false);
  const toggleCityPopover = useCallback(() => setCityPopoverActive((a) => !a), []);

  const [pincodePopoverActive, setPincodePopoverActive] = useState(false);
  const togglePincodePopover = useCallback(() => setPincodePopoverActive((a) => !a), []);

  const [courierPopoverActive, setCourierPopoverActive] = useState(false);
  const toggleCourierPopover = useCallback(() => setCourierPopoverActive((a) => !a), []);

  // Calendar page states (month and year)
  const [{ month, year }, setDate] = useState(() => ({
    month: new Date().getMonth(),
    year: new Date().getFullYear(),
  }));

  // Preset filter state
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
  }, [setSelectedDates]);

  const handleDateSelection = useCallback(
    (value) => {
      setSelectedDates(value);
      setPresetFilter('custom');
    },
    [setSelectedDates],
  );

  const formatDateForComparison = (start, end) => {
    const startStr = start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const endStr = end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${startStr} - ${endStr}`;
  };

  const formatDateForInput = (date) => {
    return `${date.getDate()}-${date.getMonth() + 1}-${date.getFullYear()}`;
  };

  // Unique options derivations
  const uniqueProducts = useMemo(() => storeProducts, [storeProducts]);

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

  const uniqueCouriers = useMemo(() => {
    const vals = new Set();
    orders.forEach(o => {
      const company = o.fulfillments?.[0]?.trackingInfo?.[0]?.company;
      if (company && company.trim()) vals.add(company.trim());
    });
    return Array.from(vals).sort();
  }, [orders]);

  const uniqueConnectors = useMemo(() => {
    const names = new Set();
    orders.forEach(o => {
      const name = getThirdPartyConnectorName(o);
      if (name) names.add(name);
    });
    return Array.from(names).sort();
  }, [orders]);

  // Activators and options arrays
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

  const resolvedFailedLabel = failedLabel || (variant === "orders" ? "RTO" : "Failed");

  const deliveryStatusOptions = useMemo(() => {
    const options = [
      { content: "All Statuses", onAction: () => { setDeliveryStatusFilter("All Statuses"); toggleDeliveryStatusPopover(); } },
      { content: "In-Transit", onAction: () => { setDeliveryStatusFilter("In-Transit"); toggleDeliveryStatusPopover(); } },
      { content: "Delivered", onAction: () => { setDeliveryStatusFilter("Delivered"); toggleDeliveryStatusPopover(); } },
      { content: resolvedFailedLabel, onAction: () => { setDeliveryStatusFilter(resolvedFailedLabel); toggleDeliveryStatusPopover(); } }
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
  }, [uniqueConnectors, setDeliveryStatusFilter, toggleDeliveryStatusPopover, resolvedFailedLabel]);

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

  const courierOptions = [
    { content: "All Couriers", onAction: () => { setCourierFilter("All Couriers"); toggleCourierPopover(); } },
    ...uniqueCouriers.map(c => ({
      content: c,
      onAction: () => { setCourierFilter(c); toggleCourierPopover(); }
    }))
  ];

  const isOrders = variant === "orders";

  return (
    <InlineStack gap="400" blockAlign="center" wrap={isOrders ? false : undefined}>
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
                <div style={{ fontSize: '13px', fontWeight: '500', color: isOrders ? undefined : '#1a1a1a', marginBottom: '6px' }}>Starting</div>
                {isOrders ? (
                  <div style={{ border: '1px solid #c9cccf', borderRadius: '8px', padding: '8px 12px' }}>
                    {formatDateForInput(selectedDates.start)}
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #c9cccf', borderRadius: '8px', padding: '8px 12px', background: '#fff' }}>
                    <svg width="14" height="14" viewBox="0 0 20 20" fill="#5c5f62"><path d="M7 2a1 1 0 0 0-1 1v1H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V3a1 1 0 0 0-2 0v1H8V3a1 1 0 0 0-1-1ZM4 8h12v9H4V8Z" /></svg>
                    <span style={{ fontSize: '14px', color: '#1a1a1a' }}>{formatDateForInput(selectedDates.start)}</span>
                  </div>
                )}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', fontWeight: '500', color: isOrders ? undefined : '#1a1a1a', marginBottom: '6px' }}>Ending</div>
                {isOrders ? (
                  <div style={{ border: '1px solid #c9cccf', borderRadius: '8px', padding: '8px 12px' }}>
                    {formatDateForInput(selectedDates.end)}
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #c9cccf', borderRadius: '8px', padding: '8px 12px', background: '#fff' }}>
                    <svg width="14" height="14" viewBox="0 0 20 20" fill="#5c5f62"><path d="M7 2a1 1 0 0 0-1 1v1H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V3a1 1 0 0 0-2 0v1H8V3a1 1 0 0 0-1-1ZM4 8h12v9H4V8Z" /></svg>
                    <span style={{ fontSize: '14px', color: '#1a1a1a' }}>{formatDateForInput(selectedDates.end)}</span>
                  </div>
                )}
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
            {isOrders ? (
              <Button onClick={toggleDatePopover} variant="primary" tone="success">Apply</Button>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '4px' }}>
                <Button onClick={toggleDatePopover}>Cancel</Button>
                <Button onClick={toggleDatePopover} variant="primary" tone="success">Apply</Button>
              </div>
            )}
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

      {/* Courier Filter */}
      <Popover
        active={courierPopoverActive}
        activator={
          <Button onClick={toggleCourierPopover} icon={FilterIcon}>
            {courierFilter}
          </Button>
        }
        onClose={toggleCourierPopover}
      >
        <div style={{ minWidth: "180px", maxHeight: "260px", overflowY: "auto" }}>
          <ActionList items={courierOptions} />
        </div>
      </Popover>
    </InlineStack>
  );
}

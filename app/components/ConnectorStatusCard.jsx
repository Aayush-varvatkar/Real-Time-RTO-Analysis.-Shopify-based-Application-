import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";

export default function ConnectorStatusCard({ orders }) {
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
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', border: '1px solid #e5e7eb' }}>
          <thead>
            <tr style={{ backgroundColor: '#f9fafb' }}>
              <th style={{ padding: '10px 12px', textAlign: 'left', color: '#4b5563', fontWeight: '600', border: '1px solid #e5e7eb', backgroundColor: '#f9fafb' }}>Platform</th>
              <th style={{ padding: '10px 12px', textAlign: 'center', color: '#3b82f6', fontWeight: '600', border: '1px solid #e5e7eb', backgroundColor: '#eff6ff' }}>In Transit</th>
              <th style={{ padding: '10px 12px', textAlign: 'center', color: '#10b981', fontWeight: '600', border: '1px solid #e5e7eb', backgroundColor: '#ecfdf5' }}>Delivered</th>
              <th style={{ padding: '10px 12px', textAlign: 'center', color: '#f59e0b', fontWeight: '600', border: '1px solid #e5e7eb', backgroundColor: '#fffbeb' }}>Unfulfilled</th>
              <th style={{ padding: '10px 12px', textAlign: 'center', color: '#ef4444', fontWeight: '600', border: '1px solid #e5e7eb', backgroundColor: '#fef2f2' }}>RTO</th>
              <th style={{ padding: '10px 12px', textAlign: 'center', color: '#4f46e5', fontWeight: '600', border: '1px solid #e5e7eb', backgroundColor: '#f5f3ff' }}>Total</th>
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

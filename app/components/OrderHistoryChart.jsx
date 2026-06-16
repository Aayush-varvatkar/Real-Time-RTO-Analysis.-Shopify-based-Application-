import { ResponsiveContainer, BarChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Bar } from "recharts";

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
      { key: "Total Orders", label: "Total Orders", defaultColor: "#818cf8" },
      { key: "Unfulfilled", label: "Unfulfilled", defaultColor: "#fbbf24" },
      { key: "Fulfilled", label: "Fulfilled", defaultColor: "#26a69a" },
      { key: "Delivered", label: "Delivered", defaultColor: "#34d399" },
      { key: "In-Transit", label: "In-Transit", defaultColor: "#60a5fa" },
      { key: "Failed", label: "Failed", defaultColor: "#f87171" }
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

const renderCustomLegend = () => {
  const orderedLegend = [
    { value: "Total Orders", color: "#818cf8" },
    { value: "Unfulfilled", color: "#fbbf24" },
    { value: "Fulfilled", color: "#26a69a" },
    { value: "Delivered", color: "#34d399" },
    { value: "In-Transit", color: "#60a5fa" },
    { value: "Failed", color: "#f87171" }
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

export default function OrderHistoryChart({ chartData }) {
  return (
    <div style={{ backgroundColor: "#fff", borderRadius: "12px", padding: "24px", boxShadow: "0 2px 4px rgba(0,0,0,0.04)", border: "1px solid #f0f0f0" }}>
      <div style={{ borderBottom: "1px dotted #9ca3af", display: "inline-block", alignSelf: "flex-start", paddingBottom: "6px", marginBottom: "20px" }}>
        <h3 style={{ fontSize: "15px", fontWeight: "500", color: "#111827", margin: 0 }}>Order History</h3>
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
            <Bar dataKey="Total Orders" stackId="total" fill="#818cf8" barSize={6} />
            <Bar dataKey="Unfulfilled" stackId="unfulfilled" fill="#fbbf24" barSize={6} />
            <Bar dataKey="Fulfilled" stackId="fulfilled" fill="#26a69a" barSize={6} />
            <Bar dataKey="Delivered" stackId="logistics" fill="#34d399" barSize={6} />
            <Bar dataKey="In-Transit" stackId="logistics" fill="#60a5fa" barSize={6} />
            <Bar dataKey="Failed" stackId="logistics" fill="#f87171" barSize={6} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

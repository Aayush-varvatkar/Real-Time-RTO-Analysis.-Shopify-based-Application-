import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";

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

export default function TrackingStatusHistory({ trackingStatusData, pieTotal }) {
  return (
    <>
      <div style={{ borderBottom: "1px dotted #9ca3af", display: "inline-block", alignSelf: "flex-start", paddingBottom: "6px", marginBottom: "20px" }}>
        <h3 style={{ fontSize: "15px", fontWeight: "500", color: "#111827", margin: 0 }}>Tracking-Status History</h3>
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
    </>
  );
}

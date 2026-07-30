import { useMemo, useState } from "react";

const THEME_MAP = {
  // Quantity themes
  "Total Orders": { key: "total", title: "Total Orders", color: "#4f46e5" },
  "Delivered": { key: "delivered", title: "Delivered", color: "#10b981" },
  "In-Transit": { key: "inTransit", title: "In-Transit", color: "#3b82f6" },
  "Unfulfilled": { key: "unfulfilled", title: "Unfulfilled", color: "#f59e0b" },
  "Failed": { key: "rto", title: "Failed", color: "#ef4444" },

  // Revenue themes
  "Expected Revenue": { key: "expected", title: "Expected Revenue", color: "#4f46e5" },
  "Delivered Revenue": { key: "delivered", title: "Delivered Revenue", color: "#10b981" },
  "In-Transit Revenue": { key: "inTransit", title: "In-Transit Revenue", color: "#3b82f6" },
  "Unfulfilled Revenue": { key: "unfulfilled", title: "Unfulfilled Revenue", color: "#f59e0b" },
  "Lost Revenue": { key: "lost", title: "Lost Revenue", color: "#ef4444" },
};

export default function BreakdownBarChart({ activeCard, data = [], type = "quantity", onClose }) {
  const [showAll, setShowAll] = useState(false);

  const theme = THEME_MAP[activeCard] || (type === "revenue"
    ? { key: "expected", title: activeCard, color: "#4f46e5" }
    : { key: "total", title: activeCard, color: "#4f46e5" });

  const activeKey = theme.key;

  const chartData = useMemo(() => {
    if (!data || data.length === 0) {
      return { items: [], totalValue: 0, maxVal: 1 };
    }

    const filtered = data.filter(p => (p[activeKey] || 0) > 0);
    const totalValue = filtered.reduce((sum, p) => sum + (p[activeKey] || 0), 0);
    const sorted = [...filtered].sort((a, b) => (b[activeKey] || 0) - (a[activeKey] || 0));
    const maxVal = sorted.length > 0 ? (sorted[0][activeKey] || 1) : 1;

    return { items: sorted, totalValue, maxVal };
  }, [data, activeKey]);

  const formatVal = (val) => {
    if (type === "revenue") {
      return `Rs. ${Math.round(Number(val)).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
    }
    return `${val.toLocaleString()} ${val === 1 ? "item" : "items"}`;
  };

  const isRevenue = type === "revenue";

  if (!theme || chartData.items.length === 0) {
    return (
      <div style={{
        backgroundColor: "#ffffff", padding: "24px", borderRadius: "10px",
        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)", border: "1px solid #e5e7eb",
        borderTop: `4px solid ${theme?.color || '#cbd5e1'}`, marginTop: "16px"
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: "16px", fontWeight: "600", color: "#111827", margin: 0 }}>
            {activeCard} - Product Breakdown
          </h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "18px", color: "#9ca3af" }} title="Close">✕</button>
        </div>
        <p style={{ margin: "16px 0 0 0", color: "#6b7280", fontSize: "14px", fontStyle: "italic" }}>
          No product data available in this status.
        </p>
      </div>
    );
  }

  const visibleItems = showAll ? chartData.items : chartData.items.slice(0, 5);

  return (
    <div style={{
      backgroundColor: "#ffffff", padding: "24px", borderRadius: "10px",
      boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)", border: "1px solid #e5e7eb",
      borderTop: `4px solid ${theme.color}`, marginTop: "16px"
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: "20px" }}>
        <div>
          <h3 style={{ fontSize: "16px", fontWeight: "600", color: "#111827", margin: 0 }}>
            {theme.title} Breakdown by Product {isRevenue ? "" : "(Item Quantities)"}
          </h3>
          <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#6b7280" }}>
            Showing product {isRevenue ? "revenue" : "quantity"} contributions to the total {theme.title.toLowerCase()} ({formatVal(chartData.totalValue)})
          </p>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "18px", color: "#9ca3af" }} title="Close">✕</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {visibleItems.map((p, idx) => {
          const val = p[activeKey] || 0;
          const pctWidth = (val / chartData.maxVal) * 100;
          const sharePct = ((val / chartData.totalValue) * 100).toFixed(1);
          const totalRef = isRevenue ? p.expected : p.total;
          const successPct = totalRef > 0 ? ((val / totalRef) * 100).toFixed(1) : "0.0";

          return (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 200px', minWidth: '150px', maxWidth: '300px' }}>
                <span style={{ fontSize: '13px', fontWeight: '600', color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }} title={p.name}>
                  {p.name}
                </span>
              </div>
              <div style={{ flex: '2 2 300px', minWidth: '200px', height: '14px', backgroundColor: '#f3f4f6', borderRadius: '7px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pctWidth}%`, backgroundColor: theme.color, borderRadius: '7px', transition: 'width 0.6s cubic-bezier(0.4, 0, 0.2, 1)' }} />
              </div>
              <div style={{ flex: '1 1 200px', minWidth: '200px', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <span style={{ fontSize: '13px', fontWeight: '700', color: '#111827' }}>
                  {formatVal(val)}
                </span>
                <span style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px', whiteSpace: 'nowrap' }}>
                  {sharePct}% share
                  {activeKey === 'delivered' && (
                    <span style={{ color: '#9ca3af' }}> • {successPct}% success rate</span>
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {chartData.items.length > 5 && (
        <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'center' }}>
          <button
            onClick={() => setShowAll(!showAll)}
            style={{
              padding: '6px 16px', fontSize: '12px', fontWeight: '600', color: theme.color,
              backgroundColor: `${theme.color}10`, border: `1px solid ${theme.color}30`,
              borderRadius: '20px', cursor: 'pointer'
            }}
          >
            {showAll ? "Show Less" : `Show More (${chartData.items.length - 5} products)`}
          </button>
        </div>
      )}
    </div>
  );
}

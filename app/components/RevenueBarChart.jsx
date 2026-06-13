import { useMemo, useState } from "react";

const CARD_THEMES = {
  expected: {
    title: "Expected Revenue",
    color: "#4f46e5",
    bgLight: "#f5f3ff",
  },
  delivered: {
    title: "Delivered Revenue",
    color: "#10b981",
    bgLight: "#ecfdf5",
  },
  inTransit: {
    title: "In-Transit Revenue",
    color: "#3b82f6",
    bgLight: "#eff6ff",
  },
  unfulfilled: {
    title: "Unfulfilled Revenue",
    color: "#f59e0b",
    bgLight: "#fffbeb",
  },
  lost: {
    title: "Lost Revenue",
    color: "#ef4444",
    bgLight: "#fef2f2",
  }
};

export default function RevenueBarChart({ activeCard, productRevenues = [], onClose }) {
  const [showAll, setShowAll] = useState(false);

  // Map the activeCard title to the correct key
  const activeKey = useMemo(() => {
    return Object.keys(CARD_THEMES).find(k => CARD_THEMES[k].title === activeCard) || "expected";
  }, [activeCard]);

  const theme = CARD_THEMES[activeKey];
  const chartData = useMemo(() => {
    if (!productRevenues || productRevenues.length === 0) {
      return { products: [], totalValue: 0, maxVal: 1 };
    }
    // Filter products with value > 0 for this status
    const filtered = productRevenues.filter(p => (p[activeKey] || 0) > 0);

    // Sum total status value for contribution calculations
    const totalValue = filtered.reduce((sum, p) => sum + (p[activeKey] || 0), 0);

    // Sort descending by value
    const sorted = [...filtered].sort((a, b) => (b[activeKey] || 0) - (a[activeKey] || 0));

    // Get max value for relative bar widths
    const maxVal = sorted.length > 0 ? (sorted[0][activeKey] || 1) : 1;

    return {
      products: sorted,
      totalValue,
      maxVal
    };
  }, [productRevenues, activeKey]);

  const formatRevenue = (val) => {
    return `Rs. ${Math.round(Number(val)).toLocaleString('en-IN', {
      maximumFractionDigits: 0
    })}`;
  };

  if (!theme || chartData.products.length === 0) {
    return (
      <div style={{
        backgroundColor: "#ffffff",
        padding: "24px",
        borderRadius: "10px",
        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.02)",
        border: "1px solid #e5e7eb",
        borderTop: `4px solid ${theme?.color || '#cbd5e1'}`,
        marginTop: "16px",
        fontFamily: "inherit"
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: "16px", fontWeight: "600", color: "#111827", margin: 0 }}>
            {activeCard} - Product Breakdown
          </h3>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "18px",
              color: "#9ca3af",
              padding: "4px"
            }}
            title="Close breakdown"
          >
            ✕
          </button>
        </div>
        <p style={{ margin: "16px 0 0 0", color: "#6b7280", fontSize: "14px", fontStyle: "italic" }}>
          No product data available in this status.
        </p>
      </div>
    );
  }

  const visibleProducts = showAll ? chartData.products : chartData.products.slice(0, 5);

  return (
    <div style={{
      backgroundColor: "#ffffff",
      padding: "24px",
      borderRadius: "10px",
      boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.02)",
      border: "1px solid #e5e7eb",
      borderTop: `4px solid ${theme.color}`,
      marginTop: "16px",
      fontFamily: "inherit"
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: "20px" }}>
        <div>
          <h3 style={{ fontSize: "16px", fontWeight: "600", color: "#111827", margin: 0 }}>
            {theme.title} Breakdown by Product
          </h3>
          <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#6b7280" }}>
            Showing product revenue contributions to the total {theme.title.toLowerCase()} ({formatRevenue(chartData.totalValue)})
          </p>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: "18px",
            color: "#9ca3af",
            padding: "4px"
          }}
          title="Close breakdown"
        >
          ✕
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {visibleProducts.map((p, idx) => {
          const val = p[activeKey] || 0;
          const pctWidth = (val / chartData.maxVal) * 100;
          const sharePct = ((val / chartData.totalValue) * 100).toFixed(1);
          const successPct = p.expected > 0 ? ((val / p.expected) * 100).toFixed(1) : "0.0";

          return (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
              {/* Product Label */}
              <div style={{ flex: '1 1 200px', minWidth: '150px', maxWidth: '300px' }}>
                <span
                  style={{
                    fontSize: '13px',
                    fontWeight: '600',
                    color: '#111827',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    display: 'block'
                  }}
                  title={p.name}
                >
                  {p.name}
                </span>
              </div>

              {/* Progress Bar Column */}
              <div style={{ flex: '2 2 300px', minWidth: '200px', height: '14px', backgroundColor: '#f3f4f6', borderRadius: '7px', overflow: 'hidden', position: 'relative' }}>
                <div style={{
                  height: '100%',
                  width: `${pctWidth}%`,
                  backgroundColor: theme.color,
                  borderRadius: '7px',
                  transition: 'width 0.6s cubic-bezier(0.4, 0, 0.2, 1)'
                }} />
              </div>

              {/* Value and Percentages */}
              <div style={{ flex: '1 1 200px', minWidth: '200px', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <span style={{ fontSize: '13px', fontWeight: '700', color: '#111827' }}>
                  {formatRevenue(val)}
                </span>
                <span style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px', whiteSpace: 'nowrap' }}>
                  {sharePct}% share
                  {activeKey !== 'expected' && (
                    <span style={{ color: '#9ca3af' }}> • {successPct}% success rate</span>
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {chartData.products.length > 5 && (
        <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'center' }}>
          <button
            onClick={() => setShowAll(!showAll)}
            style={{
              padding: '6px 16px',
              fontSize: '12px',
              fontWeight: '600',
              color: theme.color,
              backgroundColor: `${theme.color}10`,
              border: `1px solid ${theme.color}30`,
              borderRadius: '20px',
              cursor: 'pointer',
              transition: 'background-color 0.2s, transform 0.1s'
            }}
          >
            {showAll ? "Show Less" : `Show More (${chartData.products.length - 5} products)`}
          </button>
        </div>
      )}
    </div>
  );
}

import { useMemo, useState } from "react";
import RevenueBarChart from "./RevenueBarChart";

export default function RevenueCards({ orders = [], productFilter = "", productRevenues = [] }) {
  const [activeCardTitle, setActiveCardTitle] = useState(null);

  const metrics = useMemo(() => {
    let expected = 0;
    let delivered = 0;
    let inTransit = 0;
    let unfulfilled = 0;
    let lost = 0;
    const connectorRevenue = {};

    orders.forEach(order => {
      let amount = 0;
      if (Array.isArray(order.lineItems?.edges)) {
        order.lineItems.edges.forEach(edge => {
          const item = edge.node;
          if (!item) return;
          const matchesFilter = !productFilter || productFilter === "All Product Types" || item.title?.trim() === productFilter;
          if (matchesFilter) {
            const qty = item.quantity || 1;
            const unitPrice = Number(item.originalUnitPriceSet?.shopMoney?.amount || 0);
            amount += qty * unitPrice;
          }
        });
      } else {
        amount = Number(order.totalPriceSet?.shopMoney?.amount || 0);
      }

      const isConnector = !!order.connectorName;

      if (isConnector) {
        const platform = order.connectorName || "Connector";
        connectorRevenue[platform] = (connectorRevenue[platform] || 0) + amount;
      } else {
        expected += amount;
        if (order.orderDeliveryStatus === 'delivered' || order.orderDeliveryStatus === 'fulfilled') {
          delivered += amount;
        } else if (order.orderDeliveryStatus === 'in_transit' || order.orderDeliveryStatus === 'out_for_delivery') {
          inTransit += amount;
        } else if (order.orderDeliveryStatus === 'rto_failed') {
          lost += amount;
        } else {
          unfulfilled += amount;
        }
      }
    });

    return {
      expected,
      delivered,
      inTransit,
      unfulfilled,
      lost,
      connectorRevenue
    };
  }, [orders, productFilter]);

  const formatRevenue = (val) => {
    return `Rs. ${Math.round(Number(val)).toLocaleString('en-IN', {
      maximumFractionDigits: 0
    })}`;
  };

  const styles = {
    sectionContainer: {
      marginTop: "16px",
      marginBottom: "24px",
    },
    sectionTitle: {
      fontSize: "18px",
      fontWeight: "600",
      color: "#111827",
      marginBottom: "16px",
      fontFamily: "inherit",
    },
    grid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
      gap: "16px",
    },
    card: {
      backgroundColor: "#ffffff",
      padding: "20px 24px",
      borderRadius: "10px",
      boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.02)",
      border: "1px solid #e5e7eb",
      display: "flex",
      flexDirection: "column",
      position: "relative",
      overflow: "hidden",
      cursor: "default",
    },
    cardHeader: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: "16px",
    },
    cardTitle: {
      fontSize: "14px",
      fontWeight: "500",
      color: "#4b5563",
      margin: 0,
    },
    iconContainer: {
      width: "36px",
      height: "36px",
      borderRadius: "8px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    },
    cardValue: {
      fontSize: "26px",
      fontWeight: "700",
      margin: 0,
      lineHeight: 1.2,
      fontFamily: "inherit",
    },
    cardSubtext: {
      fontSize: "12px",
      color: "#9ca3af",
      marginTop: "6px",
      margin: 0,
    }
  };

  // Define standard card configurations
  const baseCards = [
    {
      title: "Expected Revenue",
      value: metrics.expected,
      color: "#4f46e5", // Indigo
      borderColor: "#4f46e5",
      bgLight: "#f5f3ff",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="1" x2="12" y2="23"></line>
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
        </svg>
      ),
      subtext: "Total potential store revenue",
      percentage: metrics.expected > 0 ? 100 : 0,
      percentageLabel: "of expected",
    },
    {
      title: "Delivered Revenue",
      value: metrics.delivered,
      color: "#10b981", // Emerald
      borderColor: "#10b981",
      bgLight: "#ecfdf5",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
          <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>
      ),
      subtext: "Successfully delivered",
      percentage: metrics.expected > 0 ? (metrics.delivered / metrics.expected) * 100 : 0,
      percentageLabel: "of expected",
    },
    {
      title: "In-Transit Revenue",
      value: metrics.inTransit,
      color: "#3b82f6", // Blue
      borderColor: "#3b82f6",
      bgLight: "#eff6ff",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1" y="3" width="15" height="13"></rect>
          <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon>
          <circle cx="5.5" cy="18.5" r="2.5"></circle>
          <circle cx="18.5" cy="18.5" r="2.5"></circle>
        </svg>
      ),
      subtext: "Shipped & pending delivery",
      percentage: metrics.expected > 0 ? (metrics.inTransit / metrics.expected) * 100 : 0,
      percentageLabel: "of expected",
    },
    {
      title: "Unfulfilled Revenue",
      value: metrics.unfulfilled,
      color: "#f59e0b", // Amber
      borderColor: "#f59e0b",
      bgLight: "#fffbeb",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
      ),
      subtext: "Pending shipment (untracked)",
      percentage: metrics.expected > 0 ? (metrics.unfulfilled / metrics.expected) * 100 : 0,
      percentageLabel: "of expected",
    },
    {
      title: "Lost Revenue",
      value: metrics.lost,
      color: "#ef4444", // Red
      borderColor: "#ef4444",
      bgLight: "#fef2f2",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="15" y1="9" x2="9" y2="15"></line>
          <line x1="9" y1="9" x2="15" y2="15"></line>
        </svg>
      ),
      subtext: "Failed shipments (RTO / Returned)",
      percentage: metrics.expected > 0 ? (metrics.lost / metrics.expected) * 100 : 0,
      percentageLabel: "of expected",
    }
  ];

  return (
    <div style={styles.sectionContainer}>
      <style>{`
        .revenue-card {
          transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.25s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.25s ease;
        }
        .revenue-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 12px 20px -8px rgba(0, 0, 0, 0.08), 0 4px 6px -2px rgba(0, 0, 0, 0.03);
          border-color: #cbd5e1 !important;
        }
      `}</style>

      <h2 style={styles.sectionTitle}>Revenue Generated</h2>

      <div style={styles.grid}>
        {baseCards.map((card, idx) => {
          const isActive = activeCardTitle === card.title;
          return (
            <div
              key={idx}
              className="revenue-card"
              onClick={() => {
                setActiveCardTitle(prev => prev === card.title ? null : card.title);
              }}
              style={{
                ...styles.card,
                borderTop: `4px solid ${card.borderColor}`,
                cursor: "pointer",
                boxShadow: isActive 
                  ? "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)"
                  : styles.card.boxShadow
              }}
            >
              <div style={styles.cardHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h3 style={styles.cardTitle}>{card.title}</h3>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "20px",
                      height: "20px",
                      borderRadius: "50%",
                      backgroundColor: `${card.color}15`,
                      color: card.color,
                      fontSize: "12px",
                      fontWeight: "bold",
                      border: `1px solid ${card.color}30`
                    }}
                  >
                    {isActive ? "🢁" : "🢃"}
                  </span>
                </div>
                <div
                  style={{
                    ...styles.iconContainer,
                    backgroundColor: card.bgLight,
                    color: card.color
                  }}
                >
                  {card.icon}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '4px', marginBottom: '8px' }}>
                <p style={{ ...styles.cardValue, color: card.color }}>
                  {formatRevenue(card.value)}
                </p>
                {card.percentage !== undefined && (
                  <span style={{
                    fontSize: '12px',
                    fontWeight: '600',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    backgroundColor: card.bgLight,
                    color: card.color,
                    border: `1px solid ${card.color}33`,
                    display: 'inline-flex',
                    alignItems: 'center',
                    whiteSpace: 'nowrap',
                  }} title={`${card.percentage.toFixed(1)}% ${card.percentageLabel}`}>
                    {card.percentage.toFixed(1)}%
                  </span>
                )}
              </div>
              <p style={styles.cardSubtext}>{card.subtext}</p>
            </div>
          );
        })}

        {Object.entries(metrics.connectorRevenue).map(([platform, value]) => {
          return (
            <div
              key={platform}
              className="revenue-card"
              style={{
                ...styles.card,
                borderTop: `4px solid #8b5cf6` // Purple for connectors
              }}
            >
              <div style={styles.cardHeader}>
                <h3 style={styles.cardTitle}>{platform} Revenue</h3>
                <div
                  style={{
                    ...styles.iconContainer,
                    backgroundColor: "#f5f3ff",
                    color: "#8b5cf6"
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path>
                  </svg>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '4px', marginBottom: '8px' }}>
                <p style={{ ...styles.cardValue, color: "#8b5cf6" }}>
                  {formatRevenue(value)}
                </p>
              </div>
              <p style={styles.cardSubtext}>Marketplace platform sales</p>
            </div>
          );
        })}
      </div>

      {activeCardTitle && (
        <RevenueBarChart
          activeCard={activeCardTitle}
          productRevenues={productRevenues}
          onClose={() => setActiveCardTitle(null)}
        />
      )}
    </div>
  );
}

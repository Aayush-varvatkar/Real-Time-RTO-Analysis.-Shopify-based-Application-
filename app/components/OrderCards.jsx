export default function OrderCards({ metrics, activeOrderCardTitle, setActiveOrderCardTitle }) {
  const orderCardStyles = {
    grid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
      gap: "16px",
      marginTop: "32px",
      marginBottom: "32px",
    },
    card: {
      backgroundColor: "#ffffff",
      padding: "20px 24px",
      borderRadius: "8px",
      boxShadow: "0 1px 3px rgba(0, 0, 0, 0.08)",
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
  };

  const baseOrderCards = [
    {
      title: "Total Orders",
      value: metrics.totalOrders,
      color: "#4f46e5",
      borderColor: "#4f46e5",
      bgLight: "#f5f3ff",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <path d="M16 10a4 4 0 0 1-8 0"></path>
        </svg>
      ),
      percentage: metrics.totalOrders > 0 ? 100 : 0,
      percentageLabel: "of total"
    },
    {
      title: "Delivered",
      value: metrics.fulfilled,
      color: "#10b981",
      borderColor: "#10b981",
      bgLight: "#ecfdf5",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
          <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>
      ),
      percentage: metrics.totalOrders > 0 ? (metrics.fulfilled / metrics.totalOrders) * 100 : 0,
      percentageLabel: "of total"
    },
    {
      title: "In-Transit",
      value: metrics.shipped,
      color: "#3b82f6",
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
      percentage: metrics.totalOrders > 0 ? (metrics.shipped / metrics.totalOrders) * 100 : 0,
      percentageLabel: "of total"
    },
    {
      title: "Unfulfilled",
      value: metrics.unfulfilled,
      color: "#f59e0b",
      borderColor: "#f59e0b",
      bgLight: "#fffbeb",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
      ),
      percentage: metrics.totalOrders > 0 ? (metrics.unfulfilled / metrics.totalOrders) * 100 : 0,
      percentageLabel: "of total"
    },
    {
      title: "Failed",
      value: metrics.failed,
      color: "#ef4444",
      borderColor: "#ef4444",
      bgLight: "#fef2f2",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="15" y1="9" x2="9" y2="15"></line>
          <line x1="9" y1="9" x2="15" y2="15"></line>
        </svg>
      ),
      percentage: metrics.totalOrders > 0 ? (metrics.failed / metrics.totalOrders) * 100 : 0,
      percentageLabel: "of total"
    }
  ];

  return (
    <>
      <style>{`
        .order-card {
          transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.25s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.25s ease;
        }
        .order-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 12px 20px -8px rgba(0, 0, 0, 0.08), 0 4px 6px -2px rgba(0, 0, 0, 0.03);
          border-color: #cbd5e1 !important;
        }
      `}</style>

      <div style={orderCardStyles.grid}>
        {baseOrderCards.map((card, idx) => {
          const isActive = activeOrderCardTitle === card.title;
          return (
            <div
              key={idx}
              className="order-card"
              onClick={() => {
                setActiveOrderCardTitle(prev => prev === card.title ? null : card.title);
              }}
              style={{
                ...orderCardStyles.card,
                borderTop: `4px solid ${card.borderColor}`,
                cursor: "pointer",
                boxShadow: isActive 
                  ? "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)"
                  : orderCardStyles.card.boxShadow
              }}
            >
              <div style={orderCardStyles.cardHeader}>
                <h3 style={orderCardStyles.cardTitle}>{card.title}</h3>
                <div
                  style={{
                    ...orderCardStyles.iconContainer,
                    backgroundColor: card.bgLight,
                    color: card.color
                  }}
                >
                  {card.icon}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '4px', marginBottom: '8px' }}>
                <p style={{ ...orderCardStyles.cardValue, color: card.color }}>
                  {card.value}
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
              <span
                style={{
                  position: "absolute",
                  bottom: "16px",
                  right: "16px",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "22px",
                  height: "22px",
                  borderRadius: "50%",
                  backgroundColor: isActive ? `${card.color}15` : "#f3f4f6",
                  color: isActive ? card.color : "#9ca3af",
                  fontSize: "12px",
                  fontWeight: "bold",
                  border: isActive ? `1px solid ${card.color}30` : "1px solid #e5e7eb",
                  transition: "background-color 0.2s, color 0.2s, border-color 0.2s"
                }}
              >
                {isActive ? "🢁" : "🢃"}
              </span>
            </div>
          );
        })}

        {Object.entries(metrics.connectorCounts).map(([connectorName, count]) => (
          <div
            key={connectorName}
            className="order-card"
            style={{
              ...orderCardStyles.card,
              borderTop: `4px solid #8b5cf6`
            }}
          >
            <div style={orderCardStyles.cardHeader}>
              <h3 style={orderCardStyles.cardTitle}>Dispatched by {connectorName}</h3>
              <div
                style={{
                  ...orderCardStyles.iconContainer,
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
              <p style={{ ...orderCardStyles.cardValue, color: "#8b5cf6" }}>
                {count}
              </p>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

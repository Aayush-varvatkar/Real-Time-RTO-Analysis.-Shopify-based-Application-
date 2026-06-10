import { useState, useMemo } from "react";
import { indiaMapData } from "../routes/indiaMapData";

export default function IndiaHeatMap({ statesData }) {
  const [hoveredState, setHoveredState] = useState(null);

  // Normalize mapping for quick lookup
  const statsMap = useMemo(() => {
    const map = {};
    if (!statesData) return map;
    statesData.forEach(state => {
      const norm = normalizeStateName(state.name);
      map[norm] = state;
    });
    return map;
  }, [statesData]);

  // Normalize state helper
  function normalizeStateName(name) {
    if (!name) return '';
    const clean = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const mapping = {
      'mh': 'maharashtra',
      'ka': 'karnataka',
      'dl': 'delhi',
      'up': 'uttarpradesh',
      'mp': 'madhyapradesh',
      'gj': 'gujarat',
      'hr': 'haryana',
      'pb': 'punjab',
      'rj': 'rajasthan',
      'tn': 'tamilnadu',
      'ap': 'andhrapradesh',
      'tg': 'telangana', 'ts': 'telangana',
      'kl': 'kerala',
      'wb': 'westbengal',
      'br': 'bihar',
      'or': 'odisha', 'od': 'odisha', 'orissa': 'odisha',
      'ct': 'chhattisgarh', 'cg': 'chhattisgarh',
      'jh': 'jharkhand',
      'uk': 'uttarakhand', 'ua': 'uttarakhand',
      'hp': 'himachalpradesh',
      'jk': 'jammuandkashmir', 'jammukashmir': 'jammuandkashmir', 'jammu': 'jammuandkashmir', 'kashmir': 'jammuandkashmir', 'ladakh': 'jammuandkashmir',
      'as': 'assam',
      'ml': 'meghalaya',
      'mn': 'manipur',
      'mz': 'mizoram',
      'nl': 'nagaland',
      'sk': 'sikkim',
      'tr': 'tripura',
      'py': 'puducherry', 'pondicherry': 'puducherry',
      'ga': 'goa',
      'ch': 'chandigarh',
      'an': 'andamanandnicobarislands', 'andaman': 'andamanandnicobarislands', 'nicobar': 'andamanandnicobarislands',
      'ld': 'lakshadweep',
      'dn': 'dadraandnagarhaveli',
      'dd': 'damananddiu',
      'dnhdd': 'dadraandnagarhaveli'
    };
    return mapping[clean] || clean;
  }

  // Get color for RTO %
  function getColorForRto(rtoPct, totalOrders) {
    if (!totalOrders || totalOrders === 0) return '#e5e7eb'; // no data
    if (rtoPct < 5) return '#00b480'; // <5%
    if (rtoPct < 10) return '#2ec175'; // 5-10%
    if (rtoPct < 15) return '#84cc16'; // 10-15%
    if (rtoPct < 20) return '#eab308'; // 15-20%
    if (rtoPct < 25) return '#f97316'; // 20-25%
    return '#ef4444'; // >25%
  }

  return (
    <div style={{
      backgroundColor: '#ffffff',
      borderRadius: '12px',
      padding: '24px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      border: '1px solid #e5e7eb',
      marginTop: '20px',
      position: 'relative'
    }}>
      {/* Title */}
      <div style={{
        borderBottom: '1px dotted #9ca3af',
        display: 'inline-flex',
        alignItems: 'center',
        paddingBottom: '6px',
        marginBottom: '24px'
      }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}>
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
        <h3 style={{ fontSize: '15px', fontWeight: '700', color: '#111827', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          RTO Heatmap — India
        </h3>
      </div>

      {/* Map Content */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
        <div style={{ width: '100%', maxWidth: '600px', display: 'flex', justifyContent: 'center' }}>
          <svg
            viewBox={indiaMapData.viewBox}
            width="100%"
            height="100%"
            style={{
              filter: 'drop-shadow(0px 8px 16px rgba(0,0,0,0.04))',
              overflow: 'visible'
            }}
          >
            {indiaMapData.locations.map(loc => {
              const normName = normalizeStateName(loc.name);
              const stateInfo = statsMap[normName] || { total: 0, rto: 0, delivered: 0, rtoPct: 0 };
              const fill = getColorForRto(stateInfo.rtoPct, stateInfo.total);
              const isHovered = hoveredState && hoveredState.id === loc.id;

              return (
                <path
                  key={loc.id}
                  id={loc.id}
                  d={loc.path}
                  fill={fill}
                  stroke={isHovered ? '#111827' : '#ffffff'}
                  strokeWidth={isHovered ? 2.5 : 1.2}
                  style={{
                    cursor: 'pointer',
                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                  onMouseMove={(e) => {
                    setHoveredState({
                      id: loc.id,
                      name: loc.name,
                      total: stateInfo.total,
                      rto: stateInfo.rto,
                      delivered: stateInfo.delivered,
                      rtoPct: stateInfo.rtoPct,
                      x: e.clientX,
                      y: e.clientY
                    });
                  }}
                  onMouseLeave={() => {
                    setHoveredState(null);
                  }}
                />
              );
            })}
          </svg>
        </div>

        {/* Legend */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          flexWrap: 'wrap',
          gap: '16px',
          marginTop: '24px',
          fontSize: '12px',
          color: '#6b7280',
          fontWeight: '500'
        }}>
          {[
            { label: '<5%', color: '#00f1adff' },
            { label: '5-10%', color: '#339765ff' },
            { label: '10-15%', color: '#84cc16' },
            { label: '15-20%', color: '#eab308' },
            { label: '20-25%', color: '#f97316' },
            { label: '>25%', color: '#ef4444' },
            { label: 'no data', color: '#e5e7eb' }
          ].map((item, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                backgroundColor: item.color,
                display: 'inline-block',
                boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
              }} />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Tooltip */}
      {hoveredState && (
        <div style={{
          position: 'fixed',
          left: hoveredState.x + 15,
          top: hoveredState.y + 15,
          backgroundColor: '#ffffff',
          border: '1px solid #e5e7eb',
          padding: '10px 14px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          borderRadius: '8px',
          fontSize: '13px',
          pointerEvents: 'none',
          zIndex: 9999,
          fontFamily: 'inherit',
          color: '#1f2937',
          minWidth: '160px'
        }}>
          <p style={{ margin: '0 0 6px 0', fontWeight: '700', color: '#111827', fontSize: '14px', borderBottom: '1px solid #f3f4f6', paddingBottom: '4px' }}>
            {hoveredState.name}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#6b7280' }}>Total Orders:</span>
              <span style={{ fontWeight: '600' }}>{hoveredState.total}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#6b7280' }}>Delivered:</span>
              <span style={{ fontWeight: '600', color: '#059669' }}>{hoveredState.delivered}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#6b7280' }}>RTO:</span>
              <span style={{ fontWeight: '600', color: '#ef4444' }}>{hoveredState.rto}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', paddingTop: '4px', borderTop: '1px dotted #f3f4f6' }}>
              <span style={{ color: '#111827', fontWeight: '600' }}>RTO Rate:</span>
              <span style={{
                backgroundColor: hoveredState.total === 0 ? '#e5e7eb' : hoveredState.rtoPct >= 25 ? '#fee2e2' : hoveredState.rtoPct >= 15 ? '#fee2e2' : hoveredState.rtoPct >= 10 ? '#fef3c7' : '#d1fae5',
                color: hoveredState.total === 0 ? '#4b5563' : hoveredState.rtoPct >= 25 ? '#991b1b' : hoveredState.rtoPct >= 15 ? '#b45309' : hoveredState.rtoPct >= 10 ? '#92400e' : '#065f46',
                padding: '1px 6px',
                borderRadius: '4px',
                fontWeight: '700'
              }}>
                {hoveredState.total === 0 ? 'N/A' : `${hoveredState.rtoPct}%`}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

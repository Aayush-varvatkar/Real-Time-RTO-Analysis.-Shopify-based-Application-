import { useState, useMemo } from "react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";

const RTO_COLORS = ['#ef4444', '#f97316', '#eab308', '#8b5cf6', '#06b6d4'];
const CARD_DEFAULT = 5;
const CARD_PAGE = 20;

export default function RTOAnalysis({ title, label, data, fullWidth = false, showInTransit = false }) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  const [sortField, setSortField] = useState('rtoPct'); // Default RTO %
  const [sortDir, setSortDir] = useState('desc');   // Default descending

  // Layout constants — declared early so renderSortHeader can reference `pad`
  const pad = fullWidth ? '10px 16px' : '10px 10px';
  const pieW = fullWidth ? 200 : 170;
  const innerR = fullWidth ? 50 : 42;
  const outerR = fullWidth ? 80 : 68;

  // Sort the full dataset based on active sort options
  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => {
      const valA = a[sortField] ?? 0;
      const valB = b[sortField] ?? 0;
      if (sortDir === 'desc') {
        return valB - valA;
      } else {
        return valA - valB;
      }
    });
  }, [data, sortField, sortDir]);

  // Rows to display: either top-5 or current page of full list
  const visibleRows = expanded
    ? sortedData.slice(page * CARD_PAGE, (page + 1) * CARD_PAGE)
    : sortedData.slice(0, CARD_DEFAULT);

  const totalPages = Math.ceil(sortedData.length / CARD_PAGE);
  const showPagination = expanded && sortedData.length > CARD_PAGE;

  const handleToggle = () => { setExpanded(e => !e); setPage(0); };

  // Sort handler that toggles direction if active, or sets new field to desc
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(prev => prev === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
    setPage(0);
  };

  // Helper to render sortable column header with single arrow
  const renderSortHeader = (field, displayName) => {
    const isActive = sortField === field;
    const arrow = isActive ? (sortDir === 'desc' ? '⮝' : '⮟') : '⮝';
    return (
      <th
        style={{
          padding: pad,
          textAlign: 'center',
          color: '#6b7280',
          fontWeight: '600',
          cursor: 'pointer',
          userSelect: 'none',
          transition: 'color 0.15s ease'
        }}
        onClick={() => handleSort(field)}
        onMouseEnter={(e) => e.currentTarget.style.color = '#111827'}
        onMouseLeave={(e) => e.currentTarget.style.color = '#6b7280'}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
          {displayName}
          <span
            style={{
              fontWeight: '800',
              fontSize: '11px',
              color: isActive ? '#6366f1' : '#d1d5db',
              display: 'inline-block',
              transition: 'transform 0.15s ease'
            }}
          >
            {arrow}
          </span>
        </span>
      </th>
    );
  };

  // Pie always shows top-5 by current sorted order for clarity
  const pieData = sortedData.slice(0, 5);

  return (
    <div style={{ backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid #f3f4f6', backgroundColor: '#fafafa', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <span style={{ fontSize: '15px', fontWeight: '700', color: '#111827' }}>{title}</span>
        {data.length > CARD_DEFAULT && (
          <button
            onClick={handleToggle}
            style={{ fontSize: '12px', fontWeight: '600', color: '#6366f1', background: '#eef2ff', border: 'none', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', transition: 'background 0.15s' }}
          >
            {expanded ? 'View Less ↑' : `View All (${data.length}) ↓`}
          </button>
        )}
      </div>

      {data.length === 0 ? (
        <div style={{ padding: '32px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>No RTO orders in selected period</div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'stretch', flex: 1 }}>
          {/* Table side */}
          <div style={{ flex: 1, overflowX: 'auto', display: 'flex', flexDirection: 'column' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f9fafb' }}>
                  <th style={{ padding: pad, textAlign: 'center', color: '#6b7280', fontWeight: '600', width: '32px' }}>#</th>
                  <th style={{ padding: pad, textAlign: 'left', color: '#6b7280', fontWeight: '600' }}>{label}</th>
                  {renderSortHeader('total', 'Total')}
                  {renderSortHeader('rtoPct', 'RTO %')}
                  {renderSortHeader('delivered', 'Delivered')}
                  {showInTransit && renderSortHeader('inTransit', 'In Transit')}
                  {renderSortHeader('rto', 'RTO')}
                </tr>
              </thead>
              <tbody style={{ transition: 'opacity 0.15s ease' }}>
                {visibleRows.map((row, i) => {
                  const globalIdx = expanded ? page * CARD_PAGE + i : i;
                  return (
                    <tr key={row.name} style={{ borderTop: '1px solid #f3f4f6', backgroundColor: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                      <td style={{ padding: pad, textAlign: 'center', fontWeight: '700', fontSize: '13px', color: globalIdx < 5 ? RTO_COLORS[globalIdx] : '#9ca3af' }}>
                        {globalIdx + 1}
                      </td>
                      <td title={row.name} style={{ padding: pad, color: '#111827', fontWeight: '500', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'default' }}>{row.name}</td>
                      <td style={{ padding: pad, textAlign: 'center', color: '#374151', fontWeight: '600' }}>{row.total}</td>
                      <td style={{ padding: pad, textAlign: 'center' }}>
                        <span style={{ backgroundColor: row.rtoPct >= 50 ? '#fee2e2' : row.rtoPct >= 25 ? '#fef3c7' : '#d1fae5', color: row.rtoPct >= 50 ? '#991b1b' : row.rtoPct >= 25 ? '#92400e' : '#065f46', padding: '2px 7px', borderRadius: '99px', fontWeight: '700', fontSize: '11px' }}>
                          {row.rtoPct}%
                        </span>
                      </td>
                      <td style={{ padding: pad, textAlign: 'center', color: '#059669', fontWeight: '600' }}>{row.delivered}</td>
                      {showInTransit && <td style={{ padding: pad, textAlign: 'center', color: '#3b82f6', fontWeight: '600' }}>{row.inTransit ?? 0}</td>}
                      <td style={{ padding: pad, textAlign: 'center', color: '#ef4444', fontWeight: '700' }}>{row.rto}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Pagination bar */}
            {showPagination && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderTop: '1px solid #f3f4f6', backgroundColor: '#fafafa', marginTop: 'auto' }}>
                <span style={{ fontSize: '12px', color: '#6b7280' }}>
                  {page * CARD_PAGE + 1}–{Math.min((page + 1) * CARD_PAGE, data.length)} of {data.length}
                </span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                    style={{ fontSize: '12px', fontWeight: '600', padding: '4px 10px', borderRadius: '6px', border: '1px solid #e5e7eb', background: page === 0 ? '#f9fafb' : '#fff', color: page === 0 ? '#9ca3af' : '#374151', cursor: page === 0 ? 'default' : 'pointer', transition: 'all 0.15s' }}>
                    ← Prev
                  </button>
                  <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                    style={{ fontSize: '12px', fontWeight: '600', padding: '4px 10px', borderRadius: '6px', border: '1px solid #e5e7eb', background: page >= totalPages - 1 ? '#f9fafb' : '#fff', color: page >= totalPages - 1 ? '#9ca3af' : '#374151', cursor: page >= totalPages - 1 ? 'default' : 'pointer', transition: 'all 0.15s' }}>
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Pie chart side — always top-5 */}
          <div style={{ width: fullWidth ? '220px' : '180px', flexShrink: 0, borderLeft: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 0' }}>
            <ResponsiveContainer width={pieW} height={pieW}>
              <PieChart>
                <Pie
                  data={pieData.map(r => ({ name: r.name, value: r.rto }))}
                  dataKey="value" nameKey="name"
                  cx="50%" cy="50%" innerRadius={innerR} outerRadius={outerR} isAnimationActive={false}>
                  {pieData.map((_, i) => <Cell key={i} fill={RTO_COLORS[i]} />)}
                </Pie>
                <Tooltip formatter={(value, name) => [`${value} RTO`, name]}
                  contentStyle={{ fontSize: '11px', borderRadius: '6px', border: '1px solid #e5e7eb' }}
                  wrapperStyle={{ outline: 'none' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useMemo } from "react";

const CARD_DEFAULT = 5;
const CARD_PAGE = 20;

export default function ProductRevenue({ data = [] }) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  const [sortField, setSortField] = useState('expected'); // default sort by expected amount
  const [sortDir, setSortDir] = useState('desc');

  const totalExpectedAllProducts = useMemo(() => {
    return data.reduce((sum, row) => sum + (row.expected || 0), 0);
  }, [data]);

  const processedData = useMemo(() => {
    return data.map(row => {
      const expected = row.expected || 0;
      const expectedPct = 100;
      const deliveredPct = expected > 0 ? ((row.delivered || 0) / expected) * 100 : 0;
      const inTransitPct = expected > 0 ? ((row.inTransit || 0) / expected) * 100 : 0;
      const unfulfilledPct = expected > 0 ? ((row.unfulfilled || 0) / expected) * 100 : 0;
      const lostPct = expected > 0 ? ((row.lost || 0) / expected) * 100 : 0;

      return {
        ...row,
        expectedPct,
        deliveredPct,
        inTransitPct,
        unfulfilledPct,
        lostPct
      };
    });
  }, [data]);

  const sortedData = useMemo(() => {
    return [...processedData].sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (typeof valA === 'string') {
        return sortDir === 'desc'
          ? valB.localeCompare(valA)
          : valA.localeCompare(valB);
      }

      valA = valA ?? 0;
      valB = valB ?? 0;
      return sortDir === 'desc' ? valB - valA : valA - valB;
    });
  }, [processedData, sortField, sortDir]);

  const totals = useMemo(() => {
    let expected = 0;
    let delivered = 0;
    let inTransit = 0;
    let unfulfilled = 0;
    let lost = 0;

    data.forEach(row => {
      expected += row.expected || 0;
      delivered += row.delivered || 0;
      inTransit += row.inTransit || 0;
      unfulfilled += row.unfulfilled || 0;
      lost += row.lost || 0;
    });

    const expectedPct = expected > 0 ? 100 : 0;
    const deliveredPct = expected > 0 ? (delivered / expected) * 100 : 0;
    const inTransitPct = expected > 0 ? (inTransit / expected) * 100 : 0;
    const unfulfilledPct = expected > 0 ? (unfulfilled / expected) * 100 : 0;
    const lostPct = expected > 0 ? (lost / expected) * 100 : 0;

    return {
      expected,
      expectedPct,
      delivered,
      deliveredPct,
      inTransit,
      inTransitPct,
      unfulfilled,
      unfulfilledPct,
      lost,
      lostPct
    };
  }, [data]);

  const visibleRows = expanded
    ? sortedData.slice(page * CARD_PAGE, (page + 1) * CARD_PAGE)
    : sortedData.slice(0, CARD_DEFAULT);

  const totalPages = Math.ceil(sortedData.length / CARD_PAGE);
  const showPagination = expanded && sortedData.length > CARD_PAGE;

  const handleToggle = () => {
    setExpanded(e => !e);
    setPage(0);
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(prev => prev === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
    setPage(0);
  };

  const formatAmount = (val) => {
    return `Rs. ${Math.round(Number(val)).toLocaleString('en-IN', {
      maximumFractionDigits: 0
    })}`;
  };

  const formatPct = (val) => {
    return `${Number(val).toFixed(1)}%`;
  };

  const renderSortHeader = (field, displayName, colspan = 1, rowspan = 1, align = 'center') => {
    const isActive = sortField === field;
    const arrow = isActive ? (sortDir === 'desc' ? '⮝' : '⮟') : '⮝';
    return (
      <th
        colSpan={colspan}
        rowSpan={rowspan}
        style={{
          padding: '10px 12px',
          textAlign: align,
          color: '#4b5563',
          fontWeight: '600',
          cursor: 'pointer',
          userSelect: 'none',
          transition: 'color 0.15s ease',
          whiteSpace: 'nowrap',
          border: '1px solid #e5e7eb',
          backgroundColor: '#f9fafb',
        }}
        onClick={() => handleSort(field)}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = '#111827';
          e.currentTarget.style.backgroundColor = '#f3f4f6';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = '#4b5563';
          e.currentTarget.style.backgroundColor = '#f9fafb';
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: align === 'left' ? 'flex-start' : 'center', gap: '4px', width: '100%' }}>
          {displayName}
          <span style={{ fontWeight: '800', fontSize: '11px', color: isActive ? '#6366f1' : '#d1d5db' }}>
            {arrow}
          </span>
        </span>
      </th>
    );
  };

  const renderSubHeader = (field, displayName) => {
    return renderSortHeader(field, displayName, 1, 1, 'center');
  };

  return (
    <div style={{ backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: '20px' }}>
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid #f3f4f6', backgroundColor: '#fafafa', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '15px', fontWeight: '700', color: '#111827' }}>💰 Product Revenue Summary</span>
        {data.length > CARD_DEFAULT && (
          <button
            onClick={handleToggle}
            style={{ fontSize: '12px', fontWeight: '600', color: '#6366f1', background: '#eef2ff', border: 'none', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer' }}
          >
            {expanded ? 'View Less ↑' : `View All (${data.length}) ↓`}
          </button>
        )}
      </div>

      {data.length === 0 ? (
        <div style={{ padding: '32px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>No product revenue data in selected period</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', border: '1px solid #e5e7eb' }}>
              <thead>
                {/* Main headers */}
                <tr>
                  <th rowSpan={2} style={{ padding: '10px 12px', textAlign: 'center', color: '#4b5563', fontWeight: '600', width: '36px', border: '1px solid #e5e7eb', backgroundColor: '#f9fafb' }}>#</th>
                  {renderSortHeader('name', 'Product', 1, 2, 'left')}
                  <th colSpan={2} style={{ padding: '8px 12px', textAlign: 'center', color: '#4f46e5', fontWeight: '700', border: '1px solid #e5e7eb', backgroundColor: '#f5f3ff' }}>Expected Revenue</th>
                  <th colSpan={2} style={{ padding: '8px 12px', textAlign: 'center', color: '#10b981', fontWeight: '700', border: '1px solid #e5e7eb', backgroundColor: '#ecfdf5' }}>Delivered Revenue</th>
                  <th colSpan={2} style={{ padding: '8px 12px', textAlign: 'center', color: '#3b82f6', fontWeight: '700', border: '1px solid #e5e7eb', backgroundColor: '#eff6ff' }}>In-Transit Revenue</th>
                  <th colSpan={2} style={{ padding: '8px 12px', textAlign: 'center', color: '#f59e0b', fontWeight: '700', border: '1px solid #e5e7eb', backgroundColor: '#fffbeb' }}>Unfulfilled Revenue</th>
                  <th colSpan={2} style={{ padding: '8px 12px', textAlign: 'center', color: '#ef4444', fontWeight: '700', border: '1px solid #e5e7eb', backgroundColor: '#fef2f2' }}>Lost Revenue</th>
                </tr>
                {/* Sub headers for Amount & % */}
                <tr>
                  {renderSubHeader('expected', 'Amount')}
                  {renderSubHeader('expectedPct', '%')}
                  {renderSubHeader('delivered', 'Amount')}
                  {renderSubHeader('deliveredPct', '%')}
                  {renderSubHeader('inTransit', 'Amount')}
                  {renderSubHeader('inTransitPct', '%')}
                  {renderSubHeader('unfulfilled', 'Amount')}
                  {renderSubHeader('unfulfilledPct', '%')}
                  {renderSubHeader('lost', 'Amount')}
                  {renderSubHeader('lostPct', '%')}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, i) => {
                  const globalIdx = expanded ? page * CARD_PAGE + i : i;
                  return (
                    <tr key={row.name} style={{ borderTop: '1px solid #f3f4f6', backgroundColor: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                      {/* Index */}
                      <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: '700', fontSize: '13px', color: '#9ca3af', borderRight: '1px solid #e5e7eb' }}>
                        {globalIdx + 1}
                      </td>
                      {/* Product Name */}
                      <td title={row.name} style={{ padding: '10px 12px', color: '#111827', fontWeight: '500', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', borderRight: '1px solid #e5e7eb', cursor: 'default' }}>
                        {row.name}
                      </td>
                      {/* Expected */}
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#111827', fontWeight: '600', borderRight: '1px solid #f3f4f6' }}>{formatAmount(row.expected)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', color: '#4f46e5', fontWeight: '600', borderRight: '1px solid #e5e7eb' }}>{formatPct(row.expectedPct)}</td>
                      {/* Delivered */}
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#111827', fontWeight: '600', borderRight: '1px solid #f3f4f6' }}>{formatAmount(row.delivered)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', color: '#059669', fontWeight: '600', borderRight: '1px solid #e5e7eb' }}>{formatPct(row.deliveredPct)}</td>
                      {/* In Transit */}
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#111827', fontWeight: '600', borderRight: '1px solid #f3f4f6' }}>{formatAmount(row.inTransit)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', color: '#2563eb', fontWeight: '600', borderRight: '1px solid #e5e7eb' }}>{formatPct(row.inTransitPct)}</td>
                      {/* Unfulfilled */}
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#111827', fontWeight: '600', borderRight: '1px solid #f3f4f6' }}>{formatAmount(row.unfulfilled)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', color: '#d97706', fontWeight: '600', borderRight: '1px solid #e5e7eb' }}>{formatPct(row.unfulfilledPct)}</td>
                      {/* Lost */}
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#111827', fontWeight: '600', borderRight: '1px solid #f3f4f6' }}>{formatAmount(row.lost)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', color: '#dc2626', fontWeight: '600', borderRight: '1px solid #e5e7eb' }}>{formatPct(row.lostPct)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                {/* Total Row */}
                <tr style={{ borderTop: '2px solid #9ca3af', borderBottom: '2px solid #9ca3af', backgroundColor: '#f9fafb', fontWeight: '700' }}>
                  <td style={{ padding: '10px 12px', textAlign: 'center', color: '#9ca3af', fontWeight: '700', borderRight: '1px solid #e5e7eb' }}>-</td>
                  <td style={{ padding: '10px 12px', color: '#111827', fontWeight: '700', borderRight: '1px solid #e5e7eb' }}>Total</td>
                  {/* Expected */}
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#111827', fontWeight: '700', borderRight: '1px solid #f3f4f6' }}>{formatAmount(totals.expected)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', color: '#4f46e5', fontWeight: '700', borderRight: '1px solid #e5e7eb' }}>{formatPct(totals.expectedPct)}</td>
                  {/* Delivered */}
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#111827', fontWeight: '700', borderRight: '1px solid #f3f4f6' }}>{formatAmount(totals.delivered)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', color: '#059669', fontWeight: '700', borderRight: '1px solid #e5e7eb' }}>{formatPct(totals.deliveredPct)}</td>
                  {/* In Transit */}
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#111827', fontWeight: '700', borderRight: '1px solid #f3f4f6' }}>{formatAmount(totals.inTransit)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', color: '#2563eb', fontWeight: '700', borderRight: '1px solid #e5e7eb' }}>{formatPct(totals.inTransitPct)}</td>
                  {/* Unfulfilled */}
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#111827', fontWeight: '700', borderRight: '1px solid #f3f4f6' }}>{formatAmount(totals.unfulfilled)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', color: '#d97706', fontWeight: '700', borderRight: '1px solid #e5e7eb' }}>{formatPct(totals.unfulfilledPct)}</td>
                  {/* Lost */}
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#111827', fontWeight: '700', borderRight: '1px solid #f3f4f6' }}>{formatAmount(totals.lost)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', color: '#dc2626', fontWeight: '700', borderRight: '1px solid #e5e7eb' }}>{formatPct(totals.lostPct)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Pagination */}
          {showPagination && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderTop: '1px solid #f3f4f6', backgroundColor: '#fafafa' }}>
              <span style={{ fontSize: '12px', color: '#6b7280' }}>
                {page * CARD_PAGE + 1}–{Math.min((page + 1) * CARD_PAGE, data.length)} of {data.length}
              </span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                  style={{ fontSize: '12px', fontWeight: '600', padding: '4px 10px', borderRadius: '6px', border: '1px solid #e5e7eb', background: page === 0 ? '#f9fafb' : '#fff', color: page === 0 ? '#9ca3af' : '#374151', cursor: page === 0 ? 'default' : 'pointer' }}>
                  ← Prev
                </button>
                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                  style={{ fontSize: '12px', fontWeight: '600', padding: '4px 10px', borderRadius: '6px', border: '1px solid #e5e7eb', background: page >= totalPages - 1 ? '#f9fafb' : '#fff', color: page >= totalPages - 1 ? '#9ca3af' : '#374151', cursor: page >= totalPages - 1 ? 'default' : 'pointer' }}>
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

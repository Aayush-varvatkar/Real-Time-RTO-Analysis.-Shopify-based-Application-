/**
 * Skeleton loading placeholders shown while deferred order data resolves.
 * Renders immediately on page load so the user sees structure instead of a blank page.
 */

const shimmer = {
  background: 'linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)',
  backgroundSize: '200% 100%',
  animation: 'shimmer 1.5s infinite',
  borderRadius: '8px',
};

const shimmerKeyframes = `
  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
`;

function SkeletonBox({ width = '100%', height = '20px', style = {} }) {
  return <div style={{ ...shimmer, width, height, ...style }} />;
}

function SkeletonCard({ height = '120px' }) {
  return (
    <div style={{
      backgroundColor: '#fff',
      borderRadius: '12px',
      padding: '20px',
      boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
      border: '1px solid #f0f0f0',
    }}>
      <SkeletonBox width="40%" height="14px" style={{ marginBottom: '12px' }} />
      <SkeletonBox width="60%" height={height} />
    </div>
  );
}

export function SkeletonDashboard() {
  return (
    <>
      <style>{shimmerKeyframes}</style>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Order metric cards row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
          {[...Array(5)].map((_, i) => (
            <SkeletonCard key={i} height="48px" />
          ))}
        </div>

        {/* Revenue cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
          {[...Array(4)].map((_, i) => (
            <SkeletonCard key={i} height="36px" />
          ))}
        </div>

        {/* Chart placeholder */}
        <div style={{
          backgroundColor: '#fff',
          borderRadius: '12px',
          padding: '24px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
          border: '1px solid #f0f0f0',
        }}>
          <SkeletonBox width="30%" height="16px" style={{ marginBottom: '20px' }} />
          <SkeletonBox width="100%" height="240px" />
        </div>

        {/* Two-column section */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <SkeletonCard height="180px" />
          <SkeletonCard height="180px" />
        </div>
      </div>
    </>
  );
}

export function SkeletonOrdersTable() {
  return (
    <>
      <style>{shimmerKeyframes}</style>
      <div style={{
        backgroundColor: '#fff',
        borderRadius: '12px',
        padding: '24px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
        border: '1px solid #f0f0f0',
      }}>
        <SkeletonBox width="20%" height="16px" style={{ marginBottom: '20px' }} />
        {[...Array(8)].map((_, i) => (
          <SkeletonBox key={i} width="100%" height="40px" style={{ marginBottom: '8px' }} />
        ))}
      </div>
    </>
  );
}

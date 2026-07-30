import BreakdownBarChart from "./BreakdownBarChart";

export default function RevenueBarChart({ activeCard, productRevenues = [], onClose }) {
  return (
    <BreakdownBarChart
      activeCard={activeCard}
      data={productRevenues}
      type="revenue"
      onClose={onClose}
    />
  );
}

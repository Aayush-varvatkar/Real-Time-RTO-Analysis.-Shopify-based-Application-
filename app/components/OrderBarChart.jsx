import BreakdownBarChart from "./BreakdownBarChart";

export default function OrderBarChart({ activeCard, products = [], onClose }) {
  return (
    <BreakdownBarChart
      activeCard={activeCard}
      data={products}
      type="quantity"
      onClose={onClose}
    />
  );
}

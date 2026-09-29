export default function Toast({ show, message, type }) {
  return (
    <div className={`toast ${show ? "show" : ""} ${type ? type : ""}`}>
      <div className="t-dot"></div>
      <span>{message}</span>
    </div>
  );
}

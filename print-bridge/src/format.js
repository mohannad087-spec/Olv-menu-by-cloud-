function formatMoney(n) {
  return Number(n || 0).toFixed(2);
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(ts) {
  return new Date(ts).toLocaleString("ar-EG", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

module.exports = { formatMoney, formatTime, formatDateTime };

// Mirrors the Python generators' fmt_money/money helpers: "$1,234" with
// parentheses when negative. Display-only — structured payload fields stay raw.
function formatMoney(amount) {
  const text = `$${Math.round(Math.abs(amount)).toLocaleString("en-US")}`;
  return amount < 0 ? `(${text})` : text;
}

module.exports = { formatMoney };

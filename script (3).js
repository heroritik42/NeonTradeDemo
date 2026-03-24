let trades = [], history = [];
let balance = 100, wins = 0, total = 0;
let price = 0;

const BOT_TOKEN = "8680897603:AAG1q6d4VU-hI-xN04uxVuIM3IzoRpD0_Ac";
const CHAT_ID = "895422832";

function sendTelegram(msg) {
  fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg })
  });
}

// Get references to inputs
const amount = document.getElementById("amount");
const leverage = document.getElementById("leverage");
const sl = document.getElementById("sl");
const tp = document.getElementById("tp");

// CHART
new TradingView.widget({
  symbol: "BINANCE:BTCUSDT",
  interval: "5",
  theme: "dark",
  container_id: "chart"
});

// PRICE FETCH
async function getPrice() {
  try {
    let r = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
    let d = await r.json();
    price = parseFloat(d.price);
  } catch {
    // network errors silently ignored
  }
}
setInterval(getPrice, 2000);
getPrice();

// INDICATORS (RSI, EMA)
async function getKlines() {
  try {
    let r = await fetch("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=20");
    let d = await r.json();

    let closes = d.map(x => parseFloat(x[4]));
    let ema = closes.reduce((a, b) => a + b) / closes.length;

    let gain = 0, loss = 0;
    for (let i = 1; i < closes.length; i++) {
      let diff = closes[i] - closes[i - 1];
      if (diff > 0) gain += diff;
      else loss += Math.abs(diff);
    }
    let rs = loss ? gain / loss : 0;
    let rsi = 100 - (100 / (1 + rs));

    document.getElementById("indicators").innerHTML =
      `RSI: ${rsi.toFixed(1)} | EMA: ${ema.toFixed(2)}`;
  } catch {
    // ignore
  }
}
setInterval(getKlines, 3000);
getKlines();

// OPEN TRADE
function openTrade(type) {
  let amt = parseFloat(amount.value);
  let lev = parseInt(leverage.value);
  let slp = parseFloat(sl.value);
  let tpp = parseFloat(tp.value);

  if (isNaN(amt) || amt <= 0) return alert("Enter valid USDT amount!");
  if (isNaN(lev) || lev <= 0 || lev > 125) return alert("Enter leverage 1-125!");
  if (isNaN(slp) || slp <= 0) return alert("Enter positive SL %!");
  if (isNaN(tpp) || tpp <= 0) return alert("Enter positive TP %!");
  if (amt > balance) return alert("Insufficient Balance!");

  let entry = price;
  if (!entry || entry <= 0) return alert("Current price not available!");

  let slPrice = type === "long" ? entry * (1 - slp / 100) : entry * (1 + slp / 100);
  let tpPrice = type === "long" ? entry * (1 + tpp / 100) : entry * (1 - tpp / 100);

  // Reduce balance upfront - demo margin locked:
  balance -= amt;

  trades.push({
    id: Date.now(),
    type, entry, amt, lev,
    sl: slPrice, tp: tpPrice,
    status: "open",
    live: 0
  });

  sendTelegram(`Opened ${type.toUpperCase()} Trade at ${entry.toFixed(2)} with Amt $${amt} Lev ${lev}`);

  // Reset inputs for faster entry
  amount.value = "";
  sl.value = "";
  tp.value = "";

  render();
}

// TRACK TRADES every 2 seconds
setInterval(() => {

  trades.forEach(t => {
    if (t.status !== "open") return;

    // Calculate PnL ratio
    let pnlRatio = t.type === "long"
      ? (price - t.entry) / t.entry
      : (t.entry - price) / t.entry;

    // Calculate profit considering leverage
    let profit = t.amt * pnlRatio * t.lev;
    t.live = profit;

    // SL hit
    if ((t.type === "long" && price <= t.sl) || (t.type === "short" && price >= t.sl)) {
      closeTrade(t, "Stop Loss");
    }

    // TP hit
    if ((t.type === "long" && price >= t.tp) || (t.type === "short" && price <= t.tp)) {
      closeTrade(t, "Take Profit");
    }
  });

  render();

}, 2000);

// CLOSE TRADE MANUAL
function manualClose(id) {
  let t = trades.find(x => x.id === id);
  if (t) closeTrade(t, "Manual Close");
}

// CLOSE TRADE
function closeTrade(t, reason) {
  if (t.status !== "open") return;

  t.status = "closed";
  t.reason = reason;

  // Release margin + profit/loss
  balance += t.amt + (t.live || 0);

  history.push(t);

  total++;
  if ((t.live || 0) > 0) wins++;

  sendTelegram(`Closed trade (${reason}) PnL: $${t.live.toFixed(2)}`);
  render();
}

// ADD BALANCE (prompt)
function addBalance() {
  let a = prompt("Amount to Add:");
  let val = parseFloat(a);
  if (!isNaN(val) && val > 0) {
    balance += val;
    render();
  }
}

// CANCEL ALL OPEN TRADES
function cancelAllTrades() {
  let openTrades = trades.filter(t => t.status === "open");
  openTrades.forEach(t => {
    // Return margin only, no PnL since cancelled
    balance += t.amt;
    t.status = "closed";
    t.reason = "Cancelled";
    history.push(t);
  });
  render();
}

// RENDER UI
function render() {
  // Positions panel
  let html = `<h3>Positions</h3>`;
  let openTrades = trades.filter(t => t.status === "open");
  if (openTrades.length === 0) html += `<p>No open positions</p>`;

  openTrades.forEach(t => {
    html += `
      <div class="position-row">
        <div class="position-info">
          <b>${t.type.toUpperCase()}</b> | Entry: ${t.entry.toFixed(2)} | Amt: $${t.amt} | Lev: ${t.lev}x<br>
          PnL: <span style="color:${t.live >= 0 ? '#0f0' : '#f00'}">$${t.live.toFixed(2)}</span><br>
          SL: ${t.sl.toFixed(2)} | TP: ${t.tp.toFixed(2)}
        </div>
        <button class="position-btn" onclick="manualClose(${t.id})">Close</button>
      </div>`;
  });

  document.getElementById("positions").innerHTML = html;

  // History panel
  let h = `<h3>Journal</h3>`;
  if (history.length === 0) h += `<p>No trade history yet.</p>`;

  history.slice(-50).reverse().forEach(t => {
    let prof = t.live.toFixed(2);
    let profColor = t.live >= 0 ? "#0f0" : "#f00";
    h += `${t.reason} | <b style="color:${profColor}">$${prof}</b> | ${t.type.toUpperCase()} | Entry:${t.entry.toFixed(2)} | Amt:$${t.amt} | Lev:${t.lev}x<br>`;
  });

  document.getElementById("history").innerHTML = h;

  // Stats
  let wr = total ? ((wins / total) * 100).toFixed(1) : "0.0";

  document.getElementById("balance").innerText = balance.toFixed(2);
  document.getElementById("winrate").innerText = wr;
}

render();

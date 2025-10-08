// backend/server.js
import express from "express";
import fetch from "node-fetch";
import { LRUCache } from "lru-cache";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Si vas a servir UI y API desde el mismo dominio, podés comentar CORS.
// En desarrollo múltiple (puertos 3000/4200), dejalo habilitado.
app.use(cors());

// ---------- Cache y helpers ----------
const cache = new LRUCache({ max: 500, ttl: 1000 * 60 }); // 60s
const CG = "https://api.coingecko.com/api/v3";

async function cg(pathStr) {
  const url = `${CG}${pathStr}`;
  if (cache.has(url)) return cache.get(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko ${res.status} ${pathStr}`);
  const data = await res.json();
  cache.set(url, data);
  return data;
}

function downsample(points, target = 48) {
  if (!points || points.length <= target) return points;
  const step = Math.floor(points.length / target);
  const out = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  return out;
}

function rsi(values, period = 14) {
  if (!values || values.length < period + 1) return null;
  const gains = [], losses = [];
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gains.push(Math.max(d, 0));
    losses.push(Math.max(-d, 0));
  }
  let avgG = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgL = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < gains.length; i++) {
    avgG = (avgG * (period - 1) + gains[i]) / period;
    avgL = (avgL * (period - 1) + losses[i]) / period;
  }
  const RS = avgL === 0 ? Infinity : avgG / avgL;
  return 100 - 100 / (1 + RS);
}

async function getSparkline(coinId, days) {
  const data = await cg(`/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`);
  return downsample((data?.prices ?? []).map(p => p[1]), 48);
}

// ---------- API ----------
app.get("/api", (_, res) => res.json({ ok: true, service: "crypto-backend" }));

app.get("/api/dashboard", async (req, res) => {
  try {
    const ids = (req.query.ids ?? "bitcoin,ethereum,solana,cardano,polkadot,tron,chainlink,polygon")
      .toString()
      .split(",");

    const base = await cg(`/coins/markets?vs_currency=usd&ids=${ids.join(",")}&order=market_cap_desc&per_page=${ids.length}&page=1&sparkline=false&price_change_percentage=24h,7d,30d`);

    const out = await Promise.all(
      base.map(async c => {
        const [s1d, s7d, s30d] = await Promise.all([
          getSparkline(c.id, 1),
          getSparkline(c.id, 7),
          getSparkline(c.id, 30)
        ]);
        return {
          id: c.id,
          symbol: (c.symbol || "").toUpperCase(),
          name: c.name,
          image: c.image,
          price: c.current_price,
          change24h: c.price_change_percentage_24h_in_currency,
          change7d: c.price_change_percentage_7d_in_currency,
          change30d: c.price_change_percentage_30d_in_currency,
          spark24h: s1d,
          spark7d: s7d,
          spark30d: s30d,
          rsi: rsi(s1d)
        };
      })
    );

    res.json({ count: out.length, results: out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/coin/:id/history", async (req, res) => {
  try {
    const { id } = req.params;
    const days = req.query.days ?? 90;
    const interval = req.query.interval ?? "daily";
    const data = await cg(`/coins/${id}/market_chart?vs_currency=usd&days=${days}&interval=${interval}`);
    res.json(data); // { prices, market_caps, total_volumes }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ------- Servir Angular estático -------
const distPath = path.join(__dirname, "..", "dist", "crypto-dashboard", "browser");
app.use(express.static(distPath));

// Catch-all para rutas del SPA (excepto /api)
app.use((req, res, next) => {
  if (req.path.startsWith("/api")) return res.status(404).json({ error: "Not found" });
  res.sendFile(path.join(distPath, "index.html"));
});


// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ App corriendo en http://localhost:${PORT}`));

// backend/server.js
import express from "express";
// ❌ Ya no usamos node-fetch: Node 18+ trae fetch nativo
import { LRUCache } from "lru-cache";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_FILE = path.join(__dirname, "cache", "market-data.json");

const app = express();

// Asegurarnos que existe el directorio cache
await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });

// Seguridad y rendimiento
app.use(
  helmet({
    // Necesario para servir estáticos (Angular) desde el mismo servidor
    crossOriginResourcePolicy: false,
  })
);
app.use(compression());

// CORS: solo en desarrollo, si UI y API van por dominios/puertos distintos
if (process.env.NODE_ENV !== "production") {
  app.use(cors());
}

// ---------- Cache y helpers ----------
const priceCache = new LRUCache({
  max: 100,
  ttl: 1000 * 60 * 2, // 2 minutos para precios
});

const sparklineCache = new LRUCache({
  max: 500,
  ttl: 1000 * 60 * 15, // 15 minutos para sparklines
});

// Cache para /api/coin/:id/history (opcional, 10 min)
const historyCache = new LRUCache({
  max: 200,
  ttl: 1000 * 60 * 10,
});

const CG = "https://api.coingecko.com/api/v3";

// ---------- Request Queue (Rate Limiting real) ----------
// ~1 request/segundo. Ajustá según tolerancia de CoinGecko y tus necesidades.
const QUEUE_INTERVAL_MS = 1100;
let queue = Promise.resolve();
let lastDequeue = 0;

function enqueue(task) {
  // Garantiza orden y espaciamiento real entre requests
  queue = queue
    .then(async () => {
      const now = Date.now();
      const wait = Math.max(0, QUEUE_INTERVAL_MS - (now - lastDequeue));
      if (wait) {
        console.log(
          "\x1b[36m%s\x1b[0m",
          `⏳ Esperando ${Math.ceil(wait / 1000)}s para respetar rate limit...`
        );
        await new Promise((r) => setTimeout(r, wait));
      }
      lastDequeue = Date.now();
      return task();
    })
    .catch((e) => {
      // Evitar que la cola se rompa por errores
      console.error("\x1b[31m%s\x1b[0m", "❌ Error en tarea de cola:", e);
    });
  return queue;
}

// ---------- HTTP client a CoinGecko con cola + timeout ----------
async function cg(pathStr, useCache = priceCache) {
  const url = `${CG}${pathStr}`;

  // Cache en memoria
  if (useCache.has(url)) {
    console.log("\x1b[36m%s\x1b[0m", "💾 Usando cache en memoria");
    return useCache.get(url);
  }

  // Todas las llamadas a CG pasan por la cola
  return enqueue(async () => {
    console.log("\x1b[90m%s\x1b[0m", `📡 Llamando a CoinGecko API: ${url}`);

    const doFetch = async () => {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Crypto Dashboard/1.0",
        },
        // Reemplaza timeout: 5000
        signal: AbortSignal.timeout(5000),
      });
      return res;
    };

    // Primer intento
    let res = await doFetch();

    if (res.status === 429) {
      console.log(
        "\x1b[33m%s\x1b[0m",
        "⚠️ Rate limit alcanzado (429). Enfriando 60s y reintentando una vez…"
      );
      await new Promise((r) => setTimeout(r, 60_000));
      res = await doFetch(); // único retry
    }

    if (!res.ok) {
      const err = new Error(`${res.status} ${res.statusText}`);
      console.log("\x1b[31m%s\x1b[0m", `❌ Error en CoinGecko: ${err.message}`);
      throw err;
    }

    const data = await res.json();
    useCache.set(url, data);
    console.log("\x1b[36m%s\x1b[0m", "📥 Respuesta recibida de la API");
    return data;
  });
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
  const gains = [],
    losses = [];
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
  const value = 100 - 100 / (1 + RS);
  if (Number.isFinite(value)) return value;
  // Evitar Infinity/NaN serializando
  return 100.0;
}

async function getSparkline(coinId, days) {
  try {
    const data = await cg(
      `/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`,
      sparklineCache
    );
    return downsample((data?.prices ?? []).map((p) => p[1]), 48);
  } catch (error) {
    console.log(
      "\x1b[33m%s\x1b[0m",
      `⚠️ No se pudo obtener sparkline para ${coinId}, usando datos vacíos`
    );
    return [];
  }
}

// mapLimit: paralelismo limitado (por ejemplo, 3 tareas a la vez)
async function mapLimit(arr, limit, mapper) {
  const ret = new Array(arr.length);
  let i = 0;
  let active = 0;
  return new Promise((resolve, reject) => {
    const next = () => {
      if (i === arr.length && active === 0) return resolve(ret);
      while (active < limit && i < arr.length) {
        const idx = i++;
        active++;
        Promise.resolve(mapper(arr[idx], idx))
          .then((val) => (ret[idx] = val))
          .catch(reject)
          .finally(() => {
            active--;
            next();
          });
      }
    };
    next();
  });
}

// ---------- API ----------
app.get("/api", (_, res) => res.json({ ok: true, service: "crypto-backend" }));

async function loadCacheFile() {
  try {
    const data = await fs.readFile(CACHE_FILE, "utf8");
    const parsed = JSON.parse(data);

    if (!parsed.data || !Array.isArray(parsed.data)) {
      console.log("\x1b[33m%s\x1b[0m", "⚠️ Formato de cache inválido");
      return { lastUpdate: "", data: [] };
    }

    const lastUpdate = new Date(parsed.lastUpdate);
    const now = new Date();
    const diffMinutes = (now - lastUpdate) / 1000 / 60;

    if (diffMinutes > 5) {
      console.log(
        "\x1b[33m%s\x1b[0m",
        `⚠️ Cache en disco antiguo (${Math.round(diffMinutes)} minutos)`
      );
    }

    return parsed;
  } catch (e) {
    console.log(
      "\x1b[33m%s\x1b[0m",
      "⚠️ No se pudo leer el archivo de cache:",
      e.message
    );
    return { lastUpdate: "", data: [] };
  }
}

async function saveCacheFile(data) {
  try {
    const cacheData = {
      lastUpdate: new Date().toISOString(),
      data,
    };

    await fs.writeFile(CACHE_FILE, JSON.stringify(cacheData, null, 2));
    console.log("\x1b[32m%s\x1b[0m", "💾 Cache guardado en disco correctamente");
  } catch (e) {
    console.log("\x1b[31m%s\x1b[0m", "❌ Error guardando cache en disco:", e.message);
  }
}

app.get("/api/dashboard", async (req, res) => {
  try {
    const ids = (req.query.ids ??
      "bitcoin,ethereum,solana,cardano,polkadot,tron,chainlink,polygon")
      .toString()
      .split(",");

    // 1) Intentar responder rápido con caché en disco (si existe)
    const cached = await loadCacheFile();
    let cachedData = [];
    if (cached.data && cached.data.length > 0) {
      cachedData = cached.data.filter((item) => ids.includes(item.id));
      if (cachedData.length > 0) {
        // Importante: headers antes del body
        if (cached.lastUpdate) {
          res.setHeader(
            "Last-Modified",
            new Date(cached.lastUpdate).toUTCString()
          );
        }
        console.log(
          "\x1b[36m%s\x1b[0m",
          "💾 Enviando datos del cache mientras actualizamos..."
        );
        console.log(
          "\x1b[90m%s\x1b[0m",
          `   └─ Última actualización: ${cached.lastUpdate}`
        );
        // Enviar cache inmediatamente
        res.json({
          count: cachedData.length,
          results: cachedData,
          fromCache: true,
          lastUpdate: cached.lastUpdate,
        });
        // Seguimos para intentar refrescar (si falla, ya respondimos)
      }
    }

    // 2) Actualizar datos (secuencialmente regulado por cola + paralelismo limitado)
    try {
      const base = await cg(
        `/coins/markets?vs_currency=usd&ids=${ids.join(
          ","
        )}&order=market_cap_desc&per_page=${ids.length}&page=1&sparkline=false&price_change_percentage=24h,7d,30d`
      );

      console.log("\x1b[36m%s\x1b[0m", "📊 Obteniendo datos de sparklines...");

      const out = await mapLimit(base, 3, async (c) => {
        const [s1d, s7d, s30d] = await Promise.all([
          getSparkline(c.id, 1).catch((e) => {
            console.log(
              "\x1b[33m%s\x1b[0m",
              `⚠️ Error en sparkline 1d para ${c.id}:`,
              e.message
            );
            return [];
          }),
          getSparkline(c.id, 7).catch((e) => {
            console.log(
              "\x1b[33m%s\x1b[0m",
              `⚠️ Error en sparkline 7d para ${c.id}:`,
              e.message
            );
            return [];
          }),
          getSparkline(c.id, 30).catch((e) => {
            console.log(
              "\x1b[33m%s\x1b[0m",
              `⚠️ Error en sparkline 30d para ${c.id}:`,
              e.message
            );
            return [];
          }),
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
          rsi: rsi(s1d),
        };
      });

      if (out.length > 0) {
        await saveCacheFile(out);
        console.log(
          "\x1b[32m%s\x1b[0m",
          "✅ Cache actualizado exitosamente en disco"
        );
      } else {
        throw new Error("No se obtuvieron datos para actualizar el cache");
      }

      // Si aún no se había respondido con cache, respondemos ahora con fresco
      if (!cachedData.length) {
        res.json({ count: out.length, results: out, fromCache: false });
      }
    } catch (apiError) {
      console.log(
        "\x1b[31m%s\x1b[0m",
        "❌ Error al actualizar datos:",
        apiError.message
      );
      if (!cachedData.length) {
        // No había cache que mandar -> devolvemos error
        throw apiError;
      }
      // Si ya enviamos cache, no hacemos nada más
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Endpoint específico para monedas con RSI bajo
app.get("/api/oversold", async (req, res) => {
  try {
    const threshold = Number(req.query.threshold) || 30; // RSI threshold, default 30
    const ids = (req.query.ids ??
      "bitcoin,ethereum,solana,cardano,polkadot,tron,chainlink,polygon,avalanche,cosmos")
      .toString()
      .split(",");

    const base = await cg(
      `/coins/markets?vs_currency=usd&ids=${ids.join(
        ","
      )}&order=market_cap_desc&per_page=${ids.length}&page=1&sparkline=false&price_change_percentage=24h,7d,30d`
    );

    console.log(
      "\x1b[36m%s\x1b[0m",
      `🔍 Buscando monedas con RSI < ${threshold}...`
    );

    const enriched = await mapLimit(base, 3, async (coin) => {
      const sparkline = await getSparkline(coin.id, 1);
      const val = rsi(sparkline);
      if (val === null) return null;
      return {
        id: coin.id,
        symbol: (coin.symbol || "").toUpperCase(),
        name: coin.name,
        price: coin.current_price,
        rsi: Number(val.toFixed(2)),
        change24h: coin.price_change_percentage_24h_in_currency,
        sparkline,
      };
    });

    const oversoldCoins = enriched
      .filter(Boolean)
      .filter((c) => c.rsi < threshold)
      .sort((a, b) => a.rsi - b.rsi);

    res.json({
      count: oversoldCoins.length,
      threshold,
      results: oversoldCoins,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/coin/:id/history", async (req, res) => {
  try {
    const { id } = req.params;
    const days = req.query.days ?? 90;
    const interval = req.query.interval ?? "daily";
    const key = `${id}:${days}:${interval}`;
    const pathStr = `/coins/${id}/market_chart?vs_currency=usd&days=${days}&interval=${interval}`;

    // Cache de 10 min para series históricas
    if (historyCache.has(key)) {
      const cached = historyCache.get(key);
      if (cached?.lastUpdate) {
        res.setHeader("Last-Modified", new Date(cached.lastUpdate).toUTCString());
      }
      return res.json(cached.data); // { prices, market_caps, total_volumes }
    }

    const data = await cg(pathStr);
    historyCache.set(key, { lastUpdate: new Date().toISOString(), data });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ------- Servir Angular estático -------
const distPath = path.join(
  __dirname,
  "..",
  "dist",
  "crypto-dashboard",
  "browser"
);
app.use(express.static(distPath));

// Catch-all para rutas del SPA (excepto /api)
app.use((req, res, next) => {
  if (req.path.startsWith("/api"))
    return res.status(404).json({ error: "Not found" });
  res.sendFile(path.join(distPath, "index.html"));
});

// ---------- Graceful Shutdown ----------
process.on("SIGTERM", () => {
  console.log("SIGTERM recibido. Saliendo…");
  process.exit(0);
});
process.on("SIGINT", () => {
  console.log("SIGINT recibido. Saliendo…");
  process.exit(0);
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`✅ App corriendo en http://localhost:${PORT}`)
);

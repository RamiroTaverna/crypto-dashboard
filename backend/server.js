// backend/server.js
import express from "express";
import fetch from "node-fetch";
import { LRUCache } from "lru-cache";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_FILE = path.join(__dirname, 'cache', 'market-data.json');

const app = express();

// Asegurarnos que existe el directorio cache
await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });

// Si vas a servir UI y API desde el mismo dominio, podés comentar CORS.
// En desarrollo múltiple (puertos 3000/4200), dejalo habilitado.
app.use(cors());

// ---------- Cache y helpers ----------
const priceCache = new LRUCache({ 
  max: 100, 
  ttl: 1000 * 60 * 2  // 2 minutos para precios
}); 

const sparklineCache = new LRUCache({ 
  max: 500, 
  ttl: 1000 * 60 * 15  // 15 minutos para sparklines
}); 
const CG = "https://api.coingecko.com/api/v3";

// Control de rate limiting
let lastApiCall = 0;
const MIN_TIME_BETWEEN_CALLS = 10000; // 10 segundos entre llamadas
const RATE_LIMIT_RESET_TIME = 60000; // 1 minuto de espera después de un 429

async function waitForRateLimit() {
  const now = Date.now();
  const timeSinceLastCall = now - lastApiCall;
  
  if (timeSinceLastCall < MIN_TIME_BETWEEN_CALLS) {
    const waitTime = MIN_TIME_BETWEEN_CALLS - timeSinceLastCall;
    console.log('\x1b[36m%s\x1b[0m', `⏳ Esperando ${waitTime/1000}s para respetar rate limit...`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  lastApiCall = Date.now();
}

async function cg(pathStr, useCache = priceCache) {
  const url = `${CG}${pathStr}`;
  
  try {
    // Primero revisamos el cache en memoria
    if (useCache.has(url)) {
      console.log('\x1b[36m%s\x1b[0m', '💾 Usando cache en memoria');
      return useCache.get(url);
    }

    // Esperar si es necesario por el rate limit
    await waitForRateLimit();
    
    console.log('\x1b[90m%s\x1b[0m', `📡 Llamando a CoinGecko API: ${url}`);

    // Si no está en cache, llamamos a la API
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Crypto Dashboard/1.0'
      },
      timeout: 5000 // 5 segundos de timeout
    });

    if (res.status === 429) {
      console.log('\x1b[33m%s\x1b[0m', '⚠️ Rate limit alcanzado, esperando 1 minuto...');
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_RESET_TIME));
      throw new Error('Rate limit alcanzado, reintentando después de espera');
    }

    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    useCache.set(url, data);
    console.log('\x1b[36m%s\x1b[0m', '📥 Respuesta recibida de la API');
    return data;
  } catch (error) {
    console.log('\x1b[31m%s\x1b[0m', `❌ Error en llamada a CoinGecko: ${error.message}`);
    throw error;
  }
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
  try {
    const data = await cg(`/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`, sparklineCache);
    return downsample((data?.prices ?? []).map(p => p[1]), 48);
  } catch (error) {
    console.log('\x1b[33m%s\x1b[0m', `⚠️ No se pudo obtener sparkline para ${coinId}, usando datos vacíos`);
    return [];
  }
}

// ---------- API ----------
app.get("/api", (_, res) => res.json({ ok: true, service: "crypto-backend" }));

async function loadCacheFile() {
  try {
    const data = await fs.readFile(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(data);
    
    if (!parsed.data || !Array.isArray(parsed.data)) {
      console.log('\x1b[33m%s\x1b[0m', '⚠️ Formato de cache inválido');
      return { lastUpdate: '', data: [] };
    }
    
    // Solo informamos si el cache es antiguo, pero lo devolvemos igual
    const lastUpdate = new Date(parsed.lastUpdate);
    const now = new Date();
    const diffMinutes = (now - lastUpdate) / 1000 / 60;
    
    if (diffMinutes > 5) {
      console.log('\x1b[33m%s\x1b[0m', `⚠️ Cache en disco antiguo (${Math.round(diffMinutes)} minutos)`);
    }
    
    return parsed;
  } catch (e) {
    console.log('\x1b[33m%s\x1b[0m', '⚠️ No se pudo leer el archivo de cache:', e.message);
    return { lastUpdate: '', data: [] };
  }
}

async function saveCacheFile(data) {
  try {
    const cacheData = {
      lastUpdate: new Date().toISOString(),
      data
    };
    
    await fs.writeFile(CACHE_FILE, JSON.stringify(cacheData, null, 2));
    console.log('\x1b[32m%s\x1b[0m', '💾 Cache guardado en disco correctamente');
  } catch (e) {
    console.log('\x1b[31m%s\x1b[0m', '❌ Error guardando cache en disco:', e.message);
  }
}

let pendingRequests = 0;

function logRequest(endpoint) {
  if (pendingRequests === 0) {
    console.log('📊 Actualizando datos...');
  }
  pendingRequests++;
}

function logResponse() {
  pendingRequests--;
  if (pendingRequests === 0) {
    console.log('✅ Datos actualizados');
  }
}

function logCache(lastUpdate) {
  console.log(`💾 Usando cache (última actualización: ${lastUpdate})`);
}

let rateLimitWarningShown = false;
function logRateLimit() {
  if (!rateLimitWarningShown) {
    console.log('⚠️ Rate limit alcanzado, las siguientes requests serán retrasadas');
    rateLimitWarningShown = true;
  }
}

app.get("/api/dashboard", async (req, res) => {
  try {
    const ids = (req.query.ids ?? "bitcoin,ethereum,solana,cardano,polkadot,tron,chainlink,polygon")
      .toString()
      .split(",");

    // Cargar datos del cache primero
    const cached = await loadCacheFile();
    let cachedData = [];
    if (cached.data && cached.data.length > 0) {
      cachedData = cached.data.filter(item => ids.includes(item.id));
      
      // Si tenemos datos en cache, los usamos mientras intentamos actualizar
      if (cachedData.length > 0) {
        console.log('\x1b[36m%s\x1b[0m', '💾 Enviando datos del cache mientras actualizamos...');
        console.log('\x1b[90m%s\x1b[0m', `   └─ Última actualización: ${cached.lastUpdate}`);
        res.json({ 
          count: cachedData.length, 
          results: cachedData,
          fromCache: true,
          lastUpdate: cached.lastUpdate
        });
        // Continuamos con la actualización en segundo plano
      }
    }

    // Intentamos actualizar los datos en segundo plano
    try {
      const base = await cg(`/coins/markets?vs_currency=usd&ids=${ids.join(",")}&order=market_cap_desc&per_page=${ids.length}&page=1&sparkline=false&price_change_percentage=24h,7d,30d`);

      console.log('\x1b[36m%s\x1b[0m', '📊 Obteniendo datos de sparklines...');
      const out = [];
      for (const c of base) {
        let s1d = [], s7d = [], s30d = [];
        try {
          [s1d, s7d, s30d] = await Promise.all([
            getSparkline(c.id, 1).catch(e => {
              console.log('\x1b[33m%s\x1b[0m', `⚠️ Error en sparkline 1d para ${c.id}:`, e.message);
              return [];
            }),
            getSparkline(c.id, 7).catch(e => {
              console.log('\x1b[33m%s\x1b[0m', `⚠️ Error en sparkline 7d para ${c.id}:`, e.message);
              return [];
            }),
            getSparkline(c.id, 30).catch(e => {
              console.log('\x1b[33m%s\x1b[0m', `⚠️ Error en sparkline 30d para ${c.id}:`, e.message);
              return [];
            })
          ]);
        } catch (sparklineError) {
          console.log('\x1b[31m%s\x1b[0m', `❌ Error crítico obteniendo sparklines para ${c.id}:`, sparklineError.message);
        }
        
        out.push({
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
        });
      }

      // Asegurarnos de que out tenga datos antes de guardar el cache
      if (out.length > 0) {
        await saveCacheFile(out);
        console.log('\x1b[32m%s\x1b[0m', '✅ Cache actualizado exitosamente en disco');
      } else {
        throw new Error('No se obtuvieron datos para actualizar el cache');
      }
      
      // Solo enviamos la respuesta si no enviamos el cache antes
      if (!cachedData.length) {
        res.json({ count: out.length, results: out });
      }

    } catch (apiError) {
      console.log('\x1b[31m%s\x1b[0m', '❌ Error al actualizar datos:', apiError.message);
      
      // Si no teníamos datos en cache y la API falló, devolvemos error
      if (!cachedData.length) {
        throw apiError;
      }
      // Si ya enviamos datos del cache, simplemente logueamos el error
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Endpoint específico para monedas con RSI bajo
app.get("/api/oversold", async (req, res) => {
  try {
    const threshold = Number(req.query.threshold) || 30; // RSI threshold, default 30
    const ids = (req.query.ids ?? "bitcoin,ethereum,solana,cardano,polkadot,tron,chainlink,polygon,avalanche,cosmos")
      .toString()
      .split(",");

    // Obtener datos base
    const base = await cg(`/coins/markets?vs_currency=usd&ids=${ids.join(",")}&order=market_cap_desc&per_page=${ids.length}&page=1&sparkline=false&price_change_percentage=24h,7d,30d`);
    
    const oversoldCoins = [];
    console.log('\x1b[36m%s\x1b[0m', `🔍 Buscando monedas con RSI < ${threshold}...`);

    // Analizar cada moneda
    for (const coin of base) {
      const sparkline = await getSparkline(coin.id, 1);
      const coinRsi = rsi(sparkline);
      
      if (coinRsi !== null && coinRsi < threshold) {
        oversoldCoins.push({
          id: coin.id,
          symbol: (coin.symbol || "").toUpperCase(),
          name: coin.name,
          price: coin.current_price,
          rsi: Number(coinRsi.toFixed(2)),
          change24h: coin.price_change_percentage_24h_in_currency,
          sparkline: sparkline
        });
      }
    }

    res.json({ 
      count: oversoldCoins.length,
      threshold,
      results: oversoldCoins.sort((a, b) => a.rsi - b.rsi) // Ordenar por RSI ascendente
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

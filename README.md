# 📊 Crypto Dashboard

Dashboard de criptomonedas desarrollado en **Angular** (frontend) y **Node.js + Express** (backend).  
El proyecto consume la **API de CoinGecko** para mostrar precios, variaciones y gráficos históricos de criptos populares.

---

## 🚀 Características

- Listado de criptomonedas populares (BTC, ETH, SOL, BNB, XRP).  
- Búsqueda por símbolo o nombre (`btc`, `bitcoin`, `eth`, etc.).  
- Variación de precio en % con colores (verde/rojo).  
- Gráfico histórico al entrar en el detalle de cada moneda.  
- Backend con caché en memoria (LRU) para optimizar requests a la API.  

---

## 📂 Estructura

```
crypto-dashboard/
├── backend/           # Servidor Express (API local)
│   ├── server.js
│   ├── package.json
│   └── ...
├── src/               # Frontend Angular
├── proxy.conf.json    # Proxy para redirigir /api → backend
├── package.json       # Configuración Angular
└── README.md
```

---

## 🛠️ Instalación

Clonar el repositorio:

```bash
git clone https://github.com/RamiroTaverna/crypto-dashboard.git
cd crypto-dashboard
```

### 1. Instalar dependencias del frontend (Angular)

```bash
npm install
```

### 2. Instalar dependencias del backend (Express)

```bash
cd backend
npm install
cd ..
```

---

## ▶️ Ejecución

Necesitás **dos terminales** abiertas al mismo tiempo:

### 🖥️ Terminal 1 — Backend
```bash
cd backend
npm start
```
Esto levanta el servidor Express en:  
👉 `http://localhost:3000/api`

### 🌐 Terminal 2 — Frontend
En la raíz del proyecto:
```bash
ng serve -o --proxy-config proxy.conf.json
```
Esto levanta Angular en:  
👉 `http://localhost:4200/dashboard`

---

## 📊 Endpoints de prueba del backend

- `http://localhost:3000/api/dashboard?ids=bitcoin,ethereum,solana`
- `http://localhost:3000/api/coin/bitcoin/history?days=30&interval=daily`

---

## 📋 Objetivos del Challenge

- Aprender a consumir APIs externas (CoinGecko).  
- Calcular y mostrar indicadores financieros (ejemplo: RSI).  
- Presentar la información de forma clara y visual en un dashboard estilo exchange.  

---

## 📸 Capturas (ejemplo)

- **Dashboard con lista de criptos**  
- **Detalle de Bitcoin con gráfico histórico**

*(Agregá tus propias capturas cuando tengas la UI corriendo 👀)*

---

## ⚡ Tecnologías

- **Frontend**: Angular 17 + Angular Material + Chart.js  
- **Backend**: Node.js, Express, LRU Cache, node-fetch  
- **API**: [CoinGecko](https://www.coingecko.com/en/api)

---

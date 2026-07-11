require('dotenv').config();
const express = require('express');
const path    = require('path');

const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json({ limit: '10mb' }));

// Раздаём HTML файлы из папки проекта
app.use(express.static(path.join(__dirname, '..')));

app.use('/api/auth',     require('./routes/auth'));
app.use('/api/listings', require('./routes/listings'));
app.use('/api/referrals', require('./routes/referrals'));
app.use('/api/payments', require('./routes/payments'));

app.get('/api/cities', async (req, res) => {
  try {
    const db = require('../config/db');
    const result = await db.query('SELECT id, name, lat, lng FROM cities ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Геокодирование адреса через Google Maps API (ключ хранится только на
// сервере, никогда не попадает во фронтенд-код)
app.get('/api/geocode', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Укажите адрес' });
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return res.status(503).json({ error: 'Геокодирование не настроено' });
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&components=country:IL&language=ru&key=${key}`;
    const r = await fetch(url);
    const data = await r.json();
    if (data.status !== 'OK') return res.json({ results: [] });
    const results = (data.results || []).map(item => {
      const comp = item.address_components || [];
      const get = type => (comp.find(c => c.types.includes(type)) || {}).long_name || '';
      return {
        street: get('route'),
        houseNumber: get('street_number'),
        city: get('locality') || get('administrative_area_level_2'),
        formatted: item.formatted_address,
        lat: item.geometry.location.lat,
        lng: item.geometry.location.lng
      };
    });
    res.json({ results });
  } catch (err) {
    console.error('Geocode error:', err);
    res.status(500).json({ error: 'Ошибка геокодирования' });
  }
});

app.get('/', (req,res)=>res.sendFile(path.join(__dirname,'..','Nesay_IL.html')));
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`);
  console.log(`Сайт: http://localhost:${PORT}/Nesay_IL.html`);
});

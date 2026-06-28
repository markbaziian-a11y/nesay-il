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

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`);
  console.log(`Сайт: http://localhost:${PORT}/Nesay_IL.html`);
});

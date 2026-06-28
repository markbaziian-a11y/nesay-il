require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
});

pool.query('SELECT NOW()', (err, res) => {
  if (err) console.error('Ошибка подключения к БД:', err.message);
  else      console.log('✅ База данных подключена!');
});

const query = (text, params) => pool.query(text, params);
module.exports = { query, pool };

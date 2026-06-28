const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Нужна авторизация' });
  }
  try {
    req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Токен недействителен' });
  }
}

function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try { req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET); } catch (_) {}
  }
  next();
}

module.exports = { requireAuth, optionalAuth };

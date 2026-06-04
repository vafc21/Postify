const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  // Prefer the Authorization: Bearer header (works cross-domain, immune to
  // third-party-cookie blocking), falling back to the legacy cookie.
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : null;
  const token = bearerToken || req.cookies?.token;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    req.userEmail = decoded.email;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }
}

module.exports = authMiddleware;

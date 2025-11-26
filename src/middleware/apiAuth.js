const apiAuth = (req, res, next) => {
  const apiSecret = req.headers['x-api-secret'] || req.query.secret;
  const expectedSecret = process.env.API_SECRET;

  if (!expectedSecret) {
    return res.status(500).json({ error: 'API secret not configured' });
  }

  if (!apiSecret || apiSecret !== expectedSecret) {
    return res.status(401).json({ error: 'Invalid or missing API secret' });
  }

  next();
};

module.exports = apiAuth;


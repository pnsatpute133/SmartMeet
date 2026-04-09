const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  let token;
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer')) {
    try {
      token = authHeader.split(' ')[1];
      console.log(`[AuthMiddleware] Token found in header: ${token.substring(0, 10)}...`);
      
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'smartmeet_fallback_secret');
      req.user = await User.findById(decoded.id).select('-password');
      
      if (!req.user) {
        console.warn(`[AuthMiddleware] User not found for ID: ${decoded.id}`);
        return res.status(401).json({ message: 'Not authorized, user not found' });
      }
      
      next();
    } catch (error) {
      console.error(`[AuthMiddleware] Token verification failed: ${error.message}`);
      return res.status(401).json({ message: 'Not authorized, token failed' });
    }
  } else {
    console.warn(`[AuthMiddleware] No Bearer token found in headers:`, req.headers);
    return res.status(401).json({ message: 'Not authorized, no token' });
  }
};

module.exports = { protect };

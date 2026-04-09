const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const router = express.Router();
const bcrypt = require('bcryptjs');

const DEBUG = true;
function dbg(tag, ...args) {
  if (!DEBUG) return;
  const ts = new Date().toISOString().substring(11, 23);
  console.log(`[${ts}] [DEBUG][Auth/${tag}]`, ...args);
}

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'smartmeet_fallback_secret', {
    expiresIn: '30d',
  });
};

router.post('/register', async (req, res) => {
  try {
    console.log('Signup body:', req.body);
    const { name, email, password } = req.body;
    dbg('register', `Attempt: name=${name} | email=${email}`);
    
    if (!name || !email || !password) {
      dbg('register', '❌ Missing required fields');
      return res.status(400).json({ message: 'Please provide all required fields' });
    }

    const userExists = await User.findOne({ email });
    if (userExists) {
      dbg('register', `❌ Email already taken: ${email}`);
      return res.status(400).json({ message: 'User already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await User.create({ 
      name, 
      email, 
      password: hashedPassword 
    });

    dbg('register', `✅ User created: ${user._id} | email=${email}`);
    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      token: generateToken(user._id),
    });
  } catch (error) {
    console.error('Registration error:', error);
    dbg('register', '❌ Error:', error.message);
    res.status(500).json({ message: error.message || 'Registration failed due to server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    dbg('login', `Login attempt for email: ${email}`);

    if (!email || !password) {
      dbg('login', '❌ Missing email or password');
      return res.status(400).json({ message: 'Please provide email and password' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      dbg('login', `❌ User not found with email: ${email}`);
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    dbg('login', `User found, comparing passwords...`);
    const isMatch = await bcrypt.compare(password, user.password);
    
    if (isMatch) {
      dbg('login', `✅ Login successful for: ${email}`);
      const token = generateToken(user._id);
      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        token,
      });
    } else {
      dbg('login', `❌ Password mismatch for: ${email}`);
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Login failed due to server error' });
  }
});

module.exports = router;

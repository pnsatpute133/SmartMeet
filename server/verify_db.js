require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

async function checkDb() {
  try {
    const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/smartmeet';
    console.log('Connecting to', uri);
    await mongoose.connect(uri);
    const users = await User.find({});
    console.log('Users found in db:', users.length);
    console.log(users.map(u => ({ email: u.email, name: u.name })));
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

checkDb();

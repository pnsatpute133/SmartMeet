require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const Meeting = require('./models/Meeting');

async function seedData() {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/smartmeet';
    console.log('Connecting to MongoDB at:', mongoUri);
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB.');

    // Clear existing
    console.log('Clearing old data...');
    await User.deleteMany({});
    await Meeting.deleteMany({});

    console.log('Inserting users...');
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('password123', salt);

    const usersToInsert = [
      { name: 'Alice Smith', email: 'alice@example.com', password: hashedPassword },
      { name: 'Bob Jones', email: 'bob@example.com', password: hashedPassword },
      { name: 'Charlie Developer', email: 'charlie@example.com', password: hashedPassword }
    ];

    const insertedUsers = await User.insertMany(usersToInsert);
    console.log('Inserted Users:', insertedUsers.map(u => u.email));

    console.log('Inserting meetings...');
    const meetingToInsert = {
      meetingId: 'abc-defg-hij',
      hostId: insertedUsers[0]._id,
      participants: [insertedUsers[0]._id, insertedUsers[1]._id],
      isActive: true,
      chatLogs: [
        {
          senderId: insertedUsers[0]._id,
          senderName: insertedUsers[0].name,
          text: 'Welcome to the sample meeting!',
          timestamp: new Date()
        }
      ]
    };

    const insertedMeeting = await Meeting.create(meetingToInsert);
    console.log('Inserted Meeting ID:', insertedMeeting.meetingId);

    console.log('Seed completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Seeding error:', error);
    process.exit(1);
  }
}

seedData();

require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  HEADLESS: process.env.HEADLESS !== 'false'
}; 
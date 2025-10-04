const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  database: 'blockchain', // MySQL veritabanı adınız
  password: '1234567890', // MySQL şifreniz
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

console.log('Veritabanı bağlantı havuzu oluşturuldu.');

module.exports = pool;
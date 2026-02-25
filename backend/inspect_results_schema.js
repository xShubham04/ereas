require('dotenv').config();
const pool = require('./src/config/db');
(async () => {
  try {
    const res = await pool.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_name='results'");
    console.log(res.rows);
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
})();

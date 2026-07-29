const { neon } = require('@neondatabase/serverless');

let sql;
try {
  sql = neon(process.env.DATABASE_URL);
} catch (err) {
  console.error('[db] DATABASE_URL not set:', err.message);
  sql = null;
}

module.exports = { sql };
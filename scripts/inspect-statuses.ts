import mysql from 'mysql2/promise';

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const connection = await mysql.createConnection({
  host: env('INSPECT_DB_HOST'),
  port: Number(env('INSPECT_DB_PORT')),
  database: env('INSPECT_DB_NAME'),
  user: env('INSPECT_DB_USER'),
  password: env('INSPECT_DB_PASSWORD'),
  connectTimeout: 10_000,
});

try {
  const [rows] = await connection.query(`
    SELECT delete_flag, status, provider, model_id, COUNT(*) AS record_count
    FROM sc_ai_photo_generation_record
    GROUP BY delete_flag, status, provider, model_id
    ORDER BY delete_flag, status, provider, model_id
  `);
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await connection.end();
}

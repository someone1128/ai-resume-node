import mysql from 'mysql2/promise';

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const db = await mysql.createConnection({
  host: env('INSPECT_DB_HOST'),
  port: Number(env('INSPECT_DB_PORT')),
  database: env('INSPECT_DB_NAME'),
  user: env('INSPECT_DB_USER'),
  password: env('INSPECT_DB_PASSWORD'),
  connectTimeout: 10_000,
});
try {
  const [rows] = await db.query(`
    SELECT id, package_name, current_amount, original_amount, sort, gift_day, billing_mode,
           usage_count, ext_json, tags, delete_flag
    FROM sc_member_package
    WHERE delete_flag = 'NOT_DELETE'
    ORDER BY sort, id
  `);
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await db.end();
}

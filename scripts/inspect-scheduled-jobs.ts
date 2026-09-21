import mysql from 'mysql2/promise';

function requiredEnv(
  name:
    | 'INSPECT_DB_HOST'
    | 'INSPECT_DB_PORT'
    | 'INSPECT_DB_NAME'
    | 'INSPECT_DB_USER'
    | 'INSPECT_DB_PASSWORD',
) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}; this inspection is read-only`);
  return value;
}

const connection = await mysql.createConnection({
  host: requiredEnv('INSPECT_DB_HOST'),
  port: Number(requiredEnv('INSPECT_DB_PORT')),
  database: requiredEnv('INSPECT_DB_NAME'),
  user: requiredEnv('INSPECT_DB_USER'),
  password: requiredEnv('INSPECT_DB_PASSWORD'),
  multipleStatements: false,
  connectTimeout: 10_000,
});

try {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT id, name, action_class, cron_expression, status, delete_flag
     FROM dev_job
     WHERE delete_flag = 'NOT_DELETE'
     ORDER BY id`,
  );
  console.log(
    JSON.stringify(
      {
        jobs: rows,
        note: 'Read-only query. No row values were changed and no DDL was executed.',
      },
      null,
      2,
    ),
  );
} finally {
  await connection.end();
}

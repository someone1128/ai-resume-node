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
  multipleStatements: false,
  connectTimeout: 10_000,
});

try {
  const tables = [
    'client_user',
    'sc_resume',
    'sc_resume_modules',
    'sys_user',
    'dev_dict',
    'sc_user_function_limits',
  ];
  const output: Record<string, unknown> = {};
  for (const table of tables) {
    const [createRows] = await connection.query(`SHOW CREATE TABLE \`${table}\``);
    const [indexRows] = await connection.query(`SHOW INDEX FROM \`${table}\``);
    output[table] = { create: createRows, indexes: indexRows };
  }
  console.log(JSON.stringify(output, null, 2));
} finally {
  await connection.end();
}

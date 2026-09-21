import mysql from 'mysql2/promise';

function requiredEnv(
  name:
    | 'INSPECT_DB_HOST'
    | 'INSPECT_DB_PORT'
    | 'INSPECT_DB_NAME'
    | 'INSPECT_DB_USER'
    | 'INSPECT_DB_PASSWORD',
): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. This read-only inspection script never uses a repository credential.`,
    );
  }
  return value;
}

const host = requiredEnv('INSPECT_DB_HOST');
const port = Number(requiredEnv('INSPECT_DB_PORT'));
const database = requiredEnv('INSPECT_DB_NAME');
const user = requiredEnv('INSPECT_DB_USER');
const password = requiredEnv('INSPECT_DB_PASSWORD');

const connection = await mysql.createConnection({
  host,
  port,
  database,
  user,
  password,
  multipleStatements: false,
  connectTimeout: 10_000,
});

try {
  const [serverRows] = await connection.query<mysql.RowDataPacket[]>(
    'SELECT DATABASE() AS database_name, VERSION() AS server_version',
  );
  const [tableRows] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT TABLE_NAME AS table_name, TABLE_ROWS AS estimated_rows
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
     ORDER BY TABLE_NAME`,
  );

  const interesting = tableRows
    .map((row) => String(row.table_name))
    .filter((tableName) =>
      /resume|member|campus|photo|config|user|order|dict|tag|notification|template|interview/i.test(
        tableName,
      ),
    );

  const [columnRows] = interesting.length
    ? await connection.query<mysql.RowDataPacket[]>(
        `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name, DATA_TYPE AS data_type
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME IN (?)
         ORDER BY TABLE_NAME, ORDINAL_POSITION`,
        [interesting],
      )
    : [[] as mysql.RowDataPacket[], [] as mysql.FieldPacket[]];

  console.log(
    JSON.stringify(
      {
        server: serverRows[0],
        tableCount: tableRows.length,
        tables: tableRows,
        interestingColumns: columnRows,
        note: 'Read-only metadata inspection. No row values, writes, DDL, or deletes were executed.',
      },
      null,
      2,
    ),
  );
} finally {
  await connection.end();
}

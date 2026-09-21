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

async function rows<T extends mysql.RowDataPacket[]>(
  sql: string,
  values: unknown[] = [],
): Promise<T> {
  const [result] = await connection.query<T>(sql, values);
  return result;
}

try {
  const counts = await rows<mysql.RowDataPacket[]>(`
    SELECT 'client_user' AS table_name, COUNT(*) AS row_count FROM client_user
    UNION ALL SELECT 'sys_user', COUNT(*) FROM sys_user
    UNION ALL SELECT 'sc_resume', COUNT(*) FROM sc_resume
    UNION ALL SELECT 'sc_resume_modules', COUNT(*) FROM sc_resume_modules
    UNION ALL SELECT 'sc_user_function_limits', COUNT(*) FROM sc_user_function_limits
    UNION ALL SELECT 'sc_ai_photo_generation_record', COUNT(*) FROM sc_ai_photo_generation_record
    UNION ALL SELECT 'sc_campus_recruitment', COUNT(*) FROM sc_campus_recruitment
    UNION ALL SELECT 'sc_campus_recruitment_user', COUNT(*) FROM sc_campus_recruitment_user
    UNION ALL SELECT 't_payment_order', COUNT(*) FROM t_payment_order
    UNION ALL SELECT 't_recharge_record', COUNT(*) FROM t_recharge_record
    UNION ALL SELECT 't_redeem_code', COUNT(*) FROM t_redeem_code
  `);

  const dictionaryCategories = await rows<mysql.RowDataPacket[]>(`
    SELECT CATEGORY AS category, COUNT(*) AS item_count
    FROM dev_dict
    WHERE DELETE_FLAG = 'NOT_DELETE'
    GROUP BY CATEGORY
    ORDER BY CATEGORY
  `);

  const configKeys = await rows<mysql.RowDataPacket[]>(`
    SELECT CATEGORY AS category, CONFIG_KEY AS config_key, DELETE_FLAG AS delete_flag
    FROM dev_config
    WHERE DELETE_FLAG = 'NOT_DELETE'
    ORDER BY CATEGORY, CONFIG_KEY
  `);

  const adminStatuses = await rows<mysql.RowDataPacket[]>(`
    SELECT USER_STATUS AS user_status, COUNT(*) AS user_count
    FROM sys_user
    WHERE DELETE_FLAG = 'NOT_DELETE'
    GROUP BY USER_STATUS
    ORDER BY USER_STATUS
  `);

  const orderStatuses = await rows<mysql.RowDataPacket[]>(`
    SELECT status, COUNT(*) AS order_count
    FROM t_payment_order
    WHERE DELETE_FLAG = 'NOT_DELETE'
    GROUP BY status
    ORDER BY status
  `);

  const photoStatuses = await rows<mysql.RowDataPacket[]>(`
    SELECT status, provider, model_id, COUNT(*) AS record_count
    FROM sc_ai_photo_generation_record
    WHERE delete_flag = 'NOT_DELETE'
    GROUP BY status, provider, model_id
    ORDER BY status, provider, model_id
  `);

  console.log(
    JSON.stringify(
      { counts, dictionaryCategories, configKeys, adminStatuses, orderStatuses, photoStatuses },
      null,
      2,
    ),
  );
} finally {
  await connection.end();
}

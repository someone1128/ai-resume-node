import mysql from 'mysql2/promise';

const fixturePrefix = 'codex_migration_test';

export function assertFixtureWriteAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to create fixtures with NODE_ENV=production');
  }
  if (env.ALLOW_TEST_FIXTURE_WRITE !== 'true') {
    throw new Error(
      'Set ALLOW_TEST_FIXTURE_WRITE=true explicitly before creating a test fixture; this script never writes by default.',
    );
  }
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

assertFixtureWriteAllowed();

const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-16);
const userId = `99${suffix}`.slice(0, 19);
const resumeId = `${fixturePrefix}_${suffix}`.slice(0, 40);
const moduleId = `${fixturePrefix}_module_${suffix}`.slice(0, 40);
const account = `${fixturePrefix}_${suffix}`;
const invitationCode = `codex_test_${suffix}`;
const now = new Date();

const fixture = { userId, resumeId, moduleId, account, invitationCode };
if (process.env.FIXTURE_DRY_RUN === 'true') {
  console.log(JSON.stringify({ dryRun: true, ...fixture }));
  process.exit(0);
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
  await connection.beginTransaction();
  await connection.execute(
    `INSERT INTO client_user
      (ID, ACCOUNT, PASSWORD, NAME, NICKNAME, USER_STATUS, DELETE_FLAG, CREATE_TIME, UPDATE_TIME,
       invitation_code, member_level, has_publish_cases, share_free_member, super_user, has_debug)
     VALUES (?, ?, ?, ?, ?, 'ENABLE', 'NOT_DELETE', ?, ?, ?, 'NORMAL', 1, 0, 0, 0)`,
    [
      userId,
      account,
      'codex-test-password-placeholder',
      'codex_migration_test',
      'codex_migration_test',
      now,
      now,
      invitationCode,
    ],
  );
  await connection.execute(
    `INSERT INTO sc_resume
      (id, title, user_id, is_published, view_count, usage_count, collect_count, create_time, update_time, delete_flag, template)
     VALUES (?, ?, ?, 0, 0, 0, 0, ?, ?, 'NOT_DELETE', 'template2')`,
    [resumeId, 'codex_migration_test_resume', userId, now, now],
  );
  await connection.execute(
    `INSERT INTO sc_resume_modules
      (id, resume_id, module_type, display_order, module_content, create_time, update_time, delete_flag, user_id, has_enable)
     VALUES (?, ?, ?, 1, ?, ?, ?, 'NOT_DELETE', ?, 1)`,
    [
      moduleId,
      resumeId,
      '基本信息',
      JSON.stringify({ name: 'codex_migration_test' }),
      now,
      now,
      userId,
    ],
  );
  await connection.commit();
  console.log(JSON.stringify(fixture));
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  await connection.end();
}

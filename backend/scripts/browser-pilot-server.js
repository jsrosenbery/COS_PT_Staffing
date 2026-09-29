import pg from 'pg';
import { randomUUID } from 'node:crypto';

// Deliberately accepts only an explicitly supplied local test database. Never
// inherits DATABASE_URL, sends real mail, or adds fixture routes to the app.
if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required');
const url = new URL(process.env.TEST_DATABASE_URL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Browser pilot requires a local disposable PostgreSQL database');
const schema = `browser_pilot_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: url.toString() });
await admin.query(`CREATE SCHEMA "${schema}"`);
url.searchParams.set('options', `-c search_path=${schema}`);
Object.assign(process.env, {
  DATABASE_URL: url.toString(), DATABASE_SSL: 'false', NODE_ENV: 'test',
  AUTH_DISABLED: 'false', API_TOKEN_AUTH_ENABLED: 'false', EMAIL_PROVIDER: 'console',
  ALLOW_TOKEN_URLS_IN_RESPONSES: 'false', RATE_LIMIT_STORE: 'postgres',
  PORT: '4317', CORS_ORIGIN: 'http://127.0.0.1:4173',
});
const { pool } = await import('../db.js');
const { runMigrations } = await import('../migrations.js');
const { hashPassword } = await import('../auth.js');
await runMigrations({ pool });
const password = await hashPassword('Synthetic-pilot-only-2099!');
const actors = [['admin', ''], ...['Science', 'Arts'].flatMap(division => ['faculty', 'chair', 'dean'].map(role => [role, division]))];
for (const [role, division] of actors) {
  const key = `${role}${division ? `-${division.toLowerCase()}` : ''}`;
  await pool.query(`INSERT INTO scope_users(email,full_name,employee_id,role,division,active_status,password_hash,password_salt)
    VALUES ($1,$2,$3,$4,$5,'active',$6,$7)`, [`${key}@example.invalid`, `Pilot ${key}`, key, role, division, password.hash, password.salt]);
  if (role === 'faculty') {
    await pool.query(`INSERT INTO scope_pt_faculty(employee_id,first_name,last_name,email,division,discipline,qualified_disciplines,seniority_rank)
      VALUES ($1,'Pilot',$2,$3,$4,$5,$5,'1')`, [key, key, `${key}@example.invalid`, division, division === 'Science' ? 'MATH' : 'ART']);
  } else if (role !== 'admin') {
    await pool.query(`INSERT INTO scope_roles(employee_id,first_name,last_name,email,role,division)
      VALUES ($1,'Pilot',$1,$2,$3,$4)`, [key, `${key}@example.invalid`, role, division]);
  }
}
await pool.query("INSERT INTO scope_terms(term_code,term_name,is_active) VALUES ('2099FA','Fall 2099',true)");
for (const division of ['Science', 'Arts']) {
  await pool.query("INSERT INTO scope_staffing_windows(term,division,status,closes_at) VALUES ('2099FA',$1,'open','2099-12-31')", [division]);
  const discipline = division === 'Science' ? 'MATH' : 'ART';
  await pool.query(`INSERT INTO scope_sections(term_code,division,assignment_group_id,primary_subject_course,primary_crn,title,subject_code,discipline_code,raw_row)
    VALUES ('2099FA',$1,$2,$3,$4,$5,$6,$6,'{"staff_eligible":true}'::jsonb)`, [division, `${division}-1`, `${discipline} 101`, division === 'Science' ? '90001' : '90002', `Pilot ${division} section`, discipline]);
}
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
  process.exit(0);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
await import('../server.js');

import dns from 'dns';
import pg from 'pg';

dns.setDefaultResultOrder('ipv4first');

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase.co')
    ? { rejectUnauthorized: false }
    : undefined,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error', err);
});

export async function query<T = any>(sql: string, params?: any[]): Promise<T[]> {
  const { rows } = await pool.query(sql, params);
  return rows as T[];
}

export async function queryOne<T = any>(sql: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function execute(sql: string, params?: any[]): Promise<number> {
  const { rowCount } = await pool.query(sql, params);
  return rowCount ?? 0;
}

export async function withTransaction<T>(
  fn: (
    txQuery: typeof query,
    txQueryOne: typeof queryOne,
    txExecute: typeof execute,
  ) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const txQuery = async <R = any>(sql: string, params?: any[]): Promise<R[]> => {
      const { rows } = await client.query(sql, params);
      return rows as R[];
    };
    const txQueryOne = async <R = any>(sql: string, params?: any[]): Promise<R | null> => {
      const rows = await txQuery<R>(sql, params);
      return rows[0] ?? null;
    };
    const txExecute = async (sql: string, params?: any[]): Promise<number> => {
      const { rowCount } = await client.query(sql, params);
      return rowCount ?? 0;
    };
    const result = await fn(txQuery, txQueryOne, txExecute);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export { pool };

import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { db as appDeployDb } from '@appdeploy/sdk';

type RecordData = Record<string, any>;
type ListOptions = {
  limit?: number;
  nextToken?: string;
  filter?: Record<string, unknown>;
};

const connectionString = process.env.DATABASE_URL?.trim();
const pool = connectionString
  ? new Pool({
      connectionString,
      max: Math.max(1, Math.min(10, Number(process.env.PG_POOL_MAX || 5))),
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
    })
  : null;

export const databaseMode = pool ? 'postgresql' : 'appdeploy';

const validTableName = (table: string) =>
  /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(table) && !table.includes('__');

const requireTableName = (table: string) => {
  if (!validTableName(table)) throw new Error('Invalid database table name');
};

const decodeOffset = (token?: string) => {
  if (!token) return 0;
  const match = /^offset:(\d+)$/.exec(token);
  if (!match) throw new Error('Invalid database pagination token');
  return Number(match[1]);
};

const postgresDb = {
  async list<T = RecordData>(table: string, options: ListOptions = {}) {
    requireTableName(table);
    const limit = Math.max(1, Math.min(10000, Math.floor(Number(options.limit || 100))));
    const offset = decodeOffset(options.nextToken);
    const result = await pool!.query(
      'SELECT id, data FROM app_records WHERE table_name = $1 ORDER BY created_at ASC, id ASC LIMIT $2 OFFSET $3',
      [table, limit + 1, offset],
    );
    const hasMore = result.rows.length > limit;
    const items = result.rows.slice(0, limit).map((row: { id: string; data: RecordData }) => ({
      ...(row.data || {}),
      id: row.id,
    }));
    const filtered = options.filter
      ? items.filter((item: RecordData) =>
          Object.entries(options.filter!).every(([key, value]) => item[key] === value),
        )
      : items;
    return {
      items: filtered as Array<Omit<T, 'id'> & { id: string }>,
      ...(hasMore ? { nextToken: 'offset:' + String(offset + limit) } : {}),
    };
  },

  async add(table: string, records: RecordData[]) {
    requireTableName(table);
    const ids: Array<string | null> = [];
    for (const record of records) {
      const id = randomUUID();
      try {
        await pool!.query(
          'INSERT INTO app_records (table_name, id, data) VALUES ($1, $2, $3::jsonb)',
          [table, id, JSON.stringify(record)],
        );
        ids.push(id);
      } catch (err: any) {
        if (err?.code === '23505') ids.push(null);
        else throw err;
      }
    }
    return ids;
  },

  async update(table: string, updates: Array<{ id: string; record: RecordData }>) {
    requireTableName(table);
    const outcomes: boolean[] = [];
    for (const update of updates) {
      const result = await pool!.query(
        'UPDATE app_records SET data = $3::jsonb, updated_at = NOW() WHERE table_name = $1 AND id = $2 RETURNING id',
        [table, update.id, JSON.stringify(update.record)],
      );
      outcomes.push(result.rowCount === 1);
    }
    return outcomes;
  },

  async delete(table: string, ids: string[]) {
    requireTableName(table);
    const outcomes: boolean[] = [];
    for (const id of ids) {
      const result = await pool!.query(
        'DELETE FROM app_records WHERE table_name = $1 AND id = $2 RETURNING id',
        [table, id],
      );
      outcomes.push(result.rowCount === 1);
    }
    return outcomes;
  },
};

export const db = {
  list: <T = RecordData>(table: string, options?: ListOptions) =>
    pool ? postgresDb.list<T>(table, options) : appDeployDb.list<T>(table, options),
  add: (table: string, records: RecordData[]) =>
    pool ? postgresDb.add(table, records) : appDeployDb.add(table, records),
  update: (table: string, updates: Array<{ id: string; record: RecordData }>) =>
    pool ? postgresDb.update(table, updates) : appDeployDb.update(table, updates),
  delete: (table: string, ids: string[]) =>
    pool ? postgresDb.delete(table, ids) : appDeployDb.delete(table, ids),
};

export const closePostgresPool = async () => {
  if (pool) await pool.end();
};

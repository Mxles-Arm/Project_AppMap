import * as SQLite from 'expo-sqlite';

export type ToiletStatus = 'available' | 'closed' | 'no_paper';

export type Toilet = {
  id: number;
  building: string;
  floor: string;
  accessible: number;
  latitude: number;
  longitude: number;
  status: ToiletStatus;
  updated_at: number;
};

type ToiletInsert = Omit<Toilet, 'id' | 'status' | 'updated_at'>;

let db: SQLite.SQLiteDatabase | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync('toilets.db');
  }
  return db;
}

export async function initDB(): Promise<void> {
  const database = await getDb();
  await database.runAsync(`
    CREATE TABLE IF NOT EXISTS toilets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      building TEXT NOT NULL,
      floor TEXT NOT NULL DEFAULT '',
      accessible INTEGER NOT NULL DEFAULT 0,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'available',
      updated_at INTEGER NOT NULL DEFAULT 0
    )
  `);

  const columns = await database.getAllAsync<{ name: string }>('PRAGMA table_info(toilets)');
  if (!columns.some(c => c.name === 'status')) {
    await database.runAsync("ALTER TABLE toilets ADD COLUMN status TEXT NOT NULL DEFAULT 'available'");
  }
  if (!columns.some(c => c.name === 'updated_at')) {
    await database.runAsync('ALTER TABLE toilets ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0');
    await database.runAsync('UPDATE toilets SET updated_at = ? WHERE updated_at = 0', [Date.now()]);
  }
}

export async function getAll(): Promise<Toilet[]> {
  const database = await getDb();
  return await database.getAllAsync<Toilet>('SELECT * FROM toilets ORDER BY id ASC');
}

export async function insert(data: ToiletInsert): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    'INSERT INTO toilets (building, floor, accessible, latitude, longitude, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [data.building, data.floor, data.accessible, data.latitude, data.longitude, 'available', Date.now()]
  );
}

export async function remove(id: number): Promise<void> {
  const database = await getDb();
  await database.runAsync('DELETE FROM toilets WHERE id = ?', [id]);
}

export async function update(id: number, data: Omit<ToiletInsert, 'latitude' | 'longitude'>): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    'UPDATE toilets SET building = ?, floor = ?, accessible = ?, updated_at = ? WHERE id = ?',
    [data.building, data.floor, data.accessible, Date.now(), id]
  );
}

export async function setStatus(id: number, status: ToiletStatus): Promise<void> {
  const database = await getDb();
  await database.runAsync('UPDATE toilets SET status = ?, updated_at = ? WHERE id = ?', [status, Date.now(), id]);
}

export async function confirmStillAccurate(id: number): Promise<void> {
  const database = await getDb();
  await database.runAsync('UPDATE toilets SET updated_at = ? WHERE id = ?', [Date.now(), id]);
}

import { JSONFilePreset } from 'lowdb/node';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, '..', 'data');
const dbFile = path.join(dataDir, 'db.json');

fs.mkdirSync(dataDir, { recursive: true });

const defaultData = {
  users: [],
  posts: [],
  learningProgress: [],
  learningResources: [],
  notifications: []
};

export const db = await JSONFilePreset(dbFile, defaultData);

await db.read();


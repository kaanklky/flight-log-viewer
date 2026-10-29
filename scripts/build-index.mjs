import { readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'logs');
const names = readdirSync(dir).filter(n => /\.csv$/i.test(n)).sort();
writeFileSync(join(dir, 'index.json'), JSON.stringify(names, null, 2) + '\n');
console.log(`logs/index.json: ${names.length} file(s)`);

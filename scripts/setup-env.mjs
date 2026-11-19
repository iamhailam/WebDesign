import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

const example = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
const content = ['DB_PASSWORD', 'POSTGRES_PASSWORD', 'JWT_SECRET'].reduce(
  (text, key) => text.replace(new RegExp(`^${key}=$`, 'm'), `${key}=${randomBytes(32).toString('hex')}`),
  example,
);
try {
  await writeFile(new URL('../.env', import.meta.url), content, { flag: 'wx', mode: 0o600 });
  console.log('Created ignored .env with local-only generated credentials. Values were not printed.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('.env already exists; left unchanged.');
}

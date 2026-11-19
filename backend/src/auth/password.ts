import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

const MEMORY_KIB = 19456;
const PASSES = 2;
const PARALLELISM = 1;
const SALT_BYTES = 16;
const TAG_BYTES = 32;
const DUMMY_SALT = Buffer.from('0123456789abcdef');
const PHC_REGEX = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/=_-]+)\$([A-Za-z0-9+/=_-]+)$/;

function deriveArgon2id(
  password: string,
  salt: Buffer,
  memory: number,
  passes: number,
  parallelism: number,
  tagLength: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      'argon2id',
      {
        message: password,
        nonce: salt,
        memory,
        passes,
        parallelism,
        tagLength,
      },
      (error, derivedKey) => {
        if (error) return reject(error);
        resolve(derivedKey);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await deriveArgon2id(password, salt, MEMORY_KIB, PASSES, PARALLELISM, TAG_BYTES);
  return `$argon2id$v=19$m=${MEMORY_KIB},t=${PASSES},p=${PARALLELISM}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const match = PHC_REGEX.exec(storedHash);
  if (!match) {
    // Burn comparable Argon2id time on missing/disabled hashes to reduce timing side channels.
    await deriveArgon2id(password, DUMMY_SALT, MEMORY_KIB, PASSES, PARALLELISM, TAG_BYTES);
    return false;
  }

  const [, mRaw, tRaw, pRaw, saltB64, hashB64] = match;
  if (!saltB64 || !hashB64) {
    await deriveArgon2id(password, DUMMY_SALT, MEMORY_KIB, PASSES, PARALLELISM, TAG_BYTES);
    return false;
  }

  const memory = Number(mRaw);
  const passes = Number(tRaw);
  const parallelism = Number(pRaw);
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');

  if (
    !Number.isInteger(memory) || memory < 4096 || memory > 131072 ||
    !Number.isInteger(passes) || passes < 1 || passes > 10 ||
    !Number.isInteger(parallelism) || parallelism < 1 || parallelism > 4 ||
    salt.length < 8 || salt.length > 64 ||
    expected.length < 16 || expected.length > 64
  ) {
    await deriveArgon2id(password, DUMMY_SALT, MEMORY_KIB, PASSES, PARALLELISM, TAG_BYTES);
    return false;
  }

  const derived = await deriveArgon2id(password, salt, memory, passes, parallelism, expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

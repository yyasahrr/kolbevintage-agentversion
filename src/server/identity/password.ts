import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
const algorithm = "scrypt";

type ScryptOptions = {
  N: number;
  r: number;
  p: number;
  maxmem: number;
};

function deriveKey(
  password: string,
  salt: Buffer,
  length: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, length, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey as Buffer);
    });
  });
}
const cost = 32_768;
const blockSize = 8;
const parallelization = 1;
const keyLength = 64;
const maxMemory = 64 * 1024 * 1024;

function encode(value: Buffer): string {
  return value.toString("base64url");
}

function decode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await deriveKey(password, salt, keyLength, {
    N: cost,
    r: blockSize,
    p: parallelization,
    maxmem: maxMemory,
  });

  return [algorithm, cost, blockSize, parallelization, encode(salt), encode(derivedKey)].join("$");
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const parts = encodedHash.split("$");
  if (parts.length !== 6 || parts[0] !== algorithm) {
    return false;
  }

  const [, encodedCost, encodedBlockSize, encodedParallelization, encodedSalt, encodedKey] = parts;
  const parsedCost = Number(encodedCost);
  const parsedBlockSize = Number(encodedBlockSize);
  const parsedParallelization = Number(encodedParallelization);

  if (
    !Number.isSafeInteger(parsedCost) ||
    !Number.isSafeInteger(parsedBlockSize) ||
    !Number.isSafeInteger(parsedParallelization) ||
    parsedCost < 16_384 ||
    parsedCost > 1_048_576 ||
    parsedBlockSize < 1 ||
    parsedBlockSize > 32 ||
    parsedParallelization < 1 ||
    parsedParallelization > 8
  ) {
    return false;
  }

  try {
    const expectedKey = decode(encodedKey);
    const actualKey = await deriveKey(password, decode(encodedSalt), expectedKey.length, {
      N: parsedCost,
      r: parsedBlockSize,
      p: parsedParallelization,
      maxmem: maxMemory,
    });

    return actualKey.length === expectedKey.length && timingSafeEqual(actualKey, expectedKey);
  } catch {
    return false;
  }
}

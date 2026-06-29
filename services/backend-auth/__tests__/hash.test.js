const { hashPassword, comparePassword } = require('../src/utils/hash');

describe('hashPassword', () => {
  test('returns a bcrypt hash string starting with $2b$', async () => {
    const hash = await hashPassword('mySecret');
    expect(typeof hash).toBe('string');
    expect(hash).toMatch(/^\$2b\$/);
  });

  test('different calls produce different hashes for the same input', async () => {
    const h1 = await hashPassword('same');
    const h2 = await hashPassword('same');
    expect(h1).not.toBe(h2);
  });
});

describe('comparePassword', () => {
  test('returns true when password matches the hash', async () => {
    const hash = await hashPassword('correct');
    expect(await comparePassword('correct', hash)).toBe(true);
  });

  test('returns false when password does not match the hash', async () => {
    const hash = await hashPassword('correct');
    expect(await comparePassword('wrong', hash)).toBe(false);
  });

  test('returns false for empty string vs real hash', async () => {
    const hash = await hashPassword('notempty');
    expect(await comparePassword('', hash)).toBe(false);
  });
});

process.env.JWT_SECRET = 'test-access-secret-32chars-long!!';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-32chars-long!';
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';

const {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} = require('../src/utils/jwt');

const PAYLOAD = { userId: 'user-123', email: 'test@example.com' };

describe('signAccessToken + verifyAccessToken', () => {
  test('roundtrip preserves userId and email', () => {
    const token = signAccessToken(PAYLOAD);
    const decoded = verifyAccessToken(token);
    expect(decoded.userId).toBe('user-123');
    expect(decoded.email).toBe('test@example.com');
  });

  test('produces a JWT string with 3 dot-separated parts', () => {
    const token = signAccessToken(PAYLOAD);
    expect(token.split('.')).toHaveLength(3);
  });

  test('each call produces a unique token (different jti)', () => {
    const t1 = signAccessToken(PAYLOAD);
    const t2 = signAccessToken(PAYLOAD);
    expect(t1).not.toBe(t2);
  });

  test('throws on tampered token', () => {
    const token = signAccessToken(PAYLOAD);
    expect(() => verifyAccessToken(token + 'tampered')).toThrow();
  });

  test('throws on completely invalid string', () => {
    expect(() => verifyAccessToken('not.a.jwt')).toThrow();
  });

  test('throws when verified with refresh secret (wrong secret)', () => {
    const token = signRefreshToken(PAYLOAD);
    expect(() => verifyAccessToken(token)).toThrow();
  });
});

describe('signRefreshToken + verifyRefreshToken', () => {
  test('roundtrip preserves userId and email', () => {
    const token = signRefreshToken(PAYLOAD);
    const decoded = verifyRefreshToken(token);
    expect(decoded.userId).toBe('user-123');
    expect(decoded.email).toBe('test@example.com');
  });

  test('throws when access token is passed (different secret)', () => {
    const accessToken = signAccessToken(PAYLOAD);
    expect(() => verifyRefreshToken(accessToken)).toThrow();
  });

  test('throws on invalid string', () => {
    expect(() => verifyRefreshToken('garbage')).toThrow();
  });
});

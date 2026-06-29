process.env.JWT_SECRET = 'test-access-secret-32chars-long!!';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-32chars-long!';
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';

jest.mock('../src/models/user.model', () => ({
  findUserByEmail: jest.fn(),
  createUser: jest.fn(),
}));
jest.mock('../src/utils/redis', () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  on: jest.fn(),
}));
jest.mock('../src/utils/tracer', () => ({
  runWithSpan: (_name, fn) =>
    fn({ setAttribute: jest.fn(), recordException: jest.fn(), setStatus: jest.fn(), end: jest.fn() }),
}));

const bcrypt = require('bcrypt');
const userModel = require('../src/models/user.model');
const redis = require('../src/utils/redis');
const { signRefreshToken } = require('../src/utils/jwt');
const authService = require('../src/services/auth.service');

beforeEach(() => jest.clearAllMocks());

describe('register', () => {
  test('throws "Email already exists" when email is taken', async () => {
    userModel.findUserByEmail.mockResolvedValue({ email: 'dup@test.com' });
    await expect(authService.register({ email: 'dup@test.com', password: 'pass' }))
      .rejects.toThrow('Email already exists');
  });

  test('does not call createUser when email already exists', async () => {
    userModel.findUserByEmail.mockResolvedValue({ email: 'dup@test.com' });
    await authService.register({ email: 'dup@test.com', password: 'pass' }).catch(() => {});
    expect(userModel.createUser).not.toHaveBeenCalled();
  });

  test('hashes password before saving', async () => {
    userModel.findUserByEmail.mockResolvedValue(null);
    userModel.createUser.mockResolvedValue({ _id: 'u1', email: 'new@test.com' });
    await authService.register({ email: 'new@test.com', password: 'plaintext' });
    const savedWith = userModel.createUser.mock.calls[0][0];
    expect(savedWith.password).not.toBe('plaintext');
    expect(savedWith.password).toMatch(/^\$2b\$/);
  });

  test('returns the created user', async () => {
    userModel.findUserByEmail.mockResolvedValue(null);
    userModel.createUser.mockResolvedValue({ _id: 'u1', email: 'new@test.com', name: 'Test' });
    const result = await authService.register({ email: 'new@test.com', password: 'pass', name: 'Test' });
    expect(result._id).toBe('u1');
    expect(result.email).toBe('new@test.com');
  });
});

describe('login', () => {
  test('throws "User not found" when email does not exist', async () => {
    userModel.findUserByEmail.mockResolvedValue(null);
    await expect(authService.login({ email: 'no@test.com', password: 'pass' }))
      .rejects.toThrow('User not found');
  });

  test('throws "Wrong password" when password is incorrect', async () => {
    const hashed = await bcrypt.hash('correct', 10);
    userModel.findUserByEmail.mockResolvedValue({ _id: 'u1', email: 'a@test.com', password: hashed });
    await expect(authService.login({ email: 'a@test.com', password: 'wrong' }))
      .rejects.toThrow('Wrong password');
  });

  test('returns accessToken and refreshToken on valid credentials', async () => {
    const hashed = await bcrypt.hash('correct', 10);
    userModel.findUserByEmail.mockResolvedValue({ _id: 'u1', email: 'a@test.com', password: hashed });
    redis.set.mockResolvedValue('OK');
    const result = await authService.login({ email: 'a@test.com', password: 'correct' });
    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
  });

  test('stores refresh token in redis with correct key', async () => {
    const hashed = await bcrypt.hash('correct', 10);
    userModel.findUserByEmail.mockResolvedValue({ _id: 'u1', email: 'a@test.com', password: hashed });
    redis.set.mockResolvedValue('OK');
    const result = await authService.login({ email: 'a@test.com', password: 'correct' });
    expect(redis.set).toHaveBeenCalledWith(
      'rf_token:u1',
      result.refreshToken,
      'EX',
      expect.any(Number)
    );
  });
});

describe('refreshToken', () => {
  test('throws when stored token does not match (revoked)', async () => {
    const token = signRefreshToken({ userId: 'u1', email: 'a@test.com' });
    redis.get.mockResolvedValue('different-stored-token');
    redis.del.mockResolvedValue(1);
    await expect(authService.refreshToken(token)).rejects.toThrow();
  });

  test('deletes key from redis when token is revoked', async () => {
    const token = signRefreshToken({ userId: 'u1', email: 'a@test.com' });
    redis.get.mockResolvedValue('different-stored-token');
    redis.del.mockResolvedValue(1);
    await authService.refreshToken(token).catch(() => {});
    expect(redis.del).toHaveBeenCalledWith('rf_token:u1');
  });

  test('returns new accessToken and refreshToken when valid', async () => {
    const token = signRefreshToken({ userId: 'u1', email: 'a@test.com' });
    redis.get.mockResolvedValue(token);
    redis.set.mockResolvedValue('OK');
    const result = await authService.refreshToken(token);
    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
  });

  test('rotates refresh token (new token stored in redis)', async () => {
    const token = signRefreshToken({ userId: 'u1', email: 'a@test.com' });
    redis.get.mockResolvedValue(token);
    redis.set.mockResolvedValue('OK');
    const result = await authService.refreshToken(token);
    expect(redis.set).toHaveBeenCalledWith(
      'rf_token:u1',
      result.refreshToken,
      'EX',
      expect.any(Number)
    );
  });
});

describe('logout', () => {
  test('deletes refresh token from redis', async () => {
    const token = signRefreshToken({ userId: 'u1', email: 'a@test.com' });
    redis.del.mockResolvedValue(1);
    await authService.logout(token);
    expect(redis.del).toHaveBeenCalledWith('rf_token:u1');
  });

  test('does not throw on an invalid/expired token', async () => {
    await expect(authService.logout('bad.invalid.token')).resolves.toBeUndefined();
    expect(redis.del).not.toHaveBeenCalled();
  });

  test('does not throw when called with empty string', async () => {
    await expect(authService.logout('')).resolves.toBeUndefined();
  });
});

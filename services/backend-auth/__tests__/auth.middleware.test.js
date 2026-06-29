process.env.JWT_SECRET = 'test-access-secret-32chars-long!!';
process.env.JWT_EXPIRES_IN = '15m';

const { signAccessToken } = require('../src/utils/jwt');
const { authMiddleware } = require('../src/middlewares/auth.middleware');

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('authMiddleware', () => {
  test('returns 401 when Authorization header is missing', () => {
    const req = { headers: {} };
    const res = makeRes();
    const next = jest.fn();
    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'No token' });
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 401 when token is malformed', () => {
    const req = { headers: { authorization: 'Bearer not.a.valid.token' } };
    const res = makeRes();
    const next = jest.fn();
    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid token' });
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 401 when Bearer prefix is missing', () => {
    const token = signAccessToken({ userId: 'u1', email: 'a@test.com' });
    const req = { headers: { authorization: token } };
    const res = makeRes();
    const next = jest.fn();
    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('calls next() and attaches user when token is valid', () => {
    const token = signAccessToken({ userId: 'u1', email: 'a@test.com' });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = makeRes();
    const next = jest.fn();
    authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user.userId).toBe('u1');
    expect(req.user.email).toBe('a@test.com');
  });

  test('does not call res.status when token is valid', () => {
    const token = signAccessToken({ userId: 'u2', email: 'b@test.com' });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = makeRes();
    const next = jest.fn();
    authMiddleware(req, res, next);
    expect(res.status).not.toHaveBeenCalled();
  });
});

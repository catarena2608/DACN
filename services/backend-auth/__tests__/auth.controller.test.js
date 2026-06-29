jest.mock('../src/services/auth.service', () => ({
  register: jest.fn(),
  login: jest.fn(),
  refreshToken: jest.fn(),
  logout: jest.fn(),
}));

const authService = require('../src/services/auth.service');
const authController = require('../src/controllers/auth.controller');

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.cookie = jest.fn(() => res);
  res.clearCookie = jest.fn(() => res);
  return res;
};

beforeEach(() => jest.clearAllMocks());

describe('register', () => {
  test('responds 201 with user data on success', async () => {
    authService.register.mockResolvedValue({ _id: 'u1', email: 'a@test.com' });
    const req = { body: { email: 'a@test.com', password: 'pass' } };
    const res = makeRes();
    await authController.register(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ email: 'a@test.com' }));
  });

  test('responds 400 with error message when email already exists', async () => {
    authService.register.mockRejectedValue(new Error('Email already exists'));
    const req = { body: {} };
    const res = makeRes();
    await authController.register(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Email already exists' });
  });
});

describe('login', () => {
  test('sets refreshToken cookie and returns accessToken', async () => {
    authService.login.mockResolvedValue({ accessToken: 'acc-tok', refreshToken: 'ref-tok' });
    const req = { body: { email: 'a@test.com', password: 'pass' } };
    const res = makeRes();
    await authController.login(req, res);
    expect(res.cookie).toHaveBeenCalledWith('refreshToken', 'ref-tok', expect.any(Object));
    expect(res.json).toHaveBeenCalledWith({ accessToken: 'acc-tok' });
  });

  test('responds 401 on wrong credentials', async () => {
    authService.login.mockRejectedValue(new Error('Wrong password'));
    const req = { body: {} };
    const res = makeRes();
    await authController.login(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Wrong password' });
  });

  test('responds 401 when user not found', async () => {
    authService.login.mockRejectedValue(new Error('User not found'));
    const req = { body: {} };
    const res = makeRes();
    await authController.login(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('refresh', () => {
  test('responds 403 when no refresh token cookie present', async () => {
    const req = { cookies: {} };
    const res = makeRes();
    await authController.refresh(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(authService.refreshToken).not.toHaveBeenCalled();
  });

  test('returns new accessToken and rotates cookie on valid token', async () => {
    authService.refreshToken.mockResolvedValue({ accessToken: 'new-acc', refreshToken: 'new-ref' });
    const req = { cookies: { refreshToken: 'old-ref' } };
    const res = makeRes();
    await authController.refresh(req, res);
    expect(authService.refreshToken).toHaveBeenCalledWith('old-ref');
    expect(res.cookie).toHaveBeenCalledWith('refreshToken', 'new-ref', expect.any(Object));
    expect(res.json).toHaveBeenCalledWith({ accessToken: 'new-acc' });
  });

  test('responds 403 when token is revoked', async () => {
    authService.refreshToken.mockRejectedValue(new Error('Token revoked or reused!'));
    const req = { cookies: { refreshToken: 'revoked' } };
    const res = makeRes();
    await authController.refresh(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('logout', () => {
  test('calls authService.logout with the cookie value', async () => {
    authService.logout.mockResolvedValue();
    const req = { cookies: { refreshToken: 'ref-tok' } };
    const res = makeRes();
    await authController.logout(req, res);
    expect(authService.logout).toHaveBeenCalledWith('ref-tok');
  });

  test('clears the refreshToken cookie', async () => {
    authService.logout.mockResolvedValue();
    const req = { cookies: { refreshToken: 'ref-tok' } };
    const res = makeRes();
    await authController.logout(req, res);
    expect(res.clearCookie).toHaveBeenCalledWith('refreshToken');
  });

  test('responds with Logged out message', async () => {
    authService.logout.mockResolvedValue();
    const req = { cookies: { refreshToken: 'ref-tok' } };
    const res = makeRes();
    await authController.logout(req, res);
    expect(res.json).toHaveBeenCalledWith({ message: 'Logged out' });
  });

  test('clears cookie even when no refresh token present', async () => {
    const req = { cookies: {} };
    const res = makeRes();
    await authController.logout(req, res);
    expect(authService.logout).not.toHaveBeenCalled();
    expect(res.clearCookie).toHaveBeenCalledWith('refreshToken');
  });
});

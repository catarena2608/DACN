const rateLimiter = require('../middleware/rateLimiter');

const makeReq = (ip = '127.0.0.1') => ({ ip, headers: {} });
const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

beforeEach(() => {
  // Reset the module between tests so the in-memory buckets map starts fresh
  jest.resetModules();
});

describe('rateLimiter middleware', () => {
  test('allows requests below the limit', () => {
    process.env.RATE_LIMIT_WINDOW_MS = '60000';
    process.env.RATE_LIMIT_MAX_REQUESTS = '5';
    const limiter = require('../middleware/rateLimiter');

    const req = makeReq('10.0.0.1');
    const res = makeRes();
    const next = jest.fn();

    limiter(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('blocks requests that exceed the limit', () => {
    process.env.RATE_LIMIT_WINDOW_MS = '60000';
    process.env.RATE_LIMIT_MAX_REQUESTS = '3';
    const limiter = require('../middleware/rateLimiter');

    const req = makeReq('10.0.0.2');
    const res = makeRes();
    const next = jest.fn();

    // Send 4 requests — the 4th should be blocked (count > max)
    limiter(req, res, next);
    limiter(req, res, next);
    limiter(req, res, next);
    limiter(req, res, next);

    expect(next).toHaveBeenCalledTimes(3);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({ message: 'Too many requests' });
  });

  test('different IPs have independent counters', () => {
    process.env.RATE_LIMIT_WINDOW_MS = '60000';
    process.env.RATE_LIMIT_MAX_REQUESTS = '2';
    const limiter = require('../middleware/rateLimiter');

    const next = jest.fn();

    // IP A: 2 requests (within limit)
    const reqA = makeReq('10.0.0.3');
    const resA = makeRes();
    limiter(reqA, resA, next);
    limiter(reqA, resA, next);

    // IP B: 1 request (within limit)
    const reqB = makeReq('10.0.0.4');
    const resB = makeRes();
    limiter(reqB, resB, next);

    expect(next).toHaveBeenCalledTimes(3);
    expect(resA.status).not.toHaveBeenCalled();
    expect(resB.status).not.toHaveBeenCalled();
  });

  test('uses x-forwarded-for header when req.ip is not available', () => {
    process.env.RATE_LIMIT_WINDOW_MS = '60000';
    process.env.RATE_LIMIT_MAX_REQUESTS = '5';
    const limiter = require('../middleware/rateLimiter');

    const req = { ip: undefined, headers: { 'x-forwarded-for': '192.168.1.1' } };
    const res = makeRes();
    const next = jest.fn();

    limiter(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('falls back to "unknown" key when no IP is available', () => {
    process.env.RATE_LIMIT_WINDOW_MS = '60000';
    process.env.RATE_LIMIT_MAX_REQUESTS = '5';
    const limiter = require('../middleware/rateLimiter');

    const req = { ip: undefined, headers: {} };
    const res = makeRes();
    const next = jest.fn();

    limiter(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

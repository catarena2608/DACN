jest.mock('../src/models/order.model', () => ({
  createOrder: jest.fn(),
  findOrders: jest.fn(),
  findOrderById: jest.fn(),
  deleteOrder: jest.fn(),
}));
jest.mock('../src/utils/redis', () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  keys: jest.fn(),
  on: jest.fn(),
}));
jest.mock('../src/utils/lock', () => ({
  acquireLock: jest.fn(),
  releaseLock: jest.fn(),
}));
jest.mock('../src/utils/product.rpc');
jest.mock('../src/utils/tracer', () => ({
  runWithSpan: (_name, fn) =>
    fn({ setAttribute: jest.fn(), recordException: jest.fn(), setStatus: jest.fn(), end: jest.fn() }),
}));

const orderModel = require('../src/models/order.model');
const redis = require('../src/utils/redis');
const { acquireLock, releaseLock } = require('../src/utils/lock');
const { callProduct } = require('../src/utils/product.rpc');
const orderService = require('../src/services/order.service');

beforeEach(() => jest.clearAllMocks());

describe('getOrder', () => {
  test('returns cached result without hitting DB', async () => {
    const cached = [{ _id: 'o1', userID: 'u1' }];
    redis.get.mockResolvedValue(JSON.stringify(cached));
    const result = await orderService.getOrder({ userID: 'u1' });
    expect(result).toEqual(cached);
    expect(orderModel.findOrders).not.toHaveBeenCalled();
  });

  test('queries DB and caches result when no cache exists', async () => {
    redis.get.mockResolvedValue(null);
    acquireLock.mockResolvedValue('tok');
    releaseLock.mockResolvedValue();
    redis.set.mockResolvedValue('OK');
    orderModel.findOrders.mockResolvedValue([{ _id: 'o1', userID: 'u1' }]);

    const result = await orderService.getOrder({ userID: 'u1' });
    expect(orderModel.findOrders).toHaveBeenCalledWith({ userID: 'u1' });
    expect(result).toHaveLength(1);
    expect(redis.set).toHaveBeenCalled();
  });

  test('throws "Server busy" when lock cannot be acquired', async () => {
    redis.get.mockResolvedValue(null);
    acquireLock.mockResolvedValue(null);
    await expect(orderService.getOrder({})).rejects.toThrow('Server busy');
  });

  test('builds filter with orderID when provided', async () => {
    redis.get.mockResolvedValue(null);
    acquireLock.mockResolvedValue('tok');
    releaseLock.mockResolvedValue();
    redis.set.mockResolvedValue('OK');
    orderModel.findOrders.mockResolvedValue([]);

    await orderService.getOrder({ orderID: 'o1' });
    expect(orderModel.findOrders).toHaveBeenCalledWith({ _id: 'o1' });
  });
});

describe('getOrderById', () => {
  test('returns cached order without hitting DB', async () => {
    const cached = { _id: 'o1', userID: 'u1', total: 100 };
    redis.get.mockResolvedValue(JSON.stringify(cached));
    const result = await orderService.getOrderById('o1');
    expect(result).toEqual(cached);
    expect(orderModel.findOrderById).not.toHaveBeenCalled();
  });

  test('throws "Order not found" when order does not exist', async () => {
    redis.get.mockResolvedValue(null);
    acquireLock.mockResolvedValue('tok');
    releaseLock.mockResolvedValue();
    orderModel.findOrderById.mockResolvedValue(null);

    await expect(orderService.getOrderById('nonexistent')).rejects.toThrow('Order not found');
  });

  test('returns order from DB and caches it', async () => {
    const order = { _id: 'o1', userID: 'u1', total: 200 };
    redis.get.mockResolvedValue(null);
    acquireLock.mockResolvedValue('tok');
    releaseLock.mockResolvedValue();
    redis.set.mockResolvedValue('OK');
    orderModel.findOrderById.mockResolvedValue(order);

    const result = await orderService.getOrderById('o1');
    expect(result).toEqual(order);
    expect(redis.set).toHaveBeenCalled();
  });
});

describe('addOrder', () => {
  const orderPayload = {
    userID: 'u1',
    products: [{ productID: 'p1', num: 2 }],
    address: '123 Street',
  };

  test('reserves stock and creates order on success', async () => {
    callProduct.mockResolvedValue({ success: true, price: 500, name: 'Phone' });
    orderModel.createOrder.mockResolvedValue({
      _id: 'o1',
      userID: 'u1',
      total: 1000,
      products: [{ productID: 'p1', num: 2, price: 500 }],
    });
    redis.keys.mockResolvedValue([]);

    const result = await orderService.addOrder(orderPayload);
    expect(callProduct).toHaveBeenCalledWith({
      action: 'RESERVE_STOCK',
      productID: 'p1',
      quantity: 2,
    });
    expect(orderModel.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ userID: 'u1', total: 1000 })
    );
    expect(result._id).toBe('o1');
  });

  test('calculates total as price × quantity', async () => {
    callProduct.mockResolvedValue({ success: true, price: 300, name: 'Tablet' });
    orderModel.createOrder.mockResolvedValue({ _id: 'o1', total: 900 });
    redis.keys.mockResolvedValue([]);

    await orderService.addOrder({ userID: 'u1', products: [{ productID: 'p1', num: 3 }], address: 'Addr' });
    expect(orderModel.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ total: 900 })
    );
  });

  test('releases already-reserved stock when a product fails', async () => {
    callProduct
      .mockResolvedValueOnce({ success: true, price: 100, name: 'A' })
      .mockResolvedValueOnce({ success: false, error: 'Out of stock' });

    const payload = {
      userID: 'u1',
      products: [
        { productID: 'p1', num: 1 },
        { productID: 'p2', num: 5 },
      ],
      address: 'Addr',
    };
    await expect(orderService.addOrder(payload)).rejects.toThrow('Out of stock');
    expect(callProduct).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'RELEASE_STOCK', productID: 'p1' })
    );
  });

  test('throws error from callProduct when stock reservation fails', async () => {
    callProduct.mockResolvedValue({ success: false, error: 'Product not found' });
    await expect(orderService.addOrder(orderPayload)).rejects.toThrow('Product not found');
    expect(orderModel.createOrder).not.toHaveBeenCalled();
  });
});

describe('deleteOrder', () => {
  test('throws "Order busy" when lock cannot be acquired', async () => {
    acquireLock.mockResolvedValue(null);
    await expect(orderService.deleteOrder('o1')).rejects.toThrow('Order busy');
  });

  test('throws "Order not found" when order does not exist', async () => {
    acquireLock.mockResolvedValue('tok');
    releaseLock.mockResolvedValue();
    orderModel.findOrderById.mockResolvedValue(null);
    await expect(orderService.deleteOrder('o1')).rejects.toThrow('Order not found');
  });

  test('releases stock for each product before deleting order', async () => {
    acquireLock.mockResolvedValue('tok');
    releaseLock.mockResolvedValue();
    orderModel.findOrderById.mockResolvedValue({
      _id: 'o1',
      products: [
        { productID: 'p1', num: 2 },
        { productID: 'p2', num: 1 },
      ],
    });
    callProduct.mockResolvedValue({ success: true });
    orderModel.deleteOrder.mockResolvedValue({});
    redis.del.mockResolvedValue(1);
    redis.keys.mockResolvedValue([]);

    await orderService.deleteOrder('o1');
    expect(callProduct).toHaveBeenCalledWith({ action: 'RELEASE_STOCK', productID: 'p1', quantity: 2 });
    expect(callProduct).toHaveBeenCalledWith({ action: 'RELEASE_STOCK', productID: 'p2', quantity: 1 });
    expect(orderModel.deleteOrder).toHaveBeenCalledWith('o1');
  });

  test('returns { success: true } after deletion', async () => {
    acquireLock.mockResolvedValue('tok');
    releaseLock.mockResolvedValue();
    orderModel.findOrderById.mockResolvedValue({ _id: 'o1', products: [] });
    orderModel.deleteOrder.mockResolvedValue({});
    redis.del.mockResolvedValue(1);
    redis.keys.mockResolvedValue([]);

    const result = await orderService.deleteOrder('o1');
    expect(result.success).toBe(true);
  });

  test('always releases lock even when error occurs', async () => {
    acquireLock.mockResolvedValue('tok');
    releaseLock.mockResolvedValue();
    orderModel.findOrderById.mockResolvedValue(null);
    await orderService.deleteOrder('o1').catch(() => {});
    expect(releaseLock).toHaveBeenCalledWith('lock:order:o1', 'tok');
  });
});

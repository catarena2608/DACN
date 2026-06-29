jest.mock('../src/services/order.service', () => ({
  getOrder: jest.fn(),
  getOrderById: jest.fn(),
  addOrder: jest.fn(),
  deleteOrder: jest.fn(),
}));

const orderService = require('../src/services/order.service');
const orderController = require('../src/controllers/order.controller');

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

beforeEach(() => jest.clearAllMocks());

describe('getOrder', () => {
  test('returns order list on success', async () => {
    const orders = [{ _id: 'o1', userID: 'u1' }];
    orderService.getOrder.mockResolvedValue(orders);
    const req = { query: { userID: 'u1' } };
    const res = makeRes();
    await orderController.getOrder(req, res);
    expect(orderService.getOrder).toHaveBeenCalledWith({ userID: 'u1' });
    expect(res.json).toHaveBeenCalledWith(orders);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('responds 500 on service error', async () => {
    orderService.getOrder.mockRejectedValue(new Error('Server busy'));
    const req = { query: {} };
    const res = makeRes();
    await orderController.getOrder(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: 'Server busy' });
  });
});

describe('getOrderById', () => {
  test('returns order when found', async () => {
    const order = { _id: 'o1', userID: 'u1', total: 500 };
    orderService.getOrderById.mockResolvedValue(order);
    const req = { params: { id: 'o1' } };
    const res = makeRes();
    await orderController.getOrderById(req, res);
    expect(orderService.getOrderById).toHaveBeenCalledWith('o1');
    expect(res.json).toHaveBeenCalledWith(order);
  });

  test('responds 404 when order is not found', async () => {
    orderService.getOrderById.mockRejectedValue(new Error('Order not found'));
    const req = { params: { id: 'nonexistent' } };
    const res = makeRes();
    await orderController.getOrderById(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Order not found' });
  });
});

describe('addOrder', () => {
  test('responds 201 with created order', async () => {
    const order = { _id: 'o1', userID: 'u1', total: 1000 };
    orderService.addOrder.mockResolvedValue(order);
    const req = {
      body: { userID: 'u1', products: [{ productID: 'p1', num: 2 }], address: 'Addr' },
    };
    const res = makeRes();
    await orderController.addOrder(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(order);
  });

  test('responds 400 when RabbitMQ is not initialized', async () => {
    orderService.addOrder.mockRejectedValue(new Error('RabbitMQ not initialized'));
    const req = { body: {} };
    const res = makeRes();
    await orderController.addOrder(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'RabbitMQ not initialized' });
  });

  test('responds 400 when product is out of stock', async () => {
    orderService.addOrder.mockRejectedValue(new Error('Out of stock'));
    const req = { body: {} };
    const res = makeRes();
    await orderController.addOrder(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('deleteOrder', () => {
  test('responds 200 with success result', async () => {
    orderService.deleteOrder.mockResolvedValue({ success: true });
    const req = { params: { id: 'o1' } };
    const res = makeRes();
    await orderController.deleteOrder(req, res);
    expect(orderService.deleteOrder).toHaveBeenCalledWith('o1');
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('responds 400 when order is not found', async () => {
    orderService.deleteOrder.mockRejectedValue(new Error('Order not found'));
    const req = { params: { id: 'nonexistent' } };
    const res = makeRes();
    await orderController.deleteOrder(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Order not found' });
  });

  test('responds 400 when order is busy (lock held)', async () => {
    orderService.deleteOrder.mockRejectedValue(new Error('Order busy'));
    const req = { params: { id: 'o1' } };
    const res = makeRes();
    await orderController.deleteOrder(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

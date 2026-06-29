jest.mock('../src/models/product.model');
jest.mock('../src/models/detail.model');
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
jest.mock('../src/utils/tracer', () => ({
  runWithSpan: (_name, fn) =>
    fn({ setAttribute: jest.fn(), recordException: jest.fn(), setStatus: jest.fn(), end: jest.fn() }),
}));

const productModel = require('../src/models/product.model');
const detailModel = require('../src/models/detail.model');
const redis = require('../src/utils/redis');
const { acquireLock, releaseLock } = require('../src/utils/lock');
const productService = require('../src/services/product.service');

beforeEach(() => jest.clearAllMocks());

describe('getProducts', () => {
  test('returns cached result without hitting DB', async () => {
    const cached = { products: [{ _id: '1' }], total: 1, page: 1, totalPages: 1 };
    redis.get.mockResolvedValue(JSON.stringify(cached));
    const result = await productService.getProducts({ page: 1, limit: 10 });
    expect(result).toEqual(cached);
    expect(productModel.findProducts).not.toHaveBeenCalled();
  });

  test('queries DB and caches result when no cache exists', async () => {
    redis.get.mockResolvedValue(null);
    redis.set
      .mockResolvedValueOnce('OK')  // lock acquired
      .mockResolvedValueOnce('OK'); // cache stored
    redis.del.mockResolvedValue(1);
    productModel.findProducts.mockResolvedValue([{ _id: '1', name: 'Phone' }]);
    productModel.countProducts.mockResolvedValue(1);

    const result = await productService.getProducts({ page: 1, limit: 10 });
    expect(productModel.findProducts).toHaveBeenCalled();
    expect(result.total).toBe(1);
    expect(result.products).toHaveLength(1);
    expect(redis.del).toHaveBeenCalled(); // lock released
  });

  test('throws "Server busy" when lock cannot be acquired', async () => {
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue(null); // lock not acquired (NX failed)
    await expect(productService.getProducts({})).rejects.toThrow('Server busy, retry');
  });

  test('calculates totalPages correctly', async () => {
    redis.get.mockResolvedValue(null);
    redis.set
      .mockResolvedValueOnce('OK')
      .mockResolvedValueOnce('OK');
    redis.del.mockResolvedValue(1);
    productModel.findProducts.mockResolvedValue(new Array(3).fill({ _id: '1' }));
    productModel.countProducts.mockResolvedValue(7);

    const result = await productService.getProducts({ page: 1, limit: 3 });
    expect(result.totalPages).toBe(3); // ceil(7/3) = 3
  });
});

describe('getProductById', () => {
  test('returns cached product without hitting DB', async () => {
    const cached = { _id: '001', name: 'Laptop', price: 1000 };
    redis.get.mockResolvedValue(JSON.stringify(cached));
    const result = await productService.getProductById('001');
    expect(result).toEqual(cached);
    expect(productModel.findProductById).not.toHaveBeenCalled();
  });

  test('returns null when product does not exist', async () => {
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValueOnce('OK').mockResolvedValueOnce('OK');
    redis.del.mockResolvedValue(1);
    productModel.findProductById.mockResolvedValue(null);

    const result = await productService.getProductById('999');
    expect(result).toBeNull();
  });

  test('merges product with detail description', async () => {
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValueOnce('OK').mockResolvedValueOnce('OK');
    redis.del.mockResolvedValue(1);
    productModel.findProductById.mockResolvedValue({ _id: '001', name: 'Laptop', price: 999 });
    detailModel.findDetailById.mockResolvedValue({ description: 'A great laptop' });

    const result = await productService.getProductById('001');
    expect(result.description).toBe('A great laptop');
    expect(result.name).toBe('Laptop');
  });

  test('returns null description when no detail found', async () => {
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValueOnce('OK').mockResolvedValueOnce('OK');
    redis.del.mockResolvedValue(1);
    productModel.findProductById.mockResolvedValue({ _id: '001', name: 'Laptop' });
    detailModel.findDetailById.mockResolvedValue(null);

    const result = await productService.getProductById('001');
    expect(result.description).toBeNull();
  });
});

describe('createProduct', () => {
  test('auto-generates _id as "0001" when no products exist', async () => {
    productModel.findLastProduct.mockResolvedValue(null);
    productModel.createProduct.mockResolvedValue({ _id: '0001', name: 'New' });
    redis.keys.mockResolvedValue([]);

    const result = await productService.createProduct({ name: 'New', price: 100 });
    expect(productModel.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ _id: '0001' })
    );
    expect(result._id).toBe('0001');
  });

  test('increments _id from last product', async () => {
    productModel.findLastProduct.mockResolvedValue({ _id: '0005' });
    productModel.createProduct.mockResolvedValue({ _id: '0006', name: 'New' });
    redis.keys.mockResolvedValue([]);

    await productService.createProduct({ name: 'New' });
    expect(productModel.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ _id: '0006' })
    );
  });

  test('clears product list cache after creation', async () => {
    productModel.findLastProduct.mockResolvedValue(null);
    productModel.createProduct.mockResolvedValue({ _id: '0001' });
    redis.keys.mockResolvedValue(['products:{}', 'products:{"page":1}']);
    redis.del.mockResolvedValue(1);

    await productService.createProduct({ name: 'New' });
    expect(redis.del).toHaveBeenCalledTimes(2);
  });
});

describe('updateProduct', () => {
  test('updates product and invalidates cache', async () => {
    productModel.updateProduct.mockResolvedValue({ _id: '001', name: 'Updated', price: 200 });
    redis.del.mockResolvedValue(1);
    redis.keys.mockResolvedValue([]);

    const result = await productService.updateProduct('001', { price: 200 });
    expect(productModel.updateProduct).toHaveBeenCalledWith('001', { price: 200 });
    expect(redis.del).toHaveBeenCalledWith('product:001');
    expect(result.price).toBe(200);
  });
});

describe('deleteProduct', () => {
  test('deletes product and removes from cache', async () => {
    productModel.deleteProduct.mockResolvedValue({ _id: '001' });
    redis.del.mockResolvedValue(1);
    redis.keys.mockResolvedValue([]);

    await productService.deleteProduct('001');
    expect(productModel.deleteProduct).toHaveBeenCalledWith('001');
    expect(redis.del).toHaveBeenCalledWith('product:001');
  });
});

describe('reserveStock', () => {
  test('throws "Product busy" when lock cannot be acquired', async () => {
    acquireLock.mockResolvedValue(null);
    await expect(productService.reserveStock('p1', 2)).rejects.toThrow('Product busy');
  });

  test('throws "Product not found" when product does not exist', async () => {
    acquireLock.mockResolvedValue('lock-token');
    releaseLock.mockResolvedValue();
    productModel.findProductById.mockResolvedValue(null);
    await expect(productService.reserveStock('p1', 2)).rejects.toThrow('Product not found');
  });

  test('throws "Out of stock" when requested quantity exceeds stock', async () => {
    acquireLock.mockResolvedValue('lock-token');
    releaseLock.mockResolvedValue();
    productModel.findProductById.mockResolvedValue({ _id: 'p1', stock: 1, name: 'X', price: 100 });
    await expect(productService.reserveStock('p1', 5)).rejects.toThrow('Out of stock');
  });

  test('deducts stock and returns reservation details on success', async () => {
    acquireLock.mockResolvedValue('lock-token');
    releaseLock.mockResolvedValue();
    productModel.findProductById.mockResolvedValue({ _id: 'p1', stock: 10, name: 'Phone', price: 500 });
    productModel.updateProduct.mockResolvedValue({ _id: 'p1', stock: 8 });
    redis.del.mockResolvedValue(1);
    redis.keys.mockResolvedValue([]);

    const result = await productService.reserveStock('p1', 2);
    expect(productModel.updateProduct).toHaveBeenCalledWith('p1', { stock: 8 });
    expect(result.success).toBe(true);
    expect(result.quantity).toBe(2);
    expect(result.price).toBe(500);
  });

  test('always releases lock even when error occurs', async () => {
    acquireLock.mockResolvedValue('lock-token');
    releaseLock.mockResolvedValue();
    productModel.findProductById.mockResolvedValue(null);
    await productService.reserveStock('p1', 1).catch(() => {});
    expect(releaseLock).toHaveBeenCalledWith('lock:product:p1', 'lock-token');
  });
});

describe('releaseStock', () => {
  test('throws "Product busy" when lock cannot be acquired', async () => {
    acquireLock.mockResolvedValue(null);
    await expect(productService.releaseStock('p1', 2)).rejects.toThrow('Product busy');
  });

  test('adds quantity back to stock', async () => {
    acquireLock.mockResolvedValue('lock-token');
    releaseLock.mockResolvedValue();
    productModel.findProductById.mockResolvedValue({ _id: 'p1', stock: 5, name: 'X', price: 100 });
    productModel.updateProduct.mockResolvedValue({ _id: 'p1', stock: 8 });
    redis.del.mockResolvedValue(1);
    redis.keys.mockResolvedValue([]);

    const result = await productService.releaseStock('p1', 3);
    expect(productModel.updateProduct).toHaveBeenCalledWith('p1', { stock: 8 });
    expect(result.success).toBe(true);
  });
});

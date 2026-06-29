jest.mock('../src/services/product.service', () => ({
  getProducts: jest.fn(),
  getProductById: jest.fn(),
  createProduct: jest.fn(),
  updateProduct: jest.fn(),
  deleteProduct: jest.fn(),
}));

const productService = require('../src/services/product.service');
const productController = require('../src/controllers/product.controller');

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

beforeEach(() => jest.clearAllMocks());

describe('getProduct', () => {
  test('returns product list on success', async () => {
    const mockData = { products: [{ _id: '1', name: 'Phone' }], total: 1, page: 1, totalPages: 1 };
    productService.getProducts.mockResolvedValue(mockData);
    const req = { query: { page: 1, limit: 10 } };
    const res = makeRes();
    await productController.getProduct(req, res);
    expect(res.json).toHaveBeenCalledWith(mockData);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('responds 500 on service error', async () => {
    productService.getProducts.mockRejectedValue(new Error('Server busy, retry'));
    const req = { query: {} };
    const res = makeRes();
    await productController.getProduct(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: 'Server busy, retry' });
  });
});

describe('getProductById', () => {
  test('responds 400 when id is missing', async () => {
    const req = { params: { id: undefined } };
    const res = makeRes();
    await productController.getProductById(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Missing id' });
  });

  test('responds 404 when product does not exist', async () => {
    productService.getProductById.mockResolvedValue(null);
    const req = { params: { id: '999' } };
    const res = makeRes();
    await productController.getProductById(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Product not found' });
  });

  test('returns product when found', async () => {
    const product = { _id: '001', name: 'Laptop', price: 999 };
    productService.getProductById.mockResolvedValue(product);
    const req = { params: { id: '001' } };
    const res = makeRes();
    await productController.getProductById(req, res);
    expect(res.json).toHaveBeenCalledWith(product);
  });

  test('responds 500 on service error', async () => {
    productService.getProductById.mockRejectedValue(new Error('DB error'));
    const req = { params: { id: '001' } };
    const res = makeRes();
    await productController.getProductById(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('addProduct', () => {
  test('responds 201 with created product', async () => {
    const newProduct = { _id: '0001', name: 'Headphones', price: 50 };
    productService.createProduct.mockResolvedValue(newProduct);
    const req = { body: { name: 'Headphones', price: 50 } };
    const res = makeRes();
    await productController.addProduct(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(newProduct);
  });

  test('responds 500 on service error', async () => {
    productService.createProduct.mockRejectedValue(new Error('DB error'));
    const req = { body: {} };
    const res = makeRes();
    await productController.addProduct(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('adjustProduct', () => {
  test('responds 400 when id is missing', async () => {
    const req = { params: { id: undefined }, body: {} };
    const res = makeRes();
    await productController.adjustProduct(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Missing id' });
  });

  test('returns updated product', async () => {
    const updated = { _id: '001', name: 'Laptop', price: 1100 };
    productService.updateProduct.mockResolvedValue(updated);
    const req = { params: { id: '001' }, body: { price: 1100 } };
    const res = makeRes();
    await productController.adjustProduct(req, res);
    expect(productService.updateProduct).toHaveBeenCalledWith('001', { price: 1100 });
    expect(res.json).toHaveBeenCalledWith(updated);
  });
});

describe('deleteProduct', () => {
  test('responds 400 when id is missing', async () => {
    const req = { params: { id: undefined } };
    const res = makeRes();
    await productController.deleteProduct(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('responds with success message after deletion', async () => {
    productService.deleteProduct.mockResolvedValue();
    const req = { params: { id: '001' } };
    const res = makeRes();
    await productController.deleteProduct(req, res);
    expect(productService.deleteProduct).toHaveBeenCalledWith('001');
    expect(res.json).toHaveBeenCalledWith({ message: 'Deleted successfully' });
  });

  test('responds 500 on service error', async () => {
    productService.deleteProduct.mockRejectedValue(new Error('DB error'));
    const req = { params: { id: '001' } };
    const res = makeRes();
    await productController.deleteProduct(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

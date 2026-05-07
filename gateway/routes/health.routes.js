const axios = require('axios');

exports.checkSystemHealth = async (req, res) => {
  const services = [
    { name: 'auth_service', url: process.env.AUTH_SERVICE_URL + '/health' },
    { name: 'product_service', url: process.env.PRODUCT_SERVICE_URL + '/health' }
  ];

  const healthStatus = {
    gateway: "OK",
    timestamp: new Date().toISOString(),
    dependencies: []
  };

  const checks = services.map(async (service) => {
    try {
      const response = await axios.get(service.url, { timeout: 2000 });
      return { name: service.name, status: "UP", details: response.data };
    } catch (error) {
      return { name: service.name, status: "DOWN", error: error.message };
    }
  });

  healthStatus.dependencies = await Promise.all(checks);

  const isAnyDown = healthStatus.dependencies.some(s => s.status === "DOWN");
  res.status(isAnyDown ? 503 : 200).json(healthStatus);
};
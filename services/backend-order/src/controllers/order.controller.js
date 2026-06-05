const orderService =
  require("../services/order.service");

exports.getOrder =
  async (req, res) => {
    try {
      const data =
        await orderService.getOrder(
          req.query
        );

      res.json(data);
    } catch (err) {
      res.status(500).json({
        message: err.message,
      });
    }
  };

exports.getOrderById =
  async (req, res) => {
    try {
      const data =
        await orderService.getOrderById(
          req.params.id
        );

      res.json(data);
    } catch (err) {
      res.status(404).json({
        message: err.message,
      });
    }
  };

exports.addOrder =
  async (req, res) => {
    try {
      const data =
        await orderService.addOrder(
          req.body
        );

      res.status(201).json(data);
    } catch (err) {
      res.status(400).json({
        message: err.message,
      });
    }
  };

exports.deleteOrder =
  async (req, res) => {
    try {
      const data =
        await orderService.deleteOrder(
          req.params.id
        );

      res.json(data);
    } catch (err) {
      res.status(400).json({
        message: err.message,
      });
    }
  };
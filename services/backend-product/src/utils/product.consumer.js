const productService = require("../services/product.service");
const { startConsumer } = require("./rabbit");

async function start() {

  const channel = await startConsumer();

  channel.consume("product.rpc",async (msg) => {
    const request =JSON.parse(msg.content.toString());
    let response;
    try {
      switch (request.action) {
        case "RESERVE_STOCK":
          response =await productService.reserveStock(
            request.productID, 
            request.quantity);

          break;

        case "RELEASE_STOCK":
            response =await productService.releaseStock(
              request.productID,
              request.quantity
            );

          break;

        default:
          throw new Error("Unknown action");
      }

    } catch (err) {

      response = {success: false,
        error:
          err.message,
      };
    }

    channel.sendToQueue(
      msg.properties.replyTo,
      Buffer.from(JSON.stringify(response)),
      {
        correlationId:
          msg.properties.correlationId,
      }
    );

    channel.ack(msg);
    }
  );
}

module.exports = start;
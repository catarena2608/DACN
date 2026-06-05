const crypto = require("crypto");
const { getChannel } = require("./rabbit");

exports.callProduct = async (payload) => {

  const channel = getChannel();

  const corrId = crypto.randomUUID();

  const q = await channel.assertQueue(
    "",
    {
      exclusive: true,
    }
  );

  return new Promise((resolve) => {

    channel.consume(
      q.queue,
      (msg) => {

        if (
          msg.properties.correlationId ===
          corrId
        ) {
          resolve(
            JSON.parse(
              msg.content.toString()
            )
          );
        }
      },
      {
        noAck: true,
      }
    );

    channel.sendToQueue(
      "product.rpc",
      Buffer.from(
        JSON.stringify(payload)
      ),
      {
        correlationId: corrId,
        replyTo: q.queue,
      }
    );
  });
};
const amqp = require("amqplib");

let channel;

async function connectRabbit() {

  const conn = await amqp.connect(
    process.env.RABBITMQ_URL ||
    "amqp://guest:guest@localhost:5672"
  );

  channel = await conn.createChannel();

  await channel.assertQueue(
    "product.rpc",
    {
      durable: true,
    }
  );

  console.log("✅ RabbitMQ connected");

  return channel;
}

function getChannel() {

  if (!channel) {
    throw new Error(
      "RabbitMQ not initialized"
    );
  }

  return channel;
}

module.exports = {
  connectRabbit,
  getChannel,
};
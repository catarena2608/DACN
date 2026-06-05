const amqp = require("amqplib");

async function startConsumer() {

  const conn = await amqp.connect(
    process.env.RABBITMQ_URL ||
    "amqp://guest:guest@localhost:5672"
  );

  const channel =
    await conn.createChannel();

  await channel.assertQueue(
    "product.rpc",
    {
      durable: true,
    }
  );
  console.log("🐰 RabbitMQ connected");
  return channel;
}

module.exports = {
  startConsumer,
};
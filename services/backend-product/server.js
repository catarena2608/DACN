require('./tracing/tracing');
const app = require("./src/app");

const PORT = process.env.PORT || 3002;

app.listen(PORT, () => {
  console.log(`Product service running on port ${PORT}`);
});

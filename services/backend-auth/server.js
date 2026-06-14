require('./tracing/tracing');
const app = require("./src/app");

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Auth service running on port ${PORT}`);
});

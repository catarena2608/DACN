const app = require("./src/app");

const PORT = process.env.PORT || 3003;

app.listen(PORT, () => {
  console.log(`🚀 Order service running on port ${PORT}`);
  console.log("URI:", process.env.URI);
});
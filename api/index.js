let app;
try {
  app = require('../api-server/server');
} catch (e) {
  app = (req, res) => res.status(500).json({ error: e.message });
}

module.exports = async (req, res) => {
  app(req, res);
};

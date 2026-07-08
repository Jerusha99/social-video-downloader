const app = require('../api-server/server');

module.exports = async (req, res) => {
  app(req, res);
};

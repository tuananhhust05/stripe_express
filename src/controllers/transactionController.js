const { listTransactions } = require('../services/transactionService');

const getTransactions = async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const transactions = await listTransactions({ limit });
    res.json({ data: transactions });
  } catch (err) {
    next(err);
  }
};

module.exports = { getTransactions };


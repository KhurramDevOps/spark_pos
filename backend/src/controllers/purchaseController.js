import { recordPurchase, listPurchases, getPurchase } from "../services/purchaseService.js";
import { reversePurchase } from "../services/reversalService.js";
import { rupeesToPaisa } from "../../../shared/validation/money.js";

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const create = wrap(async (req, res) => {
  const v = req.validated;
  // Convert each line's unitCost rupees -> paisa string at the boundary; the
  // service works in paisa. qty is a quantity, passed through as a decimal string.
  const lines = v.lines.map((l) => ({
    itemId: l.itemId,
    qty: l.qty,
    unitCost: String(rupeesToPaisa(l.unitCost, "unitCost").value),
  }));

  const { purchase, supplier } = await recordPurchase(
    { date: v.date, supplierId: v.supplierId, paymentType: v.paymentType, lines, note: v.note },
    { userId: req.userId }
  );
  res.status(201).json({ purchase, supplier });
});

export const list = wrap(async (req, res) => {
  const { supplierId, from, to, page, limit } = req.query;
  const result = await listPurchases({
    supplierId: supplierId || undefined,
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
    page,
    limit,
  });
  res.json(result);
});

export const getOne = wrap(async (req, res) => {
  const purchase = await getPurchase(req.params.id);
  res.json(purchase);
});

export const reverse = wrap(async (req, res) => {
  const result = await reversePurchase(req.params.id, { userId: req.userId });
  res.json(result);
});

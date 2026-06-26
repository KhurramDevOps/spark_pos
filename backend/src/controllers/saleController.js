import { recordSale, listSales, getSale } from "../services/saleService.js";
import { voidSale, recordCustomerReturn, listCustomerReturnsForSale } from "../services/saleReversalService.js";
import { rupeesToPaisa } from "../../../shared/validation/money.js";

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const create = wrap(async (req, res) => {
  const v = req.validated;
  // Convert each line's unitPrice rupees -> paisa string at the boundary; the
  // service works in paisa (same pattern as the purchase controller — one
  // conversion path via the shared money validator). A quick line (spec 008)
  // carries a name and no itemId; an item line carries an itemId and no name.
  const lines = v.lines.map((l) => {
    const common = { qty: l.qty, unitPrice: String(rupeesToPaisa(l.unitPrice, "unitPrice").value) };
    return l.kind === "quick"
      ? { kind: "quick", name: l.name, ...common }
      : { kind: "item", itemId: l.itemId, ...common };
  });

  const { sale, customer } = await recordSale(
    {
      date: v.date,
      customerId: v.customerId,
      paymentType: v.paymentType,
      priceMode: v.priceMode,
      lines,
      note: v.note,
    },
    { userId: req.userId }
  );
  res.status(201).json({ sale, customer });
});

export const list = wrap(async (req, res) => {
  const { customerId, from, to, paymentType, page, limit } = req.query;
  const result = await listSales({
    customerId: customerId || undefined,
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
    paymentType: paymentType || undefined,
    // Workers see ONLY their own sales (§9.4) — server-enforced, not UI-hidden.
    createdBy: req.userRole === "worker" ? req.userId : undefined,
    page,
    limit,
  });
  res.json(result);
});

export const getOne = wrap(async (req, res) => {
  const restrictToUserId = req.userRole === "worker" ? req.userId : null;
  res.json(await getSale(req.params.id, { restrictToUserId }));
});

export const void_ = wrap(async (req, res) => {
  res.json(await voidSale(req.params.id, { userId: req.userId }));
});

export const returns = wrap(async (req, res) => {
  res.json(await listCustomerReturnsForSale(req.params.id));
});

export const recordReturn = wrap(async (req, res) => {
  const v = req.validated;
  const result = await recordCustomerReturn(
    { saleId: req.params.id, customerId: v.customerId, date: v.date, lines: v.lines, refundMethod: v.refundMethod, note: v.note },
    { userId: req.userId }
  );
  res.status(201).json(result);
});

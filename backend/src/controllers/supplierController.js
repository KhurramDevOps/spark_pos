import {
  createSupplier,
  listSuppliers,
  getSupplier,
  updateSupplier,
  setSupplierActive,
  recordSupplierPayment,
  listSupplierPayments,
} from "../services/supplierService.js";
import { rupeesToPaisa } from "../../../shared/validation/money.js";

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const create = wrap(async (req, res) => {
  const v = req.validated;
  const supplier = await createSupplier({
    name: v.name,
    phone: v.phone,
    openingBalance: String(rupeesToPaisa(v.openingBalance, "openingBalance").value),
  });
  res.status(201).json(supplier);
});

export const list = wrap(async (req, res) => {
  const { active } = req.query;
  let activeFilter;
  if (active === "true") activeFilter = true;
  else if (active === "false") activeFilter = false;
  else if (active === "all") activeFilter = undefined;
  else activeFilter = true;
  res.json(await listSuppliers({ active: activeFilter }));
});

export const getOne = wrap(async (req, res) => {
  res.json(await getSupplier(req.params.id));
});

export const update = wrap(async (req, res) => {
  res.json(await updateSupplier(req.params.id, req.validated));
});

export const deactivate = wrap(async (req, res) => {
  res.json(await setSupplierActive(req.params.id, false));
});

export const reactivate = wrap(async (req, res) => {
  res.json(await setSupplierActive(req.params.id, true));
});

export const payments = wrap(async (req, res) => {
  res.json(await listSupplierPayments(req.params.id));
});

export const recordPayment = wrap(async (req, res) => {
  const v = req.validated;
  const result = await recordSupplierPayment(
    {
      supplierId: req.params.id,
      amount: String(rupeesToPaisa(v.amount, "amount").value),
      date: v.date,
      note: v.note,
    },
    { userId: req.userId }
  );
  res.status(201).json(result);
});

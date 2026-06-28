import {
  createCustomer,
  listCustomers,
  getCustomer,
  updateCustomer,
  setCustomerActive,
  recordCustomerPayment,
  listCustomerPayments,
  recordCustomerAdjustment,
  listCustomerAdjustments,
} from "../services/customerService.js";
import { rupeesToPaisa } from "../../../shared/validation/money.js";

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const create = wrap(async (req, res) => {
  const v = req.validated;
  const customer = await createCustomer({
    name: v.name,
    phone: v.phone,
    openingBalance: String(rupeesToPaisa(v.openingBalance, "openingBalance").value),
    promisedPayBy: v.promisedPayBy ?? null,
  });
  res.status(201).json(customer);
});

export const list = wrap(async (req, res) => {
  const { active } = req.query;
  let activeFilter;
  if (active === "true") activeFilter = true;
  else if (active === "false") activeFilter = false;
  else if (active === "all") activeFilter = undefined;
  else activeFilter = true;
  res.json(await listCustomers({ active: activeFilter, search: req.query.search }));
});

export const getOne = wrap(async (req, res) => {
  res.json(await getCustomer(req.params.id));
});

export const update = wrap(async (req, res) => {
  res.json(await updateCustomer(req.params.id, req.validated));
});

export const deactivate = wrap(async (req, res) => {
  res.json(await setCustomerActive(req.params.id, false));
});

export const reactivate = wrap(async (req, res) => {
  res.json(await setCustomerActive(req.params.id, true));
});

export const payments = wrap(async (req, res) => {
  res.json(await listCustomerPayments(req.params.id));
});

export const recordPayment = wrap(async (req, res) => {
  const v = req.validated;
  const result = await recordCustomerPayment(
    {
      customerId: req.params.id,
      amount: String(rupeesToPaisa(v.amount, "amount").value),
      date: v.date,
      note: v.note,
    },
    { userId: req.userId }
  );
  res.status(201).json(result);
});

export const adjustments = wrap(async (req, res) => {
  res.json(await listCustomerAdjustments(req.params.id));
});

export const recordAdjustment = wrap(async (req, res) => {
  const v = req.validated;
  // Map the increase/decrease toggle + positive rupees → a signed paisa amount.
  const magnitude = rupeesToPaisa(v.amount, "amount").value;
  const signed = v.direction === "decrease" ? -magnitude : magnitude;
  const result = await recordCustomerAdjustment(
    { customerId: req.params.id, amount: String(signed), reason: v.reason, date: v.date },
    { userId: req.userId }
  );
  res.status(201).json(result);
});

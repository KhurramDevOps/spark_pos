import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import Customer from "../src/models/Customer.js";
import CustomerAdjustment from "../src/models/CustomerAdjustment.js";
import CustomerPayment from "../src/models/CustomerPayment.js";
import {
  createCustomer,
  recordCustomerAdjustment,
  listCustomerAdjustments,
  recordCustomerPayment,
  getCustomer,
} from "../src/services/customerService.js";
import { aggregateCashFlows } from "../src/services/dailyCloseService.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_cust_adjustment?replicaSet=rs0";

const userId = new mongoose.Types.ObjectId();

before(async () => {
  await mongoose.connect(TEST_URI);
  await Promise.all([Customer.init(), CustomerAdjustment.init(), CustomerPayment.init()]);
});
after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
beforeEach(async () => {
  await Promise.all([Customer.deleteMany({}), CustomerAdjustment.deleteMany({}), CustomerPayment.deleteMany({})]);
});

const bal = (c) => c.balance.toString();
const wideRange = () => ({ start: new Date(Date.now() - 86400000), end: new Date(Date.now() + 86400000) });

test("an increase adjustment raises the balance; opening balance is untouched", async () => {
  const c = await createCustomer({ name: "Cust", openingBalance: "5000" }); // owes 50.00
  const { customer } = await recordCustomerAdjustment(
    { customerId: c._id, amount: "45000", reason: "corrected opening: was 50, should be 500" },
    { userId }
  );
  assert.equal(bal(customer), "50000"); // 5000 + 45000
  const fresh = await getCustomer(c._id);
  assert.equal(fresh.openingBalance.toString(), "5000"); // immutable
  assert.equal(bal(fresh), "50000");
});

test("a decrease adjustment lowers the balance and may drive it negative (store credit)", async () => {
  const c = await createCustomer({ name: "Cust", openingBalance: "10000" });
  const { customer } = await recordCustomerAdjustment(
    { customerId: c._id, amount: "-15000", reason: "wrote off + overpaid" },
    { userId }
  );
  assert.equal(bal(customer), "-5000"); // 10000 - 15000 = -5000 (advance/credit)
});

test("a zero adjustment is rejected", async () => {
  const c = await createCustomer({ name: "Cust", openingBalance: "10000" });
  await assert.rejects(
    () => recordCustomerAdjustment({ customerId: c._id, amount: "0", reason: "noop" }, { userId }),
    /greater than 0|cannot be zero|non-zero/i
  );
});

test("a missing reason is rejected", async () => {
  const c = await createCustomer({ name: "Cust", openingBalance: "10000" });
  await assert.rejects(
    () => recordCustomerAdjustment({ customerId: c._id, amount: "5000", reason: "" }, { userId }),
    /reason/i
  );
});

test("EXCLUSION: an adjustment does NOT count as cash in the daily-close math", async () => {
  const c = await createCustomer({ name: "Cust", openingBalance: "0" });
  // A real payment IS cash; an adjustment is NOT.
  await recordCustomerPayment({ customerId: c._id, amount: "30000", note: "cash in" }, { userId });
  await recordCustomerAdjustment({ customerId: c._id, amount: "99999", reason: "correction" }, { userId });

  const flows = await aggregateCashFlows(wideRange());
  // Only the 30000 payment shows as customer-payment cash; the 99999 adjustment is absent.
  assert.equal(flows.customerPayments, "30000");
});

test("adjustments list newest-first for the ledger", async () => {
  const c = await createCustomer({ name: "Cust", openingBalance: "0" });
  await recordCustomerAdjustment({ customerId: c._id, amount: "1000", reason: "first" }, { userId });
  await recordCustomerAdjustment({ customerId: c._id, amount: "2000", reason: "second" }, { userId });
  const list = await listCustomerAdjustments(c._id);
  assert.equal(list.length, 2);
  assert.equal(list[0].reason, "second"); // newest first
});

import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import Customer from "../src/models/Customer.js";
import Supplier from "../src/models/Supplier.js";
import { createCustomer, listCustomers, setCustomerActive } from "../src/services/customerService.js";
import { createSupplier, listSuppliers, setSupplierActive } from "../src/services/supplierService.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_khata_totals?replicaSet=rs0";

before(async () => {
  await mongoose.connect(TEST_URI);
  await Promise.all([Customer.init(), Supplier.init()]);
});
after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
beforeEach(async () => {
  await Promise.all([Customer.deleteMany({}), Supplier.deleteMany({})]);
});

test("listCustomers totals match a hand-sum over positive / negative / zero balances", async () => {
  await createCustomer({ name: "Owes 450", openingBalance: "45000" });
  await createCustomer({ name: "Owes 200", openingBalance: "20000" });
  await createCustomer({ name: "Credit 8", openingBalance: "-800" }); // store credit
  await createCustomer({ name: "Settled", openingBalance: "0" }); // not a khata customer
  const deact = await createCustomer({ name: "Owes 50 (inactive)", openingBalance: "5000" });
  await setCustomerActive(deact._id, false);

  const { totals } = await listCustomers({});
  // toReceive = 45000 + 20000 + 5000 (the inactive one still owes) = 70000
  assert.equal(totals.toReceive, "70000");
  assert.equal(totals.storeCredit, "800"); // |−800|
  assert.equal(totals.count, 4); // all non-zero balances (the settled one excluded)
});

test("customer totals are GLOBAL — identical regardless of the active filter, while the list is filtered", async () => {
  await createCustomer({ name: "Active owes", openingBalance: "10000" });
  const inactive = await createCustomer({ name: "Inactive owes", openingBalance: "30000" });
  await setCustomerActive(inactive._id, false);

  const all = await listCustomers({});
  const activeOnly = await listCustomers({ active: true });

  // The LIST respects the filter…
  assert.equal(all.customers.length, 2);
  assert.equal(activeOnly.customers.length, 1);
  // …but the TOTALS are the whole book either way (the inactive debtor still counts).
  assert.deepEqual(activeOnly.totals, all.totals);
  assert.equal(activeOnly.totals.toReceive, "40000");
  assert.equal(activeOnly.totals.count, 2);
});

test("listSuppliers totals match a hand-sum; activeCount counts only active suppliers", async () => {
  await createSupplier({ name: "Pay 1000", openingBalance: "100000" });
  await createSupplier({ name: "Pay 500", openingBalance: "50000" });
  await createSupplier({ name: "Advance 20", openingBalance: "-2000" });
  await createSupplier({ name: "Settled", openingBalance: "0" });
  const deact = await createSupplier({ name: "Pay 300 (inactive)", openingBalance: "30000" });
  await setSupplierActive(deact._id, false);

  const { totals } = await listSuppliers({});
  // toPay = 100000 + 50000 + 30000 (inactive still owed) = 180000
  assert.equal(totals.toPay, "180000");
  assert.equal(totals.advances, "2000");
  assert.equal(totals.activeCount, 4); // 5 suppliers, one deactivated
});

test("empty collections → totals are 0 and counts are 0 (no NaN / no throw)", async () => {
  const c = await listCustomers({});
  assert.deepEqual(c.customers, []);
  assert.deepEqual(c.totals, { toReceive: "0", storeCredit: "0", count: 0 });

  const s = await listSuppliers({});
  assert.deepEqual(s.suppliers, []);
  assert.deepEqual(s.totals, { toPay: "0", advances: "0", activeCount: 0 });
});

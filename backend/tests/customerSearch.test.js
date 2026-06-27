import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import Customer from "../src/models/Customer.js";
import { createCustomer, listCustomers, setCustomerActive } from "../src/services/customerService.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_customer_search?replicaSet=rs0";

before(async () => {
  await mongoose.connect(TEST_URI);
  await Customer.init();
});
after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
beforeEach(async () => {
  await Customer.deleteMany({});
});

const names = (res) => res.customers.map((c) => c.name).sort();

test("search filters the list by a case-insensitive name substring", async () => {
  await createCustomer({ name: "Ahmed Khan" });
  await createCustomer({ name: "Bilal Ahmed" });
  await createCustomer({ name: "Zubair Ali" });

  const res = await listCustomers({ search: "ahmed" });
  assert.deepEqual(names(res), ["Ahmed Khan", "Bilal Ahmed"]); // both contain "ahmed", any case
});

test("a blank or whitespace-only search returns everyone (no filter)", async () => {
  await createCustomer({ name: "One" });
  await createCustomer({ name: "Two" });

  assert.equal((await listCustomers({ search: "" })).customers.length, 2);
  assert.equal((await listCustomers({ search: "   " })).customers.length, 2);
  assert.equal((await listCustomers({})).customers.length, 2);
});

test("search combines with the active filter", async () => {
  await createCustomer({ name: "Active Ahmed" });
  const inactive = await createCustomer({ name: "Inactive Ahmed" });
  await setCustomerActive(inactive._id, false);
  await createCustomer({ name: "Active Bilal" });

  const res = await listCustomers({ active: true, search: "ahmed" });
  assert.deepEqual(names(res), ["Active Ahmed"]); // inactive Ahmed excluded by the active filter
});

test("totals stay whole-book (global) even when the list is narrowed by search", async () => {
  await createCustomer({ name: "Ahmed owes", openingBalance: "30000" });
  await createCustomer({ name: "Bilal owes", openingBalance: "20000" });

  const res = await listCustomers({ search: "ahmed" });
  assert.equal(res.customers.length, 1); // list is narrowed…
  assert.equal(res.totals.toReceive, "50000"); // …but totals are the whole book (30000 + 20000)
  assert.equal(res.totals.count, 2);
});

test("regex metacharacters in the query are matched literally (no injection)", async () => {
  await createCustomer({ name: "abc" });
  await createCustomer({ name: "a.c" });

  // "a.c" must match only the literal "a.c", not "abc" (which a raw '.' regex would).
  assert.deepEqual(names(await listCustomers({ search: "a.c" })), ["a.c"]);
});

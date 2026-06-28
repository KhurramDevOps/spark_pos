import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import Customer from "../src/models/Customer.js";
import { createCustomer, updateCustomer, getCustomer } from "../src/services/customerService.js";

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_promised_date?replicaSet=rs0";

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

test("a customer can be created with a promised-pay-by date", async () => {
  const c = await createCustomer({ name: "Owes", openingBalance: "50000", promisedPayBy: new Date("2026-07-15") });
  const fresh = await getCustomer(c._id);
  assert.equal(new Date(fresh.promisedPayBy).toISOString().slice(0, 10), "2026-07-15");
});

test("promisedPayBy defaults to null when not given", async () => {
  const c = await createCustomer({ name: "No promise", openingBalance: "0" });
  assert.equal(c.promisedPayBy, null);
});

test("updateCustomer can set the promised date", async () => {
  const c = await createCustomer({ name: "Cust", openingBalance: "10000" });
  await updateCustomer(c._id, { promisedPayBy: new Date("2026-08-01") });
  const fresh = await getCustomer(c._id);
  assert.equal(new Date(fresh.promisedPayBy).toISOString().slice(0, 10), "2026-08-01");
});

test("updateCustomer can CLEAR the promised date with null", async () => {
  const c = await createCustomer({ name: "Cust", openingBalance: "10000", promisedPayBy: new Date("2026-08-01") });
  await updateCustomer(c._id, { promisedPayBy: null });
  const fresh = await getCustomer(c._id);
  assert.equal(fresh.promisedPayBy, null);
});

test("updating the promised date leaves name/balance untouched", async () => {
  const c = await createCustomer({ name: "Cust", openingBalance: "30000" });
  await updateCustomer(c._id, { promisedPayBy: new Date("2026-09-09") });
  const fresh = await getCustomer(c._id);
  assert.equal(fresh.name, "Cust");
  assert.equal(fresh.balance.toString(), "30000"); // cached balance unchanged
});

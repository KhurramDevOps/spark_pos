import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { createApp } from "../src/app.js";

// Render terminates TLS at a proxy; trusting one hop makes req.ip / req.secure /
// req.protocol reflect the real client. (Secure-cookie detection is handled
// independently by express-session's proxy:true — ADR-014.)

const TEST_URI =
  process.env.TEST_MONGODB_URI ||
  "mongodb://127.0.0.1:27017/sparkpos_test_trustproxy?replicaSet=rs0";

let app;

before(async () => {
  await mongoose.connect(TEST_URI);
  // Pre-create the sessions collection up front and await it, so connect-mongo's
  // background collection/index setup isn't still pending when after() drops the
  // DB (else its implicit createCollection races the drop under parallel test load
  // and fails the file). Mirrors prodServing / setupGateSpa.
  await mongoose.connection.createCollection("sessions").catch(() => {});
  app = createApp();
  await mongoose.connection.collection("sessions").createIndex({ expires: 1 }, { expireAfterSeconds: 0 });
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test("the app trusts exactly one proxy hop", () => {
  assert.equal(app.get("trust proxy"), 1);
});

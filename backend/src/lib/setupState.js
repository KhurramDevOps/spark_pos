import User from "../models/User.js";

// In-memory cache of "has the system been bootstrapped?" (spec 007 §6). The
// empty-DB 503 gate checks this on every request, so we avoid a DB hit per
// request: initialised once at startup, flipped true the moment bootstrap
// creates the first owner.
let _hasUsers = false;

export function hasUsers() {
  return _hasUsers;
}

export function setHasUsers(value) {
  _hasUsers = Boolean(value);
}

/** Initialise the flag from the DB (call once at startup, before serving). */
export async function refreshHasUsers() {
  _hasUsers = (await User.estimatedDocumentCount()) > 0;
  return _hasUsers;
}

// KALUSAGAP Health Personnel Registration — contact number rules (node:test, no
// browser/network). Proves the contact-number masking and validation used by
// PersonnelRegistration.jsx keep the frontend consistent with the backend
// `isStrictMobile` rule and the staff_account_requests phone CHECK constraint:
// digits only, capped at 11, exact 11-digit 09XXXXXXXXX required for validity.
//
// Run: node --test tests/registration/personnelContact.test.js

import assert from "node:assert/strict";
import test from "node:test";

import { digitsOnly, isStrictMobile } from "../../src/utils/validation/index.js";

const CONTACT_MAX_DIGITS = 11;

// Mirrors `setContact` in PersonnelRegistration.jsx: strip non-digits, cap at 11.
const maskContact = (raw) => digitsOnly(raw).slice(0, CONTACT_MAX_DIGITS);

test("masking strips letters and special characters, keeping only digits", () => {
  assert.equal(maskContact("0917abc4567"), "09174567");
  assert.equal(maskContact("0917-123-4567"), "09171234567");
  assert.equal(maskContact("(0917) 123 4567"), "09171234567");
  assert.equal(maskContact("+639171234567"), "639171234567".slice(0, 11));
});

test("masking never keeps more than 11 digits", () => {
  assert.equal(maskContact("091712345670000"), "09171234567");
  assert.equal(maskContact("12345678901234"), "12345678901");
  assert.ok(maskContact("99999999999999").length === CONTACT_MAX_DIGITS);
});

test("a well-formed 11-digit 09 number is accepted", () => {
  assert.equal(isStrictMobile("09171234567"), true);
  assert.equal(isStrictMobile(maskContact("09171234567")), true);
});

test("validation rejects wrong length, wrong prefix and separators", () => {
  assert.equal(isStrictMobile("0917123456"), false); // 10 digits
  assert.equal(isStrictMobile("091712345670"), false); // 12 digits
  assert.equal(isStrictMobile("08171234567"), false); // wrong prefix
  assert.equal(isStrictMobile("0917 123 4567"), false); // separators
  assert.equal(isStrictMobile("+639171234567"), false); // country code prefix
  assert.equal(isStrictMobile("0917abc4567"), false); // letters
});

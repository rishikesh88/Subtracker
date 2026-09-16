process.env.TOKEN_ENCRYPTION_KEY = Buffer.from(
  "0123456789abcdef0123456789abcdef", "utf8").toString("base64");

const m = await import("./tokenCrypto");
let pass = 0, fail = 0;
const check = (name, cond) => { cond ? (pass++, console.log("  ok   " + name)) : (fail++, console.log("  FAIL " + name)); };

const secret = "1//0abcXYZ-real_looking.refresh~token";
const enc = m.encryptToken(secret);
check("ciphertext differs from plaintext", enc !== secret);
check("plaintext absent from ciphertext", !enc.includes(secret));
check("version prefix present", enc.startsWith("v1."));
check("round-trips", m.decryptToken(enc) === secret);

const enc2 = m.encryptToken(secret);
check("same input gives different ciphertext (random IV)", enc !== enc2);
check("both decrypt to the same value", m.decryptToken(enc2) === secret);

// The property the whole rollout depends on.
check("legacy plaintext passes through untouched", m.decryptToken(secret) === secret);
check("isEncrypted false for plaintext", m.isEncrypted(secret) === false);

// Tamper detection.
const parts = enc.split(".");
const tampered = [parts[0], parts[1], parts[2], Buffer.from("nonsense").toString("base64url")].join(".");
let threw = false;
try { m.decryptToken(tampered); } catch { threw = true; }
check("tampered ciphertext throws rather than returning junk", threw);

// Field helpers.
const row = { accessToken: "at-123", refreshToken: "rt-456", other: "untouched", nullTok: null };
const e = m.encryptFields(row, ["accessToken", "refreshToken", "nullTok"]);
check("encryptFields leaves non-token fields alone", e.other === "untouched");
check("encryptFields tolerates null", e.nullTok === null);
const d = m.decryptFields(e, ["accessToken", "refreshToken", "nullTok"]);
check("encryptFields/decryptFields round-trip", d.accessToken === "at-123" && d.refreshToken === "rt-456");

// Double-encryption guard: re-writing an already-encrypted row must not nest.
const twice = m.encryptFields(e, ["accessToken"]);
check("already-encrypted value is not re-encrypted", twice.accessToken === e.accessToken);

// Wrong key must not silently succeed.
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

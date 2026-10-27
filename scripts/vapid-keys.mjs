// Prints a new VAPID key pair for Web Push (base64url, the format browsers
// and the push library use). Run once: node scripts/vapid-keys.mjs
const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const b64url = (buf) => Buffer.from(buf).toString("base64url");
const raw = await crypto.subtle.exportKey("raw", publicKey);
const jwk = await crypto.subtle.exportKey("jwk", privateKey);
console.log(`VAPID_PUBLIC_KEY=${b64url(raw)}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);

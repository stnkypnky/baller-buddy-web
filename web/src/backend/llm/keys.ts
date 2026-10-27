/** API keys, encrypted at rest in IndexedDB with a non-extractable AES-GCM key
 *  (the browser's stand-in for the OS keychain the desktop used). Keys never
 *  leave this device except in requests to their own provider, and only
 *  {configured, last4} is shown in the UI. */

import { idbGet, idbSet, idbDel } from "../idb";

const MASTER = "__master";

interface Sealed {
  iv: Uint8Array;
  data: ArrayBuffer;
}

let master: Promise<CryptoKey> | null = null;
const plain = new Map<string, string>(); // decrypted copies for this session

function masterKey(): Promise<CryptoKey> {
  if (!master) {
    master = (async () => {
      const have = await idbGet<CryptoKey>("keys", MASTER).catch(() => undefined);
      if (have) return have;
      const k = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      await idbSet("keys", MASTER, k);
      return k;
    })();
    master.catch(() => (master = null));
  }
  return master;
}

export async function getKey(provider: string): Promise<string> {
  if (plain.has(provider)) return plain.get(provider)!;
  try {
    const sealed = await idbGet<Sealed>("keys", `k_${provider}`);
    if (!sealed) return "";
    const buf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.iv as BufferSource }, await masterKey(), sealed.data);
    const key = new TextDecoder().decode(buf);
    plain.set(provider, key);
    return key;
  } catch (e) {
    console.warn(`key read failed for ${provider}:`, e);
    return "";
  }
}

export async function setKey(provider: string, key: string) {
  const k = key.trim();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, await masterKey(), new TextEncoder().encode(k));
  await idbSet("keys", `k_${provider}`, { iv, data });
  plain.set(provider, k);
}

export async function deleteKey(provider: string) {
  plain.delete(provider);
  await idbDel("keys", `k_${provider}`).catch(() => {});
}

export async function keyStatus(provider: string) {
  const k = await getKey(provider);
  return { configured: !!k, last4: k.length >= 8 ? k.slice(-4) : "" };
}

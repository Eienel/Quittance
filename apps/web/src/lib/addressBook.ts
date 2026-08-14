/**
 * A local hash → XRPL address book.
 *
 * The chain stores keccak256 of the address, never the address itself, so an
 * invoice fetched cold cannot be rendered with a friendly `r...` name. We
 * remember every address the user types and resolve what we can — and show a
 * truncated hash for the rest rather than pretending we know.
 */
import { addressHash } from "./format";

const KEY = "plime.addressBook.v1";

type Book = Record<string, string>; // hash → address

function load(): Book {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Book;
  } catch {
    return {};
  }
}

function save(book: Book): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(book));
  } catch {
    // Storage full or blocked — the app still works, names just won't persist.
  }
}

/** Call this whenever the user types an XRPL address anywhere. */
export function remember(xrplAddress: string): string {
  const addr = xrplAddress.trim();
  if (!addr) return "";
  const hash = addressHash(addr);
  const book = load();
  if (book[hash] !== addr) {
    book[hash] = addr;
    save(book);
  }
  return hash;
}

/** The address behind a hash, if we have ever seen it. */
export const resolve = (hash: string): string | null => load()[hash] ?? null;

export const all = (): Book => load();

export function forget(hash: string): void {
  const book = load();
  delete book[hash];
  save(book);
}

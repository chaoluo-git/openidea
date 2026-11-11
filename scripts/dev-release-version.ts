/** Chooses a date-based release tag without replacing an existing tag. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function devReleaseVersion(date: string | undefined, tags: readonly string[]): string {
  if (!date || !/^[1-9]\d{7}$/.test(date)) throw new Error(`expected a YYYYMMDD date, got ${date}`);
  const parsed = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8))));
  if (parsed.toISOString().slice(0, 10).replace(/-/g, "") !== date) throw new Error(`invalid release date: ${date}`);

  let latest = 0;
  for (const ref of tags) {
    const tag = ref.replace(/^refs\/tags\//, "");
    if (tag === date) latest = Math.max(latest, 1);
    else if (tag.startsWith(`${date}.`)) {
      const suffix = tag.slice(date.length + 1);
      if (!/^[1-9]\d*$/.test(suffix)) continue;
      const sequence = Number(suffix);
      if (!Number.isSafeInteger(sequence) || sequence >= Number.MAX_SAFE_INTEGER) {
        throw new Error(`release sequence is too large: ${tag}`);
      }
      latest = Math.max(latest, sequence);
    }
  }
  return latest === 0 ? date : `${date}.${latest + 1}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const tags = readFileSync(0, "utf8").split(/\r?\n/).filter(Boolean);
    console.log(devReleaseVersion(process.argv[2], tags));
  } catch (error) {
    console.error(`dev-release-version: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

import { listAccounts } from "../lib/accounts";
import { ensureSchema } from "../lib/db";
import { loadCredentials } from "../lib/secrets";
import { syncAccount, syncOtherPlatforms } from "../lib/sync";

async function main() {
  await ensureSchema();
  await loadCredentials();
  const accounts = await listAccounts();
  if (accounts.length === 0) {
    console.log("No clients yet. Add one from /admin.");
    return;
  }

  // One failing client must not stop the others from updating.
  let failed = 0;
  for (const acc of accounts) {
    try {
      console.log(await syncAccount(acc));
      for (const note of await syncOtherPlatforms(acc)) {
        console.log(note);
        if (note.includes("FAILED")) failed++;
      }
    } catch (e) {
      failed++;
      console.error(`${acc.name}: FAILED`, e);
    }
  }
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

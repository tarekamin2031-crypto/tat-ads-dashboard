import { listAccounts } from "../lib/accounts";
import { ensureSchema } from "../lib/db";
import { syncAccount } from "../lib/sync";

async function main() {
  await ensureSchema();
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

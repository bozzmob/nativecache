import { createClient } from "../src/index";

export async function createIsolatedClient() {
  const client = createClient({ isolated: true });
  await client.connect();
  return client;
}

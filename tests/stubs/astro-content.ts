export async function getCollection(): Promise<never> {
  throw new Error(
    'The Astro content collection is unavailable in unit tests. Mock it explicitly when exercising local-file content mode.',
  );
}

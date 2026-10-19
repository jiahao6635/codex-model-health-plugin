export async function runBatch<T>(items: T[], concurrency: number, execute: (item: T) => Promise<void>, canContinue: () => boolean): Promise<void> {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (canContinue() && next < items.length) {
      const item = items[next++]!
      await execute(item)
    }
  }))
}

interface SyncCompletionItem {
  id: string;
  type: string;
}

interface ProcessSyncItemToCompletionOptions<Item extends SyncCompletionItem> {
  item: Item;
  process: (item: Item) => Promise<void>;
  markSaleReadyToContinue: (operationId: string) => Promise<boolean>;
  markDone: (operationId: string) => void;
}

export async function processSyncItemToCompletion<Item extends SyncCompletionItem>({
  item,
  process,
  markSaleReadyToContinue,
  markDone,
}: ProcessSyncItemToCompletionOptions<Item>): Promise<void> {
  await process(item);
  if (item.type === 'sale_order') {
    await markSaleReadyToContinue(item.id);
  }
  markDone(item.id);
}

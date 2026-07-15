// Tracks which chats are mid archived-replay session, so /play can't double-start
// one and the live watcher won't post over a running session. In its own module to
// keep calls.ts and replay.ts free of an import cycle.
const running = new Set<number>();
export const sessionActive = (chatId: number): boolean => running.has(chatId);
export const startSession = (chatId: number): void => void running.add(chatId);
export const endSession = (chatId: number): void => void running.delete(chatId);

export function safeCase(c) {
  const { solution, guestId, shareToken, ...publicCase } = c;
  return publicCase;
}

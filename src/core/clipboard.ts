/** First non-comment `text/uri-list` line, then `text/plain`. */
export function clipboardText(data: DataTransfer | null | undefined): string {
  const line = data
    ?.getData('text/uri-list')
    ?.split(/\r?\n/)
    .find((entry) => entry && !entry.startsWith('#'));
  return line?.trim() || data?.getData('text/plain') || '';
}

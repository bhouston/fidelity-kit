/**
 * Static exports and serve mode have no channel. EventSource reconnects automatically. `refresh` reloads the suite data;
 * the new data carries a new revision, which re-subscribes.
 */
export function listenForChanges(channel: { eventsUrl: string; revision: string } | null, refresh: () => unknown) {
  if (!channel || typeof EventSource === 'undefined') return;
  const events = new EventSource(channel.eventsUrl);
  let refreshing = false;
  const onRevision = (event: MessageEvent<string>) => {
    if (refreshing || event.data === channel.revision) return;
    refreshing = true;
    events.close();
    refresh();
  };
  events.addEventListener('ready', onRevision);
  events.addEventListener('change', onRevision);
  return () => events.close();
}

/** Static exports and serve mode have no channel. EventSource reconnects automatically. */
export function listenForChanges(
  channel: { eventsUrl: string; revision: string } | null,
  reload = () => window.location.reload(),
) {
  if (!channel || typeof EventSource === 'undefined') return;
  const events = new EventSource(channel.eventsUrl);
  let refreshing = false;
  const onRevision = (event: MessageEvent<string>) => {
    if (refreshing || event.data === channel.revision) return;
    refreshing = true;
    events.close();
    reload();
  };
  events.addEventListener('ready', onRevision);
  events.addEventListener('change', onRevision);
  return () => events.close();
}

export function createPreviewRequests() {
  let pending = null;

  return {
    get pending() {
      return pending?.owner ?? null;
    },
    begin(owner, isStale = () => false) {
      const request = {
        owner,
        isPending: () => pending === request,
        isCurrent: () => pending === request && !isStale(owner),
        finish() {
          if (pending !== request) return false;
          pending = null;
          return true;
        },
      };
      pending = request;
      return request;
    },
    invalidate() {
      const owner = pending?.owner ?? null;
      pending = null;
      return owner;
    },
  };
}

// Namespaces Durable Object names per Workshop binding so deployments sharing this gatekeeper stay
// isolated; not a boundary against malicious peer configs.
export const DEFAULT_SHARING_DOMAIN = "default";

// NUL never appears in domains or UUIDs.
const SEP = "\u0000";

/** Durable Object name for a domain-scoped entity. */
export function domainName(domain: string, id: string): string {
  return `${domain}${SEP}${id}`;
}

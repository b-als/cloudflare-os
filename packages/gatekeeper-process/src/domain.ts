/** Default namespace for a Workshop binding without an explicit sharing domain. */
export const DEFAULT_SHARING_DOMAIN = "default";

// NUL never appears in domains or UUIDs.
const SEP = "\u0000";

/** Durable Object name for a domain-scoped entity. */
export function domainName(domain: string, id: string): string {
  return `${domain}${SEP}${id}`;
}

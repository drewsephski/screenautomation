import type { ReactNode } from "react";

export function BrowserChrome({
  address,
  loading = false,
  badge,
  actions,
}: {
  address: string;
  loading?: boolean;
  badge?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="chrome">
      <span className="lights" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className={`address ${loading ? "loading" : ""}`}>
        <span aria-hidden="true">⌂</span>
        <span className="address-text">{address || " "}</span>
      </span>
      {badge}
      {actions}
    </div>
  );
}

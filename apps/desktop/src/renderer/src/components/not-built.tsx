/**
 * The honest surface behind a rail entry whose feature does not exist yet.
 *
 * The redesigned rail was drawn with entries for work that has not been built.
 * Shipping them as dead buttons, or worse as convincing empty dashboards, would
 * imply a product that is not there. This says what the surface is for, what
 * exists today instead, and stops.
 */
export function NotBuilt({
  title,
  titleId,
  summary,
  instead,
}: {
  readonly title: string;
  readonly titleId: string;
  readonly summary: string;
  readonly instead?: { readonly label: string; readonly detail: string };
}): React.JSX.Element {
  return (
    <section className="notBuilt" aria-labelledby={titleId}>
      <div className="notBuiltCard">
        <p className="notBuiltTag">Not built yet</p>
        <h1 id={titleId}>{title}</h1>
        <p className="notBuiltSummary">{summary}</p>
        {instead === undefined ? null : (
          <p className="notBuiltInstead">
            <strong>{instead.label}</strong> {instead.detail}
          </p>
        )}
      </div>
    </section>
  );
}

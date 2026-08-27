export function SpaceStepper({
  step,
  items,
}: {
  readonly step: 1 | 2 | 3;
  readonly items: readonly [
    { readonly n: 1; readonly label: string },
    { readonly n: 2; readonly label: string },
    { readonly n: 3; readonly label: string },
  ];
}): React.JSX.Element {
  return (
    <ol className="spaceStepper">
      {items.map((item) => (
        <li
          key={item.n}
          className={
            item.n < step ? 'spaceStepperDone' : item.n === step ? 'spaceStepperOn' : ''
          }
        >
          <i>{item.n < step ? '✓' : item.n}</i>
          {item.label}
        </li>
      ))}
    </ol>
  );
}

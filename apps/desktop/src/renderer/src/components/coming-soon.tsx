import logo from '../assets/logo.png';
import { SignalField } from './signal-field.js';

export function ComingSoon({ titleId }: { titleId: string }): React.JSX.Element {
  return (
    <section className="spaceStage" aria-labelledby={titleId} data-core-status="ready">
      <SignalField />
      <div className="spaceHome">
        <div className="spaceHomeBrand">
          <img className="spaceHomeLogo" src={logo} width={56} height={56} alt="" />
          BuilderHelm
        </div>
        <h1 id={titleId}>
          Your agents.
          <br />
          You at the helm.
        </h1>
        <p className="spaceHomeLead">Coming soon</p>
      </div>
    </section>
  );
}

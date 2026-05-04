import type { PersonaDefinition, PersonaSummary } from "@persona/shared";

type PersonaHeaderProps = {
  personaSummary: PersonaSummary | undefined;
  personaDetail: PersonaDefinition | undefined;
};

export function PersonaHeader({ personaSummary, personaDetail }: PersonaHeaderProps) {
  const persona = personaDetail ?? personaSummary;

  if (!persona) {
    return (
      <section className="hero-card">
        <p>Loading persona...</p>
      </section>
    );
  }

  return (
    <section className="hero-card">
      <div className="hero-topline">
        <div>
          <div className="eyebrow">Fictional AI Persona System</div>
          <h1>{persona.name}</h1>
        </div>
        {"theme" in persona && persona.theme ? <div className="theme-chip">{persona.theme.themeName}</div> : null}
      </div>
      <p className="hero-tagline">{persona.tagline}</p>
      <p className="hero-description hero-description-compact">{persona.description}</p>
      {personaDetail ? (
        <details className="hero-details">
          <summary>Persona details</summary>
          <div className="hero-meta-grid">
            <div>
              <span>Traits</span>
              <p>{personaDetail.personalityTraits.join(", ")}</p>
            </div>
            <div>
              <span>Speech</span>
              <p>{personaDetail.speechStyle.join(", ")}</p>
            </div>
            <div>
              <span>Catchphrases</span>
              <p>{personaDetail.catchphrases.join(" • ")}</p>
            </div>
            <div>
              <span>Voice</span>
              <p>{personaDetail.voiceProfile.speakingStyle}</p>
            </div>
          </div>
        </details>
      ) : null}
    </section>
  );
}

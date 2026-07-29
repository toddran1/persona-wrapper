import type { PersonaDefinition, PersonaSummary } from "@persona/shared";

type PersonaHeaderProps = {
  personaSummary: PersonaSummary | undefined;
  personaDetail: PersonaDefinition | undefined;
  loading: boolean;
  signedIn: boolean;
  error?: string | undefined;
  onRetry: () => void;
};

export function PersonaHeader({
  personaSummary,
  personaDetail,
  loading,
  signedIn,
  error,
  onRetry
}: PersonaHeaderProps) {
  const persona = personaDetail ?? personaSummary;

  if (!persona) {
    return (
      <section className="hero-card">
        {error ? (
          <>
            <p>Could not load personas. {error}</p>
            <button type="button" onClick={onRetry}>Try again</button>
          </>
        ) : loading ? (
          <p>Loading persona...</p>
        ) : !signedIn ? (
          <p>Sign in or create an account to explore personas and continue your chats.</p>
        ) : (
          <>
            <p>No persona is currently available.</p>
            <button type="button" onClick={onRetry}>Try again</button>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="hero-card">
      <div className="hero-layout">
        {persona.avatarUrl ? (
          <img className="hero-avatar" src={persona.avatarUrl} alt={`${persona.name} avatar`} />
        ) : null}
        <div className="hero-copy">
          <div className="hero-topline">
            <h1>{persona.name}</h1>
            {"theme" in persona && persona.theme ? <div className="theme-chip">{persona.theme.themeName}</div> : null}
          </div>
          <p className="hero-tagline">{persona.tagline}</p>
          <p className="hero-description hero-description-compact">{persona.description}</p>
        </div>
      </div>
      {personaDetail ? (
        <details className="hero-details">
          <summary>Persona details</summary>
          <div className="hero-meta-grid">
            <div>
              <span>Traits</span>
              <p>{personaDetail.personalityTraits.join(", ")}</p>
            </div>
            <div>
              <span>Voice style</span>
              <p>{personaDetail.speechStyle.join(", ")}</p>
            </div>
            <div>
              <span>Visual style</span>
              <p>{personaDetail.visualStyle.join(", ")}</p>
            </div>
          </div>
        </details>
      ) : null}
    </section>
  );
}

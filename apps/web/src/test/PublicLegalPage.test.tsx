import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { legalMobileReturnHref, PublicLegalPage, PUBLIC_PAGE_PATHS } from "../components/PublicLegalPage.js";

describe("PublicLegalPage", () => {
  it.each([
    ["/privacy", "Privacy Policy"],
    ["/terms", "Terms of Use"],
    ["/delete-account", "Delete Account Policy"],
    ["/support", "Support"]
  ])("renders %s as a public page", (path, heading) => {
    render(<PublicLegalPage path={path} />);
    expect(screen.getByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Legal and support" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to For the Baddiez" })).toHaveAttribute("href", "/");
  });

  it("provides an external account-deletion request flow", () => {
    render(<PublicLegalPage path="/delete-account" />);
    expect(screen.getByRole("heading", { name: "Request account deletion" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email or username")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verify account" })).toBeDisabled();
  });

  it("registers every required public route", () => {
    expect([...PUBLIC_PAGE_PATHS]).toEqual(["/privacy", "/terms", "/delete-account", "/support"]);
  });

  it("accepts only app deep links as mobile return targets", () => {
    expect(legalMobileReturnHref("?returnTo=personawrapper%3A%2F%2F%2F")).toBe("personawrapper:///");
    expect(legalMobileReturnHref("?returnTo=exp%3A%2F%2F127.0.0.1%3A8081%2F--%2F")).toBe("exp://127.0.0.1:8081/--/");
    expect(legalMobileReturnHref("?returnTo=https%3A%2F%2Fevil.example")).toBeUndefined();
    expect(legalMobileReturnHref("?returnTo=javascript%3Aalert(1)")).toBeUndefined();
  });

  it("states that users must be at least 16 years old", () => {
    render(<PublicLegalPage path="/terms" />);
    expect(screen.getByText("You must be 16 years of age or older to create an account or use the Service.", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("If you are 16 or 17, you may use the Service only with permission from a parent or legal guardian.", { exact: false })).toBeInTheDocument();
  });

  it("disclaims persona representation and affiliation", () => {
    render(<PublicLegalPage path="/terms" />);
    expect(screen.getByText("Personas are not intended to represent, portray, or identify any specific person, place, group, gang, or organization.", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Neither the personas nor the Service is affiliated with, endorsed by, sponsored by, or approved by any person, place, group, gang, or organization", { exact: false })).toBeInTheDocument();
  });

  it("identifies the operator and Texas governing law", () => {
    render(<PublicLegalPage path="/terms" />);
    expect(screen.getAllByText("Reginald Randolph", { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("2949 Parkwood Blvd, Frisco, TX 75034", { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getByText("governed by the laws of the State of Texas", { exact: false })).toBeInTheDocument();
  });

  it("covers archive imports, output rights, reporting, complaints, and terms changes", () => {
    render(<PublicLegalPage path="/terms" />);
    expect(screen.getByText("You may not import another person’s account archive", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("you may use AI-generated output produced for you for lawful personal or commercial purposes", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "9. Intellectual-property complaints" })).toBeInTheDocument();
    expect(screen.getByText("Use the response actions in the app to report unsafe", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "17. Changes to these Terms" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Standard Licensed Application End User License Agreement" })).toHaveAttribute("href", "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/");
  });

  it("explains plan credits, combined quotas, image quality, and future subscriptions", () => {
    render(<PublicLegalPage path="/terms" />);
    expect(screen.getByRole("heading", { name: "5. Plans, credits, usage limits, and subscriptions" })).toBeInTheDocument();
    expect(screen.getByText("They are not money, stored value, property", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Images and audio may also consume category-specific", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Bronze and Silver image generation is limited to no more than medium", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("does not guarantee high quality", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Deleting an account does not itself cancel a third-party subscription.", { exact: false })).toBeInTheDocument();
  });

  it("explains service shutdown, billing, credits, exports, and account-data handling", () => {
    render(<PublicLegalPage path="/terms" />);
    expect(screen.getByRole("heading", { name: "11. Availability, changes, and permanent service discontinuation" })).toBeInTheDocument();
    expect(screen.getByText("stop new purchases and future subscription renewals", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("through the original billing provider", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("promotional, bonus, tester, support-granted", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("a period during which you can access the Service and export supported account data", { exact: false })).toBeInTheDocument();

    render(<PublicLegalPage path="/privacy" />);
    expect(screen.getByText("Service closure:", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("provide instructions for exporting available account data", { exact: false })).toBeInTheDocument();
  });

  it("provides a retention schedule and regional privacy supplements", () => {
    render(<PublicLegalPage path="/privacy" />);
    expect(screen.getByRole("heading", { name: "8. Retention schedule" })).toBeInTheDocument();
    expect(screen.getByText("Import files and downloadable export ZIPs:", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "10. California privacy supplement" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "11. EEA and UK privacy supplement" })).toBeInTheDocument();
    expect(screen.getByText("is the controller for personal data", { exact: false })).toBeInTheDocument();
  });

  it("discloses storage, telemetry, and configured service providers", () => {
    render(<PublicLegalPage path="/privacy" />);
    expect(screen.getByRole("heading", { name: "4. Cookies, device storage, and telemetry" })).toBeInTheDocument();
    expect(screen.getByText("may ask for operating-system or browser foreground-location permission", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("We do not request background or continuous location access.", { exact: false })).toBeInTheDocument();
    for (const provider of ["OpenAI:", "Google Gemini:", "Fish Audio:", "ElevenLabs:", "Cloudflare R2:", "Render:", "Google, Facebook, and Apple OAuth:", "Google Gmail SMTP:", "RevenueCat, Apple, and Google Play:", "Configured OpenTelemetry providers:"]) {
      expect(screen.getByText(provider, { exact: false })).toBeInTheDocument();
    }
  });

  it("discloses plan metering, pseudonymous abuse signals, and usage retention", () => {
    render(<PublicLegalPage path="/privacy" />);
    expect(screen.getByText("plan identifier and version", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("deployment-keyed cryptographic function", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Measure plan usage; reserve, settle, release, and reconcile usage", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("currently retained for up to 400 days", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("when billing is enabled", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("remove or clear conversation memories", { exact: false })).toBeInTheDocument();
  });
});

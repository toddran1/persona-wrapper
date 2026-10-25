import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GUIDES, LearnPage } from "./components/LearnPage.js";

export const learnPages = [
  {
    path: "/learn",
    title: "Learn | For the Baddiez",
    description: "Practical guides to persona conversations, AI images, privacy, location, and finding current sources with For the Baddiez."
  },
  ...GUIDES.map((guide) => ({
    path: `/learn/${guide.slug}`,
    title: `${guide.title} | FTB Learn`,
    description: guide.dek
  }))
];

export function renderLearnPage(path: string): string {
  return renderToString(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/learn" element={<LearnPage />} />
        <Route path="/learn/:slug" element={<LearnPage />} />
      </Routes>
    </MemoryRouter>
  );
}

import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { PublisherContentAd } from "../advertising/PublisherContentAd.js";

type GuideSection = {
  title: string;
  paragraphs: string[];
  note?: string;
};

type Guide = {
  slug: string;
  category: string;
  title: string;
  dek: string;
  readingTime: string;
  updated: string;
  takeaway: string;
  sections: GuideSection[];
};

const GUIDES: Guide[] = [
  {
    slug: "better-persona-conversations",
    category: "Conversation craft",
    title: "How to get a persona response that still answers the question",
    dek: "A practical way to control tone, context, length, and follow-ups without turning every prompt into a technical specification.",
    readingTime: "7 minute read",
    updated: "September 14, 2026",
    takeaway: "Give the task first, then the context, then the voice or format you want. A persona should shape the delivery—not replace the answer.",
    sections: [
      {
        title: "Start with the job",
        paragraphs: [
          "The strongest persona prompts begin with a concrete job: compare two plans, explain a bill, outline a video, rewrite a message, or help choose between options. Put that job in the first sentence. When the request begins with several paragraphs of mood or backstory, the model has to infer which detail is the assignment and which details are atmosphere.",
          "A useful structure is: “Compare these three options for my budget. I care most about reliability, then price. Give me your pick in Chinga’s voice.” The comparison remains the center of the request, while the persona controls pacing, vocabulary, and attitude. This also makes it easier to notice when the response missed the task."
        ],
        note: "Task → constraints → voice. That order keeps the answer useful."
      },
      {
        title: "Say what should carry forward",
        paragraphs: [
          "Conversation history helps with natural follow-ups, but words such as “this,” “that one,” “the second,” and “same style” can point to more than one earlier item. Name the thing when the distinction matters: “Use the second pricing option from your last answer” is safer than “use that one.” If an image, file, or link is essential, attach it again when practical or explicitly say which earlier item you mean.",
          "A new subject should sound like a new subject. Phrases such as “separate question” or “ignore the earlier image for this answer” help prevent old visual context from entering a text-only request. You do not need to do this in every turn; use it when the conversation has recently mixed images, files, links, and ordinary chat."
        ]
      },
      {
        title: "Control length without losing substance",
        paragraphs: [
          "“Keep it short” can mean a sentence, a paragraph, or a short list. Give the response a container: “three bullets,” “under 150 words,” or “a quick recommendation followed by one reason.” When audio is enabled, shorter answers also conserve listening time and make interruptions less likely.",
          "For a complicated topic, ask for a first-pass decision and then drill down. “Give me the top three and your pick” creates a better first turn than requesting every feature, price, exception, and source at once. Follow-up questions can use the original answer as an outline instead of rebuilding the whole comparison."
        ],
        note: "A format limit is more reliable than an adjective like “brief.”"
      },
      {
        title: "Correct the response in place",
        paragraphs: [
          "When an answer is close, describe the mismatch rather than sending the original prompt unchanged. Try: “Keep the recommendations, but compare monthly cost,” or “Answer the practical question before the persona commentary.” That tells the system what succeeded and what needs revision.",
          "Start a new chat when the old conversation contains unrelated media or when you want a clean evaluation. Continue the same chat when continuity is the point. This simple choice often matters more than adding another paragraph of instructions."
        ]
      }
    ]
  },
  {
    slug: "better-ai-images",
    category: "Image direction",
    title: "Directing AI images without losing the persona",
    dek: "Separate identity from wardrobe, setting, composition, and mood so the image model knows what must stay and what must change.",
    readingTime: "8 minute read",
    updated: "September 14, 2026",
    takeaway: "Describe identity as the constant. Describe clothing, setting, pose, and framing as variables that should follow the current request.",
    sections: [
      {
        title: "Build the scene in layers",
        paragraphs: [
          "An image request has several independent decisions: who is shown, what they wear, where they are, what they are doing, how the camera frames them, and what visual mood the result should have. Models sometimes borrow an outfit or background from an identity reference because those details are visible even when they are not part of the intended character identity.",
          "State the change directly: “Create Chinga at a bright public beach, wearing a teal two-piece swimsuit, full-body, natural afternoon light. Preserve her face and hair; replace the reference outfit and studio background.” The last sentence draws a clean boundary between identity and scene."
        ],
        note: "Identity stays. Wardrobe, pose, props, and background follow the new request."
      },
      {
        title: "Use wardrobe language precisely",
        paragraphs: [
          "If clothing matters, name the complete outfit rather than one garment. “A black jacket” may leave the reference pants and accessories in place. “A black cropped jacket, white tank, straight-leg jeans, no handbag” gives the generator a coherent replacement wardrobe.",
          "For an uploaded garment, say whether the upload is an exact product reference or general inspiration. Exact matching calls for preserving color, cut, fabric, and pattern. Inspiration allows the system to adapt those qualities to the scene. If the upload shows a person wearing the item, clarify that the person is not an additional subject."
        ]
      },
      {
        title: "Choose composition before decoration",
        paragraphs: [
          "Camera instructions prevent many disappointing crops. Use familiar terms such as close-up, waist-up, three-quarter, or full-body, then add orientation and viewpoint. A full-body vertical portrait needs room around the feet; a landscape banner needs negative space around the subject for the wide frame.",
          "Lighting and mood should come after composition. “Full-body portrait, eye-level camera, morning window light, calm editorial mood” gives each instruction a job. Long piles of style words can conflict with one another and can overpower the requested clothing or action."
        ],
        note: "Subject → wardrobe → setting → framing → light. Stop when every phrase has a job."
      },
      {
        title: "Make follow-up edits explicit",
        paragraphs: [
          "For a generated image follow-up, identify both the source and the change: “Edit the latest image; keep her face, pose, and beach setting, but make the swimsuit burgundy.” If you want a fresh composition, say “create a new version” rather than “change it.” Editing aims to preserve; regeneration gives the model permission to reinterpret.",
          "When several images exist in the conversation, use a visible description or ordinal tied to the correct set: “the first beach image,” “the latest generated version,” or “my uploaded jacket photo.” Avoid relying on a number that could be mistaken for a quantity, size, date, or image position."
        ]
      }
    ]
  },
  {
    slug: "privacy-memory-location",
    category: "Privacy controls",
    title: "What memory and location change in a conversation",
    dek: "Understand what is temporary, what can carry across turns, and how to use location-aware questions without sharing more than needed.",
    readingTime: "6 minute read",
    updated: "September 14, 2026",
    takeaway: "Share only the context the task needs. Use conversation controls when you want continuity, and start clean when you do not.",
    sections: [
      {
        title: "Conversation history is working context",
        paragraphs: [
          "Messages in the active conversation help a persona understand follow-ups. That is useful when you are refining a plan or comparing several options, but it can also make ambiguous references harder to resolve after the conversation changes subjects. Starting a new chat creates a clearer boundary than asking the model to mentally discard dozens of earlier turns.",
          "Conversation memory is a compact continuity aid, not a perfect transcript. It can summarize preferences or unresolved goals, and it can be wrong. Treat important facts as details to confirm, especially before making financial, health, legal, or safety decisions."
        ]
      },
      {
        title: "Location is requested for a specific job",
        paragraphs: [
          "Questions such as “What is the weather near me?” or “Find coffee nearby” need a place. If you grant browser or device location, the app can attach an approximate location to that request. It does not need continuous background tracking to answer a foreground question.",
          "You can always provide a city instead. “Weather in Frisco, Texas” is often enough and avoids device permission entirely. For travel planning, name the destination rather than sharing your current location."
        ],
        note: "A city is usually sufficient. Precise coordinates should be the exception."
      },
      {
        title: "Files and links have different boundaries",
        paragraphs: [
          "An uploaded file becomes direct request context. A public link may provide only page text, metadata, captions, or a transcript depending on what the source allows. A private or expired link may not be accessible at all. If exact content matters, upload a file you are authorized to use instead of assuming the link can be opened.",
          "Do not upload passwords, payment credentials, private keys, medical records, or confidential material that the task does not require. Removing unnecessary pages or fields before upload reduces both privacy exposure and distraction in the answer."
        ]
      },
      {
        title: "Know when to clear context",
        paragraphs: [
          "Clear memory when a saved preference is no longer correct. Delete a conversation when you no longer want that conversation retained in the active product. Account deletion is a broader operation with a recovery period and should not be used as a substitute for ordinary conversation cleanup.",
          "Before sharing an AI response, check whether it repeats details from your prompt, attachments, or earlier conversation. The model can produce a useful answer while still including context you did not intend to publish. Review is part of the workflow, not an optional final polish."
        ]
      }
    ]
  },
  {
    slug: "sources-files-current-answers",
    category: "Research workflow",
    title: "When to use search, links, and files for a current answer",
    dek: "Pick the right source path for changing facts, long documents, public pages, and material you already have.",
    readingTime: "7 minute read",
    updated: "September 14, 2026",
    takeaway: "Use search for discovery, a direct link for a known public source, and an upload when the exact document is the evidence.",
    sections: [
      {
        title: "Match the source to the question",
        paragraphs: [
          "Current prices, schedules, availability, rules, and product features can change quickly. Ask for a current search and include the date or market that matters. For a known official page, share the direct URL and say what to inspect. For a document already on your device, upload it and identify the pages, table, or decision you care about.",
          "These paths are complementary. Search discovers candidates; a direct source verifies a specific claim; a file supports close analysis. Asking for all three without explaining the goal can add noise rather than confidence."
        ]
      },
      {
        title: "Ask for evidence you can check",
        paragraphs: [
          "A useful sourced answer distinguishes facts from recommendations. Ask for links next to the claims they support and request the date when timing matters. If the answer infers a conclusion from several facts, it should say that the conclusion is an inference rather than language copied from a source.",
          "For comparisons, define the same fields for every option: monthly price, included usage, limits, cancellation terms, and source date. A consistent comparison makes missing evidence visible instead of hiding it inside persuasive prose."
        ],
        note: "Good research makes uncertainty visible instead of decorating it away."
      },
      {
        title: "Treat excerpts as partial context",
        paragraphs: [
          "A transcript can omit visuals. Page extraction can miss interactive tables. Search snippets can be stale or shortened. When the format matters, ask whether the answer used the full source, a transcript, extracted text, or metadata. That question often explains why an answer seems unrelated to what you saw on screen.",
          "If the source cannot be reached, provide the relevant text or a screenshot you are allowed to share. Explain what the image shows and what conclusion you need. The combination of visual evidence and a precise question is more reliable than a bare screenshot."
        ]
      },
      {
        title: "Finish with a decision rule",
        paragraphs: [
          "Research becomes useful when it changes an action. End a comparison request with a decision rule: “Recommend the least expensive option that supports three ten-second videos a month,” or “Choose the plan with predictable cost over the largest feature list.” The rule keeps the answer grounded in your actual use.",
          "Recheck the decisive facts before spending money or publishing a claim. AI can organize evidence and expose tradeoffs, but the linked source—not the confidence of the wording—should settle a changing fact."
        ]
      }
    ]
  }
];

function LearnHeader() {
  return <header className="learn-header">
    <Link className="learn-brand" to="/learn" aria-label="For the Baddiez Learn home">
      <img src="/FTB_logo/For_the_Baddiez_logo_transparent.png" alt="" />
      <span><strong>For the Baddiez</strong><small>Learn</small></span>
    </Link>
    <nav aria-label="Learn navigation">
      <Link to="/learn">All guides</Link>
      <Link to="/privacy">Privacy</Link>
      <Link to="/support">Support</Link>
      <Link className="learn-open-app" to="/">Open the app</Link>
    </nav>
  </header>;
}

function LearnFooter() {
  return <footer className="learn-footer">
    <span>© {new Date().getFullYear()} For the Baddiez</span>
    <nav aria-label="Learn footer"><Link to="/terms">Terms</Link><Link to="/privacy">Privacy</Link><Link to="/support">Support</Link></nav>
  </footer>;
}

function GuideIndex() {
  useEffect(() => {
    document.title = "Learn | For the Baddiez";
    return () => { document.title = "For the Baddiez"; };
  }, []);

  return <main className="learn-shell">
    <LearnHeader />
    <section className="learn-hero">
      <div className="learn-signal" aria-hidden="true"><span /><i /><span /></div>
      <p className="learn-kicker">The field manual</p>
      <h1>Better prompts.<br /><em>Fewer crossed wires.</em></h1>
      <p className="learn-hero-copy">Practical, product-specific guidance for working with persona conversations, image references, current sources, memory, and location.</p>
    </section>
    <section className="learn-index" aria-labelledby="learn-guide-heading">
      <div className="learn-index-heading">
        <p>Curated by the FTB editorial desk</p>
        <h2 id="learn-guide-heading">Start with the thing you’re trying to control.</h2>
      </div>
      <div className="learn-guide-list">
        {GUIDES.map((guide, index) => <article className="learn-guide-card" key={guide.slug}>
          <div className="learn-guide-marker" aria-hidden="true">{String(index + 1).padStart(2, "0")}</div>
          <div>
            <p className="learn-guide-meta"><span>{guide.category}</span><span>{guide.readingTime}</span></p>
            <h3><Link to={`/learn/${guide.slug}`}>{guide.title}</Link></h3>
            <p>{guide.dek}</p>
          </div>
          <Link className="learn-guide-arrow" to={`/learn/${guide.slug}`} aria-label={`Read ${guide.title}`}>↗</Link>
        </article>)}
      </div>
    </section>
    <section className="learn-editorial-note">
      <p className="learn-kicker">How these guides are made</p>
      <h2>Specific to the product. Written for decisions.</h2>
      <p>These guides explain how For the Baddiez behaves and where its limits matter. They avoid publishing private conversations, do not treat generated answers as source material, and are updated when product behavior changes.</p>
    </section>
    <LearnFooter />
  </main>;
}

function GuideArticle({ guide }: { guide: Guide }) {
  useEffect(() => {
    document.title = `${guide.title} | FTB Learn`;
    return () => { document.title = "For the Baddiez"; };
  }, [guide.title]);

  return <main className="learn-shell learn-article-shell">
    <LearnHeader />
    <article className="learn-article">
      <Link className="learn-back" to="/learn">← All guides</Link>
      <header className="learn-article-header">
        <p className="learn-kicker">{guide.category}</p>
        <h1>{guide.title}</h1>
        <p className="learn-article-dek">{guide.dek}</p>
        <div className="learn-byline"><span>FTB editorial desk</span><span>Updated {guide.updated}</span><span>{guide.readingTime}</span></div>
      </header>
      <aside className="learn-takeaway"><span>The short version</span><p>{guide.takeaway}</p></aside>
      <div className="learn-article-body">
        {guide.sections.map((section, index) => <div key={section.title}>
          <section className="learn-article-section">
            <div className="learn-section-signal" aria-hidden="true"><span>{String(index + 1).padStart(2, "0")}</span><i /></div>
            <div><h2>{section.title}</h2>{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}{section.note ? <blockquote>{section.note}</blockquote> : null}</div>
          </section>
          {index === 1 ? <PublisherContentAd /> : null}
        </div>)}
      </div>
      <nav className="learn-next" aria-label="More guides">
        <span>Keep learning</span>
        {GUIDES.filter((candidate) => candidate.slug !== guide.slug).slice(0, 2).map((candidate) => <Link key={candidate.slug} to={`/learn/${candidate.slug}`}>{candidate.title}<b aria-hidden="true">↗</b></Link>)}
      </nav>
    </article>
    <LearnFooter />
  </main>;
}

export function LearnPage() {
  const { slug } = useParams();
  if (!slug) return <GuideIndex />;
  const guide = GUIDES.find((candidate) => candidate.slug === slug);
  if (!guide) return <main className="learn-shell"><LearnHeader /><section className="learn-missing"><p className="learn-kicker">Guide not found</p><h1>That page isn’t in the manual.</h1><Link to="/learn">Browse all guides</Link></section><LearnFooter /></main>;
  return <GuideArticle guide={guide} />;
}

export { GUIDES };

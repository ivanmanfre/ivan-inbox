# Brain-B Revamp Inspo — 21st.dev Mining Summary

Run: brain-b-revamp-inspo-2026-09-05 · Mining seat output

## Counts
- Tags crawled: 83 (0 failures)
- Search queries run: 18 (0 failures, 18 results each = 324 raw hits)
- Unique components (tags ∪ search): **2117** (note: exceeds the 400-700 estimate — 21st.dev tag pages returned a broader set per tag than anticipated, avg ~40/tag across 83 tags)
- Page detail fetches: 1908 attempted (needed — search already supplied 209), **0 failures**
- Previews downloaded: **2117** / 2117 (0 failures after fixing a trailing-backslash bug in the page-scrape regex that broke ~1858 raw CDN URLs on the first pass)
- Sources fetched (top 5/surface): 36 unique targets attempted (12 surfaces × top 5, deduped for components spanning multiple surfaces), **only 1 succeeded** — see Dependency section below for why

## Per-tag counts (components attributed to each tag)

| Tag | Count |
|---|---|
| scroll-area | 169 |
| ai-chat | 151 |
| list | 146 |
| notification | 145 |
| card | 136 |
| navigation | 136 |
| badge | 125 |
| status | 120 |
| tabs | 114 |
| drag-and-drop | 108 |
| indicator | 93 |
| spring | 92 |
| stagger | 73 |
| stacked | 66 |
| chat-input | 64 |
| upload | 64 |
| animated-card | 52 |
| chat | 49 |
| micro-interaction | 49 |
| chip | 48 |
| pulse | 48 |
| skeleton | 47 |
| empty-state | 43 |
| macos | 43 |
| ai-chat-input | 41 |
| dismissible | 41 |
| timeline | 40 |
| sticky | 40 |
| real-time | 39 |
| dock | 38 |
| toast | 38 |
| fluid | 38 |
| drawer | 37 |
| infinite-scroll | 37 |
| segmented-control | 34 |
| message | 33 |
| morph | 32 |
| stack | 31 |
| voice | 30 |
| apple | 27 |
| attachment | 27 |
| like | 26 |
| command-palette | 26 |
| physics | 26 |
| header | 24 |
| waveform | 23 |
| animated-tab | 23 |
| streaming | 22 |
| alert-toast | 22 |
| mobile | 21 |
| sortable | 21 |
| in-view | 21 |
| activity | 19 |
| swipe | 19 |
| mobile-navbar | 19 |
| thinking | 18 |
| link-preview | 17 |
| audio | 17 |
| comment | 16 |
| tool-call | 16 |
| messaging | 16 |
| sheet | 16 |
| floating-action-menu | 15 |
| conversation | 14 |
| iphone | 14 |
| mobile-app | 14 |
| no-data | 13 |
| ai-loader | 12 |
| smooth | 12 |
| reasoning | 10 |
| floating-action-button | 8 |
| reaction | 8 |
| info-card | 7 |
| relative-time | 7 |
| composer | 6 |
| native | 4 |
| bottom-sheet | 2 |
| app-shell | 1 |
| feed | 1 |
| ios | 1 |

## Per-surface counts

| Surface | Count |
|---|---|
| feed-cards | 639 |
| header-status | 596 |
| other | 478 |
| thread-answer | 359 |
| running-thinking | 259 |
| tab-bar-navigation | 215 |
| composer-attachments-voice | 198 |
| dismiss-swipe | 198 |
| grouped-stack | 151 |
| sheet-drawer | 51 |
| empty-state | 50 |
| link-preview | 28 |

## Failures
- Tag crawl: none
- Search: none
- Page detail fetch: none (0 recorded, all zero)
- Preview download: none on final pass (first pass had 1807 due to a URL-parsing bug, fixed and re-run to 0 failures)

## Dependency table (top 5 per surface, `source` fetches)

**Hard blocker: the 21st.dev registry `source` endpoint (`/r/<user>/<slug>`) is rate-limited to 2 retrievals/day on this API key's plan** (`error: "Marketplace membership required"`, `reason: "retrieval_limit_reached"`, `resetAt: 2026-09-06T00:00:00Z`). Of the 36 unique top-5-per-surface targets attempted (concurrency 6), only **1** returned real registry JSON before the daily cap hit — `@jahed/spotlight-card`, and even that component declared empty `dependencies` and `registryDependencies` arrays (no external libs). The other 35 came back as valid JSON (HTTP 200) but with an `error` field instead of `files`/`dependencies`, so they were not counted as failures by the fetch script but carry no source data — flagging that distinction here rather than in the failure count above.

**Practical consequence:** a real dependency frequency table (`motion`/`framer-motion`, `@radix-ui/*`, `lucide-react`, `vaul`, `embla`, etc.) cannot be built from this key today. Options for a follow-up seat: (a) wait for the daily reset (2026-09-06 00:00 UTC) and re-run `fetch_sources.mjs` at 36 targets, 2/day means ~18 days to clear the full list — impractical; (b) upgrade the 21st.dev key to Marketplace membership; (c) infer dependencies heuristically from each component's `install_command` string (all sampled ones read `npx shadcn@latest add "https://21st.dev/r/<user>/<slug>?api_key=..."`, which doesn't surface the underlying npm packages) — not a substitute for real registry data. Recommend (b) if the dependency table is needed for the build seat.

## Top 8 by usage, per surface

### feed-cards (639 total)

| Name | Author | Usage | Description |
|---|---|---|---|
| Button | originui | 7457 | Enhanced shadcn/ui button |
| Input | originui | 3626 | Upgaraded shadcn/ui Input |
| Timeline | manuarora700 | 3463 | A timeline component with sticky header and scroll beam follow. |
| Spotlight Card | jahed | 2105 |  |
| Carousel | shadcn | 1939 | A carousel with motion and swipe built using Embla. |
| Dialog | originui | 1908 | Enhanced shadcn/ui dialog |
| AI prompt Box | jahed | 1868 | AI prompt Box, AI chat Input, AI chat box, with search, with think, with thinking, with canvas, with audio recording |
| Popover | shadcn | 1561 | Displays rich content in a portal, triggered by a button. |

### header-status (596 total)

| Name | Author | Usage | Description |
|---|---|---|---|
| Button | originui | 7457 | Enhanced shadcn/ui button |
| Timeline | manuarora700 | 3463 | A timeline component with sticky header and scroll beam follow. |
| Table | originui | 2189 | Shadcn table with enhanced appearance |
| Stepper | originui | 1075 | Stepper |
| Popover | originui | 965 | Enhanced shadcn/ui popover |
| Avatar | sean0205 | 888 | An image element with a fallback for representing the user. |
| Dock | anurag-mishra22 | 597 | Cool Animated Dock |
| Toast | arunachalam | 488 | The Toaster component is a customizable toast notification system built on top of the Sonner library. It provides a flexible, animated UI for in-app alerts, des |

### other (478 total)

| Name | Author | Usage | Description |
|---|---|---|---|
| Animated Group | ibelick | 1977 | A wrapper that adds animated transitions to a group of child elements. It's perfect for creating staggered animations for lists, grids, or any collection of com |
| Animated Text Cycle | thimows | 492 | Component to smoothly animate a list of words. Can be used in Hero sections for example. Built using Framer Motion. Animation can be easily changed in the compo |
| Animated Slideshow | youcefbnm | 363 | - Animated hover slider |
| Animated Counter | preetsuthar17 | 165 | A simple animated counter component. |
| In view | ibelick | 156 | Easily animate elements when they come into view. You can apply animations to elements when they enter the viewport, or when they are fully visible. |
| Rolling List | daiwiikharihar | 104 | Animated process list with hover roll text and image preview. |
| Interactive Accordion | jatin-yadav05 | 103 | A minimal accordion with numbered items featuring smooth spring animations, rotating plus-to-X icons, and progressive underline hover effects. |
| Animated Subscribe Button | dillionverma | 89 | An animated subscribe button useful for showing a micro animation from intial to final result. |

### thread-answer (359 total)

| Name | Author | Usage | Description |
|---|---|---|---|
| Table | originui | 2189 | Shadcn table with enhanced appearance |
| AI prompt Box | jahed | 1868 | AI prompt Box, AI chat Input, AI chat box, with search, with think, with thinking, with canvas, with audio recording |
| Chatgpt Prompt Input | jahed | 1397 | This is a complete replica of the chatgpt prompt input some may call it chat input or prompt box or promptbox |
| Interactive Bento Gallery | anurag-mishra22 | 622 | Interactive Bento Gallery |
| Message loading | jakobhoeg | 528 | Message Loading animation |
| Chat Input | Alwurts | 442 | AI Chat Input |
| Message Dock | isaiahbjork | 436 | This is an animated, expandable message dock component that allows users to select a character and send contextual messages through a sleek, reactive UI. It sup |
| CardStack | ruixen.ui | 384 | An interactive 3D card stack carousel with fan-out animation, drag gestures, and auto-advance support. |

### running-thinking (259 total)

| Name | Author | Usage | Description |
|---|---|---|---|
| AI prompt Box | jahed | 1868 | AI prompt Box, AI chat Input, AI chat box, with search, with think, with thinking, with canvas, with audio recording |
| Skeleton | shadcn | 1033 | Use to show a placeholder while content is loading. |
| Avatar | sean0205 | 888 | An image element with a fallback for representing the user. |
| Message loading | jakobhoeg | 528 | Message Loading animation |
| Stepper | sean0205 | 480 | A step-by-step process for users to navigate through a series of steps. |
| Carousel | ibelick | 476 | A flexible and easy-to-use carousel with customizable navigation and indicators. |
| Flow Field Background | jahed | 394 | A high-performance, generative art background that mimics GLSL Shader fluid dynamics using the lightweight HTML5 Canvas API. This component creates a "living" d |
| Spinner | shugar | 378 | Indicate an action running in the background. Unlike the loading dots, this should generally be used to indicate loading feedback in response to a user action,  |

### tab-bar-navigation (215 total)

| Name | Author | Usage | Description |
|---|---|---|---|
| Tabs | shadcn | 1256 | A set of layered sections of content—known as tab panels—that are displayed one at a time. |
| Stepper | originui | 1075 | Stepper |
| Tabs | originui | 1048 | Enchanced shadcn/ui tabs |
| Dock | anurag-mishra22 | 597 | Cool Animated Dock |
| Stepper | sean0205 | 480 | A step-by-step process for users to navigate through a series of steps. |
| Message Dock | isaiahbjork | 436 | This is an animated, expandable message dock component that allows users to select a character and send contextual messages through a sleek, reactive UI. It sup |
| Radio Group | originui | 371 | Enhanced shadcn/ui radio group |
| Tabs | sean0205 | 318 | A set of layered sections of content—known as tab panels—that are displayed one at a time. |

### composer-attachments-voice (198 total)

| Name | Author | Usage | Description |
|---|---|---|---|
| Input | originui | 3626 | Upgaraded shadcn/ui Input |
| Dialog | originui | 1908 | Enhanced shadcn/ui dialog |
| AI prompt Box | jahed | 1868 | AI prompt Box, AI chat Input, AI chat box, with search, with think, with thinking, with canvas, with audio recording |
| Chatgpt Prompt Input | jahed | 1397 | This is a complete replica of the chatgpt prompt input some may call it chat input or prompt box or promptbox |
| AI Voice Input | kokonutd | 763 | A voice input component with an animated visualizer and recording timer. It includes a demo mode, customizable visualizer, and recording callbacks.  Features: 	 |
| Message loading | jakobhoeg | 528 | Message Loading animation |
| Chat Input | Alwurts | 442 | AI Chat Input |
| Message Dock | isaiahbjork | 436 | This is an animated, expandable message dock component that allows users to select a character and send contextual messages through a sleek, reactive UI. It sup |

### dismiss-swipe (198 total)

| Name | Author | Usage | Description |
|---|---|---|---|
| Button | originui | 7457 | Enhanced shadcn/ui button |
| Table | originui | 2189 | Shadcn table with enhanced appearance |
| Carousel | shadcn | 1939 | A carousel with motion and swipe built using Embla. |
| Popover | originui | 965 | Enhanced shadcn/ui popover |
| Interactive Bento Gallery | anurag-mishra22 | 622 | Interactive Bento Gallery |
| Toast | arunachalam | 488 | The Toaster component is a customizable toast notification system built on top of the Sonner library. It provides a flexible, animated UI for in-app alerts, des |
| Carousel | manuarora700 | 437 | A customizable carousel with microinteractions and slider. |
| Feature Carousel | ravikatiyar162 | 399 | Feature Carousel Interactive showcase for highlighting multiple app features in a swipeable, modern layout. Perfect for engaging users while promoting mobile-fr |

### grouped-stack (151 total)

| Name | Author | Usage | Description |
|---|---|---|---|
| Table | originui | 2189 | Shadcn table with enhanced appearance |
| Popover | originui | 965 | Enhanced shadcn/ui popover |
| Avatar | sean0205 | 888 | An image element with a fallback for representing the user. |
| Toast | arunachalam | 488 | The Toaster component is a customizable toast notification system built on top of the Sonner library. It provides a flexible, animated UI for in-app alerts, des |
| Cards Stack | youcefbnm | 470 | - Stack of cards to showcase a related set of element, like your services, your work, features, process of work, timeline,  |
| Alert | serafimcloud | 425 | Alert in shadcn/ui format |
| CardStack | ruixen.ui | 384 | An interactive 3D card stack carousel with fan-out animation, drag gestures, and auto-advance support. |
| Radio Group | originui | 371 | Enhanced shadcn/ui radio group |

### sheet-drawer (51 total)

| Name | Author | Usage | Description |
|---|---|---|---|
| Table | originui | 2189 | Shadcn table with enhanced appearance |
| Footer section | arihantcodes_1f7b8c4d | 2049 | Basic footer section with theme toggle |
| Footer | nevsky118 | 1286 | Footer |
| Tabs | shadcn | 1256 | A set of layered sections of content—known as tab panels—that are displayed one at a time. |
| Accordion | originui | 1041 | Enchanced shadcn/ui accordion |
| Drawer | coss.com | 44 | A panel that slides in from the edge of the screen with swipe gestures, snap points, and nested drawer support. Supports bottom, top, left, and right positions  |
| Smart Popover | efferd | 41 | This SmartPopover gives you a mobile-first popover/drawer combo that auto-adapts based on screen size. It wraps Radix Popover and Vaul Drawer with a shared cont |
| Animated Drawer | arihantcodes_1f7b8c4d | — | A bottom drawer built on vaul that smoothly animates its height as it transitions between multiple views, shown here as a crypto wallet settings panel. |

### empty-state (50 total)

| Name | Author | Usage | Description |
|---|---|---|---|
| Separator | shadcn | 3962 | Visually or semantically separates content. |
| Stepper | originui | 1075 | Stepper |
| Skeleton | shadcn | 1033 | Use to show a placeholder while content is loading. |
| Avatar | sean0205 | 888 | An image element with a fallback for representing the user. |
| Empty State | serafimcloud | 774 | Empty state card with shadcn/ui buttons.  Inspired by @AndyRyanWeir |
| Toggle | shadcn | 761 | A two-state button that can be either on or off. |
| Empty | shadcn | 256 | Here is Empty components |
| Interactive Empty State | remcostoeten | 213 | Beautiful and modular empty state components based of  https://21st.dev/serafimcloud/empty-state/default |

### link-preview (28 total)

| Name | Author | Usage | Description |
|---|---|---|---|
| Spotlight Card | jahed | 2105 |  |
| Card Spotlight | manuarora700 | 470 | A card component with a spotlight effect revealing a radial gradient background |
| Link Preview | manuarora700 | 336 | Dynamic link previews for your anchor tags |
| Project Showcase | jatin-yadav05 | 326 | A minimal, list-based portfolio section with a cursor-following image preview. On hover, a smooth floating image appears and tracks your mouse using lerp-based  |
| Moving Dot Card | minhxthanh | 191 | A dynamic views counter card featuring an animated dot traversing the border, gradient-highlighted count display, and stylized corner lines for a sci-fi UI effe |
| Hover Card | shadcn | 155 | For sighted users to preview content available behind a link. |
| Gradient Card Showcase | minhxthanh | 142 | Displays a set of interactive cards with skewed gradient back-panels, glowing blur highlights, and smooth hover transitions |
| Profile Card | isaiahbjork | 133 | This is a high-fidelity Animated Profile Card component designed for user discovery or social interactions. It includes layered blur effects, animated reveal of |

